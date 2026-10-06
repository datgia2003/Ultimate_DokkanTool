# -*- coding: utf-8 -*-
"""
Module: eclp_builder.py
Chức năng:
1. Đóng gói các file mod (SQL patch, assets) thành file ZIP chuẩn 100% cấu trúc Dokkan Battle.
2. Gửi file ZIP lên API Dokkan Eclipse (POST https://dokkan-eclipse.com/convert/eclp).
3. Nhận phản hồi và tự động tải file .eclp về máy tính.
4. Quản lý cấu hình session cookie Dokkan Eclipse.
"""

import os
import json
import zipfile
import requests
from modules.core.lua_compat import native_animation_bytes

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "config.json")
PATCHES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "patches")
ECLP_CONVERT_URL = "https://dokkan-eclipse.com/convert/eclp"
ACCOUNT_URL = "https://dokkan-eclipse.com/account"
DEFAULT_USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"

# Các đuôi file rác/tạm không đưa vào patch game
IGNORE_EXTS = {'.meta', '.bak', '.tmp', '.cache', '.ds_store', '.git'}
IGNORE_NAMES = {'thumbs.db', '.ds_store', '__pycache__', '.git'}

def ensure_patches_dir():
    """Tạo thư mục patches nếu chưa tồn tại"""
    if not os.path.exists(PATCHES_DIR):
        os.makedirs(PATCHES_DIR, exist_ok=True)
    return PATCHES_DIR

def normalize_cookie(cookie_str):
    """
    Chuẩn hóa Cookie phiên đăng nhập Dokkan Eclipse (sử dụng cookie 'session')
    """
    if not cookie_str:
        return ""
    clean = cookie_str.strip()
    if "=" not in clean:
        return f"session={clean}"
    return clean

def load_config():
    """Đọc file cấu hình config.json"""
    default_config = {
        "dokkan_cookie": "",
        "default_authors": "",
        "default_version": "1.0.0",
        "include_db_as_both": False,
        "auto_download": True
    }
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                default_config.update(data)
        except Exception:
            pass
    return default_config

def save_config(new_config):
    """Lưu file cấu hình config.json"""
    current = load_config()
    current.update(new_config)
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump(current, f, indent=4, ensure_ascii=False)
        return True, "Đã lưu cấu hình thành công."
    except Exception as e:
        return False, f"Lỗi khi lưu cấu hình: {e}"

def check_cookie_status(cookie_str):
    """
    Kiểm tra xem Cookie Dokkan Eclipse (cookie 'session') có hợp lệ hay không.
    Gửi request kiểm tra tới trang /account.
    """
    if not cookie_str or not cookie_str.strip():
        return False, "Chưa nhập Cookie. Vui lòng dán Cookie từ trình duyệt."
    
    clean_cookie = normalize_cookie(cookie_str)
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Cookie": clean_cookie
    }
    
    try:
        resp = requests.get(ACCOUNT_URL, headers=headers, timeout=12)
        if resp.status_code == 200:
            if "Account Information" in resp.text or "Active ECLP Conversions" in resp.text:
                return True, "✅ Cookie hợp lệ! Đã xác thực thành công tài khoản Dokkan Eclipse."
            elif "Login with Discord" in resp.text:
                return False, "❌ Cookie không đúng hoặc đã hết hạn (web vẫn yêu cầu Login with Discord)."
            else:
                return True, "✅ Đã kết nối thành công với Dokkan Eclipse."
        else:
            return False, f"⚠️ Server trả về mã HTTP {resp.status_code}"
    except Exception as e:
        return False, f"⚠️ Không thể kết nối tới Dokkan Eclipse: {e}"

