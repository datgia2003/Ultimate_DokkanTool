import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from modules.core import assets


class FakeResponse:
    status_code = 200
    headers = {'Content-Type': 'video/mp4'}

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return False

    def iter_content(self, chunk_size):
        yield b'\x00\x00\x00\x18ftypisom'
        yield b'movie-bytes'


class FakeSession:
    def get(self, url, **kwargs):
        assert '/api/usm?' in url
        assert kwargs['stream'] is True
        return FakeResponse()


class UsmStreamCacheTest(unittest.TestCase):
    def test_remote_movie_is_written_in_chunks_to_f_drive_cache(self):
        cache_root = Path(assets.GAME_RES_DIR, 'cache').resolve()
        with tempfile.TemporaryDirectory(dir=cache_root) as temp_dir:
            # The temporary test directory is verified inside the asset cache
            # before TemporaryDirectory removes it on exit.
            self.assertEqual(os.path.commonpath((cache_root, Path(temp_dir).resolve())), str(cache_root))
            movie_path = Path(temp_dir, 'sample.mp4')
            query = {'path': ['movie/sample.usm'], 'reencode': ['1']}
            with patch.object(assets, 'get_cache_filepath', return_value=str(movie_path)), \
                 patch.object(assets, 'get_cdn_session', return_value=FakeSession()):
                result = assets.ensure_cached_usm_file(query)
            self.assertEqual(result, str(movie_path))
            self.assertEqual(movie_path.read_bytes(), b'\x00\x00\x00\x18ftypisommovie-bytes')
            self.assertEqual(Path(str(movie_path) + '.meta').read_text(), 'video/mp4')


if __name__ == '__main__':
    unittest.main()
