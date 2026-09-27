# -*- coding: utf-8 -*-
import os
import io
import re
import json
import time
import shutil
import sqlite3
import base64
import subprocess
import threading
import urllib.parse
import urllib.request
import http.server
import socketserver
import socket
import requests
from requests.adapters import HTTPAdapter
from urllib3.util.retry import Retry
from concurrent.futures import ThreadPoolExecutor
from PIL import Image, ImageEnhance, ImageFilter
import streamlit as st
from modules.core.config import (
    TOOL_ROOT, GAME_RES_DIR, BGM_DIR, THUMB_DIR, VGMSTREAM_CLI, BGM_SERVER_PORT, DB_PATH
)
from modules.core.db import get_db_connection, query_db_one, query_db_all

# -------------------------------------------------------------
# BGM & Audio Utilities
# -------------------------------------------------------------
GAME_RES_DIR = os.path.join(TOOL_ROOT, "game res")
BGM_DIR = os.path.join(GAME_RES_DIR, "bgm")
BGM_CACHE_DIR = os.path.join(BGM_DIR, ".cache_wav")
THUMB_DIR = os.path.join(GAME_RES_DIR, "thumb")
VGMSTREAM_CLI = os.path.abspath(os.path.join("tools", "vgmstream", "vgmstream-cli.exe"))
LEGACY_GREEN_PLACEHOLDER_PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')
# Real fully-transparent RGBA pixel. The previous payload was semi-transparent
# green and became visible whenever an LR texture download temporarily failed.
TRANSPARENT_1X1_PNG = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR4nGNgYGBgAAAABQABpfZFQAAAAABJRU5ErkJggg==')

rarity_dict = {
    5: "LR",
    4: "UR",
    3: "SSR",
    2: "SR",
    1: "R",
    0: "N"
}

def get_card_thumb_path(card_id):
    if not card_id:
        return None
    try:
        cid_str = str(int(card_id))
    except (ValueError, TypeError):
        return None
        
    t_id = cid_str[:-1] + "0" if len(cid_str) > 1 else cid_str
    alt_t_id = "10" + cid_str[-5:-1] + "0" if len(cid_str) >= 7 else t_id
    
    id_variants = [t_id, alt_t_id, cid_str]
    
    for vid in id_variants:
        folder_path = os.path.join(THUMB_DIR, f"card_{vid}_thumb")
        if os.path.isdir(folder_path):
            img_file = os.path.join(folder_path, f"card_{vid}_thumb.png")
            if os.path.isfile(img_file):
                return img_file
            for f in os.listdir(folder_path):
                if f.endswith(".png"):
                    return os.path.join(folder_path, f)
                    
        file_cand = os.path.join(THUMB_DIR, f"card_{vid}_thumb.png")
        if os.path.isfile(file_cand):
            return file_cand
            
        raw_cand = os.path.join(THUMB_DIR, f"{vid}.png")
        if os.path.isfile(raw_cand):
            return raw_cand
            
    return None

@st.cache_data(show_spinner=False, max_entries=48)
def get_enhanced_thumb_base64(img_path, target_size=(852, 1136)):
    if not img_path or not os.path.exists(img_path):
        return None
    try:
        with Image.open(img_path) as img:
            img_rgba = img.convert('RGBA')
            target_w, target_h = target_size
            resized = img_rgba.resize((target_w, target_h), Image.Resampling.LANCZOS)
            
            buf = io.BytesIO()
            resized.save(buf, format='PNG', optimize=True)
            b64_str = base64.b64encode(buf.getvalue()).decode('utf-8')
            return f"data:image/png;base64,{b64_str}"
    except Exception:
        return None

def ensure_card_composite_art_file(cid):
    cid_str = str(cid)
    folder_str = cid_str[:-1] + "0" if len(cid_str) > 1 else cid_str
    
    local_dir = os.path.join(GAME_RES_DIR, "card", folder_str)
    os.makedirs(local_dir, exist_ok=True)
    comp_path = os.path.join(local_dir, f"card_{folder_str}_composite.png")
    
    layers = ["_bg.png", "_character.png", "_effect.png"]
    images = []
    need_composite = not os.path.exists(comp_path) or os.path.getsize(comp_path) == 0
    
    for suffix in layers:
        fn_folder = f"card_{folder_str}{suffix}"
        fn_cid = f"card_{cid_str}{suffix}"
        
        fpath_folder = os.path.join(local_dir, fn_folder)
        fpath_cid = os.path.join(local_dir, fn_cid)
        
        target_fpath = None
        if os.path.exists(fpath_folder) and os.path.getsize(fpath_folder) > 0:
            target_fpath = fpath_folder
        elif os.path.exists(fpath_cid) and os.path.getsize(fpath_cid) > 0:
            target_fpath = fpath_cid
        else:
            cdn_candidates = [
                (f"https://cdn.dokkan-eclipse.com/uncompressed/character/card/{folder_str}/{fn_folder}", fpath_folder),
                (f"https://cdn.dokkan-eclipse.com/uncompressed/character/card/{cid_str}/{fn_cid}", fpath_cid),
                (f"https://cdn.dokkan-eclipse.com/uncompressed/character/card/{folder_str}/{fn_cid}", fpath_cid)
            ]
            for url, save_path in cdn_candidates:
                try:
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=10) as resp:
                        with open(save_path, "wb") as f:
                            f.write(resp.read())
                        target_fpath = save_path
                        need_composite = True
                        break
                except Exception:
                    pass
                    
        if need_composite and target_fpath and os.path.exists(target_fpath) and os.path.getsize(target_fpath) > 0:
            try:
                with Image.open(target_fpath) as source:
                    img = source.convert("RGBA")
                images.append(img)
            except Exception:
                pass
                
    if need_composite and images:
        composite = None
        try:
            # 2x HD Native Target Resolution (852 x 1136)
            target_w, target_h = 852, 1136
            composite = Image.new("RGBA", (target_w, target_h), (0, 0, 0, 0))
            for img in images:
                resized = img.resize((target_w, target_h), Image.Resampling.LANCZOS)
                composite.alpha_composite(resized)
                resized.close()
                
            composite.save(comp_path, "PNG", optimize=True)
        except Exception:
            pass
        finally:
            if composite is not None:
                composite.close()
            for img in images:
                img.close()
            
    if os.path.exists(comp_path) and os.path.getsize(comp_path) > 0:
        return comp_path
    return None


@st.cache_data(show_spinner=False, max_entries=48)
def get_or_download_card_composite_art(cid):
    """Legacy Streamlit API; React uses the file helper to avoid Base64 caches."""
    comp_path = ensure_card_composite_art_file(cid)
    if not comp_path:
        return None
    try:
        with open(comp_path, "rb") as source:
            return "data:image/png;base64," + base64.b64encode(source.read()).decode("utf-8")
    except Exception:
        return None

def get_element_color(element_id):
    try:
        eid = int(element_id)
    except (ValueError, TypeError):
        return {
            'name': 'Unknown',
            'border': '#ff9f1c',
            'glow': 'rgba(255, 159, 28, 0.55)',
            'badge_bg': 'rgba(255, 159, 28, 0.25)',
            'badge_text': '#ffca28'
        }
        
    type_mod = eid % 10
    if type_mod == 0: # AGL (Blue / Xanh dương)
        return {
            'name': 'AGL',
            'border': '#1e88e5',
            'glow': 'rgba(30, 136, 229, 0.7)',
            'badge_bg': 'rgba(30, 136, 229, 0.25)',
            'badge_text': '#64b5f6'
        }
    elif type_mod == 1: # TEQ (Green / Xanh lá)
        return {
            'name': 'TEQ',
            'border': '#43a047',
            'glow': 'rgba(67, 160, 71, 0.7)',
            'badge_bg': 'rgba(67, 160, 71, 0.25)',
            'badge_text': '#81c784'
        }
    elif type_mod == 2: # INT (Purple / Tím)
        return {
            'name': 'INT',
            'border': '#8e24aa',
            'glow': 'rgba(142, 36, 170, 0.7)',
            'badge_bg': 'rgba(142, 36, 170, 0.25)',
            'badge_text': '#ba68c8'
        }
    elif type_mod == 3: # STR (Red / Đỏ)
        return {
            'name': 'STR',
            'border': '#e53935',
            'glow': 'rgba(229, 57, 53, 0.7)',
            'badge_bg': 'rgba(229, 57, 53, 0.25)',
            'badge_text': '#ef5350'
        }
    elif type_mod == 4: # PHY (Orange / Cam)
        return {
            'name': 'PHY',
            'border': '#fb8c00',
            'glow': 'rgba(251, 140, 0, 0.7)',
            'badge_bg': 'rgba(251, 140, 0, 0.25)',
            'badge_text': '#ffb74d'
        }
    else:
        return {
            'name': 'Other',
            'border': '#ff9f1c',
            'glow': 'rgba(255, 159, 28, 0.55)',
            'badge_bg': 'rgba(255, 159, 28, 0.25)',
            'badge_text': '#ffca28'
        }

def format_card_name_clean(name):
    if not name:
        return ""
    return " ".join(str(name).replace("\r", " ").split())