def find_card_assets(card_ids, base_res_dir=None, form_drafts=None):
    """
    Tìm kiếm các asset liên quan đến danh sách card_id trong game res/
    Tuân thủ 100% chuẩn cấu trúc cây thư mục của game Dokkan Battle:
    - character/card/{card_id}/
    - character/card_bg/{card_id}/
    - character/thumb/card_{card_id}_thumb/
    - lua/ab_script/{subdir}/{lua_file} (Các file LUA hoạt ảnh của thẻ hoặc được mod/transmuted)
    - bgm/bgm_{bgm_id}.awb (Các file BGM nhạc nền đi kèm chiêu thức)
    """
    import sqlite3
    if base_res_dir is None:
        base_res_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game res")
        
    items = []
    if not os.path.exists(base_res_dir):
        return items
        
    seen_paths = set()
    script_dirs = ["passive_skill_effect", "active_skill", "attack_sp", "finish_skill", "standby_skill", "revival"]
    
    # Kết nối DB để tra cứu chính xác các script và BGM mà card đang dùng
    db_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database_decrypted.db")
    card_scripts = set()
    card_bgms = set()
    if os.path.exists(db_path):
        try:
            from modules.core.mod_workspace import database_path
            conn = sqlite3.connect(database_path(db_path).resolve().as_uri() + "?mode=ro", uri=True)
            c = conn.cursor()
            for cid in card_ids:
                # 1. Entrance / Passive Effect
                c.execute("""
                    SELECT pse.script_name, pse.bgm_id
                    FROM cards cd
                    JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
                    JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
                    JOIN passive_skill_effects pse ON ps.passive_skill_effect_id = pse.id
                    WHERE cd.id = ?
                """, (cid,))
                for sname, bgm in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    if bgm and int(bgm) > 0: card_bgms.add(int(bgm))
                    
                # 2. Active Skill
                c.execute("""
                    SELECT sv.script_name, ass.bgm_id
                    FROM card_active_skills cas
                    JOIN active_skill_sets ass ON cas.active_skill_set_id = ass.id
                    JOIN special_views sv ON ass.special_view_id = sv.id
                    WHERE cas.card_id = ?
                """, (cid,))
                for sname, bgm in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    if bgm and int(bgm) > 0: card_bgms.add(int(bgm))
                    
                # 3. Super Attacks
                c.execute("""
                    SELECT sv.script_name
                    FROM card_specials cs
                    JOIN special_views sv ON sv.id IN (cs.view_id, cs.bonus_view_id1, cs.bonus_view_id2)
                    WHERE cs.card_id = ?
                """, (cid,))
                for sname, in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    
                # 4. Finish Skill
                c.execute("""
                    SELECT sv.script_name, fss.bgm_id
                    FROM card_finish_skill_set_relations cfsr
                    JOIN finish_skill_sets fss ON cfsr.finish_skill_set_id = fss.id
                    JOIN special_views sv ON fss.special_view_id = sv.id
                    WHERE cfsr.card_id = ?
                """, (cid,))
                for sname, bgm in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    if bgm and int(bgm) > 0: card_bgms.add(int(bgm))

                # 5. Standby Skill
                c.execute("""
                    SELECT sv.script_name, sss.bgm_id
                    FROM card_standby_skill_set_relations cssr
                    JOIN standby_skill_sets sss ON cssr.standby_skill_set_id = sss.id
                    LEFT JOIN special_views sv ON sss.special_view_id = sv.id
                    WHERE cssr.card_id = ?
                """, (cid,))
                for sname, bgm in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    if bgm and int(bgm) > 0: card_bgms.add(int(bgm))

                # 6. Revival
                c.execute("""
                    SELECT ps.eff_value3, rv.script_name
                    FROM cards cd
                    JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
                    JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
                    LEFT JOIN revival_views rv ON ps.eff_value2 = rv.id
                    WHERE cd.id = ? AND ps.efficacy_type = 109
                """, (cid,))
                for bgm, sname in c.fetchall():
                    if sname: card_scripts.add(sname.replace('.lua', '').strip().lower())
                    if bgm and int(bgm) > 0: card_bgms.add(int(bgm))

            # Include animation references from unsaved edits as well as DB rows.
            for draft in (form_drafts or {}).values():
                for attack in draft.get('card_specials', []):
                    for key in ('view_id', 'bonus_view_id1', 'bonus_view_id2'):
                        view_id = int(attack.get(key) or 0)
                        if view_id > 0:
                            row = c.execute('SELECT script_name FROM special_views WHERE id=?', (view_id,)).fetchone()
                            if row and row[0]:
                                card_scripts.add(row[0].removesuffix('.lua').strip().lower())
            conn.close()
        except Exception:
            pass

    for cid in card_ids:
        cid_str = str(cid)
        cids_to_check = [cid_str]
        if len(cid_str) >= 7 and cid_str.endswith("1"):
            cids_to_check.append(cid_str[:-1] + "0")
            
        for test_id in cids_to_check:
            # 1. Card art: character/card/{test_id}/
            card_p = os.path.join(base_res_dir, "card", test_id)
            if os.path.exists(card_p) and card_p not in seen_paths:
                seen_paths.add(card_p)
                items.append((card_p, f"character/card/{test_id}"))
                
            # 2. Card background animation (LWF): character/card_bg/{test_id}/
            card_bg_p = os.path.join(base_res_dir, "card_bg", test_id)
            if os.path.exists(card_bg_p) and card_bg_p not in seen_paths:
                seen_paths.add(card_bg_p)
                items.append((card_bg_p, f"character/card_bg/{test_id}"))
                
            # 3. Card thumbnail: character/thumb/card_{test_id}_thumb/
            thumb_name = f"card_{test_id}_thumb"
            thumb_p = os.path.join(base_res_dir, "thumb", thumb_name)
            if os.path.exists(thumb_p) and thumb_p not in seen_paths:
                seen_paths.add(thumb_p)
                items.append((thumb_p, f"character/thumb/{thumb_name}"))
                
            # 4. Quét các file LUA trong game res/ab_script/ có chứa card ID hoặc khớp script_name
            ab_dir = os.path.join(base_res_dir, "ab_script")
            if os.path.exists(ab_dir):
                for sdir in script_dirs:
                    sdir_p = os.path.join(ab_dir, sdir)
                    if os.path.exists(sdir_p):
                        for fname in os.listdir(sdir_p):
                            if fname.endswith(".lua"):
                                fpath = os.path.join(sdir_p, fname)
                                fstem = os.path.splitext(fname)[0].lower()
                                if (test_id in fname or fstem in card_scripts) and fpath not in seen_paths:
                                    seen_paths.add(fpath)
                                    items.append((fpath, f"lua/ab_script/{sdir}/{fname}"))

    # Stock BGM remains a game resource. EX options reference it through bgm_id;
    # exporting a selected stock track does not require bundling its sound bank.
    return items

