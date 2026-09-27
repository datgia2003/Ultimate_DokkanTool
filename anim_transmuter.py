# -*- coding: utf-8 -*-
"""
Module: anim_transmuter.py
Chức năng:
1. Trích xuất toàn bộ hoạt ảnh của thẻ nhân vật (Entrance, Active, Super 12Ki/18Ki, Finish, Standby).
2. Đọc mã LUA từ máy hoặc tải tự động từ CDN Dokkan Eclipse nếu chưa có.
3. Chuyển đổi và nhân bản hoạt ảnh giữa các loại chiêu thức (ví dụ: Active Skill -> Entrance).
4. Sinh SQL patch từ database chỉ đọc; không ghi dữ liệu mod vào database gốc.
"""

import os
import re
import json
import sqlite3
import requests
import datetime
import subprocess
import threading
from modules.core.mod_workspace import database_path, imported_asset

DB_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "database_decrypted.db")
BASE_RES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "game res")
CDN_LUA_BASE = "https://cdn.dokkan-eclipse.com/uncompressed/lua/ab_script"
CDN_BGM_BASE = "https://cdn.dokkan-eclipse.com/uncompressed/bgm"
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36"
_reserved_animation_ids = {"passive_skill_effects": set(), "special_views": set()}
_animation_id_lock = threading.Lock()

# Cấu hình thư mục và tiền tố theo từng slot đích
SLOT_CONFIG = {
    "entrance": {
        "label": "Hoạt ảnh Xuất trận (Entrance Animation)",
        "folder": "passive_skill_effect",
        "prefix": "pse_",
        "target_table": "passive_skill_effects"
    },
    "active": {
        "label": "Hoạt ảnh Kỹ năng chủ động (Active Skill)",
        "folder": "active_skill",
        "prefix": "bs_",
        "target_table": "active_skill_sets"
    },
    "super": {
        "label": "Hoạt ảnh Siêu tất sát (Super Attack)",
        "folder": "attack_sp",
        "prefix": "sp_",
        "target_table": "card_specials"
    },
    "finish": {
        "label": "Hoạt ảnh Đòn kết liễu (Finish Skill)",
        "folder": "finish_skill",
        "prefix": "fi_",
        "target_table": "finish_skill_sets"
    }
}

