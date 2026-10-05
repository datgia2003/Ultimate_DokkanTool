# -*- coding: utf-8 -*-
from __future__ import annotations

import argparse
import datetime as dt
import io
import json
import mimetypes
import os
import re
import shutil
import sqlite3
import threading
import urllib.parse
import uuid
import wave
from http import HTTPStatus
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from modules.core.patch_sql import materialize_patch_sql, repeatable_animation_sql

from modules.core.mod_workspace import (WORKSPACES, current_workspace, use_workspace, database_path, import_zip, public_workspace, imported_asset)

ROOT = Path(__file__).resolve().parent
DB_PATH = ROOT / "database_decrypted.db"
GAME_RES = ROOT / "game res"
PLAYER_ROOT = ROOT / "components" / "lua_player"
LWF_ROOT = ROOT / "components" / "lwf_player"
BACKUP_DIR = ROOT / "backups"
BACKUP_DIR.mkdir(exist_ok=True)
PATCH_HISTORY_DIR = ROOT / "patches" / "history"
CUSTOM_BGM_DIR = GAME_RES / "bgm ost" / "custom ost"
CUSTOM_LUA_DIR = GAME_RES / "ab_script" / "custom_lua"
_custom_bgm_lock = threading.Lock()

# Update before importing modules.core.db (which reads metadata at import time).
from modules.core.database_updater import update_database_on_startup
DB_UPDATE_STATUS = update_database_on_startup(ROOT)
print(DB_UPDATE_STATUS, flush=True)

def find_card_art(card_id: int):
    cid = str(card_id)
    folder = cid[:-1] + "0" if len(cid) > 1 else cid
    comp_folder = GAME_RES / "card" / folder / f"card_{folder}_composite.png"
    comp_cid = GAME_RES / "card" / cid / f"card_{cid}_composite.png"
    if comp_folder.is_file() and comp_folder.stat().st_size > 0:
        return comp_folder
    if comp_cid.is_file() and comp_cid.stat().st_size > 0:
        return comp_cid

    # Generate composite HD art using Dokkan assets module
    try:
        from modules.core.assets import ensure_card_composite_art_file
        ensure_card_composite_art_file(card_id)
        if comp_folder.is_file() and comp_folder.stat().st_size > 0:
            return comp_folder
        if comp_cid.is_file() and comp_cid.stat().st_size > 0:
            return comp_cid
    except Exception:
        pass

    candidates = [
        GAME_RES / "card" / folder / f"card_{folder}_character.png",
        GAME_RES / "card" / cid / f"card_{cid}_character.png",
        GAME_RES / "thumb" / f"card_{folder}_thumb" / f"card_{folder}_thumb.png",
        GAME_RES / "thumb" / f"card_{cid}_thumb" / f"card_{cid}_thumb.png",
    ]
    return next((p for p in candidates if p.is_file() and p.stat().st_size > 0), None)

# Import backend core modules
from modules.core.character import (
    load_character_context,
    build_full_chains_map
)
from modules.core.db import (
    get_db_connection,
    query_db_one,
    query_db_all,
    category_dict,
    element_type_dict,
    causality_dict,
    causality_details,
    target_type_dict,
    calc_option_dict,
    efficacy_dict,
    efficacy_details,
    exec_timing_dict
)
from modules.core.sql_builder import generate_sql_insert_or_replace, compile_character_sql, compile_character_chain_sql, apply_sql_to_database
from modules.core.dokkan_passive_compiler import compile_passive_description, match_skills_to_description
from modules.core.skill_compilers import (
    compile_leader_description,
    compile_active_description,
    compile_standby_description,
    compile_special_description,
    compile_finish_description
)
import anim_transmuter
import eclp_builder


def create_custom_bgm(wav_bytes: bytes, title: str):
    """Encode a 16-bit WAV as Dokkan's key-9 ADX inside a one-entry AWB."""
    if len(wav_bytes) > 110 * 1024 * 1024:
        raise ValueError("WAV sau khi giải mã vượt quá 110 MB.")
    try:
        with wave.open(io.BytesIO(wav_bytes), 'rb') as source:
            channels = source.getnchannels()
            sample_rate = source.getframerate()
            sample_width = source.getsampwidth()
            frame_count = source.getnframes()
            compression = source.getcomptype()
    except (wave.Error, EOFError) as exc:
        raise ValueError("File WAV không hợp lệ hoặc không phải PCM.") from exc
    if compression != 'NONE' or sample_width != 2 or channels not in (1, 2):
        raise ValueError("Audio phải là WAV PCM 16-bit mono hoặc stereo.")
    if sample_rate < 8000 or sample_rate > 44100 or not frame_count:
        raise ValueError("Sample rate phải nằm trong khoảng 8–44,1 kHz và audio không được rỗng.")
    if frame_count / sample_rate > 600:
        raise ValueError("Audio tối đa 10 phút.")

    try:
        from cricodecs import adx, awb
        config = adx.AdxEncodeConfig()
        config.sample_rate = sample_rate
        config.channels = channels
        config.bit_depth = 4
        config.block_size = 18
        config.encoding_mode = 3
        config.highpass_freq = 500
        config.version = 4
        config.encryption_type = 9
        # Dokkan's widely used key-9 LCG (start=3, mult=0xD19, add=0x43B).
        config.key64 = 0x18D1821E
        config.subkey = 0
        encoded_adx = adx.encode(wav_bytes, config)
        bank = awb.create(alignment=32, id_size=2, offset_size=4)
        bank.add_bytes(encoded_adx, wave_id=0)
        encoded_awb = bank.save_bytes()
    except ImportError as exc:
        raise RuntimeError("Thiếu CriCodecs. Hãy chạy launcher để cài dependency cricodecs.") from exc
    except Exception as exc:
        raise RuntimeError(f"Không mã hóa được ADX/AWB: {exc}") from exc

    CUSTOM_BGM_DIR.mkdir(parents=True, exist_ok=True)
    with _custom_bgm_lock:
        used_ids = set()
        for folder, recursive in ((GAME_RES / 'bgm', False), (CUSTOM_BGM_DIR, True), (ROOT / '.runtime' / 'custom-bgm', True)):
            if folder.exists():
                for file in (folder.rglob('bgm_*.awb') if recursive else folder.glob('bgm_*.awb')):
                    match = re.fullmatch(r'bgm_(\d+)\.awb', file.name, re.IGNORECASE)
                    if match:
                        used_ids.add(int(match.group(1)))
        workspace = current_workspace.get()
        for source, _ in (workspace or {}).get('assets', []):
            source_name = getattr(source, 'filename', str(source)).replace('\\', '/').rsplit('/', 1)[-1]
            match = re.fullmatch(r'bgm_(\d+)\.awb', source_name, re.IGNORECASE)
            if match:
                used_ids.add(int(match.group(1)))
        bgm_id = 900000
        while bgm_id in used_ids:
            bgm_id += 1
        output_path = CUSTOM_BGM_DIR / f'bgm_{bgm_id}.awb'
        output_path.write_bytes(encoded_awb)
        safe_title = str(title or "Custom OST").strip()[:120] or "Custom OST"
        (CUSTOM_BGM_DIR / f'bgm_{bgm_id}.json').write_text(
            json.dumps({"id": bgm_id, "title": safe_title}, ensure_ascii=False), encoding="utf-8"
        )
    return {"id": bgm_id, "title": safe_title, "path": str(output_path)}


def save_custom_lua(filename: str, content: str, overwrite=False):
    """Save one user-authored animation script under game res for later patching."""
    if not isinstance(content, str) or not content.strip():
        raise ValueError("Lua script không được để trống.")
    encoded = content.encode("utf-8")
    if len(encoded) > 5 * 1024 * 1024:
        raise ValueError("Lua script tối đa 5 MB.")
    stem = Path(str(filename or "custom_animation")).stem
    stem = re.sub(r"[^A-Za-z0-9_-]+", "_", stem).strip("_-")[:72] or "custom_animation"
    CUSTOM_LUA_DIR.mkdir(parents=True, exist_ok=True)
    target = CUSTOM_LUA_DIR / f"{stem}.lua"
    suffix = 2
    while target.exists() and not overwrite:
        target = CUSTOM_LUA_DIR / f"{stem}_{suffix}.lua"
        suffix += 1
    target.write_bytes(encoded)
    return {
        "filename": target.name,
        "source_path": str(target),
        "archive_path": f"lua/ab_script/custom_lua/{target.name}",
    }

_chain_cache_lock = threading.Lock()
_chain_cache_key = None
_chain_cache_value = None


def get_chain_map():
    """Keep one chain graph, invalidated when the SQLite database changes."""
    global _chain_cache_key, _chain_cache_value
    active_db = database_path(DB_PATH)
    stat = active_db.stat()
    wal_path = active_db.with_name(active_db.name + "-wal")
    wal = wal_path.stat() if wal_path.exists() else None
    key = (str(active_db), stat.st_mtime_ns, stat.st_size, wal.st_mtime_ns if wal else 0, wal.st_size if wal else 0)
    with _chain_cache_lock:
        if _chain_cache_key != key or _chain_cache_value is None:
            _chain_cache_value = build_full_chains_map()
            _chain_cache_key = key
        return _chain_cache_value