def load_jukebox_track_map():
    track_map = {}
    card_track_map = {}

    def add_card_track(row, suffix):
        bid = row.get('bgm_id')
        if not bid:
            return
        card_id = int(row.get('card_id') or 0)
        rarity = rarity_dict.get(int(row.get('rarity') or 0), 'N')
        element = get_element_color(row.get('element'))['name']
        card_name = format_card_name_clean(row.get('card_name')) or 'Character'
        label = f"{rarity} {element} {card_name} - {suffix} (BGM #{int(bid)})"
        previous = card_track_map.get(int(bid))
        if previous is None or card_id > previous[0]:
            card_track_map[int(bid)] = (card_id, label)

    try:
        # 1. Official Jukebox Tracks, used when no card-specific theme is linked.
        rows = query_db_all("SELECT bgm_filename, title FROM jukebox_tracks WHERE title IS NOT NULL AND title != ''")
        for r in rows:
            fn = r.get('bgm_filename')
            title = r.get('title')
            if fn and fn.startswith("bgm_"):
                try:
                    bid = int(fn.replace("bgm_", ""))
                    track_map[bid] = title
                except:
                    pass
                    
        # 2. Passive Skill Effects (Entrance Theme / Intro Theme)
        rows = query_db_all("""
            SELECT pse.bgm_id, pse.script_name, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM passive_skill_effects pse
            JOIN passive_skills ps ON ps.passive_skill_effect_id = pse.id
            JOIN passive_skill_set_relations pssr ON pssr.passive_skill_id = ps.id
            JOIN cards c ON c.passive_skill_set_id = pssr.passive_skill_set_id
            WHERE pse.bgm_id > 0
        """)
        for r in rows:
            sname = (r.get('script_name') or '').lower()
            suffix = "Entrance Theme" if 'pse' in sname or 'intro' in sname else "Passive Theme"
            add_card_track(r, suffix)

        # 3. Active Skill Sets (Active Theme)
        rows = query_db_all("""
            SELECT ass.bgm_id, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM active_skill_sets ass
            JOIN card_active_skills cas ON cas.active_skill_set_id = ass.id
            JOIN cards c ON c.id = cas.card_id
            WHERE ass.bgm_id > 0
        """)
        for r in rows:
            add_card_track(r, "Active Theme")

        # 4. Standby Skill Sets (Standby Theme)
        rows = query_db_all("""
            SELECT sss.bgm_id, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM standby_skill_sets sss
            JOIN card_standby_skill_set_relations cssr ON cssr.standby_skill_set_id = sss.id
            JOIN cards c ON c.id = cssr.card_id
            WHERE sss.bgm_id > 0
        """)
        for r in rows:
            add_card_track(r, "Standby Theme")

        # 5. Finish Skill Sets (Finish Theme)
        rows = query_db_all("""
            SELECT fss.bgm_id, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM finish_skill_sets fss
            JOIN card_finish_skill_set_relations cfsr ON cfsr.finish_skill_set_id = fss.id
            JOIN cards c ON c.id = cfsr.card_id
            WHERE fss.bgm_id > 0
        """)
        for r in rows:
            add_card_track(r, "Finish Theme")

        # 6. Extra Special Options (Transformation Theme / Super Attack Theme)
        rows = query_db_all("""
            SELECT eso.bgm_id, eso.extra_special_type, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM extra_special_options eso
            JOIN card_specials cs ON cs.id = eso.card_special_id
            JOIN cards c ON c.id = cs.card_id
            WHERE eso.bgm_id > 0
        """)
        for r in rows:
            suffix = "Transformation Theme" if r.get('extra_special_type') == 103 else "Super Attack Theme"
            add_card_track(r, suffix)

        # 7. Card Skin Items (Costume Theme)
        rows = query_db_all("""
            SELECT csi.bgm_id, c.id as card_id, c.name as card_name, c.rarity, c.element
            FROM card_skin_items csi
            JOIN cards c ON c.id = csi.card_id
            WHERE csi.bgm_id > 0
        """)
        for r in rows:
            add_card_track(r, "Costume Theme")

        # Card appearance metadata identifies character tracks more reliably than a
        # generic jukebox title when the same BGM ID is linked from both places.
        track_map.update({bid: data[1] for bid, data in card_track_map.items()})

        # 8. Areas / Events
        rows = query_db_all("SELECT bgm_id, name FROM areas WHERE bgm_id > 0 AND name IS NOT NULL AND name != ''")
        for r in rows:
            bid = r.get('bgm_id')
            if bid and bid not in track_map:
                track_map[bid] = f"Event: {r.get('name')}"

        # 9. Origin Episodes
        rows = query_db_all("SELECT bgm_id, name FROM origin_episodes WHERE bgm_id > 0 AND name IS NOT NULL AND name != ''")
        for r in rows:
            bid = r.get('bgm_id')
            if bid and bid not in track_map:
                track_map[bid] = f"Story: {r.get('name')}"

        # 10. Sugoroku / Quest maps
        rows = query_db_all("""
            SELECT sm.sugoroku_bgm_id, sm.battle_bgm_id, sm.boss_bgm_id, q.name as quest_name, a.name as area_name
            FROM sugoroku_maps sm
            LEFT JOIN quests q ON q.id = sm.quest_id
            LEFT JOIN areas a ON a.id = q.area_id
        """)
        for r in rows:
            qname = r.get('quest_name') or r.get('area_name')
            if qname:
                b_id = r.get('boss_bgm_id')
                if b_id and b_id not in track_map:
                    track_map[b_id] = f"Boss: {qname}"
                bt_id = r.get('battle_bgm_id')
                if bt_id and bt_id not in track_map:
                    track_map[bt_id] = f"Battle: {qname}"
                s_id = r.get('sugoroku_bgm_id')
                if s_id and s_id not in track_map:
                    track_map[s_id] = f"Map: {qname}"

        # 11. BGM Schedules
        rows = query_db_all("SELECT bgm_id, scene_name FROM bgm_schedules WHERE bgm_id > 0 AND scene_name IS NOT NULL")
        for r in rows:
            bid = r.get('bgm_id')
            if bid and bid not in track_map:
                track_map[bid] = f"Special Theme ({r.get('scene_name')})"

        # 12. Title screens
        rows = query_db_all("SELECT DISTINCT bgm_id FROM title_screens WHERE bgm_id > 0")
        for r in rows:
            bid = r.get('bgm_id')
            if bid and bid not in track_map:
                track_map[bid] = "Title Screen Theme"
    except Exception:
        pass
    return track_map

jukebox_track_map = load_jukebox_track_map()

def get_optimal_bgm_loops(awb_path, min_duration=120.0):
    try:
        res = subprocess.run([VGMSTREAM_CLI, "-m", awb_path], capture_output=True, text=True)
        match = re.search(r"\((\d+):(\d+\.?\d*)\s+seconds\)", res.stdout)
        if match:
            mins = float(match.group(1))
            secs = float(match.group(2))
            total_sec = mins * 60.0 + secs
            if total_sec > 0:
                needed_loops = max(2.0, round(min_duration / total_sec, 1))
                return min(needed_loops, 8.0)
    except Exception:
        pass
    return 2.5

def get_bgm_wav_path(bgm_id):
    if not bgm_id or int(bgm_id) <= 0:
        return None
    
    try:
        bid = int(bgm_id)
    except (ValueError, TypeError):
        return None
        
    os.makedirs(BGM_CACHE_DIR, exist_ok=True)
    os.makedirs(BGM_DIR, exist_ok=True)
    cache_file = os.path.join(BGM_CACHE_DIR, f"bgm_{bid:03d}_loop3.wav")
    if os.path.exists(cache_file) and os.path.getsize(cache_file) > 1000:
        return cache_file
        
    candidates = [
        os.path.join(BGM_DIR, f"bgm_{bid:03d}.awb"),
        os.path.join(BGM_DIR, f"bgm_{bid}.awb"),
        os.path.join(GAME_RES_DIR, "bgm ost", "custom ost", f"bgm_{bid:03d}.awb"),
        os.path.join(GAME_RES_DIR, "bgm ost", "custom ost", f"bgm_{bid}.awb"),
    ]
    legacy_custom_root = os.path.join(TOOL_ROOT, ".runtime", "custom-bgm")
    if os.path.isdir(legacy_custom_root):
        candidates.extend([
            os.path.join(folder, f"bgm_{bid:03d}.awb") for folder, _, files in os.walk(legacy_custom_root)
            if f"bgm_{bid:03d}.awb" in files
        ])
        candidates.extend([
            os.path.join(folder, f"bgm_{bid}.awb") for folder, _, files in os.walk(legacy_custom_root)
            if f"bgm_{bid}.awb" in files
        ])
    awb_path = None
    for cand in candidates:
        if os.path.exists(cand) and os.path.getsize(cand) > 1000:
            awb_path = cand
            break
            
    # Auto-fetch missing BGM from remote CDN if not found locally
    if not awb_path:
        target_awb = os.path.join(BGM_DIR, f"bgm_{bid:03d}.awb")
        remote_urls = [
            f"https://cdn.dokkan-eclipse.com/uncompressed/bgm/bgm_{bid:03d}.awb",
            f"https://cdn.dokkan-eclipse.com/uncompressed/bgm/bgm_{bid}.awb",
        ]
        for r_url in remote_urls:
            try:
                req = urllib.request.Request(r_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
                })
                with urllib.request.urlopen(req, timeout=12) as resp:
                    if resp.status == 200:
                        data = resp.read()
                        if len(data) > 1000:
                            with open(target_awb, 'wb') as f:
                                f.write(data)
                            awb_path = target_awb
                            break
            except Exception:
                continue

    if not awb_path or not os.path.exists(VGMSTREAM_CLI):
        return None
        
    try:
        # A longer, fade-free rendition; the browser can loop it continuously.
        cmd = [VGMSTREAM_CLI, "-l", "3.0", "-f", "0", "-o", cache_file, os.path.abspath(awb_path)]
        subprocess.run(cmd, capture_output=True, check=True)
        if os.path.exists(cache_file) and os.path.getsize(cache_file) > 1000:
            return cache_file
    except Exception:
        pass
    return None


def get_or_fetch_card_bg_info(folder_id):
    raw_str = str(folder_id).strip()
    folder_str = (raw_str[:-1] + "0") if len(raw_str) > 1 else raw_str
    local_dir = os.path.join(GAME_RES_DIR, "card_bg", folder_str)
    os.makedirs(local_dir, exist_ok=True)
    
    local_files = [f for f in os.listdir(local_dir) if not f.startswith(".")]
    lwf_file = None
    for f in local_files:
        if f.endswith(".lwf") or f.endswith(".lwf.bytes"):
            lwf_file = f
            break
            
    if lwf_file and len(local_files) >= 2:
        return {
            "folder_id": folder_str,
            "lwf": lwf_file,
            "files": local_files,
            "files_count": len(local_files),
            "status": "cached"
        }
        
    api_url = f"https://dokkan-eclipse.com/api/file-browser?path=character/card_bg/{folder_str}"
    req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
    try:
        with urllib.request.urlopen(req, timeout=12) as resp:
            data = json.loads(resp.read().decode())
            items = data.get('items', [])
            item_names = [it.get('name', '') for it in items if it.get('name')]
            for it in items:
                fn = it.get('name', '')
                if fn.endswith(".lwf") or fn.endswith(".lwf.bytes"):
                    lwf_file = fn
                    
            def prefetch_bg_files():
                for it in items:
                    fn = it.get('name', '')
                    cdn_url = it.get('cdnUrl', '')
                    dpath = os.path.join(local_dir, fn)
                    if not os.path.exists(dpath) or os.path.getsize(dpath) == 0:
                        try:
                            r = urllib.request.Request(cdn_url, headers={'User-Agent': 'Mozilla/5.0'})
                            with urllib.request.urlopen(r, timeout=15) as fresp:
                                with open(dpath, 'wb') as df:
                                    df.write(fresp.read())
                        except Exception:
                            pass
            threading.Thread(target=prefetch_bg_files, daemon=True).start()
            return {
                "folder_id": folder_str,
                "lwf": lwf_file,
                "files": item_names,
                "files_count": len(items),
                "status": "fetching"
            }
    except Exception as e:
        return {"folder_id": folder_str, "lwf": lwf_file or f"card_{folder_str}.lwf", "files": local_files, "error": str(e)}