def get_db_connection():
    return sqlite3.connect(database_path(DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)

def search_cards(query, limit=20):
    """Tìm kiếm thẻ theo tên hoặc ID cho dropdown chọn thẻ nguồn"""
    if not query:
        return []
    try:
        conn = get_db_connection()
        c = conn.cursor()
        q = f"%{str(query).strip()}%"
        c.execute("""
            SELECT id, name, rarity, element 
            FROM cards 
            WHERE id LIKE ? OR name LIKE ? 
            ORDER BY (CASE WHEN id = ? THEN 0 ELSE 1 END), (CASE WHEN id < 5000000 THEN 0 ELSE 1 END), rarity DESC, id DESC 
            LIMIT ?
        """, (q, q, int(str(query).strip()) if str(query).strip().isdigit() else -1, limit))
        rows = c.fetchall()
        conn.close()
        return [{"id": r[0], "name": r[1] or "Unknown", "rarity": r[2], "element": r[3]} for r in rows]
    except Exception:
        return []

def get_all_cards_for_select():
    """Lấy danh sách tất cả các thẻ để hiển thị trên dropdown tìm kiếm"""
    try:
        conn = get_db_connection()
        c = conn.cursor()
        c.execute("SELECT id, name FROM cards ORDER BY id DESC")
        rows = c.fetchall()
        conn.close()
        return [(r[0], f"{r[0]} - {r[1] or 'Unknown'}") for r in rows]
    except Exception:
        return []

def strip_damage_calls(lua_content: str):
    """
    Tự động comment out các lệnh dealDamage(...) và setDamage(...) 
    để hoạt ảnh khi chuyển sang Entrance (hoặc cutscene phi chiến đấu) 
    không trừ máu đối thủ, không gây rung lắc camera và không bị crash 
    game khi chưa có mục tiêu (enemy) xuất hiện lúc đầu trận.
    """
    deal_count = 0
    shake_count = 0
    
    def repl_deal(match):
        nonlocal deal_count
        deal_count += 1
        indent = match.group(1)
        deal_call = match.group(2)
        trailing = match.group(3)
        return f"{indent}-- [Entrance Cutscene: Damage Stripped] {deal_call}{trailing}"
        
    def repl_shake(match):
        nonlocal shake_count
        shake_count += 1
        indent = match.group(1)
        shake_call = match.group(2)
        trailing = match.group(3)
        return f"{indent}-- [Entrance Cutscene: Shake Stripped] {shake_call}{trailing}"

    res = re.sub(r"^([ \t]*)(dealDamage\s*\(.*?\);?)(.*)$", repl_deal, lua_content, flags=re.MULTILINE)
    res = re.sub(r"^([ \t]*)(setDamage\s*\(.*?\);?)(.*)$", repl_shake, res, flags=re.MULTILINE)
    return res, deal_count, shake_count

def get_sub_card_animations(sub_cid, sub_name, conn):
    """Trích xuất các hoạt ảnh của dạng biến hình liên kết (Transformed Card)"""
    sub_anims = []
    try:
        c = conn.cursor()
        # Super Attacks của dạng biến hình
        c.execute("""
            SELECT cs.id, ss.name as sp_name, cs.style, cs.view_id, sv.script_name
            FROM card_specials cs
            LEFT JOIN special_sets ss ON cs.special_set_id = ss.id
            LEFT JOIN special_views sv ON cs.view_id = sv.id
            WHERE cs.card_id = ?
            ORDER BY cs.eball_num_start ASC, cs.priority ASC
        """, (sub_cid,))
        for i, row in enumerate(c.fetchall()):
            cs_id, sp_name, style, sv_id, script_name = row
            s_clean = (script_name or f"sp{sv_id:04d}").replace(".lua", "") if (script_name or sv_id) else ""
            if s_clean:
                label = "Super Attack (12 Ki)" if style == "Normal" or i == 0 else "Ultra Super Attack (18 Ki)"
                sub_anims.append({
                    "type": f"Transformed [{sub_cid}] {label}",
                    "type_key": "super",
                    "folder": "attack_sp",
                    "name": f"({sub_name}) {sp_name or label}",
                    "script_name": s_clean,
                    "special_view_id": sv_id,
                    "card_special_id": cs_id,
                    "bgm_id": None
                })
        # Actives của dạng biến hình
        c.execute("""
            SELECT cas.id, ass.id as set_id, ass.name as act_name, ass.special_view_id, ass.bgm_id, sv.script_name
            FROM card_active_skills cas
            JOIN active_skill_sets ass ON cas.active_skill_set_id = ass.id
            LEFT JOIN special_views sv ON ass.special_view_id = sv.id
            WHERE cas.card_id = ?
        """, (sub_cid,))
        for row in c.fetchall():
            cas_id, set_id, act_name, sv_id, bgm_id, script_name = row
            s_clean = (script_name or f"bs{sv_id:04d}").replace(".lua", "") if (script_name or sv_id) else ""
            if s_clean:
                sub_anims.append({
                    "type": f"Transformed [{sub_cid}] Active Skill",
                    "type_key": "active",
                    "folder": "active_skill",
                    "name": f"({sub_name}) {act_name or 'Active Skill'}",
                    "script_name": s_clean,
                    "special_view_id": sv_id,
                    "set_id": set_id,
                    "bgm_id": bgm_id
                })
    except Exception as e:
        print(f"Error extracting sub animations for {sub_cid}: {e}")
    return sub_anims

def get_card_animations(card_id):
    """
    Quét và trích xuất danh sách tất cả hoạt ảnh của một thẻ nhân vật:
    1. Entrance / Xuất trận (passive_skill_effects)
    2. Active Skill & Biến hình chủ động (active_skill_sets -> special_views)
    3. Super Attacks 12Ki / 18Ki (card_specials -> special_views)
    4. Standby Skills (standby_skill_sets -> special_views)
    5. Finish Skills (finish_skill_sets -> special_views)
    6. Revival Cutscenes / Hoạt ảnh Hồi sinh (passive_skills eff=109 -> revival_views -> effect_packs + OST)
    7. Passive Transformations / Biến hình nội tại (passive_skills eff=79,103 -> battle_params -> effect_packs + OST)
    8. Toàn bộ hoạt ảnh từ Dạng biến hình liên kết (Transformed Cards)
    9. Counter / Nullify / Absorb (eff=120 -> attack_counter/cXXXX.lua;
       eff=119,97 -> ab_sys/asXXXX.lua)
    """
    anims = []
    conn = None
    try:
        conn = get_db_connection()
        c = conn.cursor()
        
        # 1. Entrance / Passive Skill Effects
        c.execute("""
            SELECT ps.id as ps_id, ps.name as ps_name, ps.passive_skill_effect_id,
                   pse.script_name, pse.bgm_id
            FROM cards cd
            JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            LEFT JOIN passive_skill_effects pse ON ps.passive_skill_effect_id = pse.id
            WHERE cd.id = ? AND ps.passive_skill_effect_id IS NOT NULL AND ps.passive_skill_effect_id > 0
        """, (card_id,))
        seen_pse = set()
        for row in c.fetchall():
            ps_id, ps_name, pse_id, script_name, bgm_id = row
            if pse_id not in seen_pse:
                seen_pse.add(pse_id)
                anims.append({
                    "type": "Entrance / Passive Effect",
                    "type_key": "entrance",
                    "folder": "passive_skill_effect",
                    "name": ps_name or f"Entrance Effect #{pse_id}",
                    "script_name": (script_name or f"pse{pse_id:04d}").replace(".lua", ""),
                    "effect_id": pse_id,
                    "bgm_id": bgm_id
                })
            
        # 2. Active Skill (bao gồm cả Active Transformation)
        c.execute("""
            SELECT cas.id, ass.id as set_id, ass.name as act_name, ass.special_view_id, ass.bgm_id,
                   sv.script_name
            FROM card_active_skills cas
            JOIN active_skill_sets ass ON cas.active_skill_set_id = ass.id
            LEFT JOIN special_views sv ON ass.special_view_id = sv.id
            WHERE cas.card_id = ?
        """, (card_id,))
        for row in c.fetchall():
            cas_id, set_id, act_name, sv_id, bgm_id, script_name = row
            s_name = (script_name or f"bs{sv_id:04d}").replace(".lua", "")
            is_tf = s_name.startswith("tf") or any(k in (act_name or "").lower() for k in ["transform", "fusion", "potara", "exchange"])
            anims.append({
                "type": "Active Transformation" if is_tf else "Active Skill",
                "type_key": "active",
                "folder": "active_skill",
                "name": act_name or "Active Skill",
                "script_name": s_name,
                "special_view_id": sv_id,
                "set_id": set_id,
                "bgm_id": bgm_id
            })
            
        # 3. Super Attacks
        from modules.core.animation_lookup import super_attack_tag
        c.execute("""
            SELECT cs.id, ss.name as sp_name, cs.style, cs.view_id,
                   sv.script_name, cs.eball_num_start,
                   EXISTS(SELECT 1 FROM extra_special_options e WHERE e.card_special_id=cs.id),
                   (SELECT e.bgm_id FROM extra_special_options e WHERE e.card_special_id=cs.id LIMIT 1)
            FROM card_specials cs
            LEFT JOIN special_sets ss ON cs.special_set_id = ss.id
            LEFT JOIN special_views sv ON cs.view_id = sv.id
            WHERE cs.card_id = ?
            ORDER BY cs.eball_num_start ASC, cs.priority ASC, cs.id ASC
        """, (card_id,))
        for i, row in enumerate(c.fetchall()):
            cs_id, sp_name, style, sv_id, script_name, ki, has_extra, bgm_id = row
            if not sv_id:
                continue
            tag = super_attack_tag(style, ki, has_extra)
            label = f"{tag} ({ki or 0} Ki)"
            anims.append({
                "type": label,
                "move_tag": tag,
                "type_key": "super",
                "folder": "attack_sp",
                "name": sp_name or label,
                "script_name": (script_name or f"sp{sv_id:04d}").replace(".lua", ""),
                "special_view_id": sv_id,
                "card_special_id": cs_id,
                "bgm_id": bgm_id
            })

        for bonus_number in (1, 2):
            c.execute(f"""
                SELECT cs.id, ss.name, b.name, sv.id, sv.script_name
                FROM card_specials cs
                LEFT JOIN special_sets ss ON ss.id=cs.special_set_id
                LEFT JOIN special_bonuses b ON b.id=cs.special_bonus_id{bonus_number}
                JOIN special_views sv ON sv.id=cs.bonus_view_id{bonus_number}
                WHERE cs.card_id=? ORDER BY cs.eball_num_start, cs.priority, cs.id
            """, (card_id,))
            for cs_id, sp_name, bonus_name, sv_id, script_name in c.fetchall():
                anims.append({
                    "type": f"Super Attack · Bonus {bonus_number}",
                    "move_tag": f"Bonus {bonus_number}", "type_key": "super", "folder": "attack_sp",
                    "name": f"{sp_name or 'Super Attack'} · {bonus_name or f'Bonus {bonus_number}'}",
                    "script_name": (script_name or f"sp{sv_id:04d}").replace(".lua", ""),
                    "special_view_id": sv_id, "card_special_id": cs_id, "bgm_id": None,
                })

        # 4. Standby Skills
        c.execute("""
            SELECT cssr.id, sss.id, sss.name, sss.special_view_id, sss.bgm_id, sv.script_name
            FROM card_standby_skill_set_relations cssr
            JOIN standby_skill_sets sss ON cssr.standby_skill_set_id = sss.id
            LEFT JOIN special_views sv ON sss.special_view_id = sv.id
            WHERE cssr.card_id = ?
        """, (card_id,))
        for row in c.fetchall():
            cssr_id, sss_id, stb_name, sv_id, bgm_id, script_name = row
            anims.append({
                "type": "Standby Skill",
                "type_key": "standby",
                "folder": "standby_skill",
                "name": stb_name or "Standby Skill",
                "script_name": (script_name or f"stb{sv_id:04d}").replace(".lua", ""),
                "special_view_id": sv_id,
                "bgm_id": bgm_id
            })
            
        # 5. Finish Skill
        c.execute("""
            SELECT cfsr.id, fss.name, fss.special_view_id, fss.bgm_id, sv.script_name
            FROM card_finish_skill_set_relations cfsr
            JOIN finish_skill_sets fss ON cfsr.finish_skill_set_id = fss.id
            LEFT JOIN special_views sv ON fss.special_view_id = sv.id
            WHERE cfsr.card_id = ?
        """, (card_id,))
        for row in c.fetchall():
            cfsr_id, fss_name, sv_id, bgm_id, script_name = row
            anims.append({
                "type": "Finish Skill",
                "type_key": "finish",
                "folder": "finish_skill",
                "name": fss_name or "Finish Skill",
                "script_name": (script_name or f"fi{sv_id:04d}").replace(".lua", ""),
                "special_view_id": sv_id,
                "bgm_id": bgm_id
            })

        # 6. Revival Cutscenes (Hoạt ảnh Hồi sinh)
        c.execute("""
            SELECT ps.id, ps.name, ps.eff_value1, ps.eff_value2, ps.eff_value3
            FROM cards cd
            JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            WHERE cd.id = ? AND ps.efficacy_type = 109
        """, (card_id,))
        for row in c.fetchall():
            ps_id, ps_name, hp_heal, rv_id, bgm_id = row
            c.execute("""
                SELECT rv.id, rv.effect_pack_id, rv.script_name, ep.name, ep.pack_name
                FROM revival_views rv
                LEFT JOIN effect_packs ep ON rv.effect_pack_id = ep.id
                WHERE rv.id = ?
            """, (rv_id,))
            rv_row = c.fetchone()
            if rv_row:
                ep_id = rv_row[1]
                ep_name = rv_row[3] or f"Revival #{rv_id}"
                pack_name = rv_row[4] or ""
                script_name = rv_row[2] or ""
                folder = "revival" if script_name else "preview_fx"
                
                # Generate only when the player requests this script. Listing
                # animations must not decode/download every effect pack.
                if not script_name and ep_id:
                    script_name = f"fx_{int(ep_id)}"
                    folder = "preview_fx"
                    
                anims.append({
                    "type": "Revival Cutscene",
                    "type_key": "revival",
                    "folder": folder,
                    "name": f"Hồi sinh: {ep_name}",
                    "script_name": script_name.replace(".lua", "") if script_name else "",
                    "pack_name": pack_name,
                    "effect_pack_id": ep_id,
                    "bgm_id": bgm_id if (bgm_id and bgm_id > 0) else None,
                    "heal_pct": hp_heal,
                    "revival_view_id": rv_id
                })

        # 7. Passive Transformations (Biến hình nội tại qua battle_params)
        c.execute("""
            SELECT ps.id, ps.name, ps.efficacy_type, ps.exec_game_type,
                   ps.eff_value1, ps.eff_value2, ps.eff_value3
            FROM cards cd
            JOIN passive_skill_set_relations pssr ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            WHERE cd.id = ? AND ps.efficacy_type IN (79, 103)
        """, (card_id,))
        seen_targets = set()
        seen_transformations = set()
        for row in c.fetchall():
            ps_id, ps_name, eff_type, exec_game_type, target_cid, p2, p3 = row
            # The same form change can have separate battle-mode conditions
            # (exec_game_type 1 and 2). They are one transformation animation.
            transform_key = (target_cid, p2, p3)
            if transform_key in seen_transformations:
                continue
            seen_transformations.add(transform_key)
            eff_pack_id = None
            eff_pack_name = None
            pack_code = None
            bgm_id = None
            has_battle_params = False
            for p in (p2, p3):
                if p and p > 0:
                    c.execute("SELECT idx, value FROM battle_params WHERE param_no = ?", (p,))
                    bp_rows = c.fetchall()
                    has_battle_params |= bool(bp_rows)
                    bp = dict(bp_rows)
                    if bp.get(1) and bp.get(1) > 10:
                        eff_pack_id = bp.get(1)
                        c.execute("SELECT id, name, pack_name FROM effect_packs WHERE id = ?", (eff_pack_id,))
                        ep_r = c.fetchone()
                        if ep_r:
                            eff_pack_name = ep_r[1]
                            pack_code = ep_r[2]
                        bgm_id = bp.get(8)
                        break
                    elif bp.get(8) and not bgm_id:
                        bgm_id = bp.get(8)

            script_name = ""
            folder = "preview_fx"

            # Only infer an animation when no battle_params record exists.
            if not eff_pack_id and not has_battle_params:
                # 1. Check passive_skill_effects
                c.execute("""
                    SELECT id, script_name, bgm_id FROM passive_skill_effects
                    WHERE id IN (?, ?) OR script_name LIKE ? OR script_name LIKE ?
                """, (card_id, target_cid, f"%{card_id}%", f"%{target_cid}%"))
                pse_r = c.fetchone()
                if pse_r and pse_r[1]:
                    script_name = pse_r[1]
                    if not bgm_id and pse_r[2]:
                        bgm_id = pse_r[2]
                    folder = "preview_fx" if "fx_" in script_name else "passive_skill_effect"
                else:
                    # 2. Look up target character's name to find corresponding entrance / transformation pack
                    if target_cid:
                        c.execute("""
                            SELECT ch.name, cd.rarity FROM cards cd
                            JOIN characters ch ON cd.character_id = ch.id
                            WHERE cd.id = ?
                        """, (target_cid,))
                        ch_r = c.fetchone()
                        ch_name = ch_r[0] if ch_r else ""
                        t_rarity = ch_r[1] if ch_r else 0
                        prefix = "LR_" if t_rarity == 5 else ("UR_" if t_rarity == 4 else "")
                        ep_m = None
                        if ch_name:
                            if prefix:
                                c.execute("""
                                    SELECT id, name, pack_name FROM effect_packs
                                    WHERE name LIKE ? AND name LIKE ? AND (name LIKE '%登場%' OR name LIKE '%変身%' OR name LIKE '%覚醒%')
                                    ORDER BY id DESC LIMIT 1
                                """, (f"{prefix}%", f"%{ch_name}%"))
                                ep_m = c.fetchone()
                            if not ep_m:
                                c.execute("""
                                    SELECT id, name, pack_name FROM effect_packs
                                    WHERE name LIKE ? AND (name LIKE '%登場%' OR name LIKE '%変身%' OR name LIKE '%覚醒%')
                                    ORDER BY id DESC LIMIT 1
                                """, (f"%{ch_name}%",))
                                ep_m = c.fetchone()
                            if ep_m:
                                eff_pack_id = ep_m[0]
                                eff_pack_name = ep_m[1]
                                pack_code = ep_m[2]

            target_name = ""
            if target_cid:
                c.execute("SELECT name FROM cards WHERE id = ?", (target_cid,))
                t_row = c.fetchone()
                if t_row and t_row[0]:
                    target_name = t_row[0]
                    
            label = eff_pack_name or ps_name or f"Biến hình #{target_cid}"
            
            # Tự động sinh file LUA cutscene nếu có effect_pack_id để xem trực tiếp và hoán đổi
            if eff_pack_id and not script_name:
                script_name = f"fx_{int(eff_pack_id)}"
                folder = "preview_fx"
                fx_path = os.path.join(BASE_RES_DIR, "ab_script", "preview_fx", f"{script_name}.lua")
                if not os.path.exists(fx_path):
                    try:
                        generate_effect_pack_lua(int(eff_pack_id), pack_code or "", force=False)
                    except Exception as ge:
                        print(f"Auto-generate lua error for {eff_pack_id}: {ge}")
                
            # A battle_params record with idx 1 = 0 has no cutscene pack.
            # Do not substitute the transformed card's Entrance animation.
            if script_name:
                anims.append({
                    "type": "Passive Transformation",
                    "type_key": "transform",
                    "folder": folder,
                    "name": f"Biến hình: {label}",
                    "script_name": script_name,
                    "pack_name": pack_code or "",
                    "effect_pack_id": eff_pack_id,
                    "bgm_id": bgm_id if (bgm_id and bgm_id > 0) else None,
                    "target_card_id": target_cid,
                    "target_name": target_name
                })
            
            # 8. Lấy toàn bộ hoạt ảnh từ dạng biến hình (Transformed Form)
            if target_cid and target_cid != card_id and target_cid not in seen_targets:
                seen_targets.add(target_cid)
                sub_anims = get_sub_card_animations(target_cid, target_name or f"Card {target_cid}", conn)
                anims.extend(sub_anims)

        # eff_value3 is a script number, NOT a special_views ID. Counter (120)
        # uses attack_counter/cXXXX.lua; nullify (119) and absorb (97) use
        # ab_sys/asXXXX.lua. Efficacy 110 only links capacity to this passive.
        c.execute("""
            SELECT ps.id, ps.name, ps.efficacy_type, ps.eff_value3,
                   pssr.passive_skill_set_id
            FROM cards cd
            JOIN passive_skill_set_relations pssr
              ON cd.passive_skill_set_id = pssr.passive_skill_set_id
            JOIN passive_skills ps ON pssr.passive_skill_id = ps.id
            WHERE cd.id = ? AND ps.efficacy_type IN (97, 119, 120)
              AND ps.eff_value3 > 0
            ORDER BY ps.efficacy_type, ps.id
        """, (card_id,))
        seen_reactions = set()
        for ps_id, ps_name, efficacy_type, counter_no, set_id in c.fetchall():
            reaction_key = (efficacy_type, counter_no)
            if reaction_key in seen_reactions:
                continue
            seen_reactions.add(reaction_key)
            is_counter = efficacy_type == 120
            label = "Counter" if is_counter else "Absorb" if efficacy_type == 97 else "Nullify"
            anims.append({
                "type": label,
                "type_key": "counter" if is_counter else "nullify",
                "folder": "attack_counter" if is_counter else "ab_sys",
                "name": f"{label}: {ps_name or f'Passive #{ps_id}'}",
                "script_name": f"c{counter_no:04d}" if is_counter else f"as{counter_no:04d}",
                "reaction_script_no": counter_no,
                "passive_skill_id": ps_id,
                "passive_skill_set_id": set_id,
                "bgm_id": None,
            })
            
    except Exception as e:
        print(f"Error extracting animations for card {card_id}: {e}")
    finally:
        if conn is not None:
            conn.close()
        
    return anims


def extract_lwf_data(pack_name, effect_pack_id=None):
    """
    Gọi tools/extract_lwf_cues.js để trích xuất exact frameCount và toàn bộ triggers SE/Voice từ file LWF.
    """
    script_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "tools", "extract_lwf_cues.js")
    if not os.path.exists(script_path):
        return {"frameCount": 600, "triggers": []}
        
    target_arg = pack_name.strip() if (pack_name and pack_name.strip()) else f"sp_effect_{effect_pack_id}"
    try:
        res = subprocess.run(
            ["node", script_path, target_arg],
            capture_output=True,
            text=True,
            timeout=30,
            encoding="utf-8"
        )
        if res.returncode == 0 and res.stdout:
            data = json.loads(res.stdout.strip())
            return data
    except Exception as e:
        print(f"Error extracting LWF cues for {target_arg}: {e}")
        
    return {"frameCount": 600, "triggers": []}


