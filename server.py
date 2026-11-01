#!/usr/bin/env python3
"""Signal Desk: a dependency-free local API with SQLite full-text search."""
from __future__ import annotations

import argparse
from contextlib import closing
from datetime import datetime, timezone
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
import re
import sqlite3
import sys
from urllib.parse import parse_qs, urlsplit

ROOT = Path(__file__).resolve().parent
MAX_BODY = 2_000_000
FIELDS = {"id": 80, "title": 200, "body": 8000, "topic": 80, "incident": 150,
          "category": 80, "location": 150, "source": 80, "status": 80, "timestamp": 40}
DATE_PATTERN = r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?(?:Z|[+-]\d\d:\d\d)"


def validate_dataset(value):
    if not isinstance(value, dict) or not isinstance(value.get("name"), str) or not value["name"].strip() or len(value["name"]) > 100:
        raise ValueError("The dataset needs a name (up to 100 characters).")
    rows = value.get("reports")
    if not isinstance(rows, list) or not 1 <= len(rows) <= 5000:
        raise ValueError("Include between 1 and 5,000 reports.")
    reports, ids = [], set()
    for index, row in enumerate(rows, 1):
        if not isinstance(row, dict):
            raise ValueError(f"Report {index} must be an object.")
        report = {}
        for key, limit in FIELDS.items():
            text = row.get(key)
            if not isinstance(text, str) or not text.strip() or len(text) > limit:
                raise ValueError(f"Report {index}: {key} is required (up to {limit} characters).")
            report[key] = text.strip()
        if not re.fullmatch(r"[A-Za-z0-9_-]+", report["id"]) or report["id"] in {"__proto__", "constructor", "prototype"} or report["id"] in ids:
            raise ValueError(f"Report {index}: IDs must be unique and use letters, numbers, hyphens or underscores.")
        try:
            if not re.fullmatch(DATE_PATTERN, report["timestamp"]):
                raise ValueError
            instant = datetime.fromisoformat(report["timestamp"].replace("Z", "+00:00"))
            if instant.utcoffset() is None:
                raise ValueError
            report["timestamp"] = instant.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        except ValueError as exc:
            raise ValueError(f"Report {index}: timestamp must be a valid ISO date with timezone.") from exc
        if row.get("severity") not in ("low", "medium", "high"):
            raise ValueError(f"Report {index}: severity must be low, medium or high.")
        report["severity"] = row["severity"]
        reports.append(report)
        ids.add(report["id"])
    reports.sort(key=lambda row: (row["timestamp"], row["id"]))
    description = value.get("description", "")
    return {"name": value["name"].strip(), "description": description[:500] if isinstance(description, str) else "", "reports": reports}