def prefetch_lr_lwf_art(folder_id):
    raw_str = str(folder_id).strip()
    folder_str = (raw_str[:-1] + "0") if len(raw_str) > 1 else raw_str
    local_dir = os.path.join(GAME_RES_DIR, "card_bg", folder_str)
    os.makedirs(local_dir, exist_ok=True)
    def fetch_task():
        api_url = f"https://dokkan-eclipse.com/api/file-browser?path=character/card_bg/{folder_str}"
        try:
            req = urllib.request.Request(api_url, headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = json.loads(resp.read().decode())
                items = data.get('items', [])
                for it in items:
                    fn = it.get('name')
                    cdn_url = it.get('cdnUrl')
                    if fn and cdn_url:
                        dpath = os.path.join(local_dir, fn)
                        if not os.path.exists(dpath) or os.path.getsize(dpath) == 0:
                            try:
                                r = urllib.request.Request(cdn_url, headers={'User-Agent': 'Mozilla/5.0'})
                                with urllib.request.urlopen(r, timeout=15) as fresp:
                                    with open(dpath, 'wb') as df:
                                        df.write(fresp.read())
                            except Exception:
                                pass
        except Exception:
            pass
    threading.Thread(target=fetch_task, daemon=True).start()

def prefetch_card_composite_art(cid):
    cid_str = str(cid).strip()
    folder_str = (cid_str[:-1] + "0") if len(cid_str) > 1 else cid_str
    local_dir = os.path.join(GAME_RES_DIR, "card", folder_str)
    os.makedirs(local_dir, exist_ok=True)
    def fetch_task():
        for suffix in ["_bg.png", "_character.png", "_effect.png"]:
            fn = f"card_{folder_str}{suffix}"
            fpath = os.path.join(local_dir, fn)
            if not os.path.exists(fpath) or os.path.getsize(fpath) == 0:
                try:
                    url = f"https://cdn.dokkan-eclipse.com/uncompressed/character/card/{folder_str}/{fn}"
                    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=12) as resp:
                        with open(fpath, "wb") as f:
                            f.write(resp.read())
                except Exception:
                    pass
    threading.Thread(target=fetch_task, daemon=True).start()

# Global scripts index cache for Dokkan LUA Player
_GLOBAL_SCRIPTS_INDEX = None
_GLOBAL_SCRIPT_MAP = None

def get_dokkan_scripts_map():
    global _GLOBAL_SCRIPTS_INDEX, _GLOBAL_SCRIPT_MAP
    if _GLOBAL_SCRIPT_MAP is not None:
        return _GLOBAL_SCRIPT_MAP
        
    cache_file = os.path.join(GAME_RES_DIR, "dokkan_scripts_index.json")
    scripts = []
    if os.path.exists(cache_file) and os.path.getsize(cache_file) > 0:
        try:
            with open(cache_file, "r", encoding="utf-8") as f:
                scripts = [s.get('path', '') for s in json.load(f).get('scripts', [])]
        except:
            pass
            
    if not scripts:
        try:
            req = urllib.request.Request("https://dokkan-eclipse.com/api/scripts", headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=12) as resp:
                data = resp.read()
                os.makedirs(os.path.dirname(cache_file), exist_ok=True)
                with open(cache_file, "wb") as f:
                    f.write(data)
                scripts = [s.get('path', '') for s in json.loads(data.decode()).get('scripts', [])]
        except Exception:
            pass
            
    _GLOBAL_SCRIPTS_INDEX = scripts
    _GLOBAL_SCRIPT_MAP = {}
    for p in scripts:
        stem = os.path.splitext(os.path.basename(p))[0].lower()
        _GLOBAL_SCRIPT_MAP[stem] = p
    return _GLOBAL_SCRIPT_MAP

def resolve_script_by_name(script_name):
    if not script_name:
        return None
    s = str(script_name).strip().lower()
    if s.endswith('.lua'):
        s = s[:-4]
    smap = get_dokkan_scripts_map()
    if s in smap:
        return smap[s]
    # Kiểm tra các thư mục local trong game res/ab_script/
    base_res = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game res")
    for sub in ["passive_skill_effect", "active_skill", "attack_sp", "finish_skill", "preview_fx", "revival", "standby_skill"]:
        cand = os.path.join(base_res, "ab_script", sub, f"{s}.lua")
        if os.path.exists(cand):
            return f"ab_script/{sub}/{s}.lua"
        cand2 = os.path.join(GAME_RES_DIR, "ab_script", sub, f"{s}.lua")
        if os.path.exists(cand2):
            return f"ab_script/{sub}/{s}.lua"
            
    # Tự động sinh nếu là file effect_pack cutscene fx_{id}
    if s.startswith("fx_") and s[3:].isdigit():
        try:
            import anim_transmuter
            epid = int(s[3:])
            s_name, fpath = anim_transmuter.generate_effect_pack_lua(epid)
            if fpath and os.path.exists(fpath):
                return f"ab_script/preview_fx/{s}.lua"
        except Exception:
            pass
            
    return None

def resolve_special_view_script(view_id, cursor=None):
    if not view_id:
        return None
    close_conn = False
    if cursor is None:
        try:
            conn = get_db_connection()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            close_conn = True
        except Exception:
            return None
    try:
        row = cursor.execute("SELECT script_name FROM special_views WHERE id = ?", (view_id,)).fetchone()
        if row and row['script_name']:
            return resolve_script_by_name(row['script_name'])
    except Exception:
        pass
    finally:
        if close_conn and 'conn' in locals():
            try:
                conn.close()
            except:
                pass
    return None

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def get_sa_origin_info(view_id):
    if not view_id:
        return None
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        row = cur.execute("""
            SELECT c.id as card_id, c.name as card_name, c.rarity, c.element,
                   cs.style, ss.name as sa_name, sv.script_name, cs.special_asset_id
            FROM special_views sv
            LEFT JOIN card_specials cs ON sv.id = cs.view_id
            LEFT JOIN cards c ON cs.card_id = c.id
            LEFT JOIN special_sets ss ON cs.special_set_id = ss.id
            WHERE sv.id = ?
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT 1
        """, (view_id,)).fetchone()
        conn.close()
        return dict(row) if row and row['card_name'] else None
    except Exception:
        return None

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def search_special_attacks(query, limit=20):
    if not query or len(str(query).strip()) < 2:
        return []
    q = f"%{str(query).strip()}%"
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        rows = cur.execute("""
            SELECT c.id as card_id, c.name as card_name, c.rarity, c.element,
                   cs.id as cs_id, cs.view_id, sv.script_name, cs.style,
                   ss.name as sa_name, ss.description as sa_desc,
                   cs.eball_num_start, cs.special_asset_id
            FROM cards c
            JOIN card_specials cs ON c.id = cs.card_id
            LEFT JOIN special_views sv ON cs.view_id = sv.id
            LEFT JOIN special_sets ss ON cs.special_set_id = ss.id
            WHERE (c.name LIKE ? OR ss.name LIKE ? OR CAST(c.id AS TEXT) LIKE ? OR sv.script_name LIKE ?)
                  AND cs.view_id IS NOT NULL AND cs.view_id != 0
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT ?
        """, (q, q, q, q, limit)).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def get_active_origin_info(special_view_id=None, ultimate_id=None):
    if not special_view_id and not ultimate_id:
        return None
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        conds = []
        params = []
        if special_view_id:
            conds.append("ass.special_view_id = ?")
            params.append(special_view_id)
        if ultimate_id:
            conds.append("ass.ultimate_special_id = ?")
            params.append(str(ultimate_id))
        row = cur.execute(f"""
            SELECT c.id as card_id, c.name as card_name, c.rarity, c.element,
                   ass.name as act_name, ass.special_view_id, sv.script_name, ass.ultimate_special_id
            FROM active_skill_sets ass
            JOIN card_active_skills cas ON ass.id = cas.active_skill_set_id
            JOIN cards c ON cas.card_id = c.id
            LEFT JOIN special_views sv ON ass.special_view_id = sv.id
            WHERE {' OR '.join(conds)}
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT 1
        """, params).fetchone()
        conn.close()
        return dict(row) if row and row['card_name'] else None
    except Exception:
        return None

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def search_active_skills(query, limit=20):
    if not query or len(str(query).strip()) < 2:
        return []
    q = f"%{str(query).strip()}%"
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        rows = cur.execute("""
            SELECT c.id as card_id, c.name as card_name, c.rarity, c.element,
                   ass.id as set_id, ass.name as act_name, ass.effect_description, ass.condition_description,
                   ass.special_view_id, sv.script_name, ass.ultimate_special_id, ass.turn, ass.exec_limit
            FROM cards c
            JOIN card_active_skills cas ON c.id = cas.card_id
            JOIN active_skill_sets ass ON cas.active_skill_set_id = ass.id
            LEFT JOIN special_views sv ON ass.special_view_id = sv.id
            WHERE (c.name LIKE ? OR ass.name LIKE ? OR CAST(c.id AS TEXT) LIKE ? OR sv.script_name LIKE ?)
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT ?
        """, (q, q, q, q, limit)).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def get_entrance_origin_info(passive_skill_effect_id=None, script_name=None):
    if not passive_skill_effect_id and not script_name:
        return None
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        conds = []
        params = []
        if passive_skill_effect_id:
            conds.append("pse.id = ?")
            params.append(passive_skill_effect_id)
        if script_name:
            conds.append("pse.script_name = ?")
            params.append(script_name)
        row = cur.execute(f"""
            SELECT c.id as card_id, c.name as card_name, c.rarity, c.element,
                   pss.name as pss_name, ps.name as ps_name,
                   pse.id as pse_id, pse.script_name, pse.bgm_id
            FROM passive_skill_effects pse
            JOIN passive_skills ps ON pse.id = ps.passive_skill_effect_id
            JOIN passive_skill_set_relations pssr ON ps.id = pssr.passive_skill_id
            JOIN passive_skill_sets pss ON pssr.passive_skill_set_id = pss.id
            JOIN cards c ON pssr.passive_skill_set_id = c.passive_skill_set_id
            WHERE {' OR '.join(conds)}
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT 1
        """, params).fetchone()
        conn.close()
        return dict(row) if row and row['card_name'] else None
    except Exception:
        return None

