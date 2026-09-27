"""Fetch the current Eclipse SQLite before the API opens its DB connections."""
from __future__ import annotations

import datetime as dt
import json
import os
import sqlite3
import urllib.request
from contextlib import closing
from pathlib import Path

FILE_BROWSER = "https://dokkan-eclipse.com/api/file-browser?path=sqlite%2Fcurrent%2Fen"
EXPECTED_NAME = "database_decrypted.db"


def _valid_sqlite(path: Path) -> bool:
    try:
        with closing(sqlite3.connect(f"file:{path.as_posix()}?mode=ro", uri=True)) as db:
            if db.execute("PRAGMA quick_check").fetchone()[0] != "ok":
                return False
            names = {row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            return {"cards", "passive_skills", "passive_skill_sets"}.issubset(names)
    except (sqlite3.Error, OSError):
        return False


def update_database_on_startup(root: Path) -> str:
    db_path = root / EXPECTED_NAME
    marker = root / ".runtime" / "database-upstream.json"
    backup_dir = root / "backups"
    try:
        req = urllib.request.Request(FILE_BROWSER, headers={"User-Agent": "DokkanPatchStudio/1.0"})
        with urllib.request.urlopen(req, timeout=12) as response:
            listing = json.load(response)
        item = next((entry for entry in listing.get("items", []) if entry.get("name") == EXPECTED_NAME), None)
        if not item or not item.get("cdnUrl") or not item.get("modified"):
            return "Không tìm thấy SQLite mới trong danh sách server."
        remote_date = dt.datetime.fromisoformat(item["modified"].replace("Z", "+00:00"))
        remote_stamp = remote_date.timestamp()
        known = json.loads(marker.read_text(encoding="utf-8")) if marker.is_file() else {}
        if known.get("modified") == item["modified"]:
            return "Database đã cùng phiên bản với server."
        # Before the first sync, a newer local DB may contain manual edits.
        if not known and db_path.is_file() and db_path.stat().st_mtime >= remote_stamp:
            return "Database cục bộ mới hơn bản server; giữ nguyên."
        if known.get("modified"):
            old_stamp = dt.datetime.fromisoformat(known["modified"].replace("Z", "+00:00")).timestamp()
            if remote_stamp <= old_stamp:
                return "Database cục bộ đã cập nhật."

        stage_dir = root / ".runtime" / "db-updates"
        stage_dir.mkdir(parents=True, exist_ok=True)
        temp = stage_dir / "database_decrypted.download"
        try:
            download = urllib.request.Request(item["cdnUrl"], headers={"User-Agent": "DokkanPatchStudio/1.0"})
            with urllib.request.urlopen(download, timeout=45) as response, temp.open("wb") as target:
                while chunk := response.read(1024 * 1024):
                    target.write(chunk)
            expected_size = int(item.get("size") or 0)
            if (expected_size and temp.stat().st_size != expected_size) or not _valid_sqlite(temp):
                return "Bản tải về không hợp lệ; giữ nguyên database cũ."
            if db_path.is_file():
                backup_dir.mkdir(exist_ok=True)
                stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S")
                backup = backup_dir / f"database_before_upstream_{stamp}.db"
                with closing(sqlite3.connect(str(db_path))) as source, closing(sqlite3.connect(str(backup))) as destination:
                    source.backup(destination)
                    source.execute("PRAGMA wal_checkpoint(TRUNCATE)")
                wal = Path(str(db_path) + "-wal")
                if wal.is_file() and wal.stat().st_size > 0:
                    return "Database đang có WAL hoạt động; giữ nguyên bản cũ để tránh ghi đè dữ liệu."
            os.replace(temp, db_path)
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(json.dumps({"modified": item["modified"], "url": item["cdnUrl"]}), encoding="utf-8")
            return f"Đã cập nhật database từ server; backup: {backup if 'backup' in locals() else 'không có DB cũ'}"
        finally:
            if temp.exists():
                temp.unlink()
    except Exception as exc:
        return f"Không kiểm tra được cập nhật database ({exc}); dùng bản cục bộ."