def search_cards_react(keyword, rarities, elem_filter):
    """Uncached, bounded search for React; does not grow Streamlit's cache."""
    clauses = [
        "id % 10 != 0",
        "(CAST(id AS TEXT) LIKE '1%' OR CAST(id AS TEXT) LIKE '4%')",
        "LOWER(COALESCE(name, '')) NOT LIKE '%volume%'",
        "LOWER(COALESCE(name, '')) NOT LIKE '%title page%'",
    ]
    params = []
    if rarities:
        clauses.append(f"rarity IN ({','.join('?' for _ in rarities)})")
        params.extend(rarities)
    if isinstance(elem_filter, int):
        clauses.append("element = ?")
        params.append(elem_filter)
    elif isinstance(elem_filter, str):
        kind = elem_filter.lower()
        if kind == "super":
            clauses.append("element BETWEEN 10 AND 14")
        elif kind == "extreme":
            clauses.append("element BETWEEN 20 AND 24")
        elif kind in {"agl", "teq", "int", "str", "phy"}:
            clauses.append("element % 10 = ?")
            params.append({"agl": 0, "teq": 1, "int": 2, "str": 3, "phy": 4}[kind])
    if keyword:
        pattern = f"%{keyword}%"
        clauses.append("""(name LIKE ? OR CAST(id AS TEXT) LIKE ?
            OR CAST(passive_skill_set_id AS TEXT) LIKE ?
            OR CAST(leader_skill_set_id AS TEXT) LIKE ?
            OR id IN (SELECT card_id FROM card_active_skills WHERE CAST(active_skill_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT card_id FROM card_standby_skill_set_relations WHERE CAST(standby_skill_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT card_id FROM card_specials WHERE CAST(special_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT cards.id FROM cards JOIN passive_skill_set_relations
                ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
                WHERE CAST(passive_skill_set_relations.passive_skill_id AS TEXT) LIKE ?))""")
        params.extend([pattern] * 8)
    rows = query_db_all(
        "SELECT id, name, rarity, element, hp_max, atk_max, def_max, "
        "leader_skill_set_id, passive_skill_set_id FROM cards WHERE "
        + " AND ".join(clauses) + " LIMIT 400", tuple(params)
    )
    cards = [dict(row) for row in rows]
    chain_map = get_chain_map()
    rarities_by_id = {card['id']: card.get('rarity', 0) for card in cards}
    def sort_key(card):
        cid = card['id']
        root, _, position = chain_map.get(cid, (cid, (), 0))
        return (-rarities_by_id.get(root, card.get('rarity', 0)), -root, position, -cid)
    cards.sort(key=sort_key)
    return cards


EDITABLE_CARD_FIELDS = {
    "name", "character_id", "cost", "rarity", "hp_init", "hp_max", "atk_init",
    "atk_max", "def_init", "def_max", "element", "lv_max", "skill_lv_max",
    "grow_type", "price", "training_exp", "special_motion", "aura_id", "aura_scale",
    "aura_offset_x", "aura_offset_y", "bg_effect_id", "potential_board_id",
    "leader_skill_set_id", "passive_skill_set_id"
}

PASSIVE_SKILL_FIELDS = (
    "name", "exec_timing_type", "exec_game_type", "efficacy_type", "target_type",
    "sub_target_type_set_id", "passive_skill_effect_id", "calc_option", "turn",
    "is_once", "probability", "causality_conditions", "eff_value1", "eff_value2",
    "eff_value3", "efficacy_values"
)


def sql_literal(value):
    if value is None:
        return "NULL"
    if isinstance(value, bool):
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    if isinstance(value, (dict, list)):
        value = json.dumps(value, ensure_ascii=False)
    return "'" + str(value).replace("'", "''") + "'"


def find_thumb(card_id: int):
    cid = str(card_id)
    folder = cid[:-1] + "0" if len(cid) > 1 else cid
    for variant in dict.fromkeys((cid, folder)):
        for name in (f'character/thumb/card_{variant}_thumb/card_{variant}_thumb.png', f'character/thumb/card_{variant}_thumb.png'):
            imported = imported_asset(name)
            if imported:
                return imported
    alt = "10" + cid[-5:-1] + "0" if len(cid) >= 7 else folder
    candidates = [
        GAME_RES / "thumb" / f"card_{folder}_thumb" / f"card_{folder}_thumb.png",
        GAME_RES / "thumb" / f"card_{cid}_thumb" / f"card_{cid}_thumb.png",
    ]
    found = next((p for p in candidates if p.is_file() and p.stat().st_size > 100), None)
    if found:
        return found
    # Search results load thumbnails on demand. The old handler only checked
    # local files, so every newly added card stayed blank until fetched elsewhere.
    from modules.core.assets import get_or_fetch_cached_asset
    for variant in dict.fromkeys((folder, alt, cid)):
        filename = f"card_{variant}_thumb.png"
        data, ctype = get_or_fetch_cached_asset(
            f"assets/character/thumb/card_{variant}_thumb/{filename}"
        )
        if data and len(data) > 256 and ctype.startswith("image/"):
            target = GAME_RES / "thumb" / f"card_{variant}_thumb" / filename
            target.parent.mkdir(parents=True, exist_ok=True)
            staging = target.with_suffix(".png.part")
            staging.write_bytes(data)
            os.replace(staging, target)
            return target
    composite = GAME_RES / "card" / folder / f"card_{folder}_composite.png"
    return composite if composite.is_file() and composite.stat().st_size > 100 else None


def find_audio_file(subfolder: str, name_or_id: str):
    base_dir = GAME_RES / "sound" / subfolder
    if not base_dir.exists():
        return None
    patterns = [
        f"{name_or_id}.mp3", f"{name_or_id}.ogg", f"{name_or_id}.m4a", f"{name_or_id}.wav",
        f"bgm_{name_or_id}.mp3", f"bgm_{name_or_id}.ogg",
        f"voice_{name_or_id}.mp3", f"voice_{name_or_id}.ogg"
    ]
    for pat in patterns:
        f = base_dir / pat
        if f.is_file():
            return f
    # Recursive search if simple lookup fails
    for f in base_dir.glob(f"*{name_or_id}*"):
        if f.is_file() and f.suffix.lower() in {".mp3", ".ogg", ".m4a", ".wav"}:
            return f
    return None


def prewarm_effect_pack(epid: int):
    if not epid or epid <= 0:
        return
    try:
        from modules.core.assets import get_or_fetch_cached_asset
        data, _ = get_or_fetch_cached_asset(f"api/effect-pack/{epid}")
        if not data:
            return
        pack = json.loads(data.decode("utf-8", errors="ignore"))
        lwf_info = pack.get("lwf") or {}
        lwf_url = lwf_info.get("url") or lwf_info.get("rel") or ""
        if lwf_url:
            clean = lwf_url.lstrip("/")
            if clean.startswith("assets/"):
                clean = clean[len("assets/"):]
            lwf_bytes, _ = get_or_fetch_cached_asset(f"assets/{clean}")
            if lwf_bytes:
                base_dir = clean[:clean.rfind("/") + 1]
                pngs = re.findall(rb'[\w\.-]+\.png', lwf_bytes)
                for p in set(pngs):
                    fn = p.decode("ascii", errors="ignore")
                    if fn.startswith("card_"):
                        continue
                    get_or_fetch_cached_asset(f"assets/{base_dir}{fn}")
    except Exception as e:
        print(f"[prewarm] Effect pack {epid} notice: {e}")


def get_card_chain_summary(card_id: int):
    from modules.core.character import get_workspace_transformation_chain
    chain_ids = get_workspace_transformation_chain(card_id)
    if chain_ids is None:
        chain_map = get_chain_map()
        if card_id not in chain_map:
            return []
        root_id, chain_ids, curr_pos = chain_map[card_id]
    else:
        root_id = chain_ids[0] if chain_ids else card_id
    cards = []
    for pos, cid in enumerate(chain_ids):
        row = query_db_one("SELECT id, name, rarity, element, leader_skill_set_id, passive_skill_set_id FROM cards WHERE id = ?", (cid,))
        if row:
            cards.append({
                "id": cid,
                "name": row.get("name", f"Card #{cid}"),
                "rarity": row.get("rarity", 0),
                "element": row.get("element", 0),
                "pos": pos,
                "isCurrent": (cid == card_id),
                "isRoot": (cid == root_id)
            })
    return cards


def get_card_chain_ost(card_id: int):
    """Collect music for every form, including passive transformation params."""
    forms = get_card_chain_summary(card_id) or [{"id": card_id, "name": f"Card #{card_id}", "pos": 0}]
    tracks = []
    conn = get_db_connection()
    try:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        for form in forms:
            cid = int(form["id"])
            form_label = "Base" if form.get("pos", 0) == 0 else f"Form {form['pos']}"

            def add(bgm_id, source, source_type=None):
                try:
                    bid = int(bgm_id)
                except (TypeError, ValueError):
                    return
                if bid > 0:
                    card_name = form.get("name") or f"Card #{cid}"
                    tracks.append({"id": bid, "card_id": cid, "card_name": card_name,
                                   "rarity": form.get("rarity", 0), "element": form.get("element", 0),
                                   "source": source, "source_type": source_type,
                                   "label": f"{form_label} · {card_name} · {source}"})

            for row in cursor.execute("""
                SELECT DISTINCT pse.bgm_id FROM cards cd
                JOIN passive_skill_set_relations rel ON rel.passive_skill_set_id = cd.passive_skill_set_id
                JOIN passive_skills ps ON ps.id = rel.passive_skill_id
                JOIN passive_skill_effects pse ON pse.id = ps.passive_skill_effect_id
                WHERE cd.id = ? AND pse.bgm_id > 0
            """, (cid,)).fetchall():
                add(row[0], "Entrance Theme")

            for table, relation, set_table, source in (
                ("card_active_skills", "active_skill_set_id", "active_skill_sets", "Active Theme"),
                ("card_standby_skill_set_relations", "standby_skill_set_id", "standby_skill_sets", "Standby Theme"),
                ("card_finish_skill_set_relations", "finish_skill_set_id", "finish_skill_sets", "Finish Theme"),
            ):
                rows = cursor.execute(f"""
                    SELECT DISTINCT sets.bgm_id FROM {table} rel
                    JOIN {set_table} sets ON sets.id = rel.{relation}
                    WHERE rel.card_id = ? AND sets.bgm_id > 0
                """, (cid,)).fetchall()
                for row in rows:
                    add(row[0], source)

            for row in cursor.execute('''
                SELECT DISTINCT opt.bgm_id, ss.name AS special_name FROM card_specials cs
                JOIN extra_special_options opt ON opt.card_special_id=cs.id
                LEFT JOIN special_sets ss ON ss.id=cs.special_set_id
                WHERE cs.card_id=? AND opt.bgm_id>0
            ''', (cid,)).fetchall():
                name = row["special_name"] or "Super Attack"
                add(row["bgm_id"], f"EX SA · {name}", "ex_super_attack")

            passive_rows = cursor.execute("""
                SELECT DISTINCT ps.efficacy_type, ps.eff_value2, ps.eff_value3
                FROM cards cd
                JOIN passive_skill_set_relations rel ON rel.passive_skill_set_id = cd.passive_skill_set_id
                JOIN passive_skills ps ON ps.id = rel.passive_skill_id
                WHERE cd.id = ? AND ps.efficacy_type IN (79, 103, 109)
            """, (cid,)).fetchall()
            for row in passive_rows:
                if row["efficacy_type"] == 109:
                    add(row["eff_value3"], "Revival Theme")
                    continue
                for param_no in {row["eff_value2"], row["eff_value3"]}:
                    if not param_no or int(param_no) <= 0:
                        continue
                    bgm = cursor.execute("""
                        SELECT value FROM battle_params WHERE param_no = ? AND idx = 8
                    """, (param_no,)).fetchone()
                    if bgm:
                        add(bgm[0], "Transformation Theme")
    finally:
        conn.close()
    return tracks