@st.cache_data(ttl=3600, show_spinner=False, max_entries=128)
def search_entrance_animations(query, limit=20):
    if not query or len(str(query).strip()) < 2:
        return []
    q = f"%{str(query).strip()}%"
    try:
        conn = get_db_connection()
        conn.row_factory = sqlite3.Row
        cur = conn.cursor()
        rows = cur.execute("""
            SELECT pse.id as pse_id, pse.script_name, pse.bgm_id,
                   c.id as card_id, c.name as card_name, c.rarity, c.element,
                   pss.name as pss_name, ps.name as ps_name
            FROM passive_skill_effects pse
            JOIN passive_skills ps ON pse.id = ps.passive_skill_effect_id
            JOIN passive_skill_set_relations pssr ON ps.id = pssr.passive_skill_id
            JOIN passive_skill_sets pss ON pssr.passive_skill_set_id = pss.id
            JOIN cards c ON pssr.passive_skill_set_id = c.passive_skill_set_id
            WHERE (c.name LIKE ? OR pss.name LIKE ? OR ps.name LIKE ? OR CAST(c.id AS TEXT) LIKE ? OR pse.script_name LIKE ?)
                  AND pse.script_name IS NOT NULL AND pse.script_name != ''
            GROUP BY pse.id
            ORDER BY (CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END), c.rarity DESC, c.id DESC
            LIMIT ?
        """, (q, q, q, q, q, limit)).fetchall()
        conn.close()
        return [dict(r) for r in rows]
    except Exception:
        return []

def get_all_card_animations(card_id, cursor=None):
    close_conn = False
    if cursor is None:
        try:
            conn = get_db_connection()
            conn.row_factory = sqlite3.Row
            cursor = conn.cursor()
            close_conn = True
        except Exception:
            return []
    animations = []
    seen_paths = set()
    
    # 1. Super Attacks (12 Ki, 18-24 Ki, Extra, Counters)
    try:
        cs_rows = cursor.execute("""
            SELECT card_specials.*, special_sets.name as set_name, special_sets.description as set_desc,
                   extra_special_options.bgm_id as ex_bgm_id
            FROM card_specials
            LEFT JOIN special_sets ON card_specials.special_set_id = special_sets.id
            LEFT JOIN extra_special_options ON extra_special_options.card_special_id = card_specials.id
            WHERE card_specials.card_id = ?
            ORDER BY card_specials.priority ASC, card_specials.id ASC
        """, (card_id,)).fetchall()
        
        for row in cs_rows:
            vid = row['view_id']
            style = row['style'] or 'Normal'
            name = row['set_name'] or f"Super Attack ({style})"
            spath = resolve_special_view_script(vid, cursor)
            if spath and spath not in seen_paths:
                seen_paths.add(spath)
                animations.append({
                    'category': 'Super Attack',
                    'badge': f"⚡ SA ({style})",
                    'title': name,
                    'view_id': vid,
                    'script_path': spath,
                    'type': 'super_attack',
                    'bgm_id': row['ex_bgm_id'],
                    'move_tag': 'EX SA' if style == 'Extra' else ('Ultra SA' if row['eball_num_start'] >= 18 else 'SA')
                })
    except Exception:
        pass
            
    # 2. Active Skills (Attacks, Transformations, Ultimate SAs)
    try:
        act_rows = cursor.execute("""
            SELECT active_skill_sets.*
            FROM card_active_skills
            JOIN active_skill_sets ON card_active_skills.active_skill_set_id = active_skill_sets.id
            WHERE card_active_skills.card_id = ?
        """, (card_id,)).fetchall()
        
        for row in act_rows:
            vid = row['special_view_id']
            ult_id = row['ultimate_special_id']
            name = row['name'] or "Active Skill"
            bgm_id = row['bgm_id'] if ('bgm_id' in row.keys() and row['bgm_id'] and int(row['bgm_id']) > 0) else None
            
            # Kiểm tra active_skills có loại efficacy 79 hoặc 103 (Biến hình)
            is_tf_eff = False
            try:
                ask_tf = cursor.execute("SELECT id FROM active_skills WHERE active_skill_set_id = ? AND efficacy_type IN (79, 103)", (row['id'],)).fetchone()
                if ask_tf:
                    is_tf_eff = True
            except Exception:
                pass

            if vid:
                spath = resolve_special_view_script(vid, cursor) or resolve_script_by_name(f"bs{int(vid):04d}")
                if spath and spath not in seen_paths:
                    seen_paths.add(spath)
                    is_tf = (is_tf_eff or 
                             '/tf' in spath.lower() or 
                             any(k in (name or '').lower() for k in ['transform', 'biến hình', 'awaken', 'awakening', 'fusion', 'potara', 'exchange', 'hợp thể']))
                    animations.append({
                        'category': 'Transformation' if is_tf else 'Active Skill',
                        'badge': "🔄 Active Transformation" if is_tf else "💥 Active Motion",
                        'title': name,
                        'view_id': vid,
                        'script_path': spath,
                        'type': 'active_transformation' if is_tf else 'active_skill',
                        'bgm_id': bgm_id
                    })
            if ult_id:
                try:
                    ult_num = int(ult_id)
                    ult_spath = resolve_script_by_name(f"ut{ult_num:04d}")
                    if ult_spath and ult_spath not in seen_paths:
                        seen_paths.add(ult_spath)
                        animations.append({
                            'category': 'Active Skill',
                            'badge': "💥 Ultimate Attack",
                            'title': f"{name} (Ultimate Attack)",
                            'view_id': ult_num,
                            'script_path': ult_spath,
                            'type': 'ultimate_special',
                            'bgm_id': bgm_id
                        })
                except:
                    pass
    except Exception:
        pass

    # 3. Standby Skills (Standby Phase)
    try:
        stb_rows = cursor.execute("""
            SELECT standby_skill_sets.*
            FROM card_standby_skill_set_relations
            JOIN standby_skill_sets ON card_standby_skill_set_relations.standby_skill_set_id = standby_skill_sets.id
            WHERE card_standby_skill_set_relations.card_id = ?
        """, (card_id,)).fetchall()
        
        for row in stb_rows:
            vid = row['special_view_id']
            name = row['name'] or "Standby Skill"
            if vid:
                spath = resolve_special_view_script(vid, cursor) or resolve_script_by_name(f"stb{int(vid):04d}")
                if spath and spath not in seen_paths:
                    seen_paths.add(spath)
                    animations.append({
                        'category': 'Standby Skill',
                        'badge': "⏳ Standby Phase",
                        'title': name,
                        'view_id': vid,
                        'script_path': spath,
                        'type': 'standby'
                    })
    except Exception:
        pass

    # 4. Finish Skills (Finish Attack)
    try:
        fn_rows = cursor.execute("""
            SELECT finish_skill_sets.*
            FROM card_finish_skill_set_relations
            JOIN finish_skill_sets ON card_finish_skill_set_relations.finish_skill_set_id = finish_skill_sets.id
            WHERE card_finish_skill_set_relations.card_id = ?
        """, (card_id,)).fetchall()
        
        for fn_i, row in enumerate(fn_rows):
            vid = row['special_view_id']
            name = row['name'] or f"Finish Attack #{fn_i+1}"
            if vid:
                spath = resolve_special_view_script(vid, cursor) or resolve_script_by_name(f"fi{int(vid):04d}")
                anim_key = f"{spath}_{row['id']}"
                if spath and anim_key not in seen_paths:
                    seen_paths.add(anim_key)
                    badge_label = f"🎯 Finish Attack #{fn_i+1}" if len(fn_rows) > 1 else "🎯 Finish Attack"
                    animations.append({
                        'category': 'Finish Attack',
                        'badge': badge_label,
                        'title': name,
                        'view_id': vid,
                        'script_path': spath,
                        'type': 'finish'
                    })
    except Exception:
        pass

    # 5. Entrance Animations (Passive Skill Intro Cutscene)
    try:
        pse_rows = cursor.execute("""
            SELECT passive_skills.name, passive_skill_effects.script_name, passive_skill_effects.bgm_id
            FROM cards
            JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
            JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
            JOIN passive_skill_effects ON passive_skills.passive_skill_effect_id = passive_skill_effects.id
            WHERE cards.id = ? AND passive_skill_effects.script_name IS NOT NULL
        """, (card_id,)).fetchall()
        
        for row in pse_rows:
            s_name = row['script_name']
            p_name = row['name'] or "Entrance Animation"
            p_bgm = row['bgm_id'] if ('bgm_id' in row.keys() and row['bgm_id'] and int(row['bgm_id']) > 0) else None
            if s_name:
                spath = resolve_script_by_name(s_name)
                if spath and spath not in seen_paths:
                    seen_paths.add(spath)
                    animations.append({
                        'category': 'Entrance / Intro',
                        'badge': "🌟 Entrance Intro",
                        'title': p_name,
                        'view_id': s_name,
                        'script_path': spath,
                        'type': 'entrance',
                        'bgm_id': p_bgm
                    })
    except Exception:
        pass

    # 6. Revival Cutscenes (Hoạt ảnh Hồi sinh)
    try:
        rv_rows = cursor.execute("""
            SELECT ps.id, ps.name, ps.eff_value1, ps.eff_value2, ps.eff_value3
            FROM cards cd
            JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            WHERE cd.id = ? AND ps.efficacy_type = 109
        """, (card_id,)).fetchall()
        for r_row in rv_rows:
            rv_id = r_row['eff_value2']
            bgm_id = r_row['eff_value3']
            rv_data = cursor.execute("""
                SELECT rv.id, rv.effect_pack_id, rv.script_name, ep.name, ep.pack_name
                FROM revival_views rv
                LEFT JOIN effect_packs ep ON rv.effect_pack_id = ep.id
                WHERE rv.id = ?
            """, (rv_id,)).fetchone()
            if rv_data:
                epid = rv_data['effect_pack_id']
                s_name = rv_data['script_name']
                ep_name = rv_data['name'] or f"Revival #{rv_id}"
                if not s_name and epid:
                    s_name = f"fx_{epid}"
                if s_name:
                    spath = resolve_script_by_name(s_name)
                    if spath and spath not in seen_paths:
                        seen_paths.add(spath)
                        animations.append({
                            'category': 'Revival',
                            'badge': "💖 Revival Cutscene",
                            'title': f"Hồi sinh: {ep_name}",
                            'view_id': rv_id,
                            'script_path': spath,
                            'type': 'revival',
                            'bgm_id': bgm_id if (bgm_id and int(bgm_id) > 0) else None
                        })
    except Exception:
        pass

    # 7. Passive Transformations (Biến hình nội tại qua battle_params & effect_packs)
    try:
        tf_rows = cursor.execute("""
            SELECT ps.id, ps.name, ps.efficacy_type, ps.eff_value1, ps.eff_value2, ps.eff_value3
            FROM cards cd
            JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            WHERE cd.id = ? AND ps.efficacy_type IN (79, 103)
        """, (card_id,)).fetchall()
        seen_transformations = set()
        for r_row in tf_rows:
            target_cid = r_row['eff_value1']
            p2 = r_row['eff_value2']
            p3 = r_row['eff_value3']
            transform_key = (target_cid, p2, p3)
            if transform_key in seen_transformations:
                continue
            seen_transformations.add(transform_key)
            spath = None
            eff_pack_id = None
            eff_pack_name = None
            bgm_id = None
            has_battle_params = False
            for p in (p2, p3):
                if p and int(p) > 0:
                    bp_rows = cursor.execute("SELECT idx, value FROM battle_params WHERE param_no = ?", (p,)).fetchall()
                    has_battle_params |= bool(bp_rows)
                    bp = {b['idx']: b['value'] for b in bp_rows}
                    if bp.get(1) and bp.get(1) > 10:
                        eff_pack_id = bp.get(1)
                        ep_r = cursor.execute("SELECT id, name, pack_name FROM effect_packs WHERE id = ?", (eff_pack_id,)).fetchone()
                        if ep_r:
                            eff_pack_name = ep_r['name']
                        bgm_id = bp.get(8)
                        break
                    elif bp.get(8) and not bgm_id:
                        bgm_id = bp.get(8)

            if not eff_pack_id and not has_battle_params:
                # Only infer a script when the database has no battle params.
                pse_r = cursor.execute("""
                    SELECT id, script_name, bgm_id FROM passive_skill_effects
                    WHERE id IN (?, ?) OR script_name LIKE ? OR script_name LIKE ?
                """, (card_id, target_cid, f"%{card_id}%", f"%{target_cid}%")).fetchone()
                if pse_r and pse_r['script_name']:
                    s_name = pse_r['script_name']
                    spath = resolve_script_by_name(s_name)
                    if not bgm_id and pse_r['bgm_id']:
                        bgm_id = pse_r['bgm_id']
                else:
                    if target_cid:
                        ch_r = cursor.execute("""
                            SELECT ch.name, cd.rarity FROM cards cd
                            JOIN characters ch ON cd.character_id = ch.id
                            WHERE cd.id = ?
                        """, (target_cid,)).fetchone()
                        ch_name = ch_r['name'] if ch_r else ""
                        t_rarity = ch_r['rarity'] if ch_r else 0
                        prefix = "LR_" if t_rarity == 5 else ("UR_" if t_rarity == 4 else "")
                        ep_m = None
                        if ch_name:
                            if prefix:
                                ep_m = cursor.execute("""
                                    SELECT id, name, pack_name FROM effect_packs
                                    WHERE name LIKE ? AND name LIKE ? AND (name LIKE '%登場%' OR name LIKE '%変身%' OR name LIKE '%覚醒%')
                                    ORDER BY id DESC LIMIT 1
                                """, (f"{prefix}%", f"%{ch_name}%")).fetchone()
                            if not ep_m:
                                ep_m = cursor.execute("""
                                    SELECT id, name, pack_name FROM effect_packs
                                    WHERE name LIKE ? AND (name LIKE '%登場%' OR name LIKE '%変身%' OR name LIKE '%覚醒%')
                                    ORDER BY id DESC LIMIT 1
                                """, (f"%{ch_name}%",)).fetchone()
                            if ep_m:
                                eff_pack_id = ep_m['id']
                                eff_pack_name = ep_m['name']

            if eff_pack_id:
                s_name = f"fx_{eff_pack_id}"
                spath = resolve_script_by_name(s_name)

            if spath and spath not in seen_paths:
                seen_paths.add(spath)
                label = eff_pack_name or r_row['name'] or f"Biến hình #{target_cid}"
                animations.append({
                    'category': 'Transformation',
                    'badge': "🔄 Passive Transformation",
                    'title': f"Biến hình: {label}",
                    'view_id': eff_pack_id,
                    'script_path': spath,
                    'type': 'passive_transformation',
                    'bgm_id': bgm_id if (bgm_id and int(bgm_id) > 0) else None
                })
    except Exception:
        pass

    # 8. Reverse lookup for Transformed cards (nếu thẻ hiện tại là dạng biến hình, tìm cutscene biến hình từ thẻ gốc)
    if not any(a.get('category') == 'Transformation' for a in animations):
        try:
            # Active skill base card lookup
            base_act = cursor.execute("""
                SELECT cd.id, cd.name, ass.name as act_name, ass.special_view_id, ass.bgm_id
                FROM cards cd
                JOIN card_active_skills cas ON cd.id = cas.card_id
                JOIN active_skill_sets ass ON cas.active_skill_set_id = ass.id
                JOIN active_skills ask ON ass.id = ask.active_skill_set_id
                WHERE ask.efficacy_type IN (79, 103) AND ask.eff_val1 = ?
            """, (card_id,)).fetchall()
            for b_r in base_act:
                vid = b_r['special_view_id']
                if vid:
                    spath = resolve_special_view_script(vid, cursor) or resolve_script_by_name(f"bs{int(vid):04d}")
                    if spath and spath not in seen_paths:
                        seen_paths.add(spath)
                        animations.append({
                            'category': 'Transformation',
                            'badge': "🔄 Transformation (Từ bản gốc)",
                            'title': f"Biến hình từ {b_r['name']}",
                            'view_id': vid,
                            'script_path': spath,
                            'type': 'active_transformation',
                            'bgm_id': b_r['bgm_id'] if (b_r['bgm_id'] and int(b_r['bgm_id']) > 0) else None,
                            'from_base': True
                        })
        except Exception:
            pass

        try:
            # Passive skill base card lookup
            base_pas = cursor.execute("""
                SELECT cd.id, cd.name, ps.eff_value2, ps.eff_value3
                FROM cards cd
                JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
                JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
                WHERE ps.efficacy_type IN (79, 103) AND ps.eff_value1 = ?
            """, (card_id,)).fetchall()
            for b_r in base_pas:
                eff_pack_id = None
                eff_pack_name = None
                bgm_id = None
                for p in (b_r['eff_value2'], b_r['eff_value3']):
                    if p and int(p) > 0:
                        bp_rows = cursor.execute("SELECT idx, value FROM battle_params WHERE param_no = ?", (p,)).fetchall()
                        bp = {b['idx']: b['value'] for b in bp_rows}
                        if bp.get(1) and bp.get(1) > 10:
                            eff_pack_id = bp.get(1)
                            ep_r = cursor.execute("SELECT id, name FROM effect_packs WHERE id = ?", (eff_pack_id,)).fetchone()
                            if ep_r:
                                eff_pack_name = ep_r['name']
                            bgm_id = bp.get(8)
                            break
                if eff_pack_id:
                    s_name = f"fx_{eff_pack_id}"
                    spath = resolve_script_by_name(s_name)
                    if spath and spath not in seen_paths:
                        seen_paths.add(spath)
                        lbl = eff_pack_name or f"Biến hình từ {b_r['name']}"
                        animations.append({
                            'category': 'Transformation',
                            'badge': "🔄 Transformation (Từ bản gốc)",
                            'title': f"Biến hình từ {b_r['name']}: {lbl}",
                            'view_id': eff_pack_id,
                            'script_path': spath,
                            'type': 'passive_transformation',
                            'bgm_id': bgm_id if (bgm_id and int(bgm_id) > 0) else None,
                            'from_base': True
                        })
        except Exception:
            pass
                

    if close_conn and 'conn' in locals():
        try:
            conn.close()
        except:
            pass

    return animations



