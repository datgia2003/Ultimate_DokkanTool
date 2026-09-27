# Dokkan React Tool (code-only)

This folder contains the React UI, Python API, animation player code, game-rule definitions, and required helper binaries. It deliberately does **not** contain the game database, downloaded card/animation assets, OST, voice files, backups, or runtime caches.

## First run

Install Python 3.12 and Node.js with npm, then run these commands from this folder:

```powershell
python -m pip install -r requirements-react.txt
.\run_react_tool.bat
```

The launcher installs the React packages automatically with `npm ci` if they are missing. The React page is `http://127.0.0.1:5174/`. Port 8765 serves only the API; opening its root address redirects to the React page.

The API attempts to download `database_decrypted.db` on startup. An internet connection is needed for the initial database and any missing game assets. If the server is unavailable, copy a valid `database_decrypted.db` into this folder manually. Game assets downloaded later are stored under this folder's `game res` directory.

`config.json` is intentionally omitted. Export settings can be entered again in the tool; this avoids packaging a personal login cookie.

## Edit an existing ZIP mod

Use **Import mod ZIP** at the top of the React workspace. The ZIP must contain SQL (usually `files/patch.sql`); `metadata.json` and bundled assets are retained. Imported SQL is loaded into an isolated preview copy under `.runtime/imports/`, never into the original game database. Select an imported card, edit its tabs, then export a new ZIP. Closing the mod restores drafts from the normal workspace.

Re-exporting a ZIP recompiles the imported card chains even when no edits were made, applies the original SQL and current drafts in order in memory, then exports the final affected rows instead of accumulating SQL history. This also normalizes existing EX option ownership/styles and passive relation IDs. Export checks SQL and EX attack/option consistency before writing the ZIP and reports the affected statement or card on failure. These checks do not install the patch in the game or write the original database.

Cards with converted/custom Lua default to **Xuất Đầy Đủ**; other cards default to **Xuất Đơn Giản**. Imported assets are preserved when repackaging in either mode. The full mode additionally collects local card resources.

Use **Tra cứu anim cùng loại** beside the animation ID fields in Passive, Active, Super, Standby and Finish to find another card's compatible effect/view ID and apply it to the chosen row.
