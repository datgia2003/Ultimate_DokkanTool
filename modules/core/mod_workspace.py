"""Isolated ZIP editing workspaces. Never apply imported SQL to the game database."""
import contextvars
import io
import json
import re
import sqlite3
import shutil
import time
import uuid
import zipfile
from contextlib import contextmanager, closing
from pathlib import Path, PurePosixPath
from modules.core.patch_sql import repeatable_animation_sql

current_workspace = contextvars.ContextVar('mod_workspace', default=None)
WORKSPACES = {}


def database_path(default):
    workspace = current_workspace.get()
    return Path(workspace['db_path']) if workspace else Path(default)


def imported_asset(name, workspace=None):
    workspace = workspace or current_workspace.get()
    if workspace:
        return next((Path(source) for source, archive_name in workspace['assets'] if archive_name == name), None)
    return None


@contextmanager
def use_workspace(workspace):
    token = current_workspace.set(workspace)
    try:
        yield
    finally:
        current_workspace.reset(token)


def import_zip(data, base_db, runtime_dir):
    workspace_id = uuid.uuid4().hex
    root = Path(runtime_dir).resolve()
    folder = root / workspace_id
    try:
        return _import_zip(data, base_db, folder, workspace_id)
    except Exception:
        if folder.exists() and folder.resolve().is_relative_to(root):
            shutil.rmtree(folder)
        raise