CACHE_DIR = os.path.join(GAME_RES_DIR, "cache")
os.makedirs(CACHE_DIR, exist_ok=True)

# Requests are served by ThreadingTCPServer, so the same missing asset can be
# requested several times in parallel while an animation starts. Striped locks
# deduplicate those downloads without keeping one Lock object per asset forever.
_ASSET_CACHE_LOCKS = tuple(threading.RLock() for _ in range(64))
_ASSET_CACHE_FS_LOCK = threading.RLock()

def _asset_cache_lock(path):
    key = os.path.normcase(os.path.abspath(path))
    return _ASSET_CACHE_LOCKS[hash(key) % len(_ASSET_CACHE_LOCKS)]

def _ensure_cache_parent(local_file):
    """Create cache parents and recover old flat files that block a directory."""
    parent = os.path.abspath(os.path.dirname(local_file))
    root = os.path.abspath(GAME_RES_DIR)
    try:
        if os.path.commonpath((root, parent)) != root:
            raise ValueError(f"Cache path escapes game res: {local_file}")
    except ValueError:
        raise ValueError(f"Invalid cache path: {local_file}")

    with _ASSET_CACHE_FS_LOCK:
        rel_parent = os.path.relpath(parent, root)
        current = root
        for part in rel_parent.split(os.sep):
            if not part or part == '.':
                continue
            current = os.path.join(current, part)
            if os.path.isfile(current):
                # Older cache mapping flattened language paths and could create
                # a PNG literally named "en". Preserve it instead of deleting it.
                backup = current + '.legacy-file'
                suffix = 1
                while os.path.exists(backup):
                    backup = current + f'.legacy-file-{suffix}'
                    suffix += 1
                os.replace(current, backup)
                old_meta = current + '.meta'
                if os.path.isfile(old_meta):
                    try:
                        os.replace(old_meta, backup + '.meta')
                    except OSError:
                        pass
            os.makedirs(current, exist_ok=True)

def _atomic_write_bytes(path, data):
    _ensure_cache_parent(path)
    temp_path = f"{path}.part-{os.getpid()}-{threading.get_ident()}"
    try:
        with open(temp_path, 'wb') as f:
            f.write(data)
        os.replace(temp_path, path)
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass

def _atomic_write_text(path, text):
    _ensure_cache_parent(path)
    temp_path = f"{path}.part-{os.getpid()}-{threading.get_ident()}"
    try:
        with open(temp_path, 'w', encoding='utf-8') as f:
            f.write(text)
        os.replace(temp_path, path)
    finally:
        try:
            if os.path.exists(temp_path):
                os.remove(temp_path)
        except OSError:
            pass

