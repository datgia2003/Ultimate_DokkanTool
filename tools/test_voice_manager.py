import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from tools import voice_manager as voice


class VoiceDownloadTest(unittest.TestCase):
    def test_missing_bank_is_streamed_once_and_published_atomically(self):
        data = b'AFS2' + bytes(100)
        class Response:
            headers = {'Content-Length': str(len(data))}
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def raise_for_status(self): pass
            def iter_content(self, size):
                yield data[:20]
                yield data[20:]
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(voice, 'AWB_DIR', folder), \
             patch.object(voice.requests, 'get', return_value=Response()) as request:
            result = voice._ensure_bank_file('cv001000', 'awb')
            self.assertEqual(Path(result).read_bytes(), data)
            self.assertFalse(Path(result + '.download').exists())
            self.assertEqual(voice._ensure_bank_file('cv001000', 'awb'), result)
            self.assertEqual(request.call_count, 1)
            self.assertTrue(request.call_args.kwargs['stream'])

    def test_invalid_bank_is_not_cached_as_audio(self):
        class Response:
            headers = {}
            def __enter__(self): return self
            def __exit__(self, *_): pass
            def raise_for_status(self): pass
            def iter_content(self, size): yield b'<html>not audio</html>'
        with tempfile.TemporaryDirectory() as folder, \
             patch.object(voice, 'ACB_DIR', folder), \
             patch.object(voice.requests, 'get', return_value=Response()):
            self.assertIsNone(voice._ensure_bank_file('cv001000', 'acb'))
            self.assertEqual(list(Path(folder).iterdir()), [])


if __name__ == '__main__':
    unittest.main()
