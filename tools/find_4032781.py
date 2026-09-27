import sqlite3

conn = sqlite3.connect('database_decrypted.db')
cur = conn.cursor()
cur.execute("SELECT name FROM sqlite_master WHERE type='table'")
tables = [r[0] for r in cur.fetchall()]

print("Searching 4032781:")
for t in tables:
    cur.execute(f'PRAGMA table_info("{t}")')
    cols = [c[1] for c in cur.fetchall()]
    for col in cols:
        try:
            cur.execute(f'SELECT count(*) FROM "{t}" WHERE "{col}" = 4032781')
            cnt = cur.fetchone()[0]
            if cnt > 0:
                print(f"  {t}.{col}: {cnt}")
        except:
            pass