def get_cache_filepath(clean_path, query_dict=None):
    # 1. Scripts Index
    if clean_path == 'api/scripts':
        return os.path.join(GAME_RES_DIR, "dokkan_scripts_index.json")
    
    # 2. Lua Scripts
    if clean_path == 'api/script' and query_dict and 'path' in query_dict:
        sp = query_dict['path'][0] if isinstance(query_dict['path'], list) else query_dict['path']
        return os.path.join(GAME_RES_DIR, sp.replace('/', os.sep))

    # 3. Card Metadata JSON & Composite textures
    if clean_path.startswith('api/card/'):
        rest = clean_path.replace('api/card/', '').strip('/')
        parts = rest.split('/')
        cid = parts[0]
        if len(parts) == 1:
            return os.path.join(GAME_RES_DIR, "cards", cid, "card_info.json")
        else:
            sub = os.sep.join(parts[1:])
            return os.path.join(GAME_RES_DIR, "cards", cid, sub)

    # 4. Card Character & BG Textures
    if clean_path.startswith('card_bg/'):
        parts = clean_path.replace('card_bg/', '').split('/')
        if len(parts) >= 2:
            raw_id, fn = parts[0], parts[1]
            fid = (raw_id[:-1] + "0") if len(raw_id) > 1 else raw_id
            legacy_asset = os.path.join(GAME_RES_DIR, "card_bg", fid, fn)
            if os.path.isfile(legacy_asset) and os.path.getsize(legacy_asset) > 100:
                return legacy_asset
            return os.path.join(GAME_RES_DIR, "cards", fid, "background", fn)
    if clean_path.startswith('card/'):
        parts = clean_path.replace('card/', '').split('/')
        if len(parts) >= 2:
            raw_id, fn = parts[0], parts[1]
            fid = (raw_id[:-1] + "0") if len(raw_id) > 1 else raw_id
            legacy_asset = os.path.join(GAME_RES_DIR, "card", fid, fn)
            if os.path.isfile(legacy_asset) and os.path.getsize(legacy_asset) > 100:
                return legacy_asset
            return os.path.join(GAME_RES_DIR, "cards", fid, "character", fn)
    if clean_path.startswith('assets/character/card/'):
        rel = clean_path.replace('assets/character/card/', '')
        parts = rel.split('/')
        if len(parts) >= 2:
            raw_id = parts[0]
            nested_rel = os.path.join(*parts[1:])
            fn = parts[-1]
            fid = (raw_id[:-1] + "0") if len(raw_id) > 1 else raw_id
            # Only flat legacy assets can use the old card/<id>/<file> path.
            # Language folders (en/...) and numbered SA-name variants must
            # retain their full relative path or they overwrite each other as
            # one file literally named "en".
            if len(parts) == 2:
                legacy_asset = os.path.join(GAME_RES_DIR, "card", fid, fn)
                if os.path.isfile(legacy_asset) and os.path.getsize(legacy_asset) > 100:
                    return legacy_asset
            return os.path.join(GAME_RES_DIR, "cards", fid, "character", nested_rel)
    if clean_path.startswith('assets/character/card_bg/'):
        rel = clean_path.replace('assets/character/card_bg/', '')
        parts = rel.split('/')
        if len(parts) >= 2:
            raw_id, fn = parts[0], parts[1]
            fid = (raw_id[:-1] + "0") if len(raw_id) > 1 else raw_id
            legacy_asset = os.path.join(GAME_RES_DIR, "card_bg", fid, fn)
            if os.path.isfile(legacy_asset) and os.path.getsize(legacy_asset) > 100:
                return legacy_asset
            return os.path.join(GAME_RES_DIR, "cards", fid, "background", fn)

    # 5. In-Game Battle Character Model & Textures
    if clean_path.startswith('assets/ingame/battle/character/'):
        rel = clean_path.replace('assets/ingame/battle/character/', '')
        parts = rel.split('/')
        if parts:
            cid = parts[0]
            rest = os.sep.join(parts[1:])
            return os.path.join(GAME_RES_DIR, "cards", cid, "battle", rest)

    # 6. Effect Packs (JSON & LWF Files & Textures)
    if clean_path.startswith('api/effect-pack/'):
        epid = clean_path.replace('api/effect-pack/', '').split('?')[0].strip('/')
        return os.path.join(GAME_RES_DIR, "effects", f"pack_{epid}.json")
    if clean_path.startswith('assets/ingame/battle/effect/') or clean_path.startswith('assets/ingame/battle/sp_effect/'):
        rel = re.sub(r'^assets/ingame/battle/(?:sp_)?effect/', '', clean_path).replace('/', os.sep)
        return os.path.join(GAME_RES_DIR, "effects", rel)

    # 7. Audio (SE Sound Effects & Voices)
    if clean_path == 'api/se' and query_dict and 'cue' in query_dict:
        cue = query_dict['cue'][0] if isinstance(query_dict['cue'], list) else query_dict['cue']
        return os.path.join(GAME_RES_DIR, "audio", "se", f"se_{cue}.wav")
    if clean_path == 'api/voice' and query_dict and 'cue' in query_dict:
        cue = query_dict['cue'][0] if isinstance(query_dict['cue'], list) else query_dict['cue']
        lang = query_dict.get('lang', ['ja'])[0] if isinstance(query_dict.get('lang'), list) else query_dict.get('lang', 'ja')
        if lang == 'en':
            en_path = os.path.join(GAME_RES_DIR, "audio", "voice_en", f"voice_{cue}.m4a")
            if os.path.exists(en_path):
                return en_path
            legacy_en = os.path.join(GAME_RES_DIR, "audio", "voice", f"voice_{cue}.m4a")
            if os.path.exists(legacy_en):
                return legacy_en
            return en_path
        else:
            return os.path.join(GAME_RES_DIR, "audio", "voice_jp", f"voice_{cue}.wav")

    # 8. USM Movies (MP4 video streams)
    if clean_path == 'api/usm' and query_dict and 'path' in query_dict:
        upath = query_dict['path'][0] if isinstance(query_dict['path'], list) else query_dict['path']
        safe_name = os.path.splitext(os.path.basename(upath))[0]
        return os.path.join(GAME_RES_DIR, "movies", f"{safe_name}.mp4")
    if clean_path.startswith('assets/movie/'):
        rel = clean_path.replace('assets/movie/', '')
        safe_name = os.path.splitext(os.path.basename(rel))[0]
        return os.path.join(GAME_RES_DIR, "movies", f"{safe_name}.usm")

    # 9. Backgrounds & Dokkan Fields
    if clean_path.startswith('api/level-bg/'):
        bgid = clean_path.replace('api/level-bg/', '').strip('/')
        return os.path.join(GAME_RES_DIR, "backgrounds", f"level_bg_{bgid}.json")
    if clean_path.startswith('api/dokkan-field/'):
        dfid = clean_path.replace('api/dokkan-field/', '').strip('/')
        return os.path.join(GAME_RES_DIR, "backgrounds", f"dokkan_field_{dfid}.json")
    if clean_path.startswith('assets/ingame/battle/bg/'):
        rel = clean_path.replace('assets/ingame/battle/bg/', '').replace('/', os.sep)
        return os.path.join(GAME_RES_DIR, "backgrounds", rel)

    # Fallback Cache
    safe_name = re.sub(r'[^a-zA-Z0-9_\-\.]', '_', clean_path)
    if query_dict:
        flat_pairs = []
        for k in sorted(query_dict.keys()):
            val = query_dict[k]
            if isinstance(val, list):
                for v in val: flat_pairs.append((k, str(v)))
            else:
                flat_pairs.append((k, str(val)))
        q_str = urllib.parse.urlencode(flat_pairs)
        safe_name += "__" + re.sub(r'[^a-zA-Z0-9_\-\.]', '_', q_str)
    
    return os.path.join(CACHE_DIR, safe_name)

_cdn_session = None
_cdn_session_lock = threading.Lock()

def get_cdn_session():
    global _cdn_session
    if _cdn_session is None:
        with _cdn_session_lock:
            if _cdn_session is None:
                s = requests.Session()
                retries = Retry(total=2, backoff_factor=0.3, status_forcelist=[500, 502, 503, 504])
                adapter = HTTPAdapter(pool_connections=35, pool_maxsize=35, max_retries=retries)
                s.mount("https://", adapter)
                s.mount("http://", adapter)
                s.headers.update({
                    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36',
                    'Accept': '*/*'
                })
                _cdn_session = s
    return _cdn_session

_prefetch_executor = ThreadPoolExecutor(max_workers=8, thread_name_prefix="DokkanAssetPrefetch")
_prefetch_slots = threading.BoundedSemaphore(32)
_prefetch_pending = set()
_prefetch_lock = threading.Lock()

def prefetch_assets_parallel(rel_paths):
    """Prefetch multiple assets concurrently in the background using connection pool."""
    def _fetch_one(p):
        try:
            get_or_fetch_cached_asset(p)
        except Exception:
            pass
        finally:
            with _prefetch_lock:
                _prefetch_pending.discard(p)
            _prefetch_slots.release()
    for path in rel_paths:
        with _prefetch_lock:
            if path in _prefetch_pending or not _prefetch_slots.acquire(blocking=False):
                continue  # Optional warmup only; a real request still fetches on demand.
            _prefetch_pending.add(path)
        try:
            _prefetch_executor.submit(_fetch_one, path)
        except RuntimeError:
            with _prefetch_lock:
                _prefetch_pending.discard(path)
            _prefetch_slots.release()

