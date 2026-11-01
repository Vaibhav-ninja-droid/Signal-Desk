# Signal Desk

Signal Desk is a small dashboard for making sense of incident reports. You can search through reports, follow how an incident develops, and keep useful evidence together with your own notes.

The idea is simple: when several reports describe the same event it helps to see them in one place rather than read them separately. The demo includes 60 fictional reports about things like power interruptions, transport delays and flooding in Harbour City.

## What you can do

Search for a word or place, filter by source or severity, or select an incident to see its related reports. The activity chart lets you narrow the view to a particular time window.

You can also replay the scenario to watch reports arrive in order. If something looks useful, save it, add a note, and export your saved evidence as a Markdown brief. There's an option to import your own JSON dataset too; the guide in the app explains the format.

## Running it

You'll need Python 3.10 or later with SQLite FTS5 support. There are no extra Python packages to install.

From the project folder, run:

```sh
python3 server.py
```

Then open [localhost:8765](http://127.0.0.1:8765) in your browser. Keep the terminal open while you're using it, and press **Control+C** to stop the server.

A good place to start is searching for `substation`. Open one of the reports, save it and add a note, then look under **Saved evidence**.

Your data is saved locally in `.data/workspace.sqlite3`. If port 8765 is already in use, run `python3 server.py --port 9000` instead and open localhost:9000.

## Under the hood

The backend is Python with SQLite, including FTS5 for full-text search. The interface uses plain HTML, CSS and JavaScript.

The browser demo can also run on its own from the `dist` folder. In that version, saved reports and notes stay in browser storage. They aren't shared with the local Python version or other devices.

## Tests

```sh
node --test tests/model.test.js
python3 -m unittest discover -s tests -p 'test_*.py'
```

The JavaScript tests need Node.js 18 or later. You don't need Node to run the app itself.

This is a portfolio demo with fictional data. It doesn't pull in live reports and the source and status labels are part of the sample dataset. The Python server is intended for local use by one person.