def resolve_extra_assets(extra_dir):
    """
    Chuẩn hóa cấu trúc thư mục người dùng nhập bổ sung.
    Đảm bảo đặt đúng vào character/, lua/, bgm/, se/, voice/, movie/...
    """
    if not extra_dir or not os.path.exists(extra_dir):
        return []
    
    extra_dir = os.path.abspath(extra_dir)
    dir_name = os.path.basename(extra_dir).lower()
    
    # Kiểm tra xem bên trong có các thư mục gốc của Dokkan không
    subdirs = [d.lower() for d in os.listdir(extra_dir) if os.path.isdir(os.path.join(extra_dir, d))]
    dokkan_standard_roots = {'character', 'lua', 'bgm', 'se', 'voice', 'movie', 'card', 'card_bg', 'thumb', 'ab_script'}
    
    if any(s in dokkan_standard_roots for s in subdirs):
        items = []
        for item in os.listdir(extra_dir):
            item_p = os.path.join(extra_dir, item)
            item_lower = item.lower()
            if item_lower == 'card':
                items.append((item_p, "character/card"))
            elif item_lower == 'card_bg':
                items.append((item_p, "character/card_bg"))
            elif item_lower == 'thumb':
                items.append((item_p, "character/thumb"))
            elif item_lower == 'ab_script':
                items.append((item_p, "lua/ab_script"))
            else:
                items.append((item_p, item))
        return items
        
    if dir_name in ['card', 'cards']:
        return [(extra_dir, "character/card")]
    elif dir_name in ['card_bg']:
        return [(extra_dir, "character/card_bg")]
    elif dir_name in ['thumb', 'thumbs']:
        return [(extra_dir, "character/thumb")]
    elif dir_name in ['ab_script']:
        return [(extra_dir, "lua/ab_script")]
    elif dir_name in ['character', 'lua', 'bgm', 'se', 'voice', 'movie']:
        return [(extra_dir, dir_name)]
    else:
        return [(extra_dir, "")]

