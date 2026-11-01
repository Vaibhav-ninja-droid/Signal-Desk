import copy
from functools import partial
from http.server import ThreadingHTTPServer
import json
from pathlib import Path
import tempfile
import threading
import unittest
from urllib.request import Request, urlopen
from urllib.error import HTTPError
import sys
sys.path.insert(0,str(Path(__file__).resolve().parents[1]))
from server import Handler, Store, validate_dataset

SEED=json.loads((Path(__file__).resolve().parents[1]/'dist/data.json').read_text())

class QuietHandler(Handler):
    def log_message(self,*args): pass

class WorkspaceTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.path=Path(self.temp.name)/'workspace.sqlite3'
        self.store=Store(self.path,SEED)
    def tearDown(self): self.temp.cleanup()
    def test_full_text_search_is_intersection_not_sql_or_fts_syntax(self):
        ids=self.store.search('northbank substation')
        self.assertTrue(ids)
        self.assertTrue(set(ids).issubset(set(self.store.search('substation'))))
        self.assertEqual(self.store.search("' OR 1=1 --"),[])
        self.assertEqual(len(self.store.workspace()['dataset']['reports']),60)
    def test_notes_survive_reopening_database(self):
        report=SEED['reports'][0]['id']
        self.store.save_evidence({'evidence':{report:{'saved':True,'note':'Follow the first report.'}}})
        reopened=Store(self.path,SEED)
        self.assertEqual(reopened.workspace()['evidence'][report]['note'],'Follow the first report.')
    def test_invalid_import_does_not_replace_data_or_notes(self):
        report=SEED['reports'][0]['id']
        self.store.save_evidence({'evidence':{report:{'saved':True,'note':'retain'}}})
        invalid=copy.deepcopy(SEED);invalid['reports'][0]['severity']='urgent'
        with self.assertRaises(ValueError): self.store.replace_dataset(invalid)
        self.assertEqual(len(self.store.workspace()['dataset']['reports']),60)
        self.assertEqual(self.store.workspace()['evidence'][report]['note'],'retain')
    def test_replace_rebuilds_search_and_removes_old_evidence(self):
        report=copy.deepcopy(SEED['reports'][0]);report['id']='CUSTOM-1';report['title']='Unique cactus observation';report['body']='A fictional independent exercise.'
        self.store.save_evidence({'evidence':{SEED['reports'][0]['id']:{'saved':True,'note':'old'}}})
        self.store.replace_dataset({'name':'Custom','reports':[report]})
        self.assertEqual(self.store.search('cactus'),['CUSTOM-1'])
        self.assertEqual(self.store.workspace()['evidence'],{})
    def test_evidence_foreign_ids_and_invalid_dates_are_rejected(self):
        with self.assertRaises(ValueError): self.store.save_evidence({'evidence':{'UNKNOWN':{'saved':True,'note':''}}})
        invalid=copy.deepcopy(SEED);invalid['reports'][0]['timestamp']='2026-02-30T09:00:00Z'
        with self.assertRaises(ValueError): validate_dataset(invalid)
    def test_http_read_write_and_origin_rejection(self):
        server=ThreadingHTTPServer(('127.0.0.1',0),partial(QuietHandler,store=self.store))
        thread=threading.Thread(target=server.serve_forever,daemon=True);thread.start()
        url=f'http://127.0.0.1:{server.server_port}'
        try:
            with urlopen(url+'/api/health') as response:self.assertEqual(json.load(response)['status'],'ok')
            with urlopen(url+'/api/search?q=substation') as response:self.assertTrue(json.load(response)['ids'])
            rid=SEED['reports'][0]['id'];payload=json.dumps({'evidence':{rid:{'saved':True,'note':'via HTTP'}}}).encode()
            req=Request(url+'/api/workspace',data=payload,method='PUT',headers={'Content-Type':'application/json','Origin':url})
            with urlopen(req) as response:self.assertTrue(json.load(response)['ok'])
            req=Request(url+'/api/workspace',data=payload,method='PUT',headers={'Content-Type':'application/json','Origin':'https://example.invalid'})
            with self.assertRaises(HTTPError) as raised:urlopen(req)
            self.assertEqual(raised.exception.code,403)
            raised.exception.close()
            with urlopen(url+'/') as response:self.assertIn(b'Signal Desk',response.read())
        finally:
            server.shutdown();server.server_close();thread.join()

if __name__=='__main__':unittest.main()