def generate_deep_sql_patch(card_id: int, changes: dict):
    sql_lines = []
    
    # 1. cards table
    card_cols = {k: v for k, v in changes.items() if k in EDITABLE_CARD_FIELDS}
    if card_cols:
        card_cols["updated_at"] = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        sets = ", ".join(f'"{k}" = {repr(v) if v is not None else "NULL"}' for k, v in card_cols.items())
        sql_lines.append(f'UPDATE "cards" SET {sets} WHERE "id" = {card_id};')
        
    # 2. leader_set
    l_set = changes.get("leader_set")
    if l_set and isinstance(l_set, dict) and l_set.get("id"):
        fields = {k: v for k, v in l_set.items() if k in {"name", "description"}}
        if fields:
            sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
            sql_lines.append(f'UPDATE "leader_skill_sets" SET {sets} WHERE "id" = {l_set["id"]};')
            
    # 3. leader_skills
    LEADER_SKILL_FIELDS = {
        "exec_timing_type", "target_type", "sub_target_type_set_id",
        "causality_conditions", "efficacy_type", "efficacy_values", "calc_option"
    }
    generated_subtargets = {}
    next_subtarget_set_id = None
    next_subtarget_id = None
    for sk in changes.get("leader_skills", []):
        temporary_id = int(sk.get("sub_target_type_set_id") or 0)
        entries = sk.get("_sub_target_types")
        if temporary_id >= 0 or not entries or temporary_id in generated_subtargets:
            continue
        if next_subtarget_set_id is None:
            next_subtarget_set_id = int(query_db_one(
                'SELECT COALESCE(MAX(id), 0) AS id FROM sub_target_type_sets')["id"])
            next_subtarget_id = int(query_db_one(
                'SELECT COALESCE(MAX(id), 0) AS id FROM sub_target_types')["id"])
        next_subtarget_set_id += 1
        generated_subtargets[temporary_id] = next_subtarget_set_id
        sql_lines.append(
            f'INSERT INTO "sub_target_type_sets" ("id", "created_at", "updated_at") '
            f"VALUES ({next_subtarget_set_id}, datetime('now'), datetime('now'));"
        )
        for value_type, value in entries:
            next_subtarget_id += 1
            sql_lines.append(
                f'INSERT INTO "sub_target_types" '
                f'("id", "sub_target_type_set_id", "target_value_type", "target_value", '
                f'"created_at", "updated_at") VALUES '
                f"({next_subtarget_id}, {next_subtarget_set_id}, {int(value_type)}, "
                f"{int(value)}, datetime('now'), datetime('now'));"
            )
    next_leader_id = None
    for sk in changes.get("leader_skills", []):
        valid = {k: sk[k] for k in LEADER_SKILL_FIELDS if k in sk}
        temporary_id = int(valid.get("sub_target_type_set_id") or 0)
        if temporary_id in generated_subtargets:
            valid["sub_target_type_set_id"] = generated_subtargets[temporary_id]
        if sk.get("id"):
            if valid:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                sql_lines.append(f'UPDATE "leader_skills" SET {sets} WHERE "id" = {int(sk["id"])};')
        elif l_set and l_set.get("id"):
            if next_leader_id is None:
                next_leader_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM leader_skills')["id"])
            next_leader_id += 1
            new_lid = next_leader_id
            cols = ['"id"', '"leader_skill_set_id"'] + [f'"{k}"' for k in valid.keys()]
            vals = [str(new_lid), str(int(l_set["id"]))] + [sql_literal(v) for v in valid.values()]
            sql_lines.append(f'INSERT INTO "leader_skills" ({", ".join(cols)}, "created_at", "updated_at") VALUES ({", ".join(vals)}, datetime(\'now\'), datetime(\'now\'));')

    # 4. passive_set
    p_set = changes.get("passive_set")
    if p_set and isinstance(p_set, dict) and p_set.get("id"):
        p_set = dict(p_set)
        if 'itemized_description' not in p_set and 'description' in p_set:
            p_set['itemized_description'] = p_set['description']
        supported = set(get_table_columns('passive_skill_sets'))
        fields = {k: v for k, v in p_set.items() if k in {"name", "itemized_description"} and k in supported}
        if fields:
            sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in fields.items())
            sql_lines.append(f'UPDATE "passive_skill_sets" SET {sets} WHERE "id" = {int(p_set["id"])};')

    # 5. passive_skills (including new compiled rows and their set relations)
    replace_passive = bool(changes.get("passive_replace_existing"))
    if replace_passive and p_set and p_set.get("id"):
        sql_lines.append(
            f'DELETE FROM "passive_skill_set_relations" WHERE "passive_skill_set_id" = {int(p_set["id"])};'
        )
    new_skill_id = None
    new_relation_id = None
    for sk in changes.get("passive_skills", []):
        valid = {k: sk[k] for k in PASSIVE_SKILL_FIELDS if k in sk}
        if sk.get("id"):
            if valid and not replace_passive:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                sql_lines.append(f'UPDATE "passive_skills" SET {sets} WHERE "id" = {int(sk["id"])};')
            if replace_passive and p_set and sk.get("relation_id"):
                rel_id = int(sk["relation_id"])
                sql_lines.append(
                    f'INSERT INTO "passive_skill_set_relations" '
                    f'("id", "passive_skill_set_id", "passive_skill_id", "created_at", "updated_at") '
                    f'VALUES ({rel_id}, {int(p_set["id"])}, {int(sk["id"])}, '
                    f"datetime('now'), datetime('now'));"
                )
            continue
        if not p_set or not p_set.get("id"):
            continue
        if new_skill_id is None:
            new_skill_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM passive_skills')['id'])
            new_relation_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM passive_skill_set_relations')['id'])
        new_skill_id += 1
        new_relation_id += 1
        defaults = {
            "name": p_set.get("name") or "Passive Skill", "exec_timing_type": 1,
            "exec_game_type": 0, "efficacy_type": 0, "target_type": 1,
            "sub_target_type_set_id": 0, "passive_skill_effect_id": None,
            "calc_option": 0, "turn": 1, "is_once": 0, "probability": 100,
            "causality_conditions": "", "eff_value1": 0, "eff_value2": 0,
            "eff_value3": 0, "efficacy_values": "{}"
        }
        defaults.update(valid)
        columns = ', '.join(f'"{field}"' for field in PASSIVE_SKILL_FIELDS)
        values = ', '.join(sql_literal(defaults[field]) for field in PASSIVE_SKILL_FIELDS)
        sql_lines.append(
            f'INSERT INTO "passive_skills" ("id", {columns}, "created_at", "updated_at") '
            f"VALUES ({new_skill_id}, {values}, datetime('now'), datetime('now'));"
        )
        sql_lines.append(
            f'INSERT INTO "passive_skill_set_relations" '
            f'("id", "passive_skill_set_id", "passive_skill_id", "created_at", "updated_at") '
            f'VALUES ({new_relation_id}, {int(p_set["id"])}, {new_skill_id}, '
            f"datetime('now'), datetime('now'));"
        )

    # 6. active_set
    a_set = changes.get("active_set")
    ACTIVE_SET_FIELDS = {
        "name", "description", "effect_description", "condition_description",
        "turn", "hp_rate_under", "exec_limit", "causality_conditions",
        "ultimate_special_id", "special_view_id", "costume_special_view_id",
        "sound_id", "bgm_id"
    }
    if a_set and isinstance(a_set, dict) and a_set.get("id"):
        fields = {k: v for k, v in a_set.items() if k in ACTIVE_SET_FIELDS}
        if fields:
            sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in fields.items())
            sql_lines.append(f'UPDATE "active_skill_sets" SET {sets} WHERE "id" = {int(a_set["id"])};')

    # 7. active_skills
    ACTIVE_SKILL_FIELDS = {
        "target_type", "sub_target_type_set_id", "calc_option", "efficacy_type",
        "eff_val1", "eff_val2", "eff_val3", "efficacy_values", "thumb_effect_id",
        "effect_se_id", "turn"
    }
    next_active_id = None
    for sk in changes.get("active_skills", []):
        valid = {k: sk[k] for k in ACTIVE_SKILL_FIELDS if k in sk}
        if sk.get("id"):
            if valid:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                sql_lines.append(f'UPDATE "active_skills" SET {sets} WHERE "id" = {int(sk["id"])};')
        elif a_set and a_set.get("id"):
            if next_active_id is None:
                next_active_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM active_skills')["id"])
            next_active_id += 1
            new_aid = next_active_id
            cols = ['"id"', '"active_skill_set_id"'] + [f'"{k}"' for k in valid.keys()]
            vals = [str(new_aid), str(int(a_set["id"]))] + [sql_literal(v) for v in valid.values()]
            sql_lines.append(f'INSERT INTO "active_skills" ({", ".join(cols)}, "created_at", "updated_at") VALUES ({", ".join(vals)}, datetime(\'now\'), datetime(\'now\'));')

    # 8. special_set
    s_set = changes.get("special_set")
    if s_set and isinstance(s_set, dict) and s_set.get("id"):
        fields = {k: v for k, v in s_set.items() if k in {"name", "description", "causality_description", "aim_target", "increase_rate", "lv_bonus"}}
        if fields:
            sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in fields.items())
            sql_lines.append(f'UPDATE "special_sets" SET {sets} WHERE "id" = {int(s_set["id"])};')

    # 9. card_specials (including special_sets, specials effects, bonuses, and extra options)
    CARD_SPECIAL_FIELDS = {
        "eball_num_start", "view_id", "priority", "style", "lv_start",
        "special_asset_id", "special_bonus_id1", "special_bonus_lv1",
        "bonus_view_id1", "special_bonus_id2", "special_bonus_lv2",
        "bonus_view_id2", "causality_conditions"
    }
    SPECIAL_EFFECT_FIELDS = {
        "special_set_id", "type", "efficacy_type", "target_type", "calc_option",
        "turn", "prob", "causality_conditions", "eff_value1", "eff_value2", "eff_value3"
    }
    SPECIAL_BONUS_FIELDS = {
        "name", "description", "efficacy_type", "target_type", "calc_option",
        "turn", "probability", "causality_conditions", "eff_value1", "eff_value2", "eff_value3"
    }
    EXTRA_SPECIAL_FIELDS = {"card_special_id", "probability", "extra_special_type", "bgm_id"}

    next_special_id = None
    next_extra_id = None
    for cs in changes.get("card_specials", []):
        if cs.get("id"):
            valid = {k: cs[k] for k in CARD_SPECIAL_FIELDS if k in cs}
            if valid:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                sql_lines.append(f'UPDATE "card_specials" SET {sets} WHERE "id" = {int(cs["id"])};')

        # Child special_set
        cs_set = cs.get("special_set")
        if cs_set and isinstance(cs_set, dict) and cs_set.get("id"):
            s_fields = {k: v for k, v in cs_set.items() if k in {"name", "description", "causality_description", "aim_target", "increase_rate", "lv_bonus"}}
            if s_fields:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in s_fields.items())
                sql_lines.append(f'UPDATE "special_sets" SET {sets} WHERE "id" = {int(cs_set["id"])};')

        # Specials effects
        for se in cs.get("specials", []):
            se_valid = {k: se[k] for k in SPECIAL_EFFECT_FIELDS if k in se}
            if se.get("id"):
                if se_valid:
                    sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in se_valid.items())
                    sql_lines.append(f'UPDATE "specials" SET {sets} WHERE "id" = {int(se["id"])};')
            elif cs.get("special_set_id"):
                if next_special_id is None:
                    next_special_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM specials')["id"])
                next_special_id += 1
                new_seid = next_special_id
                se_valid["special_set_id"] = int(cs["special_set_id"])
                if "type" not in se_valid:
                    se_valid["type"] = "Special::NormalEfficacySpecial"
                cols = ['"id"'] + [f'"{k}"' for k in se_valid.keys()]
                vals = [str(new_seid)] + [sql_literal(v) for v in se_valid.values()]
                sql_lines.append(f'INSERT INTO "specials" ({", ".join(cols)}, "created_at", "updated_at") VALUES ({", ".join(vals)}, datetime(\'now\'), datetime(\'now\'));')

        # Special bonuses
        for sb in cs.get("bonuses", []):
            sb_valid = {k: sb[k] for k in SPECIAL_BONUS_FIELDS if k in sb}
            if sb.get("id") and sb_valid:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in sb_valid.items())
                sql_lines.append(f'UPDATE "special_bonuses" SET {sets} WHERE "id" = {int(sb["id"])};')

        # Extra special option
        eso = cs.get("extra_special_option")
        if eso and isinstance(eso, dict):
            eso_valid = {k: eso[k] for k in EXTRA_SPECIAL_FIELDS if k in eso}
            if eso.get("id"):
                if eso_valid:
                    sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in eso_valid.items())
                    sql_lines.append(f'UPDATE "extra_special_options" SET {sets} WHERE "id" = {int(eso["id"])};')
            elif cs.get("id"):
                if next_extra_id is None:
                    next_extra_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM extra_special_options')["id"])
                next_extra_id += 1
                new_esoid = next_extra_id
                eso_valid["card_special_id"] = int(cs["id"])
                cols = ['"id"'] + [f'"{k}"' for k in eso_valid.keys()]
                vals = [str(new_esoid)] + [sql_literal(v) for v in eso_valid.values()]
                sql_lines.append(f'INSERT INTO "extra_special_options" ({", ".join(cols)}) VALUES ({", ".join(vals)});')

    # 10. standby_set
    sb_set = changes.get("standby_set")
    if sb_set and isinstance(sb_set, dict) and sb_set.get("id"):
        fields = {k: v for k, v in sb_set.items() if k in {"name", "effect_description", "condition_description", "exec_limit", "causality_conditions", "special_view_id", "costume_special_view_id", "bgm_id"}}
        if fields:
            sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
            sql_lines.append(f'UPDATE "standby_skill_sets" SET {sets} WHERE "id" = {sb_set["id"]};')

    # standby_link (for initialized standby skills)
    sb_link = changes.get("standby_link")
    if sb_link and isinstance(sb_link, dict) and sb_link.get("card_id") and sb_link.get("standby_skill_set_id"):
        sql_lines.append(
            f'INSERT OR REPLACE INTO "card_standby_skill_set_relations" ("id", "card_id", "standby_skill_set_id") '
            f'VALUES ({sb_link.get("id", sb_link["standby_skill_set_id"])}, {sb_link["card_id"]}, {sb_link["standby_skill_set_id"]});'
        )

    # standby_skills
    next_standby_id = None
    for sk in changes.get("standby_skills", []):
        valid = {k: v for k, v in sk.items() if k in {"target_type", "target_type_values", "sub_target_type_set_id", "turn", "efficacy_type", "calc_option", "efficacy_values", "thumb_effect_id", "effect_se_id"}}
        if sk.get("id"):
            if valid:
                sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                sql_lines.append(f'UPDATE "standby_skills" SET {sets} WHERE "id" = {sk["id"]};')
        elif sb_set and sb_set.get("id"):
            if next_standby_id is None:
                next_standby_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM standby_skills')["id"])
            next_standby_id += 1
            cols = ['"id"', '"standby_skill_set_id"'] + [f'"{k}"' for k in valid]
            vals = [str(next_standby_id), str(int(sb_set["id"]))] + [sql_literal(v) for v in valid.values()]
            sql_lines.append(f'INSERT INTO "standby_skills" ({", ".join(cols)}, "created_at", "updated_at") VALUES ({", ".join(vals)}, datetime(\'now\'), datetime(\'now\'));')

    # 11. finish_skill_sets (list) or single finish_set
    finish_items = changes.get("finish_skill_sets")
    next_finish_id = None
    if finish_items and isinstance(finish_items, list):
        for f_item in finish_items:
            f_set = f_item.get("set")
            if f_set and isinstance(f_set, dict) and f_set.get("id"):
                fields = {k: v for k, v in f_set.items() if k in {"name", "effect_description", "condition_description", "exec_limit", "causality_conditions", "finish_special_id", "special_view_id", "costume_special_view_id", "bgm_id"}}
                if fields:
                    sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
                    sql_lines.append(f'UPDATE "finish_skill_sets" SET {sets} WHERE "id" = {f_set["id"]};')

            f_spec = f_item.get("special")
            if f_spec and isinstance(f_spec, dict) and f_spec.get("id"):
                fields = {k: v for k, v in f_spec.items() if k in {"increase_rate", "aim_target"}}
                if fields:
                    sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
                    sql_lines.append(f'UPDATE "finish_specials" SET {sets} WHERE "id" = {f_spec["id"]};')

            for sk in f_item.get("skills", []):
                valid = {k: v for k, v in sk.items() if k in {"target_type", "target_type_values", "sub_target_type_set_id", "turn", "efficacy_type", "calc_option", "efficacy_values", "thumb_effect_id", "effect_se_id"}}
                if sk.get("id"):
                    if valid:
                        sets = ", ".join(f'"{k}" = {sql_literal(v)}' for k, v in valid.items())
                        sql_lines.append(f'UPDATE "finish_skills" SET {sets} WHERE "id" = {sk["id"]};')
                elif f_set and f_set.get("id"):
                    if next_finish_id is None:
                        next_finish_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM finish_skills')["id"])
                    next_finish_id += 1
                    cols = ['"id"', '"finish_skill_set_id"'] + [f'"{k}"' for k in valid]
                    vals = [str(next_finish_id), str(int(f_set["id"]))] + [sql_literal(v) for v in valid.values()]
                    sql_lines.append(f'INSERT INTO "finish_skills" ({", ".join(cols)}, "created_at", "updated_at") VALUES ({", ".join(vals)}, datetime(\'now\'), datetime(\'now\'));')
    else:
        # Fallback single finish_set / finish_special
        f_set = changes.get("finish_set")
        if f_set and isinstance(f_set, dict) and f_set.get("id"):
            fields = {k: v for k, v in f_set.items() if k in {"name", "effect_description", "condition_description", "exec_limit", "causality_conditions", "finish_special_id", "special_view_id", "costume_special_view_id", "bgm_id"}}
            if fields:
                sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
                sql_lines.append(f'UPDATE "finish_skill_sets" SET {sets} WHERE "id" = {f_set["id"]};')

        f_spec = changes.get("finish_special")
        if f_spec and isinstance(f_spec, dict) and f_spec.get("id"):
            fields = {k: v for k, v in f_spec.items() if k in {"increase_rate", "aim_target"}}
            if fields:
                sets = ", ".join(f'"{k}" = {repr(v)}' for k, v in fields.items())
                sql_lines.append(f'UPDATE "finish_specials" SET {sets} WHERE "id" = {f_spec["id"]};')

    # 12. deleted_rows
    for del_item in changes.get("deleted_rows", []):
        tbl = del_item.get("table")
        rid = del_item.get("id")
        if tbl and rid:
            # Basic validation to prevent arbitrary table drops
            if tbl in {
                "leader_skills", "passive_skills", "passive_skill_set_relations", "passive_skill_effects", "active_skills",
                "card_specials", "standby_skills", "finish_skills", "finish_skill_sets",
                "finish_specials", "card_standby_skill_set_relations", "card_finish_skill_set_relations",
                "specials", "special_bonuses", "extra_special_options"
            }:
                sql_lines.append(f'DELETE FROM "{tbl}" WHERE "id" = {rid};')

    return sql_lines