def create_metadata_dict(patch_name, patch_version="1.0.0", description="", authors="dat", uuid=None, apk_version="5.22.1", patch_tags=None, patch_types=None):
    """
    Tạo cấu trúc metadata.json chuẩn 100% giống LR PHY SSJ2 Gohan (Youth).
    UUID tối đa 4 chữ số (1000 - 9999) để tương thích với in-game mod loader.
    """
    import random
    final_uuid = None
    if uuid is not None and str(uuid).strip():
        try:
            val = int(str(uuid).strip())
            if 0 < val <= 9999:
                final_uuid = val
            else:
                final_uuid = (val % 9000) + 1000
        except ValueError:
            try:
                import hashlib
                final_uuid = (int(hashlib.md5(str(uuid).encode('utf-8')).hexdigest()[:4], 16) % 9000) + 1000
            except Exception:
                final_uuid = random.randint(1000, 9999)
    else:
        final_uuid = random.randint(1000, 9999)

    if isinstance(authors, list):
        author_list = [str(a).strip() for a in authors if str(a).strip()]
    elif isinstance(authors, str) and authors.strip():
        author_list = [a.strip() for a in authors.split(",") if a.strip()]
    else:
        author_list = ["dat"]
    if not author_list:
        author_list = ["dat"]

    if patch_tags is None:
        patch_tags = ["EZA"]
    elif isinstance(patch_tags, str):
        patch_tags = [t.strip() for t in patch_tags.split(",") if t.strip()]

    if patch_types is None:
        patch_types = ["EZA"]
    elif isinstance(patch_types, str):
        patch_types = [t.strip() for t in patch_types.split(",") if t.strip()]

    return {
        "Name": patch_name or "Custom Patch",
        "Description": description or f"ReWork {patch_name}",
        "UUID": final_uuid,
        "Authors": author_list,
        "Whitelist": [],
        "Blacklist": [],
        "Power Level": 0,
        "Dependencies": [],
        "Priority": 99,
        "Mode": 7,
        "APK Version": apk_version or "5.22.1",
        "Patch Tags": patch_tags,
        "Patch Types": patch_types
    }

def preview_patch_entries(items_to_pack, sql_content=None, metadata_dict=None, sql_filename=None):
    """
    Xem trước danh sách toàn bộ các file và đường dẫn tương ứng bên trong file Patch ZIP.
    Chuẩn cấu trúc 100% LR PHY SSJ2 Gohan (Youth):
    - metadata.json ở root
    - files/<name>.sql
    - files/lua/ab_script/...
    - files/character/...
    """
    entries = []
    if metadata_dict:
        meta_bytes = json.dumps(metadata_dict, indent=4, ensure_ascii=False).encode("utf-8")
        entries.append({
            "path": "metadata.json",
            "size_kb": len(meta_bytes) / 1024,
            "type": "Metadata JSON",
            "source": "Mod Config & Info"
        })
    if sql_content:
        sname = sql_filename or "patch.sql"
        if not sname.endswith(".sql"):
            sname += ".sql"
        if not sname.startswith("files/"):
            sname = f"files/{sname}"
        entries.append({
            "path": sname,
            "size_kb": len(sql_content.encode("utf-8")) / 1024,
            "type": "SQL Script",
            "source": "Generated Patch SQL"
        })
    for src_path, arcname in items_to_pack:
        if not os.path.exists(src_path):
            continue
        base_arc = arcname.replace("\\", "/").strip("/")
        if not base_arc.startswith("files/"):
            target_prefix = f"files/{base_arc}" if base_arc else "files"
        else:
            target_prefix = base_arc

        if os.path.isfile(src_path):
            fname = os.path.basename(src_path).lower()
            _, ext = os.path.splitext(fname)
            if ext in IGNORE_EXTS or fname in IGNORE_NAMES:
                continue
            entries.append({
                "path": target_prefix,
                "size_kb": os.path.getsize(src_path) / 1024,
                "type": "File",
                "source": src_path
            })
        elif os.path.isdir(src_path):
            for root, dirs, files in os.walk(src_path):
                dirs[:] = [d for d in dirs if d.lower() not in IGNORE_NAMES]
                for file in files:
                    fname_lower = file.lower()
                    _, ext = os.path.splitext(fname_lower)
                    if ext in IGNORE_EXTS or fname_lower in IGNORE_NAMES:
                        continue
                    if ext in {'.wav', '.mp4'} and any(k in root.lower() for k in ['bgm', 'movies', 'audio']):
                        continue
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, src_path).replace("\\", "/")
                    zip_entry_name = f"{target_prefix}/{rel_path}".replace("\\", "/")
                    entries.append({
                        "path": zip_entry_name,
                        "size_kb": os.path.getsize(file_path) / 1024,
                        "type": "Asset",
                        "source": file_path
                    })
    return entries