def _get_or_fetch_cached_asset_unlocked(rel_path, query_dict=None):
    clean_path = rel_path.strip('/')

    # Special handler for api/voice. JP must come from the local JP ACB/AWB;
    # the public endpoint currently returns the English track even when lang=ja.
    if clean_path == 'api/voice' and query_dict and 'cue' in query_dict:
        cue = query_dict['cue'][0] if isinstance(query_dict['cue'], list) else query_dict['cue']
        lang = query_dict.get('lang', ['ja'])[0] if isinstance(query_dict.get('lang'), list) else query_dict.get('lang', 'ja')
        lang = 'en' if lang == 'en' else 'ja'

        if lang == 'ja':
            try:
                import importlib
                from tools import voice_manager
                # Streamlit can keep an already-imported helper module alive
                # across source reruns. Reload only legacy parser instances so
                # the fixed ACB chain is picked up without requiring a restart.
                if getattr(voice_manager, 'PARSER_VERSION', 0) < 4:
                    voice_manager = importlib.reload(voice_manager)
                jp_file = voice_manager.extract_jp_voice(cue)
                if jp_file and os.path.exists(jp_file):
                    with open(jp_file, 'rb') as f:
                        return f.read(), 'audio/wav'
            except Exception as e:
                print(f"Error extracting JP voice {cue}: {e}")
            return None, None
        else:
            en_file = os.path.join(GAME_RES_DIR, "audio", "voice_en", f"voice_{cue}.m4a")
            if os.path.exists(en_file):
                with open(en_file, 'rb') as f:
                    return f.read(), 'audio/wav'
            legacy_file = os.path.join(GAME_RES_DIR, "audio", "voice", f"voice_{cue}.m4a")
            if os.path.exists(legacy_file):
                with open(legacy_file, 'rb') as f:
                    return f.read(), 'audio/wav'
            remote_url = f"https://dokkan-eclipse.com/api/voice?cue={cue}"
            try:
                session = get_cdn_session()
                resp = session.get(remote_url, timeout=15)
                if resp.status_code == 200 and len(resp.content) > 0:
                    data = resp.content
                    os.makedirs(os.path.dirname(en_file), exist_ok=True)
                    with open(en_file, 'wb') as ef:
                        ef.write(data)
                    return data, 'audio/wav'
            except Exception:
                pass

    # Special handler for api/script: always return JSON {path, text}
    if clean_path == 'api/script':
        sp = query_dict.get('path', [''])[0] if query_dict and 'path' in query_dict else ''
        if isinstance(sp, list): sp = sp[0]
        if not sp:
            return b'{"error": "Missing path"}', 'application/json; charset=utf-8'
        script_name = os.path.basename(sp.replace('\\', '/'))
        if sp.replace('\\', '/').startswith('ab_script/preview_fx/') and re.fullmatch(r'fx_(\d+)\.lua', script_name):
            if not os.path.isfile(os.path.join(GAME_RES_DIR, 'ab_script', 'preview_fx', script_name)):
                try:
                    import anim_transmuter
                    anim_transmuter.generate_effect_pack_lua(int(script_name[3:-4]))
                except Exception as exc:
                    print(f"Effect pack Lua generation failed for {script_name}: {exc}")
        local_script = os.path.join(GAME_RES_DIR, sp.replace('/', os.sep))
        if os.path.exists(local_script) and os.path.getsize(local_script) > 0:
            try:
                with open(local_script, 'r', encoding='utf-8', errors='ignore') as f:
                    txt = f.read()
                return json.dumps({'path': sp, 'text': txt}).encode('utf-8'), 'application/json; charset=utf-8'
            except Exception:
                pass
        # Fetch remote
        remote_url = f"https://dokkan-eclipse.com/api/script?path={urllib.parse.quote(sp)}"
        try:
            req = urllib.request.Request(remote_url, headers={
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            })
            with urllib.request.urlopen(req, timeout=20) as resp:
                raw_bytes = resp.read()
                try:
                    p_json = json.loads(raw_bytes.decode('utf-8'))
                    if 'text' in p_json:
                        os.makedirs(os.path.dirname(local_script), exist_ok=True)
                        with open(local_script, 'w', encoding='utf-8') as f:
                            f.write(p_json['text'])
                except Exception:
                    pass
                return raw_bytes, 'application/json; charset=utf-8'
        except Exception as e:
            return json.dumps({'error': str(e)}).encode('utf-8'), 'application/json; charset=utf-8'

    local_file = get_cache_filepath(clean_path, query_dict)
    meta_file = local_file + ".meta"

    is_force = False
    if query_dict and any(k in query_dict for k in ('force', 'repair', 'fresh', 't', '_t')):
        is_force = True

    # 1. Disk Cache Hit (< 1ms) unless force/repair requested
    if not is_force and os.path.isfile(local_file) and os.path.getsize(local_file) > 0:
        ctype = 'application/octet-stream'
        if os.path.exists(meta_file):
            try:
                with open(meta_file, 'r', encoding='utf-8') as mf:
                    ctype = mf.read().strip()
            except:
                pass
        else:
            fn_low = local_file.lower()
            if fn_low.endswith('.json'): ctype = 'application/json; charset=utf-8'
            elif fn_low.endswith('.png'): ctype = 'image/png'
            elif fn_low.endswith('.jpg') or fn_low.endswith('.jpeg'): ctype = 'image/jpeg'
            elif fn_low.endswith('.m4a') or fn_low.endswith('.aac'): ctype = 'audio/mp4'
            elif fn_low.endswith('.mp3'): ctype = 'audio/mpeg'
            elif fn_low.endswith('.wav'): ctype = 'audio/wav'
            elif fn_low.endswith('.mp4'): ctype = 'video/mp4'
        
        try:
            with open(local_file, 'rb') as f:
                cached_data = f.read()
            if len(cached_data) <= 75:
                # Tiny dummy/placeholder: do not serve from disk, re-fetch from CDN
                pass
            else:
                return cached_data, ctype
        except Exception:
            pass

    # 2. Remote Fetch & Disk Cache Write
    _ensure_cache_parent(local_file)
    
    if clean_path.startswith('card_bg/'):
        parts = clean_path.replace('card_bg/', '').split('/')
        fid = (parts[0][:-1] + "0") if len(parts[0]) > 1 else parts[0]
        remote_url = f"https://cdn.dokkan-eclipse.com/uncompressed/character/card_bg/{fid}/{parts[1]}"
    elif clean_path.startswith('card/'):
        parts = clean_path.replace('card/', '').split('/')
        fid = (parts[0][:-1] + "0") if len(parts[0]) > 1 else parts[0]
        remote_url = f"https://cdn.dokkan-eclipse.com/uncompressed/character/card/{fid}/{parts[1]}"
    elif clean_path.startswith('assets/'):
        sub = clean_path[len('assets/'):]
        remote_url = f"https://cdn.dokkan-eclipse.com/uncompressed/{sub}"
    else:
        remote_url = f"https://dokkan-eclipse.com/{clean_path}"
        if query_dict:
            flat_pairs = []
            for k in sorted(query_dict.keys()):
                if k in ('force', 'repair', 'fresh', 't', '_t'):
                    continue
                val = query_dict[k]
                if isinstance(val, list):
                    for v in val: flat_pairs.append((k, str(v)))
                else:
                    flat_pairs.append((k, str(val)))
            if flat_pairs:
                remote_url += "?" + urllib.parse.urlencode(flat_pairs)

    timeout = 180 if 'usm' in clean_path else 35
    try:
        session = get_cdn_session()
        resp = session.get(remote_url, timeout=timeout)
        data = resp.content
        ctype = resp.headers.get('Content-Type', 'application/octet-stream')
        if 'usm' in clean_path and ctype.startswith('video/'):
            ctype = 'video/mp4'
        if resp.status_code == 200 and len(data) > 0 and not (ctype.startswith('application/json') and b'"error"' in data):
            _atomic_write_bytes(local_file, data)
            _atomic_write_text(meta_file, ctype)
            return data, ctype
        elif resp.status_code == 404:
            if clean_path.endswith(('.png', '.jpg', '.jpeg')):
                return TRANSPARENT_1X1_PNG, 'image/png'
            return b'', 'text/plain'
        else:
            if clean_path.endswith(('.png', '.jpg', '.jpeg')):
                return TRANSPARENT_1X1_PNG, 'image/png'
            return data, ctype
    except Exception as e:
        if clean_path.endswith(('.png', '.jpg', '.jpeg')):
            return TRANSPARENT_1X1_PNG, 'image/png'
        if clean_path.startswith('api/usm') or clean_path.endswith('.mp4'):
            return b'', 'video/mp4'
        err_bytes = json.dumps({'error': str(e)}).encode('utf-8')
        return err_bytes, 'application/json'

def get_or_fetch_cached_asset(rel_path, query_dict=None):
    """Serialize identical asset requests; unrelated assets still load in parallel."""
    clean_path = rel_path.strip('/')
    local_file = get_cache_filepath(clean_path, query_dict)
    with _asset_cache_lock(local_file):
        return _get_or_fetch_cached_asset_unlocked(rel_path, query_dict)


def ensure_cached_usm_file(query_dict, force=False):
    """Download a converted MP4 straight to the F: cache, without a RAM copy."""
    local_file = get_cache_filepath('api/usm', query_dict)
    with _asset_cache_lock(local_file):
        if not force and os.path.isfile(local_file) and os.path.getsize(local_file) > 8:
            with open(local_file, 'rb') as source:
                if source.read(8)[4:8] == b'ftyp':
                    return local_file
        _ensure_cache_parent(local_file)
        pairs = []
        for key, values in sorted(query_dict.items()):
            if key in ('force', 'repair', 'fresh', 't', '_t'):
                continue
            for value in values if isinstance(values, list) else [values]:
                pairs.append((key, str(value)))
        remote_url = 'https://dokkan-eclipse.com/api/usm?' + urllib.parse.urlencode(pairs)
        temp_path = f"{local_file}.part-{os.getpid()}-{threading.get_ident()}"
        try:
            with get_cdn_session().get(remote_url, timeout=180, stream=True) as response:
                if response.status_code != 200 or response.headers.get('Content-Type', '').lower().startswith('application/json'):
                    return None
                with open(temp_path, 'wb') as output:
                    for chunk in response.iter_content(chunk_size=1024 * 1024):
                        if chunk:
                            output.write(chunk)
            with open(temp_path, 'rb') as source:
                header = source.read(8)
            if len(header) < 8 or header[4:8] != b'ftyp':
                return None
            os.replace(temp_path, local_file)
            _atomic_write_text(local_file + '.meta', 'video/mp4')
            return local_file
        except (OSError, requests.RequestException):
            return None
        finally:
            try:
                if os.path.exists(temp_path):
                    os.remove(temp_path)
            except OSError:
                pass

