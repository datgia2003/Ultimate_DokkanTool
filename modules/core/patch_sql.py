"""Compatibility fixes for animation SQL produced by older tool versions."""
import re
import sqlite3
import time
from contextlib import closing
from pathlib import Path


def _sql_statements_preserve_comments(sql):
    """Split SQL at statement terminators without splitting quoted text/comments."""
    parts = []
    start = 0
    quote = None
    line_comment = False
    block_comment = False
    i = 0
    while i < len(sql):
        char = sql[i]
        nxt = sql[i + 1] if i + 1 < len(sql) else ''
        if line_comment:
            if char == '\n':
                line_comment = False
        elif block_comment:
            if char == '*' and nxt == '/':
                block_comment = False
                i += 1
        elif quote:
            if quote == ']' and char == ']':
                quote = None
            elif char == quote:
                if quote == "'" and nxt == "'":
                    i += 1
                else:
                    quote = None
        elif char == '-' and nxt == '-':
            line_comment = True
            i += 1
        elif char == '/' and nxt == '*':
            block_comment = True
            i += 1
        elif char in ("'", '"', '`'):
            quote = char
        elif char == '[':
            quote = ']'
        elif char == ';':
            parts.append(sql[start:i + 1])
            start = i + 1
        i += 1
    if sql[start:].strip():
        parts.append(sql[start:])
    return parts


def _strip_sql_comments(statement):
    text = statement.lstrip()
    while True:
        if text.startswith('--'):
            newline = text.find('\n')
            text = '' if newline < 0 else text[newline + 1:].lstrip()
        elif text.startswith('/*'):
            end = text.find('*/', 2)
            text = '' if end < 0 else text[end + 2:].lstrip()
        else:
            return text


def _split_sql_values(text):
    values = []
    start = 0
    quote = None
    depth = 0
    i = 0
    while i < len(text):
        char = text[i]
        nxt = text[i + 1] if i + 1 < len(text) else ''
        if quote:
            if quote == ']' and char == ']':
                quote = None
            elif char == quote:
                if quote == "'" and nxt == "'":
                    i += 1
                else:
                    quote = None
        elif char in ("'", '"', '`'):
            quote = char
        elif char == '[':
            quote = ']'
        elif char == '(':
            depth += 1
        elif char == ')':
            depth = max(0, depth - 1)
        elif char == ',' and depth == 0:
            values.append(text[start:i].strip())
            start = i + 1
        i += 1
    values.append(text[start:].strip())
    return values


def _row_operation(statement):
    text = _strip_sql_comments(statement)
    insert = re.match(
        r'(?is)^INSERT(?:\s+OR\s+REPLACE)?\s+INTO\s+'
        r'(?:(?:"main"|main)\s*\.\s*)?["`\[]?(\w+)["`\]]?\s*'
        r'\(([^)]+)\)\s*VALUES\s*\((.*)\)\s*;?\s*$', text)
    if insert and not insert.group(1).lower().startswith('sqlite_'):
        columns = [column.strip().strip('"`[]').lower() for column in insert.group(2).split(',')]
        if 'id' in columns:
            values = _split_sql_values(insert.group(3))
            idx = columns.index('id')
            if idx < len(values) and re.fullmatch(r'-?\d+', values[idx].strip().strip('"\'`')):
                return insert.group(1).lower(), int(values[idx].strip().strip('"\'`'))
    delete = re.match(
        r'(?is)^DELETE\s+FROM\s+(?:(?:"main"|main)\s*\.\s*)?'
        r'["`\[]?(\w+)["`\]]?\s+WHERE\s+["`\[]?id["`\]]?\s*=\s*'
        r'["\']?(-?\d+)["\']?\s*;?\s*$', text)
    if delete and not delete.group(1).lower().startswith('sqlite_'):
        return delete.group(1).lower(), int(delete.group(2))
    return None