def build_patch_zip(output_zip_path, items_to_pack, sql_content=None, metadata_dict=None, sql_filename=None, progress_callback=None):
    """
    Đóng gói các file/thư mục thành file ZIP chuẩn cấu trúc Dokkan Battle (LR PHY SSJ2 Gohan Youth):
    - metadata.json ở thư mục gốc
    - files/ chứa file SQL patch và toàn bộ assets (lua/, character/...)
    """
    os.makedirs(os.path.dirname(output_zip_path), exist_ok=True)
    if not sql_filename:
        sql_filename = "patch.sql"
    if not sql_filename.endswith(".sql"):
        sql_filename += ".sql"

    # Thu thập danh sách toàn bộ file cần đóng gói để tính % chính xác
    files_to_compress = []
    if metadata_dict:
        files_to_compress.append(("str", "metadata.json", json.dumps(metadata_dict, indent=4, ensure_ascii=False).encode("utf-8")))
    if sql_content:
        sql_entry_name = f"files/{sql_filename}" if not sql_filename.startswith("files/") else sql_filename
        files_to_compress.append(("str", sql_entry_name, sql_content.encode("utf-8")))

    for src_path, arcname in items_to_pack:
        if not os.path.exists(src_path):
            continue
        base_arc = arcname.replace("\\", "/").strip("/")
        target_prefix = base_arc if base_arc.startswith("files/") else (f"files/{base_arc}" if base_arc else "files")

        if os.path.isfile(src_path):
            fname = os.path.basename(src_path).lower()
            _, ext = os.path.splitext(fname)
            if ext in IGNORE_EXTS or fname in IGNORE_NAMES:
                continue
            files_to_compress.append(("file", target_prefix, src_path))
        elif os.path.isdir(src_path):
            for root, dirs, files in os.walk(src_path):
                dirs[:] = [d for d in dirs if d.lower() not in IGNORE_NAMES]
                for file in files:
                    fname_lower = file.lower()
                    _, ext = os.path.splitext(fname_lower)
                    if ext in IGNORE_EXTS or fname_lower in IGNORE_NAMES:
                        continue
                    if ext in {'.wav', '.mp4'} and any(k in root.lower() for k in ['bgm', 'movies', 'audio']):
                        continue
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, src_path).replace("\\", "/")
                    zip_entry_name = f"{target_prefix}/{rel_path}".replace("\\", "/")
                    files_to_compress.append(("file", zip_entry_name, file_path))

    # Resolve directory/file overlaps to one final entry per archive path.
    files_to_compress = list({item[1]: item for item in files_to_compress}.values())
    total_files = len(files_to_compress)

    with zipfile.ZipFile(output_zip_path, 'w', compression=zipfile.ZIP_DEFLATED) as zf:
        for idx, item in enumerate(files_to_compress, 1):
            kind = item[0]
            arc_name = item[1]
            if kind == "str":
                zf.writestr(arc_name, item[2])
            elif arc_name.startswith('files/lua/ab_script/') and arc_name.endswith('.lua'):
                with open(item[2], 'rb') as lua_file:
                    zf.writestr(arc_name, native_animation_bytes(lua_file.read(), arc_name))
            else:
                zf.write(item[2], arc_name)
            if progress_callback:
                progress_callback(idx, total_files, os.path.basename(arc_name))

    file_size_mb = os.path.getsize(output_zip_path) / (1024 * 1024)
    return output_zip_path, file_size_mb

