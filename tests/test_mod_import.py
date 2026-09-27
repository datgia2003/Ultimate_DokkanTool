"""Run with: python -m unittest discover -s tests -p test_mod_import.py"""
import hashlib
import io
import json
import shutil
import sqlite3
import tempfile
import threading
import unittest
import zipfile
from contextlib import closing
from pathlib import Path
from unittest.mock import patch

import requests
from modules.core.mod_workspace import import_zip

ROOT = Path(__file__).resolve().parents[1]


def archive(sql, assets=None):
    result = io.BytesIO()
    with zipfile.ZipFile(result, 'w') as z:
        z.writestr('metadata.json', json.dumps({'Name': 'Imported test', 'Authors': ['Test'], 'Priority': 123}))
        z.writestr('files/patch.sql', sql)
        for name, data in (assets or {}).items():
            z.writestr(name, data)
    return result.getvalue()


class ImportTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from http.server import ThreadingHTTPServer
        with patch('modules.core.database_updater.update_database_on_startup', return_value='Updater disabled for tests'):
            import react_api
        cls.api = react_api
        parent = ROOT / '.runtime' / 'import-tests'
        parent.mkdir(parents=True, exist_ok=True)
        cls.root = Path(tempfile.mkdtemp(dir=parent)).resolve()
        cls.root_patch = patch.object(react_api, 'ROOT', cls.root)
        cls.root_patch.start()
        cls.db = ROOT / 'database_decrypted.db'
        with cls.db.open('rb') as handle:
            cls.before = hashlib.file_digest(handle, 'sha256').hexdigest()
        cls.server = ThreadingHTTPServer(('127.0.0.1', 0), react_api.ApiHandler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/api/v2'

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()
        cls.root_patch.stop()
        with cls.db.open('rb') as handle:
            after = hashlib.file_digest(handle, 'sha256').hexdigest()
        assert cls.before == after, 'Original database changed'
        assert cls.root.is_relative_to(ROOT / '.runtime' / 'import-tests')
        shutil.rmtree(cls.root)

    def test_import_edit_export_and_assets(self):
        lua = b'-- Imported custom animation\nreturn {}'
        payload = archive("UPDATE cards SET name='Imported test' WHERE id=1032771", {
            'files/lua/ab_script/active_skill/import_probe.lua': lua,
            'files/character/custom_texture.bin': b'original-asset',
        })
        response = requests.post(self.url + '/mods/import', data=payload, timeout=60)
        self.assertEqual(response.status_code, 200, response.text)
        workspace = response.json()
        self.assertTrue(workspace['has_custom_animation'])
        self.assertIn(1032771, [c['id'] for c in workspace['cards']])
        headers = {'X-Mod-Workspace': workspace['id']}
        card = requests.get(self.url + '/cards/1032771', headers=headers, timeout=30).json()
        self.assertEqual(card['card']['name'], 'Imported test')
        normal = requests.get(self.url + '/cards/1032771', timeout=30).json()
        self.assertNotEqual(normal['card']['name'], 'Imported test')
        lua_response = requests.get(self.url + f"/mod-assets/{workspace['id']}/api/script", params={'path': 'ab_script/active_skill/import_probe.lua'}, timeout=10)
        self.assertEqual(lua_response.json()['text'].encode(), lua)
        blocked = requests.post(self.url + '/cards/1032771/apply', headers=headers, json={}, timeout=10)
        self.assertEqual(blocked.status_code, 400)
        response = requests.post(self.url + '/export/build-zip', headers=headers, json={
            'filename': 'roundtrip.zip', 'card_id': 1032771, 'include_assets': False,
            'meta': {'title': 'Edited mod', 'author': 'Test'},
            'changes': {'_form_drafts': {'1032771': {'name': 'Edited mod'}}}
        }, timeout=60)
        self.assertEqual(response.status_code, 200, response.text)
        with zipfile.ZipFile(response.json()['zip_path']) as z:
            self.assertEqual(z.read('files/lua/ab_script/active_skill/import_probe.lua'), lua)
            self.assertEqual(z.read('files/character/custom_texture.bin'), b'original-asset')
            self.assertEqual(json.loads(z.read('metadata.json'))['Priority'], 123)
            sql = z.read('files/patch.sql').decode()
        with closing(sqlite3.connect(':memory:')) as preview:
            with closing(sqlite3.connect(self.db.as_uri() + '?mode=ro', uri=True)) as source:
                source.backup(preview)
            preview.executescript(sql)
            self.assertEqual(preview.execute('SELECT name FROM cards WHERE id=1032771').fetchone()[0], 'Edited mod')

    def test_reject_zip_traversal_and_external_sql_writes(self):
        mini = self.root / 'mini.db'
        with closing(sqlite3.connect(mini)) as conn:
            conn.execute('CREATE TABLE cards(id INTEGER PRIMARY KEY, name TEXT)')
            conn.commit()
        for payload in [archive('SELECT 1;', {'../escape.lua': 'bad'}), archive("ATTACH DATABASE 'bad.db' AS external;")]:
            with self.assertRaises(ValueError):
                import_zip(payload, mini, self.root / 'rejections')
        self.assertFalse((ROOT / 'bad.db').exists())

    def test_animation_lookup_returns_matching_slot_ids(self):
        for slot in ('entrance', 'active', 'super', 'standby', 'finish'):
            response = requests.get(self.url + '/animations/lookup', params={'slot': slot, 'q': 'Goku'}, timeout=30)
            self.assertEqual(response.status_code, 200, response.text)
            self.assertTrue(response.json()['items'], slot)
            self.assertTrue(all(item['id'] and item['script_name'] for item in response.json()['items']))


if __name__ == '__main__':
    unittest.main()