def compact_repeatable_row_sql(sql):
    """Compatibility shim: SQL history cannot safely be compacted by row ID.

    An intervening UPDATE, SELECT or foreign-key deletion may need an earlier
    row. Use materialize_patch_sql to export the actual resulting row state.
    """
    return sql


def materialize_patch_sql(sql, base_db, *, snapshot=True):
    """Apply ordered SQL in RAM; optionally serialize the affected final rows.

    The source is opened read-only. No database on disk is modified, including
    the imported workspace preview. Audit both sides of PK updates and the
    implicit deletes from REPLACE, so removed rows survive a ZIP round trip.
    """
    def identifier(value):
        return '"' + value.replace('"', '""') + '"'

    with closing(sqlite3.connect(Path(base_db).resolve().as_uri() + '?mode=ro', uri=True)) as source, \
            closing(sqlite3.connect(':memory:')) as target:
        source.backup(target)
        target.execute('PRAGMA foreign_keys=OFF')
        target.execute('PRAGMA recursive_triggers=ON')
        touched = {}
        schemas = {}
        unkeyed_writes = set()
        target.create_function('_patch_touch', 2, lambda table, row_id: touched.setdefault((table, row_id), None))
        for (table,) in target.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall():
            schema = target.execute(f'PRAGMA table_info({identifier(table)})').fetchall()
            if [column[1] for column in schema if column[5]] != ['id']:
                continue
            schemas[table] = [column[1] for column in schema]
            literal = table.replace("'", "''")
            for operation, aliases in [('INSERT', ('NEW',)), ('UPDATE', ('OLD', 'NEW')), ('DELETE', ('OLD',))]:
                body = ' '.join(f"SELECT _patch_touch('{literal}', {alias}.id);" for alias in aliases)
                target.execute(f'CREATE TEMP TRIGGER {identifier("patch_audit_" + operation + "_" + table)} '
                               f'AFTER {operation} ON {identifier(table)} BEGIN {body} END')
        allowed = {sqlite3.SQLITE_SELECT, sqlite3.SQLITE_READ, sqlite3.SQLITE_INSERT,
                   sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE, sqlite3.SQLITE_TRANSACTION,
                   sqlite3.SQLITE_SAVEPOINT, sqlite3.SQLITE_FUNCTION, sqlite3.SQLITE_RECURSIVE}

        def authorize(action, arg1, arg2, db, trigger):
            if action == sqlite3.SQLITE_FUNCTION and str(arg2).lower() in {'load_extension', 'writefile', 'readfile'}:
                return sqlite3.SQLITE_DENY
            if action == sqlite3.SQLITE_PRAGMA and str(arg1).lower() in {'foreign_keys', 'defer_foreign_keys'}:
                return sqlite3.SQLITE_OK
            if action in {sqlite3.SQLITE_INSERT, sqlite3.SQLITE_UPDATE, sqlite3.SQLITE_DELETE}:
                if arg1 not in schemas:
                    unkeyed_writes.add(arg1)
            return sqlite3.SQLITE_OK if action in allowed else sqlite3.SQLITE_DENY

        target.set_authorizer(authorize)
        deadline = time.monotonic() + 45
        target.set_progress_handler(lambda: int(time.monotonic() > deadline), 10000)
        target.setlimit(sqlite3.SQLITE_LIMIT_LENGTH, 32 * 1024 ** 2)
        try:
            # complete_statement handles quoted semicolons and trigger bodies.
            statements, start = [], 0
            for index, char in enumerate(sql):
                if char == ';' and sqlite3.complete_statement(sql[start:index + 1]):
                    statements.append(sql[start:index + 1])
                    start = index + 1
            if sql[start:].strip():
                statements.append(sql[start:])
            for number, statement in enumerate(statements, 1):
                try:
                    target.execute(statement)
                except sqlite3.Error as exc:
                    context = ' '.join(_strip_sql_comments(statement).split())[:180]
                    raise ValueError(f'SQL lỗi tại câu #{number}: {exc}. {context}') from exc
        finally:
            target.set_authorizer(None)
            target.set_progress_handler(None, 0)
        if {'card_specials', 'extra_special_options'} <= schemas.keys():
            for table, row_id in touched:
                if table != 'card_specials':
                    continue
                attack = target.execute('SELECT card_id, style, lv_start FROM card_specials WHERE id=?', (row_id,)).fetchone()
                if attack is None:
                    continue
                option = target.execute('SELECT id FROM extra_special_options WHERE card_special_id=?', (row_id,)).fetchone()
                if (attack[1] == 'Extra') != bool(option):
                    raise ValueError(f'Thẻ #{attack[0]}, chiêu #{row_id}: Style Extra và EX Option không khớp. '
                                     'Bật EX để tạo option, hoặc tắt EX để chuyển lại Normal/Hyper.')
                if attack[1] == 'Extra':
                    levels = [r[0] for r in target.execute(
                        "SELECT DISTINCT lv_start FROM card_specials WHERE card_id=? AND style IN ('Normal', 'Hyper') ORDER BY lv_start",
                        (attack[0],))]
                    if levels and attack[2] not in levels:
                        raise ValueError(f'Thẻ #{attack[0]}, EX #{row_id}: lv_start={attack[2]} không khớp nhóm SA/Ultra {levels}. '
                                         'Chỉnh level bắt đầu của EX cùng nhóm chiêu trước khi xuất patch.')
        # Preserve unusual scripts that change tables without an id primary key.
        if not snapshot or unkeyed_writes:
            return sql
        deletes, inserts = [], []
        for table, row_id in touched:
            quoted = identifier(table)
            columns = schemas[table]
            # SQLite quote preserves TEXT affinity, NULL, blobs and apostrophes.
            values = target.execute('SELECT ' + ', '.join(f'quote({identifier(c)})' for c in columns)
                                    + f' FROM {quoted} WHERE id=?', (row_id,)).fetchone()
            if values is None:
                literal_id = target.execute('SELECT quote(?)', (row_id,)).fetchone()[0]
                deletes.append(f'DELETE FROM {quoted} WHERE "id" = {literal_id};')
            else:
                inserts.append(f'INSERT OR REPLACE INTO {quoted} (' + ', '.join(map(identifier, columns))
                               + ') VALUES (' + ', '.join(values) + ');')
        loaded = re.findall(r'(?m)^\s*--[^\r\n]*Loaded ID:\s*(\d+)', sql)
        header = '-- SQL snapshot of imported mod and current drafts'
        if loaded:
            header += f' (Loaded ID: {loaded[-1]})'
        return '\n'.join([header, *deletes, *inserts])