def build_patch_folder(output_dir_path, items_to_pack, sql_content=None, metadata_dict=None, sql_filename=None):
    """
    Xuất trực tiếp thư mục patch chuẩn Dokkan Battle (metadata.json + files/) ra ổ cứng.
    Giống y hệt cấu trúc thư mục LR PHY SSJ2 Gohan (Youth) để người dùng có thể
    dùng ngay với ECLP File Builder.exe hoặc copy vào mod loader.
    """
    import shutil
    os.makedirs(output_dir_path, exist_ok=True)
    files_dir = os.path.join(output_dir_path, "files")
    os.makedirs(files_dir, exist_ok=True)

    if not sql_filename:
        sql_filename = "patch.sql"
    if not sql_filename.endswith(".sql"):
        sql_filename += ".sql"

    # 1. metadata.json ở root
    if metadata_dict:
        meta_path = os.path.join(output_dir_path, "metadata.json")
        with open(meta_path, "w", encoding="utf-8") as f:
            json.dump(metadata_dict, f, indent=4, ensure_ascii=False)

    # 2. File SQL patch trong files/
    if sql_content:
        sql_path = os.path.join(files_dir, sql_filename)
        with open(sql_path, "w", encoding="utf-8") as f:
            f.write(sql_content)

    # 3. Tất cả assets đưa vào files/
    for src_path, arcname in items_to_pack:
        if not os.path.exists(src_path):
            continue
        base_arc = arcname.replace("\\", "/").strip("/")
        if base_arc.startswith("files/"):
            base_arc = base_arc[len("files/"):]
        target_dir = os.path.join(files_dir, base_arc.replace("/", os.sep))

        if os.path.isfile(src_path):
            fname = os.path.basename(src_path).lower()
            _, ext = os.path.splitext(fname)
            if ext in IGNORE_EXTS or fname in IGNORE_NAMES:
                continue
            os.makedirs(os.path.dirname(target_dir), exist_ok=True)
            shutil.copy2(src_path, target_dir)
        elif os.path.isdir(src_path):
            for root, dirs, files in os.walk(src_path):
                dirs[:] = [d for d in dirs if d.lower() not in IGNORE_NAMES]
                for file in files:
                    fname_lower = file.lower()
                    _, ext = os.path.splitext(fname_lower)
                    if ext in IGNORE_EXTS or fname_lower in IGNORE_NAMES:
                        continue
                    if ext in {'.wav', '.mp4'} and any(k in root.lower() for k in ['bgm', 'movies', 'audio']):
                        continue
                    file_path = os.path.join(root, file)
                    rel_path = os.path.relpath(file_path, src_path)
                    dest_file_path = os.path.join(target_dir, rel_path)
                    os.makedirs(os.path.dirname(dest_file_path), exist_ok=True)
                    shutil.copy2(file_path, dest_file_path)

    return output_dir_path