def has_custom_animation(ctx):
    for row in [*ctx.get('passive_skill_effects', []), *ctx.get('special_views', [])]:
        script = str(row.get('script_name') or '').removesuffix('.lua')
        if not script:
            continue
        if re.match(r'^(pse|bs|sp|fi)_\d+_', script):
            return True
        if Path(script).name != script:
            continue
        for folder in ('passive_skill_effect', 'active_skill', 'attack_sp', 'standby_skill', 'finish_skill'):
            file = GAME_RES / 'ab_script' / folder / (script + '.lua')
            if file.is_file():
                with file.open('rb') as handle:
                    if b'Transmuted by Dokkan Patch Tool' in handle.read(256):
                        return True
    return False


def compile_workspace_sql(card_id, changes, raw_sql):
    workspace = current_workspace.get()
    if not workspace:
        return compile_character_chain_sql(card_id, changes, raw_sql)
    parts = [repeatable_animation_sql(workspace['sql']), '\n;']
    drafts = changes.get('_form_drafts') or {str(card_id): changes}
    custom = changes.get('_form_custom_sql') or {str(card_id): raw_sql}
    pending = {int(cid) for cid, draft in drafts.items() if draft}
    pending.update(int(cid) for cid, value in custom.items() if value)
    # Imported rows also need normalization when the user exports without edits.
    # This is the same chain compilation used for repairing an existing ZIP.
    pending.update(int(card['id']) for card in workspace['cards'])
    pending.update(int(cid) for cid in changes.get('_form_chain_ids', []))
    pending.add(int(card_id))
    scoped_changes = {
        '_form_chain_ids': list(dict.fromkeys([*changes.get('_form_chain_ids', []), *sorted(pending)])),
        '_form_drafts': {str(cid): drafts.get(str(cid), {}) for cid in pending},
        '_form_custom_sql': custom,
    }
    allocation_state = {}
    parts.append(compile_character_chain_sql(card_id, scoped_changes, raw_sql, allocation_state))
    return materialize_patch_sql('\n'.join(parts), workspace.get('base_db_path', DB_PATH))


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "DokkanReactAPI/2.0"

    def log_message(self, fmt, *args):
        # Concise logging
        print(f"[react-api] {self.command} {self.path.split('?')[0]} - {args[1] if len(args) > 1 else ''}")

    def cors(self):
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, X-Mod-Workspace, Authorization, Range")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, PUT, DELETE, OPTIONS")

    def send_json(self, payload, status=200):
        data = json.dumps(payload, ensure_ascii=False, default=str).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.cors()
        self.end_headers()
        self.wfile.write(data)

    def send_file(self, path: Path, cache=True):
        if not path.is_file():
            self.send_error(404, "File not found")
            return
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
        self.send_header("Cache-Control", "public, max-age=86400" if cache else "no-cache")
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

    def body_json(self):
        length = int(self.headers.get("Content-Length", "0") or 0)
        raw = self.rfile.read(length) if length else b"{}"
        return json.loads(raw.decode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.cors()
        self.end_headers()

    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        self.with_mod_workspace(self.get_request)

    def do_POST(self):
        self.with_mod_workspace(self.post_request)

    def with_mod_workspace(self, callback):
        workspace_id = self.headers.get('X-Mod-Workspace', '')
        if not workspace_id and self.command in ('GET', 'HEAD'):
            workspace_id = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query).get('mod_workspace', [''])[0]
        workspace = WORKSPACES.get(workspace_id) if workspace_id else None
        if workspace_id and workspace is None:
            self.send_json({'error': 'Phiên import đã hết hạn. Vui lòng mở lại ZIP.'}, 409)
            return
        if workspace and (self.path.endswith('/apply') or self.path == '/api/v2/causalities') and self.command == 'POST':
            self.send_json({'error': 'Mod import được chỉnh bằng bản nháp và xuất ZIP; không ghi database.'}, 400)
            return
        with use_workspace(workspace):
            callback()

    def get_request(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path
        query = urllib.parse.parse_qs(parsed.query)

        try:
            if path == "/" or path == "/index.html":
                self.send_response(302)
                self.send_header("Location", "http://127.0.0.1:5174/")
                self.end_headers()
                return

            asset_match = re.fullmatch(r'/api/v2/mod-assets/([a-f0-9]{32})/(.+)', path)
            if asset_match:
                workspace = WORKSPACES.get(asset_match.group(1))
                if not workspace:
                    self.send_json({'error': 'Phiên import không còn tồn tại.'}, 404)
                    return
                asset_route = asset_match.group(2)
                if asset_route == 'api/script':
                    script = query.get('path', [''])[0].replace('\\', '/')
                    local = imported_asset('lua/' + script, workspace)
                    if local:
                        self.send_json({'path': script, 'text': local.read_text(encoding='utf-8-sig')})
                        return
                asset_name = asset_route.removeprefix('assets/')
                if asset_name.startswith(('card/', 'card_bg/')):
                    asset_name = 'character/' + asset_name
                local = imported_asset(asset_name, workspace)
                if local:
                    self.send_file(local, cache=False)
                    return
                import requests
                url = 'http://127.0.0.1:8585/' + asset_route
                if parsed.query:
                    url += '?' + parsed.query
                with requests.get(url, headers={'Range': self.headers['Range']} if self.headers.get('Range') else {}, stream=True, timeout=45) as response:
                    self.send_response(response.status_code)
                    for header in ('Content-Type', 'Content-Length', 'Content-Range', 'Accept-Ranges'):
                        if header in response.headers:
                            self.send_header(header, response.headers[header])
                    self.cors()
                    self.end_headers()
                    if self.command != 'HEAD':
                        for chunk in response.iter_content(256 * 1024):
                            self.wfile.write(chunk)
                return

            # 1. Health check
            if path == '/api/v2/custom-lua/list':
                files = {item.name for item in CUSTOM_LUA_DIR.glob('*.lua') if not re.fullmatch(r'timeline_\d+_draft(?:_\d+)?\.lua', item.name)}
                for _, name in (current_workspace.get() or {}).get('assets', []):
                    if name.startswith('lua/ab_script/custom_lua/') and name.endswith('.lua'):
                        files.add(Path(name).name)
                self.send_json({'items': [{'filename': name, 'script_name': Path(name).stem} for name in sorted(files)]})
                return

            if path == "/api/v2/health":
                self.send_json({
                    "ok": True,
                    "db": DB_PATH.exists(),
                    "db_update": DB_UPDATE_STATUS,
                    "version": "2.0"
                })
                return

            # 1.1 Config (Dokkan Eclipse cookie, default author, etc.)
            if path == "/api/v2/config":
                cfg = eclp_builder.load_config()
                self.send_json({"ok": True, "config": cfg})
                return

            # 2. Metadata: Categories, Elements, Rules
            if path == '/api/v2/skills/clone':
                from modules.core.skill_clone import clone_skill
                self.send_json(clone_skill(query.get('kind', [''])[0],
                    int(query.get('source_id', ['0'])[0]), int(query.get('target_id', ['0'])[0])))
                return

            if path == "/api/v2/card-memberships":
                self.send_json({
                    "link_skills": query_db_all('SELECT id, name, description FROM link_skills ORDER BY name, id'),
                    "categories": query_db_all('SELECT id, name FROM card_categories ORDER BY name, id'),
                })
                return

            if path == "/api/v2/meta":
                from modules.core.skill_compilers import special_damage_profiles
                self.send_json({
                    'special_damage_profiles': special_damage_profiles(),
                    "categories": {row['id']: row['name'] for row in query_db_all('SELECT id, name FROM card_categories ORDER BY priority, id')},
                    "link_skills": query_db_all('SELECT id, name, description FROM link_skills ORDER BY name, id'),
                    "elements": element_type_dict,
                    "causality": causality_dict,
                    "causality_details": causality_details,
                    "target_types": target_type_dict,
                    "calc_options": calc_option_dict,
                    "efficacy_types": efficacy_dict,
                    "efficacy_details": efficacy_details,
                    "exec_timings": exec_timing_dict,
                    "battle_param_max_no": int(query_db_one(
                        'SELECT COALESCE(MAX(param_no), 0) AS id FROM battle_params')['id']),
                })
                return

            # 3. Card list with search & filters
            if path == "/api/v2/enemy-cards":
                enemy_cards = query_db_all("""
                    SELECT c.id, c.name
                    FROM cards c
                    JOIN (
                        SELECT lower(trim(name)) AS name_key, MAX(id) AS max_id
                        FROM cards
                        WHERE name IS NOT NULL AND trim(name) != ''
                          AND (CAST(id AS TEXT) LIKE '1%' OR CAST(id AS TEXT) LIKE '4%')
                        GROUP BY lower(trim(name))
                    ) latest ON latest.max_id = c.id
                    ORDER BY c.name COLLATE NOCASE, c.id DESC
                """)
                self.send_json({"items": enemy_cards})
                return

            if path == "/api/v2/cards":
                term = query.get("q", [""])[0].strip()
                rarities_raw = query.get("rarities", [""])[0].strip()
                if rarities_raw:
                    rarities = tuple(int(x.strip()) for x in rarities_raw.split(",") if x.strip().isdigit())
                else:
                    rarities = (5, 4, 3)

                elem_filter = query.get("element", [""])[0].strip()
                if elem_filter.isdigit():
                    elem_val = int(elem_filter)
                elif elem_filter:
                    elem_val = elem_filter
                else:
                    elem_val = None

                page = max(1, int(query.get("page", ["1"])[0]))
                limit = min(100, max(1, int(query.get("limit", ["24"])[0])))

                # Use core search function
                all_results = search_cards_react(term, rarities, elem_val)
                total = len(all_results)
                start_idx = (page - 1) * limit
                paged_items = all_results[start_idx:start_idx + limit]

                self.send_json({
                    "items": paged_items,
                    "total": total,
                    "page": page,
                    "limit": limit,
                    "totalPages": (total + limit - 1) // limit if limit > 0 else 1
                })
                return

            # 4. Card Details (Full Context)
            match = re.fullmatch(r"/api/v2/cards/(\d+)", path)
            if match:
                card_id = int(match.group(1))
                ctx = load_character_context(card_id=card_id)
                if not ctx or not ctx.get("card"):
                    self.send_json({"error": f"Card #{card_id} not found"}, 404)
                    return

                # Build chain summary
                chain_summary = get_card_chain_summary(card_id)

                # Categories for this card
                cat_rows = query_db_all("""
                    SELECT card_category_id FROM card_card_categories WHERE card_id = ?
                """, (card_id,))
                category_ids = [r["card_category_id"] for r in cat_rows]

                # Link skills (from cards table columns link_skill1_id .. link_skill7_id)
                link_rows = []
                for i in range(1, 8):
                    lid = ctx["card"].get(f"link_skill{i}_id")
                    if lid and lid != 0:
                        ls = query_db_one("SELECT * FROM link_skills WHERE id = ?", (lid,))
                        if ls:
                            link_rows.append(dict(ls))

                payload = {
                    "card": ctx["card"],
                    "has_custom_animation": has_custom_animation(ctx),
                    "leader": {
                        "set": ctx.get("leader_set"),
                        "skills": ctx.get("leader_skills", [])
                    },
                    "passive": {
                        "set": ctx.get("passive_set"),
                        "skills": ctx.get("passive_skills", []),
                        "effects": ctx.get("passive_skill_effects", [])
                    },
                    "active": {
                        "set": ctx.get("active_set"),
                        "link": ctx.get("active_link"),
                        "skills": ctx.get("active_skills", [])
                    },
                    "standby": {
                        "set": ctx.get("standby_set"),
                        "link": ctx.get("standby_link"),
                        "skills": ctx.get("standby_skills", [])
                    },
                    "finish": ctx.get("finish_skill_sets", []),
                    "specials": ctx.get("card_specials", []),
                    "special_views": ctx.get("special_views", []),
                    "fields": ctx.get("fields", []),
                    "field_active_relations": ctx.get("field_active_relations", []),
                    "field_passive_relations": ctx.get("field_passive_relations", []),
                    "categories": category_ids,
                    "links": link_rows,
                    "chain": chain_summary
                }
                self.send_json(payload)
                return

            # 5. Transformation Chain Details
            match = re.fullmatch(r"/api/v2/cards/(\d+)/chain", path)
            if match:
                card_id = int(match.group(1))
                chain_items = get_card_chain_summary(card_id)
                self.send_json({"items": chain_items})
                return

            # 6. Card Animations
            if path == "/api/v2/animations/lookup":
                from modules.core.animation_lookup import lookup_animations
                with use_workspace(None):
                    results = lookup_animations(query.get('slot', ['entrance'])[0], query.get('q', [''])[0],
                        query.get('rarity', [''])[0], query.get('page', [1])[0], query.get('limit', [24])[0],
                        query.get('search_by', ['card_name'])[0])
                self.send_json(results)
                return

            if path == "/api/v2/animation-sources":
                term = query.get("q", [""])[0].strip()
                from modules.core.animation_lookup import search_animation_cards
                with use_workspace(None):
                    results = search_animation_cards(term, query.get('rarity', [''])[0],
                        query.get('page', [1])[0], query.get('limit', [24])[0], query.get('search_by', ['card_name'])[0])
                self.send_json(results)
                return

            if path == "/api/v2/lua/source":
                from pathlib import PurePosixPath
                from anim_transmuter import fetch_or_read_lua
                source_path = query.get('path', [''])[0].replace('\\', '/')
                parts = PurePosixPath(source_path).parts
                allowed_folders = {
                    'passive_skill_effect', 'active_skill', 'attack_sp', 'standby_skill',
                    'finish_skill', 'revival', 'preview_fx', 'attack_counter', 'ab_sys'
                }
                if (len(parts) != 3 or parts[0] != 'ab_script' or parts[1] not in allowed_folders
                        or not re.fullmatch(r'[A-Za-z0-9_.-]+\.lua', parts[2]) or '..' in parts[2]):
                    self.send_json({'error': 'Đường dẫn Lua không hợp lệ.'}, 400)
                    return
                force_refresh = query.get('refresh', ['0'])[0] == '1'
                ok, content, source = fetch_or_read_lua(parts[1], parts[2][:-4], force_refresh=force_refresh)
                if not ok:
                    self.send_json({'error': source or 'Không tải được Lua.'}, 404)
                    return
                self.send_json({'path': source_path, 'text': content, 'source': str(source)})
                return

            match = re.fullmatch(r"/api/v2/cards/(\d+)/animations", path)
            if match:
                card_id = int(match.group(1))
                if query.get('source', [''])[0] == 'database':
                    with use_workspace(None):
                        items = anim_transmuter.get_card_animations(card_id)
                else:
                    items = anim_transmuter.get_card_animations(card_id)
                normalized = []
                for item in items:
                    value = dict(item)
                    script = value.get("script_path") or value.get("script_name")
                    if script and not str(script).endswith(".lua"):
                        folder = value.get("folder") or "attack_sp"
                        script = f"ab_script/{folder}/{script}.lua"
                    value["script_path"] = script
                    normalized.append(value)

                self.send_json({"items": normalized})
                return

            match = re.fullmatch(r"/api/v2/cards/(\d+)/ost", path)
            if match:
                self.send_json({"items": get_card_chain_ost(int(match.group(1)))})
                return

            # 7. Card Thumbnail
            match = re.fullmatch(r"/api/v2/game-badge/(rarity|element)/(\d+)", path)
            if match:
                from modules.core.game_thumbnail import game_badge
                badge = game_badge(match.group(1), int(match.group(2)))
                if badge:
                    self.send_file(badge)
                else:
                    self.send_error(404, 'Unknown game icon')
                return

            match = re.fullmatch(r"/api/v2/thumb/(\d+)", path)
            if match:
                thumb = find_thumb(int(match.group(1)))
                if thumb:
                    if query.get('style', ['game'])[0] == 'game':
                        card = query_db_one('SELECT id, rarity, element, optimal_awakening_grow_type FROM cards WHERE id=?', (int(match.group(1)),))
                        if card:
                            try:
                                card = dict(card)
                                for field in ('element', 'rarity'):
                                    override = query.get(field, [None])[0]
                                    if override is not None:
                                        card[field] = int(override)
                                from modules.core.game_thumbnail import game_thumbnail
                                thumb = game_thumbnail(card, thumb)
                            except Exception as exc:
                                print(f'[thumbnail] Game layers unavailable: {exc}')
                    self.send_file(thumb)
                else:
                    self.send_error(404, "Thumbnail not found")
                return

            # 7b. Card Art (Full HD Composite Art)
            match = re.fullmatch(r"/api/v2/card-art/(\d+)", path)
            if match:
                art = find_card_art(int(match.group(1)))
                if art:
                    self.send_file(art)
                else:
                    thumb = find_thumb(int(match.group(1)))
                    if thumb:
                        self.send_file(thumb)
                    else:
                        self.send_error(404, "Art not found")
                return

            # 7c. BGM Tracks List for Top Player
            if path == "/api/v2/bgm/tracks":
                from modules.core.assets import jukebox_track_map
                bgm_dir = GAME_RES / "bgm"
                bids = set()
                if bgm_dir.exists():
                    for f in bgm_dir.iterdir():
                        match = re.fullmatch(r"bgm_(\d+)\.awb", f.name, re.IGNORECASE)
                        if match:
                            bids.add(int(match.group(1)))
                custom_bgm_dir = CUSTOM_BGM_DIR
                legacy_bgm_dir = ROOT / '.runtime' / 'custom-bgm'
                if custom_bgm_dir.exists():
                    for f in custom_bgm_dir.glob("bgm_*.awb"):
                        match = re.fullmatch(r"bgm_(\d+)\.awb", f.name, re.IGNORECASE)
                        if match:
                            bids.add(int(match.group(1)))
                if legacy_bgm_dir.exists():
                    for f in legacy_bgm_dir.rglob("bgm_*.awb"):
                        match = re.fullmatch(r"bgm_(\d+)\.awb", f.name, re.IGNORECASE)
                        if match:
                            bids.add(int(match.group(1)))
                tracks = []
                for bid in sorted(bids):
                    custom_meta = custom_bgm_dir / f"bgm_{bid}.json"
                    custom_title = ""
                    custom_awb = custom_bgm_dir / f"bgm_{bid}.awb"
                    if not custom_awb.is_file() and legacy_bgm_dir.exists():
                        custom_awb = next(iter(legacy_bgm_dir.rglob(f"bgm_{bid}.awb")), custom_awb)
                        custom_meta = custom_awb.with_suffix('.json')
                    if custom_meta.is_file():
                        try:
                            custom_title = str(json.loads(custom_meta.read_text(encoding="utf-8")).get("title") or "")
                        except (OSError, ValueError, AttributeError):
                            pass
                    is_custom = bool(custom_title) or custom_awb.is_file()
                    if is_custom:
                        title = custom_title.strip()
                        if title and title.casefold() != "custom ost":
                            tname = f"{title} (Custom OST) (BGM #{bid})"
                        else:
                            tname = f"Custom OST (BGM #{bid})"
                    else:
                        tname = jukebox_track_map.get(bid, f"Dokkan BGM #{bid:03d}")
                    tracks.append({
                        "id": bid,
                        "title": tname,
                        "url": f"http://127.0.0.1:8585/bgm/{bid}",
                        "custom": is_custom,
                    })
                self.send_json({"tracks": tracks, "total": len(tracks)})
                return

            # 8. Audio (BGM & Voice)
            match = re.fullmatch(r"/api/v2/audio/(bgm|voice)/(.+)", path)
            if match:
                kind = match.group(1)
                audio_id = match.group(2)
                fpath = find_audio_file(kind, audio_id)
                if fpath:
                    self.send_file(fpath)
                else:
                    self.send_error(404, "Audio file not found")
                return

            # 8b. Causality Conditions Query & Details
            if path == "/api/v2/causalities":
                q = query.get("q", [""])[0].strip()
                limit = min(200, max(1, int(query.get("limit", ["60"])[0])))
                if q:
                    if q.isdigit():
                        rows = query_db_all("SELECT * FROM skill_causalities WHERE id = ? OR causality_type = ? ORDER BY id ASC LIMIT ?", (int(q), int(q), limit))
                    else:
                        matching_types = [t for t, name in causality_dict.items() if q.lower() in name.lower()]
                        if matching_types:
                            placeholders = ",".join("?" * len(matching_types))
                            rows = query_db_all(f"SELECT * FROM skill_causalities WHERE causality_type IN ({placeholders}) ORDER BY id ASC LIMIT ?", (*matching_types, limit))
                        else:
                            rows = []
                else:
                    rows = query_db_all("SELECT * FROM skill_causalities ORDER BY id ASC LIMIT ?", (limit,))

                items = []
                for r in rows:
                    ctype = r["causality_type"]
                    details = causality_details.get(ctype, {})
                    items.append({
                        "id": r["id"],
                        "causality_type": ctype,
                        "cau_val1": r["cau_val1"],
                        "cau_val2": r["cau_val2"],
                        "cau_val3": r["cau_val3"],
                        "name": causality_dict.get(ctype, f"Type {ctype}"),
                        "desc": details.get("desc", ""),
                        "v1": details.get("v1", ""),
                        "v2": details.get("v2", ""),
                        "v3": details.get("v3", "")
                    })
                max_r = query_db_one("SELECT COALESCE(MAX(id), 0) AS max_id FROM skill_causalities")
                next_id = int(max_r["max_id"]) + 1 if max_r else 1
                self.send_json({"items": items, "total": len(items), "next_id": next_id})
                return

            match = re.fullmatch(r"/api/v2/causalities/(\d+)", path)
            if match:
                cid = int(match.group(1))
                r = query_db_one("SELECT * FROM skill_causalities WHERE id = ?", (cid,))
                if not r:
                    self.send_json({"error": f"Causality #{cid} not found"}, 404)
                    return
                ctype = r["causality_type"]
                details = causality_details.get(ctype, {})
                self.send_json({
                    "id": r["id"],
                    "causality_type": ctype,
                    "cau_val1": r["cau_val1"],
                    "cau_val2": r["cau_val2"],
                    "cau_val3": r["cau_val3"],
                    "name": causality_dict.get(ctype, f"Type {ctype}"),
                    "desc": details.get("desc", ""),
                    "v1": details.get("v1", ""),
                    "v2": details.get("v2", ""),
                    "v3": details.get("v3", "")
                })
                return

            # 9. LWF WebGL Player static assets
            if path.startswith("/player/") or path == "/player":
                rel = path[len("/player/"):] if path.startswith("/player/") else "index.html"
                candidate = (PLAYER_ROOT / rel).resolve()
                if PLAYER_ROOT.resolve() not in candidate.parents and candidate != PLAYER_ROOT.resolve():
                    self.send_error(404)
                else:
                    self.send_file(candidate, cache=False)
                return

            # 10. LWF Card Animation Player static assets
            if path.startswith("/lwf-player/") or path == "/lwf-player":
                rel = path[len("/lwf-player/"):] if path.startswith("/lwf-player/") else "index.html"
                candidate = (LWF_ROOT / rel).resolve()
                if LWF_ROOT.resolve() not in candidate.parents and candidate != LWF_ROOT.resolve():
                    self.send_error(404)
                else:
                    self.send_file(candidate, cache=False)
                return

            self.send_error(404, "Route not found")
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self.send_json({"error": str(exc)}, 500)

    def post_request(self):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path

        try:
            if path == "/api/v2/mods/import":
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 512 * 1024 ** 2:
                    self.send_json({'error': 'Chọn ZIP tối đa 512 MB.'}, 400)
                    return
                try:
                    workspace = import_zip(self.rfile.read(length), DB_PATH, ROOT / '.runtime' / 'imports')
                except (ValueError, OSError) as exc:
                    self.send_json({'error': str(exc)}, 400)
                    return
                self.send_json(public_workspace(workspace))
                return

            if path == "/api/v2/custom-bgm/import":
                length = int(self.headers.get('Content-Length', 0))
                if not 0 < length <= 111 * 1024 * 1024:
                    self.send_json({'error': 'WAV phải nhỏ hơn 110 MB và dài tối đa 10 phút.'}, 400)
                    return
                if self.headers.get('Content-Type', '').split(';', 1)[0].strip().lower() != 'audio/wav':
                    self.send_json({'error': 'Yêu cầu gửi audio WAV nhị phân.'}, 415)
                    return
                wav_bytes = self.rfile.read(length)
                if len(wav_bytes) != length:
                    self.send_json({'error': 'Upload WAV bị ngắt giữa chừng.'}, 400)
                    return
                title = urllib.parse.unquote(self.headers.get('X-Audio-Title', 'Custom OST'))
                self.send_json(create_custom_bgm(wav_bytes, title))
                return

            if path in {"/api/v2/custom-lua/save", "/api/v2/custom-lua/preview"}:
                body = self.body_json()
                try:
                    result = save_custom_lua(body.get("filename", "custom_animation"), body.get("content", ""),
                        overwrite=path.endswith('/preview'))
                except (ValueError, OSError) as exc:
                    self.send_json({"error": str(exc)}, 400)
                    return
                self.send_json(result)
                return

            if path == "/api/v2/animations/resolve-draft":
                from modules.core.animation_lookup import resolve_draft_animations
                body = self.body_json()
                references = body.get('references') or []
                converted = body.get('converted') or []
                if not isinstance(references, list) or not isinstance(converted, list) or len(references) + len(converted) > 2000:
                    self.send_json({'error': 'Danh sách animation không hợp lệ.'}, 400)
                    return
                self.send_json({'items': resolve_draft_animations(references, converted)})
                return

            if path == "/api/v2/animations/transmute":
                body = self.body_json()
                source_id = int(body.get("source_card_id") or 0)
                target_id = int(body.get("target_card_id") or 0)
                anim_index = int(body.get("animation_index") or 0)
                slot = str(body.get("target_slot") or "")
                if slot not in anim_transmuter.SLOT_CONFIG or not query_db_one("SELECT id FROM cards WHERE id = ?", (target_id,)):
                    self.send_json({"error": "Thẻ đích hoặc slot animation không hợp lệ."}, 400)
                    return
                custom_source = body.get('source_custom_lua')
                if custom_source:
                    filename = str(custom_source)
                    if not re.fullmatch(r'[A-Za-z0-9_-]+\.lua', filename) or not (
                        (CUSTOM_LUA_DIR / filename).is_file() or imported_asset(f'lua/ab_script/custom_lua/{filename}')
                    ):
                        self.send_json({'error': 'Không tìm thấy Lua custom đã lưu.'}, 400)
                        return
                    source_items = [{'name': filename, 'folder': 'custom_lua', 'script_name': Path(filename).stem,
                                     'type_key': 'custom', 'bgm_id': int(body.get('source_bgm_id') or 0)}]
                    anim_index = 0
                else:
                    with use_workspace(None):
                        source_items = anim_transmuter.get_card_animations(source_id)
                if anim_index < 0 or anim_index >= len(source_items):
                    self.send_json({"error": "Không tìm thấy animation nguồn."}, 400)
                    return
                selected_anim = source_items[anim_index]
                if not custom_source and ((selected_anim.get("script_name") or "") != (body.get("source_script_name") or "") or (
                    selected_anim.get("type_key") or ""
                ) != (body.get("source_type_key") or "")):
                    self.send_json({"error": "Danh sách animation nguồn đã thay đổi. Hãy chọn lại animation."}, 409)
                    return
                ok, result, animation_sql = anim_transmuter.transmute_animation(
                    source_anim=selected_anim, target_slot=slot,
                    target_card_id=target_id,
                    custom_script_name=body.get("custom_script_name"),
                    copy_bgm=bool(body.get("copy_bgm", True)),
                    strip_damage=bool(body.get("strip_damage", True)),
                )
                if not ok:
                    self.send_json({"error": result.get("msg", "Không chuyển được animation")}, 500)
                    return
                self.send_json({"ok": True, "result": result})
                return

            if path == "/api/v2/passive/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_passive_description(
                    description, preferred_set_id=body.get("passive_set_id")
                ))
                return

            if path == "/api/v2/passive/match":
                body = self.body_json()
                description = str(body.get("description") or "")
                skills = body.get("skills") or []
                if len(description) > 50000 or not isinstance(skills, list) or len(skills) > 300:
                    self.send_json({"error": "Dữ liệu passive quá lớn"}, 400)
                    return
                self.send_json({"matches": match_skills_to_description(
                    skills, description, preferred_set_id=body.get("passive_set_id")
                )})
                return

            if path == "/api/v2/leader/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_leader_description(
                    description, preferred_set_id=body.get("leader_set_id")
                ))
                return

            if path == "/api/v2/active/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_active_description(
                    description, preferred_set_id=body.get("active_set_id"), card_id=body.get("card_id")
                ))
                return

            if path == "/api/v2/standby/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_standby_description(
                    description, preferred_set_id=body.get("standby_set_id")
                ))
                return

            if path == "/api/v2/special/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_special_description(
                    description, special_set_id=body.get("special_set_id")
                ))
                return

            if path == "/api/v2/finish/compile":
                body = self.body_json()
                description = str(body.get("description") or "")
                if len(description) > 50000:
                    self.send_json({"error": "Mô tả quá dài"}, 400)
                    return
                self.send_json(compile_finish_description(
                    description, finish_set_id=body.get("finish_set_id")
                ))
                return

            # Save / Update Causality
            if path == "/api/v2/causalities":
                body = self.body_json()
                cid = int(body.get("id") or 0)
                ctype = int(body.get("causality_type") or 1)
                v1 = int(body.get("cau_val1") or 0)
                v2 = int(body.get("cau_val2") or 0)
                v3 = int(body.get("cau_val3") or 0)
                if not cid:
                    max_r = query_db_one("SELECT COALESCE(MAX(id), 0) AS max_id FROM skill_causalities")
                    cid = int(max_r["max_id"]) + 1
                conn = sqlite3.connect(DB_PATH, timeout=30)
                c = conn.cursor()
                now_str = dt.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
                c.execute("""
                    INSERT OR REPLACE INTO skill_causalities (id, causality_type, cau_val1, cau_val2, cau_val3, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM skill_causalities WHERE id = ?), ?), ?)
                """, (cid, ctype, v1, v2, v3, cid, now_str, now_str))
                conn.commit()
                conn.close()
                self.send_json({"ok": True, "id": cid, "message": f"Saved causality #{cid}"})
                return

            # 1. SQL Generation Preview
            match = re.fullmatch(r"/api/v2/cards/(\d+)/sql", path)
            if match:
                card_id = int(match.group(1))
                body = self.body_json()
                changes = body.get("changes") or {}
                raw_sql = body.get("raw_sql", "")

                compiled_sql = compile_workspace_sql(card_id, changes, raw_sql)
                self.send_json({"sql": compiled_sql or "-- Không có dữ liệu SQL"})
                return

            # 2. Apply Changes to DB with Auto-Backup
            match = re.fullmatch(r"/api/v2/cards/(\d+)/apply", path)
            if match:
                card_id = int(match.group(1))
                body = self.body_json()
                changes = body.get("changes") or {}
                raw_sql = body.get("raw_sql", "")

                compiled_sql = compile_workspace_sql(card_id, changes, raw_sql)
                if not compiled_sql:
                    self.send_json({"ok": True, "updated": 0, "message": "Không có thay đổi nào để áp dụng"})
                    return

                # Create safety backup
                stamp = dt.datetime.now().strftime("%Y%m%d_%H%M%S_%f")
                backup_file = BACKUP_DIR / f"database_decrypted_{stamp}.db"
                with sqlite3.connect(DB_PATH, timeout=30) as source_db, sqlite3.connect(backup_file) as backup_db:
                    source_db.backup(backup_db)

                applied_count, err = apply_sql_to_database(compiled_sql, db_path=str(DB_PATH))
                if err:
                    self.send_json({"error": f"Lỗi khi áp dụng SQL vào database: {err}"}, 500)
                    return

                global _chain_cache_key
                _chain_cache_key = None

                PATCH_HISTORY_DIR.mkdir(parents=True, exist_ok=True)
                with (PATCH_HISTORY_DIR / f"card_{card_id}.sql").open("a", encoding="utf-8") as history:
                    history.write(f"\n-- Saved card #{card_id} at {stamp}\n")
                    history.write(compiled_sql + "\n")

                self.send_json({
                    "ok": True,
                    "updated": applied_count,
                    "backup": str(backup_file.name)
                })
                return

            # 2.5. Export: Preview Patch SQL
            if path == "/api/v2/export/preview-sql":
                body = self.body_json()
                card_id = int(body.get("card_id") or 0)
                changes = body.get("changes") or {}
                raw_sql = body.get("raw_sql", "")
                if not card_id or not query_db_one("SELECT id FROM cards WHERE id = ?", (card_id,)):
                    self.send_json({"error": "Chọn thẻ hợp lệ trước khi xem trước SQL."}, 400)
                    return

                final_sql = compile_workspace_sql(card_id, changes, raw_sql)
                self.send_json({"sql": final_sql or "-- Không có câu lệnh SQL nào"})
                return

            # 3. Export: Build Patch ZIP
            if path == "/api/v2/export/build-zip":
                body = self.body_json()
                user_meta = body.get("meta") or {}
                meta_dict = eclp_builder.create_metadata_dict(
                    patch_name=user_meta.get("title") or user_meta.get("Name") or "Custom Patch",
                    patch_version=user_meta.get("version") or "1.0.0",
                    description=user_meta.get("description") or "",
                    authors=user_meta.get("author") or user_meta.get("Authors") or "Dokkan Modder",
                    uuid=user_meta.get("uuid") or user_meta.get("UUID"),
                )
                workspace = current_workspace.get()
                if workspace:
                    edited_meta = {key: meta_dict[key] for key in ('Name', 'Description', 'Authors', 'UUID')}
                    meta_dict = {**meta_dict, **workspace['metadata'], **edited_meta}
                target_zip_name = Path(body.get("filename", "patch.zip")).name
                inc_sql = body.get("inc_sql", True)
                sql_content = body.get("sql_content", "")
                card_id = int(body.get("card_id") or 0)
                changes = body.get("changes") or {}
                raw_sql = body.get("raw_sql", "")
                if not card_id or not query_db_one("SELECT id FROM cards WHERE id = ?", (card_id,)):
                    self.send_json({"error": "Chọn thẻ hợp lệ trước khi xuất patch."}, 400)
                    return
                chain_ids = changes.get('_form_chain_ids') or [row["id"] for row in get_card_chain_summary(card_id)] or [card_id]
                chain_ids = list(dict.fromkeys([int(cid) for cid in [*chain_ids, card_id,
                    *[cid for cid, value in (changes.get('_form_drafts') or {}).items() if value],
                    *[cid for cid, value in (changes.get('_form_custom_sql') or {}).items() if value],
                    *(changes.get('_form_animation_assets') or {}), *(changes.get('_form_audio_assets') or {})]]))
                if workspace:
                    chain_ids = list(dict.fromkeys(chain_ids + [c['id'] for c in workspace['cards']]
                        + [int(cid) for cid in (changes.get('_form_drafts') or {})]
                        + [int(cid) for cid in (changes.get('_form_animation_assets') or {})]
                        + [int(cid) for cid in (changes.get('_form_audio_assets') or {})]))
                asset_drafts = dict(changes.get('_form_drafts') or {})
                if str(card_id) not in asset_drafts:
                    asset_drafts[str(card_id)] = changes
                items = eclp_builder.find_card_assets(chain_ids, form_drafts=asset_drafts) if body.get("include_assets", True) else []
                if workspace:
                    items.extend(workspace['assets'])
                staged_assets = changes.get("_form_animation_assets") or {}
                for cid in chain_ids:
                    for asset in staged_assets.get(str(cid), []):
                        if not isinstance(asset, (list, tuple)) or len(asset) != 2:
                            continue
                        source = Path(asset[0]).resolve()
                        archive_path = str(asset[1]).replace("\\", "/")
                        if (source.is_file() and source.suffix.lower() == ".lua"
                                and GAME_RES.resolve() in source.parents
                                and archive_path.startswith("lua/ab_script/")
                                and ".." not in Path(archive_path).parts):
                            items.append((str(source), archive_path))
                staged_audio_assets = changes.get('_form_audio_assets') or {}
                custom_bgm_roots = (CUSTOM_BGM_DIR.resolve(), (ROOT / '.runtime' / 'custom-bgm').resolve())
                for cid in chain_ids:
                    for asset in staged_audio_assets.get(str(cid), []):
                        try:
                            audio_id = int(asset.get('id') or 0)
                            source = Path(asset.get('path') or '').resolve()
                        except (AttributeError, TypeError, ValueError):
                            continue
                        archive_path = f'bgm/bgm_{audio_id}.awb'
                        if (audio_id > 0 and source.is_file() and source.suffix.lower() == '.awb'
                                and source.name.lower() == f'bgm_{audio_id}.awb'
                                and any(root in source.parents for root in custom_bgm_roots)):
                            items.append((str(source), archive_path))
                # New conversions override imported files, which override stock files.
                items = list({name: (source, name) for source, name in items}.values())
                if inc_sql and not sql_content.strip():
                    sql_content = compile_workspace_sql(card_id, changes, raw_sql)

                if inc_sql and not sql_content.strip():
                    self.send_json({"error": "Không tạo được patch.sql cho thẻ này."}, 400)
                    return

                if inc_sql:
                    sql_content = repeatable_animation_sql(sql_content)
                    # Validate against the stock DB, not the imported preview
                    # which already contains the source patch. Execute only in RAM.
                    try:
                        materialize_patch_sql(sql_content, DB_PATH, snapshot=False)
                    except ValueError as exc:
                        self.send_json({"error": str(exc)}, 400)
                        return

                patches_dir = ROOT / "patches"
                patches_dir.mkdir(exist_ok=True)
                target_zip_path = patches_dir / target_zip_name

                zpath, zsize = eclp_builder.build_patch_zip(
                    str(target_zip_path),
                    items,
                    sql_content=sql_content if inc_sql else None,
                    metadata_dict=meta_dict,
                    sql_filename="patch.sql"
                )
                self.send_json({
                    "ok": True,
                    "zip_path": zpath,
                    "zip_size_kb": zsize * 1024,
                    "asset_count": len(items)
                })
                return

            # 3.5 Config: Save configuration (Cookie, defaults, etc.)
            if path == "/api/v2/config":
                body = self.body_json()
                eclp_builder.save_config(body)
                self.send_json({"ok": True, "config": eclp_builder.load_config()})
                return

            # 4. Export: Convert ZIP to .eclp via Dokkan Eclipse API
            if path == "/api/v2/export/build-eclp":
                body = self.body_json()
                zip_path = body.get("zip_path")
                user_meta = body.get("meta") or {}
                meta_dict = {
                    "patchName": user_meta.get("title") or user_meta.get("patchName") or user_meta.get("Name") or "Custom Patch",
                    "version": user_meta.get("version") or "1.0.0",
                    "description": user_meta.get("description") or user_meta.get("Description") or "",
                    "authors": user_meta.get("author") or user_meta.get("authors") or user_meta.get("Authors") or "Dokkan Modder",
                    "uuid": user_meta.get("uuid") or user_meta.get("UUID") or "",
                }
                cookie = body.get("cookie", "").strip()
                if not cookie:
                    cfg = eclp_builder.load_config()
                    cookie = cfg.get("dokkan_cookie", "").strip()

                if not cookie:
                    self.send_json({"error": "Vui lòng nhập Cookie Dokkan Eclipse!"}, 400)
                    return

                # Auto-save cookie for future sessions
                eclp_builder.save_config({"dokkan_cookie": cookie})

                if not zip_path or not os.path.exists(zip_path):
                    self.send_json({"error": f"Không tìm thấy file ZIP: {zip_path}"}, 400)
                    return

                ok, res_or_err = eclp_builder.convert_zip_to_eclp(zip_path, meta_dict, cookie)
                if not ok:
                    self.send_json({"error": str(res_or_err)}, 500)
                    return

                dl_url = res_or_err.get("downloadUrl", "")
                srv_filename = res_or_err.get("fileName", "patch.eclp")
                patches_dir = ROOT / "patches"

                down_ok, local_eclp_path, eclp_size = eclp_builder.download_eclp_file(
                    dl_url, str(patches_dir), custom_file_name=srv_filename, cookie_str=cookie
                )
                if not down_ok:
                    self.send_json({"error": str(local_eclp_path)}, 502)
                    return

                self.send_json({
                    "ok": down_ok,
                    "eclp_path": local_eclp_path,
                    "eclp_size_kb": eclp_size,
                    "downloadUrl": dl_url,
                    "fileName": srv_filename,
                    "expiresAt": res_or_err.get("expiresAt")
                })
                return

            self.send_error(404, "Route not found")
        except Exception as exc:
            import traceback
            traceback.print_exc()
            self.send_json({"error": str(exc)}, 500)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    # Automatically ensure asset server is running concurrently on port 8585
    try:
        from modules.core.assets import start_bgm_server_once
        start_bgm_server_once(8585)
        print("[Dokkan Asset Server] Auto-started/verified on port 8585 concurrently!")
    except Exception as e:
        print(f"[Dokkan Asset Server] Port 8585 check/start notice: {e}")

    server = ThreadingHTTPServer(("127.0.0.1", args.port), ApiHandler)
    print(f"==================================================")
    print(f" Dokkan React API 2.0 running at http://127.0.0.1:{args.port}")
    print(f"==================================================")
    server.serve_forever()


if __name__ == "__main__":
    main()