def _import_zip(data, base_db, folder, workspace_id):
    try:
        archive = zipfile.ZipFile(io.BytesIO(data))
    except zipfile.BadZipFile as exc:
        raise ValueError('File không phải ZIP hợp lệ.') from exc
    entries = []
    total = 0
    seen = set()
    for info in archive.infolist():
        name = info.filename.replace('\\', '/')
        path = PurePosixPath(name)
        reserved = {'CON', 'PRN', 'AUX', 'NUL', *[f'COM{i}' for i in range(1, 10)], *[f'LPT{i}' for i in range(1, 10)]}
        if (path.is_absolute() or '..' in path.parts or ':' in name or '\x00' in name
                or any(part.rstrip(' .').split('.')[0].upper() in reserved for part in path.parts)):
            raise ValueError('ZIP chứa đường dẫn không hợp lệ.')
        if info.is_dir():
            continue
        if str(path).lower() in seen:
            raise ValueError('ZIP chứa tên file trùng nhau.')
        seen.add(str(path).lower())
        total += info.file_size
        if total > 2 * 1024 ** 3 or len(seen) > 50000:
            raise ValueError('ZIP vượt giới hạn 2 GB giải nén hoặc 50.000 file.')
        entries.append((info, path))
    sql_parts = []
    metadata = {}
    assets = []
    for info, path in entries:
        if path.suffix.lower() == '.sql':
            if info.file_size > 32 * 1024 ** 2:
                raise ValueError('File SQL vượt giới hạn 32 MB.')
            sql_parts.append(archive.read(info).decode('utf-8-sig'))
        elif path.name.lower() == 'metadata.json':
            metadata = json.loads(archive.read(info).decode('utf-8-sig'))
            if not isinstance(metadata, dict):
                raise ValueError('metadata.json phải là một object.')
        else:
            parts = path.parts
            if 'files' in parts:
                parts = parts[parts.index('files') + 1:]
            assets.append((info, '/'.join(parts)))
    if not sql_parts:
        raise ValueError('ZIP cần có patch.sql để mở dữ liệu mod trong các tab chỉnh sửa.')
    sql = repeatable_animation_sql('\n;\n'.join(sql_parts))
    folder.mkdir(parents=True)
    db_path = folder / 'preview.db'
    touched = {}
    direct_card_ids = {}
    def record_touch(table, row_id, card_id):
        touched[(table, row_id)] = None
        if card_id:
            direct_card_ids[int(card_id)] = None
        return 0
    with closing(sqlite3.connect(Path(base_db).resolve().as_uri() + '?mode=ro', uri=True)) as source:
        with closing(sqlite3.connect(db_path)) as target:
            source.backup(target)
            target.execute('PRAGMA foreign_keys=OFF')
            # Record actual affected IDs, including WHERE clauses and INSERT ... SELECT.
            target.create_function('_mod_touch', 3, record_touch)
            for (table,) in target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
                quoted = '"' + table.replace('"', '""') + '"'
                columns = [r[1] for r in target.execute(f'PRAGMA table_info({quoted})')]
                if 'id' not in columns:
                    continue
                for operation, alias in [('INSERT', 'NEW'), ('UPDATE', 'NEW'), ('DELETE', 'OLD')]:
                    trigger = '"audit_' + operation + '_' + table.replace('"', '""') + '"'
                    literal = table.replace("'", "''")
                    card_column = f'{alias}.id' if table == 'cards' else (f'{alias}.card_id' if 'card_id' in columns else 'NULL')
                    target.execute(f"CREATE TEMP TRIGGER {trigger} AFTER {operation} ON {quoted} BEGIN SELECT _mod_touch('{literal}', {alias}.id, {card_column}); END")
            allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_INSERT,
                       sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_TRANSACTION,
                       sqlite3.SQLITE_SAVEPOINT, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}
            def authorize(action, arg1, arg2, db, trigger):
                if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in {'load_extension', 'writefile', 'readfile'}:
                    return sqlite3.SQLITE_DENY
                if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() in {'foreign_keys', 'defer_foreign_keys'}:
                    return sqlite3.SQLITE_OK
                return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY
            target.set_authorizer(authorize)
            target.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 32 * 1024 ** 2)
            deadline = time.monotonic() + 45
            target.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
            try:
                target.executescript(sql)
                target.commit()
            except sqlite3.Error as exc:
                raise ValueError(f'Không đọc được SQL của mod: {exc}. Database gốc không thay đổi.') from exc
            finally:
                target.set_authorizer(None)
                target.set_progress_handler(None, 0)
    items = []
    for info, name in assets:
        dest = folder / 'assets' / name
        dest.parent.mkdir(parents=True, exist_ok=True)
        with archive.open(info) as source, dest.open('wb') as output:
            shutil.copyfileobj(source, output)
        items.append((str(dest), name))
    workspace = dict(id=workspace_id, db_path=str(db_path), base_db_path=str(Path(base_db).resolve()), sql=sql, metadata=metadata,
                     assets=items, has_custom_animation=any(name.endswith('.lua') for _, name in items))
    from modules.core.sql_builder import find_card_id_for_row
    from modules.core.db import query_db_one, query_db_all
    card_ids = set()
    with use_workspace(workspace):
        # Shared skills/views can belong to many unrelated cards. Only infer owners
        # when the SQL itself provides no card IDs or card relations.
        for table, row_id in (() if direct_card_ids else touched):
            cid = find_card_id_for_row(table, row_id)
            if cid is None:
                with use_workspace(None):
                    cid = find_card_id_for_row(table, row_id)
            if cid:
                card_ids.add(cid)
            if table == 'special_views':
                card_ids.update(row['card_id'] for row in query_db_all(
                    'SELECT card_id FROM card_specials WHERE view_id=?', (row_id,)))
                for slot, relation in [('active', 'card_active_skills'),
                                       ('standby', 'card_standby_skill_set_relations'),
                                       ('finish', 'card_finish_skill_set_relations')]:
                    card_ids.update(row['card_id'] for row in query_db_all(
                        f'SELECT r.card_id FROM {relation} r JOIN {slot}_skill_sets s '
                        f'ON s.id=r.{slot}_skill_set_id WHERE s.special_view_id=?', (row_id,)))
        ordered_ids = list(direct_card_ids) if direct_card_ids else sorted(card_ids)
        workspace['cards'] = [row for cid in ordered_ids
                              if (row := query_db_one('SELECT id, name, rarity, element FROM cards WHERE id=?', (cid,)))]
        included_ids = {row['id'] for row in workspace['cards']}
        loaded_ids = re.findall(r'(?m)^\s*--[^\r\n]*Loaded ID:\s*(\d+)', sql)
        workspace['selected_card_id'] = next((int(cid) for cid in loaded_ids if int(cid) in included_ids),
                                            workspace['cards'][0]['id'] if workspace['cards'] else None)
    WORKSPACES[workspace_id] = workspace
    archive.close()
    return workspace


def public_workspace(workspace):
    return {key: workspace[key] for key in ('id', 'metadata', 'cards', 'selected_card_id', 'has_custom_animation')}