def convert_zip_to_eclp(zip_path, metadata, cookie_str):
    """
    Gửi file ZIP lên Dokkan Eclipse endpoint /convert/eclp.
    metadata: dict {'patchName'|'Name', 'version'|'APK Version', 'description'|'Description', 'authors'|'Authors', 'uuid'|'UUID'}
    Trả về: (success: bool, data_or_error_msg)
    """
    if not os.path.exists(zip_path):
        return False, f"File ZIP không tồn tại: {zip_path}"

    clean_cookie = normalize_cookie(cookie_str)
    headers = {
        "User-Agent": DEFAULT_USER_AGENT,
        "Cookie": clean_cookie
    }

    authors_val = metadata.get("authors") or metadata.get("Authors") or ""
    if isinstance(authors_val, list):
        authors_val = ", ".join(authors_val)

    raw_uuid = str(metadata.get("uuid") or metadata.get("UUID") or "").strip()
    if raw_uuid.isdigit():
        val = int(raw_uuid)
        final_eclp_uuid = str(val if 0 < val <= 9999 else (val % 9000) + 1000)
    elif raw_uuid:
        import hashlib
        final_eclp_uuid = str((int(hashlib.md5(raw_uuid.encode('utf-8')).hexdigest()[:4], 16) % 9000) + 1000)
    else:
        import random
        final_eclp_uuid = str(random.randint(1000, 9999))

    data = {
        "patchName": str(metadata.get("patchName") or metadata.get("Name") or "Custom Patch"),
        "version": str(metadata.get("version") or metadata.get("APK Version") or "1.0.0"),
        "description": str(metadata.get("description") or metadata.get("Description") or ""),
        "authors": str(authors_val),
        "uuid": final_eclp_uuid
    }
    
    try:
        with open(zip_path, "rb") as f:
            files = {
                "file": (os.path.basename(zip_path), f, "application/zip")
            }
            resp = requests.post(ECLP_CONVERT_URL, headers=headers, data=data, files=files, timeout=120)
            
        if resp.status_code == 401:
            return False, "❌ Server từ chối (401 Unauthorized): Vui lòng đăng nhập và kiểm tra lại Cookie."
            
        try:
            result = resp.json()
        except Exception:
            result = None
            
        if not resp.ok or not result:
            err_msg = result.get("error") if (result and isinstance(result, dict)) else f"HTTP {resp.status_code}: {resp.text[:200]}"
            return False, f"❌ Lỗi khi convert: {err_msg}"
            
        if "error" in result:
            return False, f"❌ Server báo lỗi: {result['error']}"
            
        return True, result
        
    except requests.exceptions.Timeout:
        return False, "❌ Quá thời gian chờ phản hồi (Timeout). Vui lòng thử lại sau."
    except Exception as e:
        return False, f"❌ Lỗi kết nối: {e}"

def download_eclp_file(download_url, output_dir, custom_file_name=None, cookie_str=None, progress_callback=None):
    """
    Tải file .eclp từ URL được trả về về máy tính với cơ chế Streaming Chunks và callback tiến độ.
    """
    os.makedirs(output_dir, exist_ok=True)
    
    if download_url.startswith("/"):
        full_url = f"https://dokkan-eclipse.com{download_url}"
    else:
        full_url = download_url
        
    headers = {"User-Agent": DEFAULT_USER_AGENT}
    if cookie_str:
        headers["Cookie"] = normalize_cookie(cookie_str)
        
    try:
        resp = requests.get(full_url, headers=headers, stream=True, timeout=120)
        resp.raise_for_status()
        
        total_len = int(resp.headers.get("Content-Length", 0) or 0)
        
        if not custom_file_name:
            content_disp = resp.headers.get("Content-Disposition", "")
            if "filename=" in content_disp:
                custom_file_name = content_disp.split("filename=")[-1].strip('"\' ')
            else:
                custom_file_name = os.path.basename(full_url.split("?")[0])
                
        if not custom_file_name or not custom_file_name.endswith(".eclp"):
            custom_file_name = "patch.eclp"
            
        target_path = os.path.join(output_dir, custom_file_name)
        downloaded = 0
        with open(target_path, "wb") as f:
            for chunk in resp.iter_content(chunk_size=65536):
                if chunk:
                    f.write(chunk)
                    downloaded += len(chunk)
                    if progress_callback:
                        progress_callback(downloaded, total_len)
                    
        file_size_kb = os.path.getsize(target_path) / 1024
        return True, target_path, file_size_kb
    except Exception as e:
        return False, f"Lỗi khi tải file .eclp: {e}", 0