class Store:
    def __init__(self, path: Path, seed: dict):
        self.path = path
        path.parent.mkdir(parents=True, exist_ok=True)
        with closing(self.connect()) as db, db:
            db.executescript("""
                PRAGMA journal_mode=WAL;
                CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS reports (id TEXT PRIMARY KEY, content TEXT NOT NULL);
                CREATE TABLE IF NOT EXISTS evidence (
                    report_id TEXT PRIMARY KEY REFERENCES reports(id) ON DELETE CASCADE,
                    saved INTEGER NOT NULL, note TEXT NOT NULL);
                CREATE VIRTUAL TABLE IF NOT EXISTS report_search USING fts5(
                    id UNINDEXED, title, body, incident, category, location, source,
                    tokenize='unicode61 remove_diacritics 0');
            """)
            empty = db.execute("SELECT COUNT(*) FROM reports").fetchone()[0] == 0
        if empty:
            self.replace_dataset(validate_dataset(seed))

    def connect(self):
        db = sqlite3.connect(self.path, timeout=10)
        db.execute("PRAGMA foreign_keys=ON")
        return db

    def replace_dataset(self, dataset):
        dataset = validate_dataset(dataset)
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            db.execute("DELETE FROM reports")
            db.execute("DELETE FROM report_search")
            db.executemany("INSERT INTO reports VALUES (?, ?)", [(r["id"], json.dumps(r)) for r in dataset["reports"]])
            db.executemany("INSERT INTO report_search VALUES (?, ?, ?, ?, ?, ?, ?)",
                           [tuple(r[k] for k in ("id", "title", "body", "incident", "category", "location", "source")) for r in dataset["reports"]])
            for key in ("name", "description"):
                db.execute("INSERT OR REPLACE INTO metadata VALUES (?, ?)", (key, dataset[key]))

    def workspace(self):
        with closing(self.connect()) as db, db:
            meta = dict(db.execute("SELECT key, value FROM metadata"))
            rows = [json.loads(row[0]) for row in db.execute("SELECT content FROM reports")]
            rows.sort(key=lambda row: (row["timestamp"], row["id"]))
            evidence = {row[0]: {"saved": bool(row[1]), "note": row[2]} for row in db.execute("SELECT report_id, saved, note FROM evidence")}
            return {"kind": "signal-desk", "dataset": {**meta, "reports": rows}, "evidence": evidence}

    def search(self, query):
        if len(query) > 1000:
            raise ValueError("Search must be 1,000 characters or fewer.")
        words = re.findall(r"[^\W_]+", query.lower(), flags=re.UNICODE)
        with closing(self.connect()) as db:
            if not words:
                return [row[0] for row in db.execute("SELECT id FROM reports")]
            # Quote every token: user input is never executed as FTS syntax or SQL.
            match = " AND ".join('"' + word.replace('"', '""') + '"' for word in words)
            return [row[0] for row in db.execute("SELECT id FROM report_search WHERE report_search MATCH ? ORDER BY rank", (match,))]

    def save_evidence(self, value):
        if not isinstance(value, dict) or not isinstance(value.get("evidence"), dict):
            raise ValueError("Expected an evidence object.")
        rows = []
        for report_id, evidence in value["evidence"].items():
            if not isinstance(evidence, dict) or type(evidence.get("saved")) is not bool or not isinstance(evidence.get("note"), str) or len(evidence["note"]) > 4000:
                raise ValueError("Evidence needs a saved Boolean and a note of up to 4,000 characters.")
            rows.append((report_id, int(evidence["saved"]), evidence["note"]))
        with closing(self.connect()) as db, db:
            db.execute("BEGIN IMMEDIATE")
            ids = {row[0] for row in db.execute("SELECT id FROM reports")}
            if any(row[0] not in ids for row in rows):
                raise ValueError("Evidence references a report outside the current dataset.")
            db.execute("DELETE FROM evidence")
            db.executemany("INSERT INTO evidence VALUES (?, ?, ?)", rows)


class Handler(SimpleHTTPRequestHandler):
    def __init__(self, *args, store, **kwargs):
        self.store = store
        super().__init__(*args, directory=str(ROOT / "dist"), **kwargs)

    def end_headers(self):
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def json_response(self, value, status=200):
        body = json.dumps(value).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = urlsplit(self.path)
        if not path.path.startswith("/api/"):
            return super().do_GET()
        try:
            if path.path == "/api/workspace":
                return self.json_response(self.store.workspace())
            if path.path == "/api/search":
                query = parse_qs(path.query).get("q", [""])[0]
                return self.json_response({"ids": self.store.search(query)})
            if path.path == "/api/health":
                self.store.workspace()
                return self.json_response({"status": "ok", "storage": "sqlite", "search": "fts5"})
            self.json_response({"error": "Not found"}, 404)
        except ValueError as exc:
            self.json_response({"error": str(exc)}, 400)
        except sqlite3.Error:
            self.json_response({"error": "Database operation failed."}, 500)

    def do_PUT(self):
        origin = self.headers.get("Origin")
        if origin and origin != f"http://{self.headers.get('Host')}":
            return self.json_response({"error": "Cross-origin writes are not allowed."}, 403)
        if self.headers.get("Content-Type", "").split(";")[0] != "application/json":
            return self.json_response({"error": "Use application/json."}, 415)
        try:
            length = int(self.headers.get("Content-Length", "0"))
            if not 0 < length <= MAX_BODY:
                return self.json_response({"error": "JSON body must be between 1 byte and 2 MB."}, 413)
            value = json.loads(self.rfile.read(length))
            path = urlsplit(self.path).path
            if path == "/api/workspace":
                self.store.save_evidence(value)
            elif path == "/api/dataset":
                self.store.replace_dataset(value)
            else:
                return self.json_response({"error": "Not found"}, 404)
            self.json_response({"ok": True})
        except (ValueError, UnicodeDecodeError) as exc:
            self.json_response({"error": str(exc)}, 400)
        except sqlite3.Error:
            self.json_response({"error": "Database operation failed."}, 500)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--db", type=Path, default=ROOT / ".data/workspace.sqlite3")
    args = parser.parse_args()
    seed = json.loads((ROOT / "dist/data.json").read_text())
    store = Store(args.db, seed)
    server = ThreadingHTTPServer(("127.0.0.1", args.port), partial(Handler, store=store))
    print(f"Signal Desk: http://127.0.0.1:{server.server_port}", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nWorkspace stopped. Your SQLite data is saved.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