class BGMHttpHandler(http.server.BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.0"
    close_connection = True
    timeout = 10

    def _send_cors_headers(self):
        self.close_connection = True
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Access-Control-Expose-Headers', 'Content-Length, Content-Range, Accept-Ranges, X-Asset-Stamp, ETag')
        self.send_header('Access-Control-Allow-Private-Network', 'true')
        self.send_header('Connection', 'close')
        self.send_header('Cache-Control', 'public, max-age=31536000, immutable')

    def do_OPTIONS(self):
        self.send_response(200)
        self._send_cors_headers()
        self.end_headers()

    def do_HEAD(self):
        self.do_GET(head_only=True)

    def _serve_cached_file(self, file_path, ctype, head_only=False, allow_range=False):
        """Stream cached assets from disk instead of copying whole videos into RAM."""
        file_size = os.path.getsize(file_path)
        start, end = 0, file_size - 1
        status = 200
        if allow_range:
            range_header = self.headers.get('Range')
            match = re.match(r'bytes=(\d+)-(\d*)', range_header or '')
            if match:
                start = int(match.group(1))
                end = int(match.group(2)) if match.group(2) else file_size - 1
                if start >= file_size:
                    self.send_response(416)
                    self.send_header('Content-Range', f'bytes */{file_size}')
                    self._send_cors_headers()
                    self.end_headers()
                    return True
                end = min(end, file_size - 1)
                status = 206

        length = max(0, end - start + 1)
        self.send_response(status)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(length))
        if allow_range:
            self.send_header('Accept-Ranges', 'bytes')
        if status == 206:
            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
        self._send_cors_headers()
        self.end_headers()
        if head_only or length <= 0:
            return True

        try:
            remaining = length
            with open(file_path, 'rb') as source:
                source.seek(start)
                while remaining > 0:
                    chunk = source.read(min(1024 * 1024, remaining))
                    if not chunk:
                        break
                    self.wfile.write(chunk)
                    remaining -= len(chunk)
        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
            pass
        return True

    def do_GET(self, head_only=False):
        parsed = urllib.parse.urlparse(self.path)
        path = parsed.path.strip('/')
        query_dict = urllib.parse.parse_qs(parsed.query)

        if path == 'api/usm' and query_dict.get('path'):
            force = any(key in query_dict for key in ('force', 'repair', 'fresh', 't', '_t'))
            movie_path = ensure_cached_usm_file(query_dict, force=force)
            if movie_path:
                return self._serve_cached_file(movie_path, 'video/mp4', head_only=head_only, allow_range=True)
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            if not head_only:
                self.wfile.write(b'{"error":"Movie file not found or invalid"}')
            return
        
        # 1. Health check
        if path == 'api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self._send_cors_headers()
            self.end_headers()
            if not head_only:
                self.wfile.write(b'{"ok": true, "version": "1.0.0"}')
            return

        # 2. Card Asset Purge & Repair API
        if path == 'api/repair-card':
            cid_str = query_dict.get('id', [''])[0]
            spath = query_dict.get('script', [''])[0]
            purged = []
            try:
                if cid_str:
                    fid = (cid_str[:-1] + "0") if len(cid_str) > 1 else cid_str
                    for d in [
                        os.path.join(GAME_RES_DIR, "cards", cid_str),
                        os.path.join(GAME_RES_DIR, "cards", fid),
                        os.path.join(GAME_RES_DIR, "card", fid),
                        os.path.join(GAME_RES_DIR, "card_bg", fid),
                        os.path.join(GAME_RES_DIR, "thumb", f"card_{fid}_thumb"),
                    ]:
                        if os.path.exists(d):
                            shutil.rmtree(d, ignore_errors=True)
                            purged.append(d)
                
                if spath:
                    local_script = os.path.join(GAME_RES_DIR, spath.replace('/', os.sep))
                    if os.path.exists(local_script):
                        try:
                            os.remove(local_script)
                            purged.append(local_script)
                        except: pass
                        
                effects_dir = os.path.join(GAME_RES_DIR, "effects")
                if os.path.exists(effects_dir):
                    shutil.rmtree(effects_dir, ignore_errors=True)
                    purged.append(effects_dir)

                movies_dir = os.path.join(GAME_RES_DIR, "movies")
                if os.path.exists(movies_dir):
                    shutil.rmtree(movies_dir, ignore_errors=True)
                    purged.append(movies_dir)

                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                if not head_only:
                    self.wfile.write(json.dumps({"ok": True, "purged": purged}).encode('utf-8'))
                return
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                if not head_only:
                    self.wfile.write(json.dumps({"error": str(e)}).encode('utf-8'))
                return

        if path == 'api/health':
            self.send_response(200)
            self.send_header('Content-Type', 'text/plain')
            self._send_cors_headers()
            self.end_headers()
            if not head_only:
                self.wfile.write(b'dokkan-asset-server-ok')
            return

        # Serve tools static JS files
        if path.startswith('tools/'):
            local_tool_file = os.path.join(os.path.dirname(os.path.abspath(__file__)), path.replace('/', os.sep))
            if os.path.exists(local_tool_file) and os.path.isfile(local_tool_file):
                try:
                    with open(local_tool_file, 'rb') as f:
                        t_data = f.read()
                    self.send_response(200)
                    self.send_header('Content-Type', 'application/javascript')
                    self.send_header('Content-Length', str(len(t_data)))
                    self._send_cors_headers()
                    self.end_headers()
                    if not head_only:
                        self.wfile.write(t_data)
                    return
                except Exception:
                    pass

        # 3. Local BGM Audio Streaming with Byte-Range support
        if path.startswith('bgm/'):
            bid_str = path.replace('bgm/', '').replace('.wav', '')
            try:
                bid = int(bid_str)
                wav_path = get_bgm_wav_path(bid)
                if wav_path and os.path.exists(wav_path):
                    file_size = os.path.getsize(wav_path)
                    range_header = self.headers.get('Range')
                    
                    if range_header:
                        m = re.match(r'bytes=(\d+)-(\d*)', range_header)
                        if m:
                            start = int(m.group(1))
                            end = int(m.group(2)) if m.group(2) else file_size - 1
                            end = min(end, file_size - 1)
                            length = end - start + 1
                            
                            self.send_response(206)
                            self.send_header('Content-Type', 'audio/wav')
                            self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                            self.send_header('Content-Length', str(length))
                            self.send_header('Accept-Ranges', 'bytes')
                            self._send_cors_headers()
                            self.end_headers()
                            
                            if not head_only:
                                try:
                                    with open(wav_path, 'rb') as source:
                                        source.seek(start)
                                        remaining = length
                                        while remaining > 0:
                                            chunk = source.read(min(1024 * 1024, remaining))
                                            if not chunk:
                                                break
                                            self.wfile.write(chunk)
                                            remaining -= len(chunk)
                                except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                                    pass
                            return
                            
                    self.send_response(200)
                    self.send_header('Content-Type', 'audio/wav')
                    self.send_header('Content-Length', str(file_size))
                    self.send_header('Accept-Ranges', 'bytes')
                    self._send_cors_headers()
                    self.end_headers()
                    
                    if not head_only:
                        try:
                            with open(wav_path, 'rb') as source:
                                while chunk := source.read(1024 * 1024):
                                    self.wfile.write(chunk)
                        except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                            pass
                    return
            except Exception:
                pass

        # Serve already-cached static assets straight from disk. This matters
        # most for MP4 range requests: loading the whole movie for every range
        # previously caused large allocations and playback stalls.
        force_keys = ('force', 'repair', 'fresh', 't', '_t')
        is_force = any(k in query_dict for k in force_keys)
        if not is_force and (path.startswith('assets/') or path == 'api/usm'):
            cached_path = get_cache_filepath(path, query_dict)
            if os.path.isfile(cached_path) and os.path.getsize(cached_path) > 0:
                cached_type = 'application/octet-stream'
                cached_meta = cached_path + '.meta'
                if os.path.isfile(cached_meta):
                    try:
                        with open(cached_meta, 'r', encoding='utf-8') as mf:
                            cached_type = mf.read().strip() or cached_type
                    except OSError:
                        pass
                lower_path = cached_path.lower()
                if lower_path.endswith('.png'): cached_type = 'image/png'
                elif lower_path.endswith('.lwf'): cached_type = 'application/octet-stream'
                elif lower_path.endswith('.mp4'): cached_type = 'video/mp4'
                elif lower_path.endswith('.usm'): cached_type = 'application/octet-stream'
                return self._serve_cached_file(
                    cached_path,
                    cached_type,
                    head_only=head_only,
                    allow_range=(cached_type == 'video/mp4' or path == 'api/usm'),
                )

        # 3. All other API and Game Asset requests (Proxied & Cached on local disk)
        data, ctype = get_or_fetch_cached_asset(path, query_dict)
        if data is None:
            self.send_response(404)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self._send_cors_headers()
            self.end_headers()
            if not head_only:
                self.wfile.write(b'{"error": "Asset not found"}')
            return
        
        # Video streaming with Byte-Range support
        if ctype == 'video/mp4' or path == 'api/usm' or path.endswith('.mp4'):
            file_size = len(data) if data else 0
            if file_size == 0:
                self.send_response(404)
                self.send_header('Content-Type', 'application/json')
                self._send_cors_headers()
                self.end_headers()
                if not head_only:
                    self.wfile.write(b'{"error": "Video file not found or empty"}')
                return
            range_header = self.headers.get('Range')
            if range_header:
                m = re.match(r'bytes=(\d+)-(\d*)', range_header)
                if m:
                    start = int(m.group(1))
                    end = int(m.group(2)) if m.group(2) else file_size - 1
                    end = min(end, file_size - 1)
                    length = end - start + 1
                    
                    self.send_response(206)
                    self.send_header('Content-Type', 'video/mp4')
                    self.send_header('Content-Range', f'bytes {start}-{end}/{file_size}')
                    self.send_header('Content-Length', str(length))
                    self.send_header('Accept-Ranges', 'bytes')
                    self._send_cors_headers()
                    self.end_headers()
                    if not head_only:
                        self.wfile.write(data[start:start+length])
                    return

            self.send_response(200)
            self.send_header('Content-Type', 'video/mp4')
            self.send_header('Content-Length', str(file_size))
            self.send_header('Accept-Ranges', 'bytes')
            self._send_cors_headers()
            self.end_headers()
            if not head_only:
                self.wfile.write(data)
            return

        self.send_response(200)
        self.send_header('Content-Type', ctype)
        self.send_header('Content-Length', str(len(data)))
        if path.startswith('api/'):
            self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
            self.send_header('Pragma', 'no-cache')
            self.send_header('Expires', '0')
        self._send_cors_headers()
        self.end_headers()
        
        if not head_only:
            try:
                self.wfile.write(data)
            except Exception:
                pass
            
    def log_message(self, format, *args):
        pass

class ThreadedTCPServer(socketserver.ThreadingMixIn, socketserver.TCPServer):
    allow_reuse_address = True
    daemon_threads = True
    timeout = 10

    def server_bind(self):
        try:
            self.socket.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        except Exception:
            pass
        super().server_bind()

def start_bgm_server_once(port=BGM_SERVER_PORT):
    import sys
    if hasattr(sys, '_bgm_httpd') and sys._bgm_httpd:
        try:
            sys._bgm_httpd.RequestHandlerClass = BGMHttpHandler
            return
        except Exception:
            pass
    try:
        req = urllib.request.Request(f'http://127.0.0.1:{port}/api/health')
        with urllib.request.urlopen(req, timeout=0.5) as resp:
            if resp.read() == b'dokkan-asset-server-ok':
                return
    except Exception:
        pass
    for attempt in range(5):
        try:
            httpd = ThreadedTCPServer(("", port), BGMHttpHandler)
            t = threading.Thread(target=httpd.serve_forever, daemon=True)
            t.start()
            sys._bgm_httpd = httpd
            return
        except Exception:
            time.sleep(0.5)

start_bgm_server_once()