def repeatable_animation_sql(sql):
    # Only legacy animation inserts are migrated. Preserve all values, comments,
    # explicit conflict policies, and unrelated user SQL byte-for-byte.
    prefix = r'(?:\s|--[^\n]*(?:\n|$)|/\*[\s\S]*?\*/)*'
    insert = re.compile(
        r'\A(' + prefix + r')INSERT\s+INTO\s+'
        r'(?:(?:"main"|main)\s*\.\s*)?'
        r'(?P<table>"?(?:passive_skill_effects|special_views)"?)\s*'
        r'\((?P<columns>[^)]+)\)\s*VALUES\s*\(', re.I)

    def migrate(statement):
        match = insert.match(statement)
        if match:
            columns = {name.strip().strip('"`[]').lower() for name in match['columns'].split(',')}
            if {'id', 'script_name'} <= columns:
                at = len(match.group(1))
                return statement[:at] + re.sub(r'^INSERT\s+INTO', 'INSERT OR REPLACE INTO', statement[at:], count=1, flags=re.I)
        return statement

    parts, start = [], 0
    for index, char in enumerate(sql):
        if char == ';' and sqlite3.complete_statement(sql[start:index + 1]):
            parts.append(migrate(sql[start:index + 1]))
            start = index + 1
    parts.append(migrate(sql[start:]))
    return ''.join(parts)