def check_effect_pack_has_usm(epid, pack_name=""):
    """Kiểm tra xem Effect Pack có video USM đi kèm hay không (chỉ dùng setupMovie khi có USM)"""
    json_path = os.path.join(BASE_RES_DIR, "effects", f"pack_{epid}.json")
    if os.path.exists(json_path):
        try:
            with open(json_path, 'r', encoding='utf-8') as f:
                d = json.load(f)
            return bool(d.get('usm') and d['usm'].get('rel'))
        except Exception:
            pass
    movie_name = pack_name if pack_name else f"battle_{epid}"
    usm_local = os.path.join(BASE_RES_DIR, "movies", f"{movie_name}.usm")
    if os.path.exists(usm_local) and os.path.getsize(usm_local) > 0:
        return True
    return False


def generate_effect_pack_lua(effect_pack_id, pack_name="", force=False):
    """
    Tạo file LUA cutscene chuẩn Dokkan với âm thanh (SE & Voice) và thời lượng chính xác
    (multi_frm = 2, 2x frame scaling) để xem thử hoặc hoán đổi bất kỳ Effect Pack nào
    (như Biến hình Passive hoặc Hồi sinh Revival) trong Dokkan Lua Player hoặc áp dụng vào game.
    """
    if not effect_pack_id or int(effect_pack_id) <= 0:
        return None, ""
        
    epid = int(effect_pack_id)
    script_name = f"fx_{epid}"
    target_dir = os.path.join(BASE_RES_DIR, "ab_script", "preview_fx")
    os.makedirs(target_dir, exist_ok=True)
    target_path = os.path.join(target_dir, f"{script_name}.lua")
    
    # Nếu chưa có pack_name, tra cứu DB để lấy pack_name chuẩn
    if not pack_name:
        try:
            conn = get_db_connection()
            c = conn.cursor()
            c.execute("SELECT pack_name FROM effect_packs WHERE id = ?", (epid,))
            r = c.fetchone()
            if r and r[0]:
                pack_name = r[0]
            conn.close()
        except Exception:
            pass

    need_write = force
    if not os.path.exists(target_path) or os.path.getsize(target_path) == 0:
        need_write = True
    else:
        # Nếu file cũ thiếu multi_frm = 2 hoặc có setupMovie trên LWF thuần thì tạo lại
        try:
            with open(target_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            if "multi_frm = 2" not in content or "setupMovie" in content:
                need_write = True
        except Exception:
            need_write = True
            
    if need_write:
        lwf_info = extract_lwf_data(pack_name, epid)
        raw_frames = lwf_info.get("frameCount") or 600
        # Dokkan Entrance & Cutscene engine chạy multi_frm = 2 (60 FPS timeline, Flash LWF chạy 30 FPS)
        # Vì vậy toàn bộ timeline frame trong mã LUA phải nhân 2 (2x scaling) để khớp 100% với nhịp phim!
        max_frame = raw_frames * 2
        triggers = lwf_info.get("triggers") or []
        has_usm = check_effect_pack_has_usm(epid, pack_name)
        
        sound_lua_lines = []
        for tr in triggers:
            raw_f = tr.get("frame", 0)
            f = raw_f * 2  # 2x scaling cho multi_frm = 2
            ttype = tr.get("type")
            cue_id = tr.get("cueId")
            vol = tr.get("volume", -1)
            
            if ttype == "se":
                if vol != -1:
                    sound_lua_lines.append(f'playSe( spep_0 + {f}, {cue_id}, "", {vol} );')
                else:
                    sound_lua_lines.append(f'playSe( spep_0 + {f}, {cue_id}, "", -1 );')
            elif ttype == "se_stop":
                sound_lua_lines.append(f'stopSe( spep_0 + {f}, {cue_id} );')
            elif ttype == "voice":
                sound_lua_lines.append(f'playVoice( spep_0 + {f}, {cue_id} );')
                if vol != -1:
                    sound_lua_lines.append(f'setVoiceVolume( spep_0 + {f}, {cue_id}, {vol} );')
            elif ttype == "voice_stop":
                sound_lua_lines.append(f'stopVoice( spep_0 + {f}, {cue_id} );')
                
        sound_section = "\n".join(sound_lua_lines)
        if sound_section:
            sound_section = "\n-- Sound Effects & Voices\n" + sound_section + "\n"
        else:
            sound_section = "\n"

        setup_movie_line = f"setupMovie( 0, SP_01, 0, 1 );\n" if has_usm else ""

        lua_code = f"""-- Dokkan Auto Cutscene Generator for Effect Pack #{epid}
-- Pack Name: {pack_name}
-- LWF Frames: {raw_frames} -> Script Frames: {max_frame} (multi_frm = 2)
-- Sound Events: {len(triggers)}

fcolor_r = 245;
fcolor_g = 245;
fcolor_b = 245;

SP_01 = {epid};

------------------------------------------------------
-- テンプレ構文 (Template Syntax)
------------------------------------------------------
multi_frm = 2;

setVisibleUI( 0, 0 );

setDisp( 0, 0, 0 );
changeAnime( 0, 0, 0 );

setMoveKey(   0,   0,    0, -5000,   0 );
setMoveKey(   1,   0,    0, -5000,   0 );
setMoveKey(   2,   0,    0, -5000,   0 );
setMoveKey(   3,   0,    0, -5000,   0 );
setMoveKey(   4,   0,    0, -5000,   0 );
setMoveKey(   5,   0,    0, -5000,   0 );
setMoveKey(   6,   0,    0, -5000,   0 );
setScaleKey(  0,   0,  1.6, 1.6 );
setScaleKey(  1,   0,  1.6, 1.6 );
setScaleKey(  2,   0,  1.6, 1.6 );
setScaleKey(  3,   0,  1.6, 1.6 );
setScaleKey(  4,   0,  1.6, 1.6 );
setScaleKey(  5,   0,  1.6, 1.6 );
setScaleKey(  6,   0,  1.6, 1.6 );
setRotateKey( 0,   0,  0 );
setRotateKey( 1,   0,  0 );
setRotateKey( 2,   0,  0 );
setRotateKey( 3,   0,  0 );
setRotateKey( 4,   0,  0 );
setRotateKey( 5,   0,  0 );
setRotateKey( 6,   0,  0 );

setDisp( 0, 1, 0 );
changeAnime( 0, 1, 100 );
setAlphaKey( 0, 1, 255 );

setMoveKey(   0,   1,    0, -5000,   0 );
setMoveKey(   1,   1,    0, -5000,   0 );
setMoveKey(   2,   1,    0, -5000,   0 );
setMoveKey(   3,   1,    0, -5000,   0 );
setMoveKey(   4,   1,    0, -5000,   0 );
setMoveKey(   5,   1,    0, -5000,   0 );
setMoveKey(   6,   1,    0, -5000,   0 );
setScaleKey(  0,   1,  1.6, 1.6 );
setScaleKey(  1,   1,  1.6, 1.6 );
setScaleKey(  2,   1,  1.6, 1.6 );
setScaleKey(  3,   1,  1.6, 1.6 );
setScaleKey(  4,   1,  1.6, 1.6 );
setScaleKey(  5,   1,  1.6, 1.6 );
setScaleKey(  6,   1,  1.6, 1.6 );
setRotateKey( 0,   1,  0 );
setRotateKey( 1,   1,  0 );
setRotateKey( 2,   1,  0 );
setRotateKey( 3,   1,  0 );
setRotateKey( 4,   1,  0 );
setRotateKey( 5,   1,  0 );
setRotateKey( 6,   1,  0 );

ENABLE_AUTO_TIME_STRETCH(0.9);

kame_flag = 0x00;
if (_IS_PLAYER_SIDE_ == 1) then

spep_0 = 0;
{setup_movie_line}MAX_FRAME = {max_frame};

base_0 = entryEffect( spep_0 + 0, SP_01, 0x100, -1, 0, 0, 0 );
setEffMoveKey( spep_0 + 0, base_0, 0, 0, 0 );
setEffMoveKey( spep_0 + MAX_FRAME, base_0, 0, 0, 0 );
setEffScaleKey( spep_0 + 0, base_0, 1.0, 1.0 );
setEffScaleKey( spep_0 + MAX_FRAME, base_0, 1.0, 1.0 );
setEffRotateKey( spep_0 + 0, base_0, 0 );
setEffRotateKey( spep_0 + MAX_FRAME, base_0, 0 );
setEffAlphaKey( spep_0 + 0, base_0, 255 );
setEffAlphaKey( spep_0 + MAX_FRAME, base_0, 255 );

entryFadeBg( spep_0 + 0, 0, MAX_FRAME + 2, 0, 0, 0, 0, 255 );
{sound_section}
endPhase( spep_0 + MAX_FRAME );

else end
"""
        with open(target_path, "w", encoding="utf-8") as f:
            f.write(lua_code)
        
    return script_name, target_path


def fetch_or_read_lua(folder, script_name):
    """
    Đọc file LUA từ thư mục local. Nếu local chưa có, tải tự động từ CDN Dokkan Eclipse.
    Trả về: (success: bool, content: str, path_or_err: str)
    """
    if not script_name:
        return False, "", "Tên script không hợp lệ."
        
    clean_name = script_name.replace(".lua", "").strip()
    
    # Tự động xử lý cutscene effect pack fx_{epid}
    if clean_name.startswith("fx_") and clean_name[3:].isdigit():
        generate_effect_pack_lua(int(clean_name[3:]))
        folder = "preview_fx"
        
    local_path = imported_asset(f"lua/ab_script/{folder}/{clean_name}.lua") or os.path.join(BASE_RES_DIR, "ab_script", folder, f"{clean_name}.lua")
    
    # 1. Kiểm tra local
    if os.path.exists(local_path):
        try:
            with open(local_path, "r", encoding="utf-8", errors="ignore") as f:
                content = f.read()
            return True, content, local_path
        except Exception as e:
            return False, "", f"Lỗi đọc file local: {e}"
            
    # 2. Thử tải từ CDN Dokkan Eclipse
    cdn_url = f"{CDN_LUA_BASE}/{folder}/{clean_name}.lua"
    headers = {"User-Agent": USER_AGENT}
    try:
        resp = requests.get(cdn_url, headers=headers, timeout=15)
        if resp.status_code == 200 and resp.text:
            content = resp.text
            os.makedirs(os.path.dirname(local_path), exist_ok=True)
            with open(local_path, "w", encoding="utf-8") as f:
                f.write(content)
            return True, content, local_path
        else:
            return False, "", f"Không tìm thấy file trên CDN Dokkan Eclipse (HTTP {resp.status_code}): {cdn_url}"
    except Exception as e:
        return False, "", f"Lỗi khi tải file từ CDN: {e}"

def fetch_bgm_if_needed(bgm_id):
    """Tải file BGM (.awb) về local nếu chưa có"""
    if not bgm_id or int(bgm_id) <= 0:
        return False, "Không có BGM ID."
    bgm_id = int(bgm_id)
    local_bgm = os.path.join(BASE_RES_DIR, "bgm", f"bgm_{bgm_id}.awb")
    if os.path.exists(local_bgm) and os.path.getsize(local_bgm) > 0:
        return True, local_bgm
    cdn_url = f"{CDN_BGM_BASE}/bgm_{bgm_id}.awb"
    try:
        resp = requests.get(cdn_url, headers={"User-Agent": USER_AGENT}, timeout=20)
        if resp.status_code == 200 and len(resp.content) > 0:
            os.makedirs(os.path.dirname(local_bgm), exist_ok=True)
            with open(local_bgm, "wb") as f:
                f.write(resp.content)
            return True, local_bgm
    except Exception:
        pass
    return False, "Không thể tải BGM từ CDN."

def transmute_animation(source_anim, target_slot, target_card_id, custom_script_name=None, copy_bgm=True, strip_damage=True):
    """
    Thực hiện hoán đổi hoạt ảnh:
    1. Đọc nội dung LUA nguồn (local hoặc CDN) nếu có file LUA.
    2. Nếu target là Entrance và strip_damage=True: tự động loại bỏ dealDamage và setDamage.
    3. Lưu sang thư mục LUA đích với tên chuẩn.
    4. Tải file BGM nếu có.
    5. Đọc SQLite để lập SQL patch, không cập nhật database gốc.
    """
    if target_slot not in SLOT_CONFIG:
        return False, {"msg": f"Vị trí đích không hợp lệ: {target_slot}"}, []
        
    cfg = SLOT_CONFIG[target_slot]
    target_folder = cfg["folder"]
    prefix = cfg["prefix"]
    target_card_id = int(target_card_id)
    
    src_folder = source_anim.get("folder", "active_skill")
    src_script = source_anim.get("script_name", "").strip().replace(".lua", "")
    has_lua = bool(src_script)
    
    # Nếu là Effect Pack hoặc Revival (hoặc script dạng fx_XXX):
    # Luôn tạo mới cutscene LUA đầy đủ âm thanh (SE & Voice) và timeline frame chính xác
    ep_id = source_anim.get("effect_pack_id")
    if not ep_id and src_script.startswith("fx_") and src_script[3:].isdigit():
        try:
            ep_id = int(src_script[3:])
        except Exception:
            ep_id = None
            
    if ep_id:
        p_name = source_anim.get("pack_name", "")
        s_name, _ = generate_effect_pack_lua(ep_id, p_name, force=True)
        if s_name:
            src_script = s_name
            src_folder = "preview_fx"
            has_lua = True

    if not has_lua:
        return False, {"msg": "Animation nguồn không có Lua hoặc Effect Pack để chuyển."}, []
    
    new_name = None
    target_lua_path = None
    pack_items = []
    deal_stripped = 0
    shake_stripped = 0
    
    if has_lua:
        # 1. Xác định tên file LUA mới
        if custom_script_name and custom_script_name.strip():
            new_name = custom_script_name.strip().replace(".lua", "")
        else:
            new_name = f"{prefix}{target_card_id}_{src_script}"
            
        new_name = re.sub(r'[^\w-]', '_', new_name)
            
        # 2. Đọc file LUA nguồn
        ok, lua_content, path_or_err = fetch_or_read_lua(src_folder, src_script)
        if not ok:
            return False, {"msg": f"Không thể lấy mã LUA nguồn: {path_or_err}"}, []
            
        # 3. Lược bỏ damage nếu chuyển sang Entrance
        if strip_damage and target_slot == "entrance":
            lua_content, deal_stripped, shake_stripped = strip_damage_calls(lua_content)
            
        # 4. Ghi file LUA mới vào thư mục đích
        target_lua_dir = os.path.join(BASE_RES_DIR, "ab_script", target_folder)
        os.makedirs(target_lua_dir, exist_ok=True)
        target_lua_path = os.path.join(target_lua_dir, f"{new_name}.lua")
        
        header_comment = f"-- Transmuted by Dokkan Patch Tool: from {src_folder}/{src_script}.lua to {target_folder}/{new_name}.lua\n-- Target Card ID: {target_card_id}\n"
        if deal_stripped > 0 or shake_stripped > 0:
            header_comment += f"-- [Entrance Optimization]: Stripped {deal_stripped} dealDamage calls and {shake_stripped} setDamage calls to prevent combat crashes/damage during entrance.\n"
        header_comment += "\n"
        
        try:
            with open(target_lua_path, "w", encoding="utf-8") as f:
                f.write(header_comment + lua_content)
        except Exception as e:
            return False, {"msg": f"Lỗi ghi file LUA đích: {e}"}, []
            
        pack_items.append((target_lua_path, f"lua/ab_script/{target_folder}/{new_name}.lua"))
        
    # 5. BGM: Tải về local để người dùng nghe/xem thử trên tool, KHÔNG đóng gói vào patch .eclp theo yêu cầu
    bgm_id = source_anim.get("bgm_id") if copy_bgm else None
    if bgm_id and int(bgm_id) > 0:
        fetch_bgm_if_needed(int(bgm_id))
        # BGM không thêm vào pack_items để giữ patch siêu nhẹ, game sẽ tự phát nhạc theo ID lưu trong Database
    else:
        bgm_id = None
        
    # 6. Chỉ đọc Database và sinh SQL patch. Bản nháp được giữ ở giao diện.
    now_str = datetime.datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    sql_statements = []
    target_pse_id = None
    sv_id = None
    conn = None

    try:
        conn = get_db_connection()
        c = conn.cursor()

        def reserve_unused_id(table, preferred):
            with _animation_id_lock:
                candidate = preferred
                while True:
                    c.execute(f"SELECT 1 FROM {table} WHERE id = ?", (candidate,))
                    if c.fetchone() is None and candidate not in _reserved_animation_ids[table]:
                        _reserved_animation_ids[table].add(candidate)
                        return candidate
                    if candidate == preferred:
                        candidate = preferred * 10 + 7
                    else:
                        candidate += 1

        if target_slot == "entrance":
            target_pse_id = reserve_unused_id("passive_skill_effects", target_card_id)
            sql_statements.append(
                "INSERT OR REPLACE INTO passive_skill_effects (id, script_name, lite_flicker_rate, bgm_id, created_at, updated_at) "
                f"VALUES ({target_pse_id}, '{new_name}', 30, {bgm_id or 0}, '{now_str}', '{now_str}');"
            )
        else:
            offset = {"active": 50000, "super": 30000, "finish": 70000}[target_slot]
            sv_id = reserve_unused_id("special_views", target_card_id + offset)
            sql_statements.append(
                "INSERT OR REPLACE INTO special_views (id, script_name, cut_in_card_id, special_name_no, "
                "special_motion, lite_flicker_rate, energy_color, special_category_id, created_at, updated_at) "
                f"VALUES ({sv_id}, '{new_name}', 0, 0, 0, 30, NULL, NULL, '{now_str}', '{now_str}');"
            )

        conn.close()
        conn = None
        
    except Exception as e:
        if conn is not None:
            conn.close()
        return False, {"msg": f"Lỗi tạo SQL animation: {e}"}, []
        
    res_msg = f"Đã sao chép hoạt ảnh '{source_anim['name']}' thành công vào {cfg['label']}!"
    if has_lua:
        res_msg += f"\n- File LUA mới: `lua/ab_script/{target_folder}/{new_name}.lua`"
    if deal_stripped > 0 or shake_stripped > 0:
        res_msg += f"\n- ✂️ Tự động lược bỏ: **{deal_stripped}** lệnh sát thương (`dealDamage`) & **{shake_stripped}** lệnh rung lắc mục tiêu (`setDamage`) để tương thích trơn tru với Entrance."
    if bgm_id:
        res_msg += f"\n- Nhạc nền BGM: ID **{bgm_id}**"
        
    res_dict = {
        "msg": res_msg,
        "script_name": new_name or "",
        "folder": target_folder,
        "lua_path": target_lua_path,
        "target_slot": target_slot,
        "target_pse_id": target_pse_id,
        "special_view_id": sv_id,
        "bgm_id": bgm_id,
        "deal_stripped": deal_stripped,
        "shake_stripped": shake_stripped,
        "sql_statements": sql_statements,
        "pack_items": pack_items
    }
        
    return True, res_dict, sql_statements
