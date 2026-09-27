# -*- coding: utf-8 -*-
"""
Dokkan Asset Proxy Server
Serves local game resources and proxies missing assets from Dokkan CDN with keep-alive connection pooling.
"""
from __future__ import annotations

import argparse
import mimetypes
import os
import re
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
GAME_RES = ROOT / "game res"

from modules.core.assets import _cdn_session, DOKKAN_CDN_BASE

class AssetHandler(BaseHTTPRequestHandler):
    server_version = "DokkanAssetServer/2.0"

    def log_message(self, fmt, *args):
        # Quiet logger
        pass

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Range")
        self.send_header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        req_path = self.path.split("?")[0].lstrip("/")
        local_path = (GAME_RES / req_path).resolve()

        # Security check: must reside inside GAME_RES
        if GAME_RES.resolve() in local_path.parents and local_path.is_file():
            self.serve_local_file(local_path)
            return

        # Not found locally: Proxy from Dokkan CDN if configured
        if DOKKAN_CDN_BASE:
            cdn_url = f"{DOKKAN_CDN_BASE.rstrip('/')}/{req_path}"
            try:
                session = _cdn_session
                resp = session.get(cdn_url, timeout=10, stream=True)
                if resp.status_code == 200:
                    # Save to local cache
                    local_path.parent.mkdir(parents=True, exist_ok=True)
                    with open(local_path, "wb") as f:
                        for chunk in resp.iter_content(chunk_size=64 * 1024):
                            f.write(chunk)
                    self.serve_local_file(local_path)
                    return
            except Exception:
                pass

        self.send_error(404, "Asset not found")

    def serve_local_file(self, path: Path):
        size = path.stat().st_size
        mime = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
        start, end = 0, size - 1
        range_header = self.headers.get("Range", "")
        match = re.match(r"bytes=(\d+)-(\d*)", range_header)
        if match:
            start = min(int(match.group(1)), max(0, size - 1))
            end = min(int(match.group(2)), size - 1) if match.group(2) else size - 1
        length = max(0, end - start + 1)

        self.send_response(206 if match else 200)
        self.send_header("Content-Type", mime)
        self.send_header("Content-Length", str(length))
        self.send_header("Accept-Ranges", "bytes")
        if match:
            self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Cache-Control", "public, max-age=86400")
        self.cors()
        self.end_headers()

        if self.command == "HEAD":
            return

        with path.open("rb") as handle:
            handle.seek(start)
            remaining = length
            while remaining:
                chunk = handle.read(min(256 * 1024, remaining))
                if not chunk:
                    break
                self.wfile.write(chunk)
                remaining -= len(chunk)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8502)
    args = parser.parse_args()

    # Also ensure port 8585 is active for components expecting default Dokkan port
    try:
        from modules.core.assets import start_bgm_server_once
        start_bgm_server_once(8585)
        print("[Asset Server] Port 8585 listening concurrently!")
    except Exception as e:
        pass

    server = ThreadingHTTPServer(("127.0.0.1", args.port), AssetHandler)
    print(f"==================================================")
    print(f" Dokkan Asset Server running on http://127.0.0.1:{args.port} & 8585")
    print(f"==================================================")
    server.serve_forever()


if __name__ == "__main__":
    main()
