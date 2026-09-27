# -*- coding: utf-8 -*-
"""
Dokkan Battle Passive Skill Compiler & Pattern Engine
Module name: dokkan_passive_compiler.py

Chức năng:
1. Parse text mô tả Dokkan (ingame itemized_description hoặc text viết tay/rút gọn)
   thành các dòng dữ liệu chuẩn passive_skills (SQLite).
2. Hỗ trợ Autocomplete / Template Library với đầy đủ các pattern meta trong game.
3. Tra cứu và gán tự động Causality Conditions (skill_causalities ID) tương ứng.
"""

import re
import json
import sqlite3
import os
from contextlib import closing
from modules.core.config import DB_PATH

_CAUSALITIES_CACHE = None
COMPILER_VERSION = "2026-09-24.2"

def get_skill_causalities_cache():
    global _CAUSALITIES_CACHE
    if _CAUSALITIES_CACHE is not None:
        return _CAUSALITIES_CACHE
    
    cache = []
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, causality_type, cau_val1, cau_val2, cau_val3 FROM skill_causalities")
            for r in c.fetchall():
                cache.append({
                    'id': r[0],
                    'type': r[1],
                    'v1': r[2],
                    'v2': r[3],
                    'v3': r[4]
                })
            conn.close()
        except Exception as e:
            print(f"Error loading skill_causalities: {e}")
    _CAUSALITIES_CACHE = cache
    return _CAUSALITIES_CACHE

_CATEGORIES_CACHE = None

def get_card_categories_cache():
    global _CATEGORIES_CACHE
    if _CATEGORIES_CACHE is not None:
        return _CATEGORIES_CACHE
    
    cache = {}
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            c.execute("SELECT id, name FROM card_categories")
            for r in c.fetchall():
                cache[r[1].lower().strip()] = r[0]
            conn.close()
        except Exception as e:
            print(f"Error loading card_categories: {e}")
    _CATEGORIES_CACHE = cache
    return _CATEGORIES_CACHE

def find_best_causality_id(caus_type, v1=0, v2=0, v3=0):
    cache = get_skill_causalities_cache()
    # A nearby condition is not equivalent: a wrong HP/category/turn threshold
    # silently changes gameplay. Let the user set an unavailable condition.
    for row in cache:
        if row['type'] == caus_type and row['v1'] == v1 and row['v2'] == v2 and row['v3'] == v3:
            return row['id']
    return None

def build_causality_json(caus_id):
    if not caus_id:
        return ""
    return json.dumps({
        "source": str(caus_id),
        "compiled": int(caus_id)
    }, separators=(',', ':'))

# ==============================================================================
# DATABASE REFERENCE CORPUS & FUZZY MATCH ENGINE (Tra cứu các mô tả khó trong DB)
# ==============================================================================
_DB_CORPUS_CACHE = None

def normalize_text_skeleton(txt):
    """Chuẩn hóa văn bản thành dạng khung xương (xóa số, xóa icon) để tìm kiếm"""
    txt = re.sub(r'\{passiveImg:[^\}]+\}', '', str(txt))
    txt = txt.replace("\\_", "_").replace("''", "'")
    for wrong, right in (("addtional", "additional"), ("atttacks", "attacks"),
                         ("agains", "against"), ("nulifies", "nullifies")):
        txt = re.sub(rf'\b{wrong}\b', right, txt, flags=re.I)
    txt = re.sub(r'\d+', '#NUM#', txt)
    txt = re.sub(r'[^\w#\s]', ' ', txt)
    txt = re.sub(r'\s+', ' ', txt).strip().lower()
    return txt

def extract_numbers_from_text(txt):
    """Trích xuất danh sách các số nguyên xuất hiện trong text"""
    return [int(n) for n in re.findall(r'\d+', str(txt))]

def get_db_passive_corpus():
    """
    Tải và lập chỉ mục toàn bộ ~4000 bộ mô tả và ~26000 skill thực tế từ database_decrypted.db.
    Được cache trong bộ nhớ để tìm kiếm tức thì (< 0.05s).
    """
    global _DB_CORPUS_CACHE
    if _DB_CORPUS_CACHE is not None:
        return _DB_CORPUS_CACHE

    corpus = []
    if os.path.exists(DB_PATH):
        try:
            conn = sqlite3.connect(DB_PATH)
            c = conn.cursor()
            
            # Lấy tất cả các set có mô tả
            c.execute("""
                SELECT s.id, s.itemized_description
                FROM passive_skill_sets s
                WHERE s.itemized_description IS NOT NULL AND s.itemized_description != ''
            """)
            all_sets = c.fetchall()
            
            # Lấy tất cả relation và skill
            c.execute("""
                SELECT r.passive_skill_set_id, p.exec_timing_type, p.target_type, p.causality_conditions, 
                       p.efficacy_type, p.calc_option, p.turn, p.is_once, p.probability,
                       p.eff_value1, p.eff_value2, p.eff_value3
                FROM passive_skill_set_relations r
                JOIN passive_skills p ON r.passive_skill_id = p.id
                ORDER BY r.id
            """)
            from collections import defaultdict
            set_skills_map = defaultdict(list)
            for row in c.fetchall():
                set_skills_map[row[0]].append({
                    'exec_timing_type': row[1],
                    'target_type': row[2],
                    'causality_conditions': row[3] or '',
                    'efficacy_type': row[4],
                    'calc_option': row[5],
                    'turn': row[6],
                    'is_once': row[7],
                    'probability': row[8],
                    'eff_value1': row[9],
                    'eff_value2': row[10],
                    'eff_value3': row[11],
                    'efficacy_values': '{}'
                })
            conn.close()

            for s_id, s_desc in all_sets:
                sk_list = set_skills_map.get(s_id, [])
                if not sk_list:
                    continue
                
                # Tách thành từng dòng mô tả
                raw_lines = str(s_desc).split('\n')
                current_header = ""
                bullet_lines = []
                for rl in raw_lines:
                    s_stripped = rl.strip()
                    if not s_stripped:
                        continue
                    if s_stripped.startswith('*'):
                        current_header = s_stripped.replace('*', '').strip()
                    else:
                        clean_b = re.sub(r'^[\-\*\•\s]+', '', s_stripped).strip()
                        clean_b = re.sub(r'\{passiveImg:[^\}]+\}', '', clean_b).strip()
                        if clean_b:
                            full_line_ctx = f"*{current_header}* {clean_b}" if current_header else clean_b
                            bullet_lines.append(full_line_ctx)

                # Lưu mapping vào corpus
                corpus.append({
                    'set_id': s_id,
                    'full_desc': s_desc,
                    'bullet_lines': bullet_lines,
                    'skills': sk_list
                })

        except Exception as e:
            print(f"Error building DB passive corpus: {e}")

    _DB_CORPUS_CACHE = corpus
    return _DB_CORPUS_CACHE

def find_best_matching_skills_from_db(user_line_text, header_text=""):
    """
    Thuật toán tra cứu Database:
    Tìm câu mô tả trong 4000+ thẻ Dokkan có độ tương đồng cấu trúc cao nhất
    (Cosine / Token overlap / SequenceMatcher trên Skeleton), sau đó lấy khung skill
    của game ra và điền đè số liệu mới của người dùng vào.
    Hỗ trợ tìm kiếm theo cả câu bullet đơn lẻ lẫn câu kèm header condition.
    """
    corpus = get_db_passive_corpus()
    if not corpus:
        return []

    from difflib import SequenceMatcher

    clean_user = re.sub(r'^[\-\*\•\s]+', '', user_line_text).strip()
    clean_user = re.sub(r'\{passiveImg:[^\}]+\}', '', clean_user).strip()
    user_skel = normalize_text_skeleton(clean_user)
    user_tokens = set(user_skel.split())
    user_nums = extract_numbers_from_text(clean_user)

    # Combined with header
    hdr_clean = re.sub(r'[\*\•]+', '', str(header_text)).strip()
    combined_user = f"*{hdr_clean}* {clean_user}" if hdr_clean else clean_user
    comb_skel = normalize_text_skeleton(combined_user)
    comb_tokens = set(comb_skel.split())

    best_score = 0.0
    best_candidate_entry = None
    best_b_idx = 0
    
    # Duyệt qua các bullet line trong database
    for entry in corpus:
        for b_idx, b_line in enumerate(entry['bullet_lines']):
            b_skel = normalize_text_skeleton(b_line)
            b_tokens = set(b_skel.split())
            if not b_tokens:
                continue
            
            # So sánh với câu đơn lẻ
            score1 = 0.0
            if user_tokens:
                common1 = len(user_tokens.intersection(b_tokens))
                if common1 >= 2:
                    rec1 = common1 / len(user_tokens)
                    ratio1 = SequenceMatcher(None, user_skel, b_skel).ratio()
                    score1 = max(ratio1, rec1 * 0.7 + ratio1 * 0.3)

            # So sánh với câu kèm header
            score2 = 0.0
            if comb_tokens and hdr_clean:
                common2 = len(comb_tokens.intersection(b_tokens))
                if common2 >= 2:
                    rec2 = common2 / len(comb_tokens)
                    ratio2 = SequenceMatcher(None, comb_skel, b_skel).ratio()
                    score2 = max(ratio2, rec2 * 0.7 + ratio2 * 0.3)

            score = max(score1, score2)
            if score > best_score and score >= 0.45:
                best_score = score
                best_candidate_entry = entry
                best_b_idx = b_idx

    if best_candidate_entry and best_score >= 0.45:
        skills = best_candidate_entry['skills']
        cand_sk = None
        if best_b_idx < len(skills):
            cand_sk = dict(skills[best_b_idx])
        elif skills:
            cand_sk = dict(skills[0])

        if cand_sk:
            res = dict(cand_sk)
            if user_nums:
                if res.get('efficacy_type') == 13:
                    res['eff_value1'] = max(0, 100 - user_nums[0])
                else:
                    res['eff_value1'] = user_nums[0]
                    if len(user_nums) > 1 and res.get('eff_value2', 0) > 0:
                        res['eff_value2'] = user_nums[1]
                    elif res.get('efficacy_type') == 3:
                        res['eff_value2'] = user_nums[0]
                    if len(user_nums) > 2 and res.get('eff_value3', 0) > 0:
                        res['eff_value3'] = user_nums[2]
            return [res]

    return []

# ==============================================================================
# PATTERN TEMPLATES & AUTOCOMPLETE REGISTRY
# ==============================================================================
PASSIVE_TEMPLATES = [
    {
        "category": "Basic Stat Buffs (Khởi đầu)",
        "label": "Ki +{X} and ATK & DEF +{Y}%",
        "description": "Buff Ki và ATK & DEF cơ bản đầu lượt",
        "defaults": {"X": 3, "Y": 150},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 5,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            },
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 3,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{Y}", "eff_value2": "{Y}", "eff_value3": 0
            }
        ]
    },
    {
        "category": "Basic Stat Buffs (Khởi đầu)",
        "label": "ATK & DEF +{X}%",
        "description": "Buff ATK & DEF cơ bản đầu lượt",
        "defaults": {"X": 150},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 3,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{X}", "eff_value3": 0
            }
        ]
    },
    {
        "category": "Basic Stat Buffs (Khởi đầu)",
        "label": "ATK +{X}%",
        "description": "Chỉ buff ATK đầu lượt",
        "defaults": {"X": 150},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 1,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Basic Stat Buffs (Khởi đầu)",
        "label": "DEF +{X}%",
        "description": "Chỉ buff DEF đầu lượt",
        "defaults": {"X": 150},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 2,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Combat / When Attacking (Khi đánh)",
        "label": "ATK & DEF +{X}% when performing a Super Attack",
        "description": "Nhận thêm ATK & DEF nhân khi ra đòn SA",
        "defaults": {"X": 50},
        "skills": [
            {
                "exec_timing_type": 4, "target_type": 1, "efficacy_type": 3,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{X}", "eff_value3": 0,
                "_caus_type": 40, "_caus_v1": 0
            }
        ]
    },
    {
        "category": "Combat / When Attacking (Khi đánh)",
        "label": "ATK & DEF +{X}% when attacking",
        "description": "Buff chỉ số tính theo cấp số nhân khi tấn công",
        "defaults": {"X": 50},
        "skills": [
            {
                "exec_timing_type": 4, "target_type": 1, "efficacy_type": 3,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{X}", "eff_value3": 0
            }
        ]
    },
    {
        "category": "Combat / Receiving Attack (Khi bị đánh)",
        "label": "DEF +{X}% when receiving an attack",
        "description": "Buff DEF khi bị đối thủ đánh",
        "defaults": {"X": 100},
        "skills": [
            {
                "exec_timing_type": 6, "target_type": 1, "efficacy_type": 2,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Survival Mechanics (Sinh tồn)",
        "label": "Damage reduction rate {X}%",
        "description": "Giảm sát thương nhận vào X% (Efficacy 13, eff1 = 100 - X)",
        "defaults": {"X": 30},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 13,
                "calc_option": 2, "turn": 1, "is_once": 0, "probability": 100,
                "eff_value1": "COMPUTE_DR_{X}", "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Survival Mechanics (Sinh tồn)",
        "label": "Guards all attacks",
        "description": "Đỡ đòn tất cả các hệ (Guard all attacks, Efficacy 78)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 78,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Survival Mechanics (Sinh tồn)",
        "label": "High chance of evading enemy's attack",
        "description": "50% tỷ lệ né đòn đánh của địch (Efficacy 91)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 91,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 50, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Survival Mechanics (Sinh tồn)",
        "label": "Great chance of evading enemy's attack",
        "description": "70% tỷ lệ né đòn đánh của địch (Efficacy 91)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 91,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 70, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Survival Mechanics (Sinh tồn)",
        "label": "Attacks are effective against all Types",
        "description": "Gây sát thương khắc hệ tất cả các hệ (Efficacy 76)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 76,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Combat / Critical Hit (Chí mạng)",
        "label": "Performs a critical hit",
        "description": "100% đòn đánh chí mạng (Efficacy 90, eff1 = 100)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 90,
                "calc_option": 2, "turn": 1, "is_once": 0, "probability": 100,
                "eff_value1": 100, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Combat / Critical Hit (Chí mạng)",
        "label": "High chance of performing a critical hit",
        "description": "50% tỷ lệ ra đòn chí mạng (Efficacy 90, eff1 = 50)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 90,
                "calc_option": 2, "turn": 1, "is_once": 0, "probability": 100,
                "eff_value1": 50, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Additional Attacks (Liên kích)",
        "label": "Launches an additional attack that has a high chance of becoming a Super Attack",
        "description": "Liên kích có 50% cơ hội thành SA (Efficacy 81, eff1=0, eff2=0, eff3=50, prob=100)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 81,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 50
            }
        ]
    },
    {
        "category": "Additional Attacks (Liên kích)",
        "label": "Launches an additional Super Attack",
        "description": "Chắc chắn tung thêm 1 đòn Super Attack (Efficacy 81, eff3=100)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 81,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 100
            }
        ]
    },
    {
        "category": "Additional Attacks (Liên kích)",
        "label": "Launches an additional attack that has a medium chance of becoming a Super Attack",
        "description": "Liên kích có 30% cơ hội thành SA (Efficacy 81, eff3=30)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 81,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 30
            }
        ]
    },
    {
        "category": "Additional Attacks (Liên kích)",
        "label": "Launches an additional attack that has a great chance of becoming a Super Attack",
        "description": "Liên kích có 70% cơ hội thành SA (Efficacy 81, eff3=70)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 81,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 70
            }
        ]
    },
    {
        "category": "Ki Spheres & Nuking (Tăng theo ngọc)",
        "label": "ATK & DEF +{X}% per Ki Sphere obtained",
        "description": "Tăng ATK và DEF theo mỗi viên ngọc thu thập được (Efficacy 61)",
        "defaults": {"X": 20},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 61,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{X}", "eff_value3": 0
            }
        ]
    },
    {
        "category": "Ki Spheres & Nuking (Tăng theo ngọc)",
        "label": "ATK +{X}% per Ki Sphere obtained",
        "description": "Tăng ATK theo mỗi viên ngọc thu thập được (Efficacy 59)",
        "defaults": {"X": 20},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 59,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Ki Spheres & Nuking (Tăng theo ngọc)",
        "label": "Randomly changes Ki Spheres of a certain Type to Rainbow Ki Spheres",
        "description": "Đổi ngọc hệ ngẫu nhiên thành ngọc 7 màu (Efficacy 67)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 67,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 31, "eff_value2": 32, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Ally Support Buffs (Hỗ trợ đồng đội)",
        "label": "All allies' Ki +{X} and ATK & DEF +{Y}%",
        "description": "Support toàn bộ đồng minh Ki và ATK/DEF (target_type = 2)",
        "defaults": {"X": 3, "Y": 40},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 2, "efficacy_type": 5,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": 0, "eff_value3": 0
            },
            {
                "exec_timing_type": 1, "target_type": 2, "efficacy_type": 3,
                "calc_option": 2, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": "{Y}", "eff_value2": "{Y}", "eff_value3": 0
            }
        ]
    },
    {
        "category": "Utility (Tiện ích)",
        "label": "Foresees enemy's Super Attack",
        "description": "Nhìn trước đòn Super Attack của địch (Scouter, Efficacy 101)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 1, "efficacy_type": 101,
                "calc_option": 0, "turn": 0, "is_once": 0, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Utility (Tiện ích)",
        "label": "Disables enemy's action once within the turn",
        "description": "Khóa 1 lượt đánh của kẻ địch (Efficacy 111)",
        "defaults": {},
        "skills": [
            {
                "exec_timing_type": 1, "target_type": 3, "efficacy_type": 111,
                "calc_option": 0, "turn": 0, "is_once": 1, "probability": 100,
                "eff_value1": 0, "eff_value2": 0, "eff_value3": 0
            }
        ]
    },
    {
        "category": "Stacking / Incremental (Tích lũy)",
        "label": "Plus an additional ATK & DEF +{X}% (up to {M}%) with each attack performed",
        "description": "Tích lũy ATK & DEF mỗi đòn đánh (hai dòng Efficacy 98)",
        "defaults": {"X": 20, "M": 100},
        "skills": [
            {
                "exec_timing_type": 5, "target_type": 1, "efficacy_type": 98,
                "calc_option": 2, "turn": 99, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{M}", "eff_value3": 0
            },
            {
                "exec_timing_type": 5, "target_type": 1, "efficacy_type": 98,
                "calc_option": 2, "turn": 99, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{M}", "eff_value3": 1
            }
        ]
    },
    {
        "category": "Stacking / Incremental (Tích lũy)",
        "label": "Plus an additional DEF +{X}% (up to {M}%) with each attack received",
        "description": "Tích lũy DEF mỗi đòn bị đánh (Efficacy 98)",
        "defaults": {"X": 20, "M": 100},
        "skills": [
            {
                "exec_timing_type": 7, "target_type": 1, "efficacy_type": 98,
                "calc_option": 2, "turn": 99, "is_once": 0, "probability": 100,
                "eff_value1": "{X}", "eff_value2": "{M}", "eff_value3": 1,
                "causality_conditions": '{"source":"24","compiled":24}'
            }
        ]
    }
]

# ==============================================================================
# SMART PARSER ENGINE: Parse natural Dokkan text line by line
# ==============================================================================

def resolve_header_rules(header_text):
    """
    Parses a condition header into:
    - causality: JSON string or ""
    - timing: int or None
    - turn: int or None
    - is_once: int (0 or 1)
    """
    if not header_text:
        return {"causality": "", "timing": None, "turn": None, "is_once": 0}
        
    hdr = header_text.strip().replace('*', '').strip()
    hdr_lower = hdr.lower()
    
    if not hdr_lower or hdr_lower in ["basic effect(s)", "basic effects", "default", "hiệu ứng cơ bản", "mặc định"]:
        return {"causality": "", "timing": 1, "turn": 0, "is_once": 0}
        
    if "entrance animation" in hdr_lower or "khởi đầu trận đấu" in hdr_lower or "xuất trận đầu trận" in hdr_lower:
        return {"causality": "", "timing": 1, "turn": 4, "is_once": 1}

    # 1. Entry turn duration / Turn duration (English & Vietnamese)
    # Ex: For 5 turns from the character's entry turn / Trong 5 lượt từ lượt ra trận
    entry_turn_m = re.search(r'(?:for|within|trong|trong\s*vòng)\s*(\d+)\s*(?:turns?|lượt|turn)\s*(?:from|after|kể\s*từ|từ)?\s*(?:the\s*)?(?:character\'?s?\s*)?(?:entry\s*turn|lượt\s*ra\s*trận|lượt\s*xuất\s*trận|ra\s*trận|xuất\s*trận|xuất\s*hiện)', hdr_lower)
    if entry_turn_m:
        return {"causality": "", "timing": 1, "turn": int(entry_turn_m.group(1)), "is_once": 1}
        
    start_battle_m = re.search(r'(?:for|within|trong|trong\s*vòng)\s*(\d+)\s*(?:turns?|lượt|turn)\s*(?:from|after|từ)?\s*(?:start\s*of\s*battle|bắt\s*đầu\s*trận)', hdr_lower)
    if start_battle_m:
        return {"causality": "", "timing": 1, "turn": int(start_battle_m.group(1)), "is_once": 1}

    turn_m = re.search(r'(?:for|trong|trong\s*vòng)\s*(\d+)\s*(?:turns?|lượt|turn)', hdr_lower)
    if turn_m:
        is_once_val = 1 if any(k in hdr_lower for k in ["start of battle", "bắt đầu", "entry", "ra trận", "xuất trận"]) else 0
        return {"causality": "", "timing": 1, "turn": int(turn_m.group(1)), "is_once": is_once_val}

    # 2. HP Scaling (English & Vietnamese)
    if any(k in hdr_lower for k in ["the more hp remaining", "càng nhiều hp", "hp càng nhiều"]):
        return {"causality": "", "timing": 1, "turn": 1, "is_once": 0}
    if any(k in hdr_lower for k in ["the less hp remaining", "càng ít hp", "hp càng ít"]):
        return {"causality": "", "timing": 1, "turn": 1, "is_once": 0}

    # 3. Enemy Class conditions (Extreme Class / Super Class enemy - English & Vietnamese)
    is_extreme_enemy = ("extreme" in hdr_lower) and any(k in hdr_lower for k in ["enemy", "enemies", "địch", "kẻ địch", "đối thủ"])
    if is_extreme_enemy:
        if any(k in hdr_lower for k in ["when attacking", "when launching", "khi tấn công", "khi ra đòn", "khi đánh"]):
            cid = find_best_causality_id(39, 64) or 205
            return {"causality": build_causality_json(cid), "timing": 4, "turn": 0, "is_once": 0}
        else:
            cid = find_best_causality_id(46, 1, 64, 1) or 805
            return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}

    is_super_enemy = ("super" in hdr_lower) and any(k in hdr_lower for k in ["enemy", "enemies", "địch", "kẻ địch", "đối thủ"]) and ("super attack" not in hdr_lower)
    if is_super_enemy:
        if any(k in hdr_lower for k in ["when attacking", "when launching", "khi tấn công", "khi ra đòn", "khi đánh"]):
            cid = find_best_causality_id(39, 32) or 611
            return {"causality": build_causality_json(cid), "timing": 4, "turn": 0, "is_once": 0}
        else:
            cid = find_best_causality_id(46, 1, 32, 1) or 804
            return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}

    # 4. All Allies Class condition
    if ("super class" in hdr_lower or "super" in hdr_lower) and any(k in hdr_lower for k in ["all allies", "toàn bộ đồng minh"]):
        return {"causality": build_causality_json(1807), "timing": 1, "turn": 0, "is_once": 0}
    if ("extreme class" in hdr_lower or "extreme" in hdr_lower) and any(k in hdr_lower for k in ["all allies", "toàn bộ đồng minh"]):
        return {"causality": build_causality_json(1925), "timing": 1, "turn": 0, "is_once": 0}
    # 4.5. Ki Sphere headers (Rainbow or Any Ki Sphere - English & Vietnamese)
    # Ex: For each Rainbow Ki Sphere obtained / For every Ki Sphere obtained / Mỗi ngọc 7 màu thu được
    if re.search(r'(?:for\s+each|for\s+every|per|with\s+each|mỗi|với\s+mỗi|khi\s+ăn|khi\s+nhận|thu\s+thập).*?(?:ki\s+sphere|rainbow|ngọc|cầu\s+ki)', hdr_lower) or re.search(r'(?:ki\s+sphere|ngọc|cầu\s+ki).*?(?:obtained|thu\s+được|nhận\s+được)', hdr_lower):
        bmask = 32 if any(k in hdr_lower for k in ["rainbow", "7 màu", "bảy màu"]) else 63
        if re.search(r'\bagl\b|nhanh nhẹn', hdr_lower): bmask = 1
        elif re.search(r'\bteq\b|kỹ thuật|khéo léo', hdr_lower): bmask = 2
        elif re.search(r'\bint\b|trí tuệ', hdr_lower): bmask = 4
        elif re.search(r'\bstr\b|sức mạnh', hdr_lower): bmask = 8
        elif re.search(r'\bphy\b|thể lực', hdr_lower): bmask = 16
        return {"causality": "", "timing": 1, "turn": 0, "is_once": 0, "is_ki_sphere": True, "bitmask": bmask}

    # 4.6. Stacking headers (Attack performed / Attack received / Start of turn)
    if any(k in hdr_lower for k in ["for every attack performed", "with each attack performed", "per attack performed", "with each attack", "mỗi đòn đánh", "mỗi lần tấn công"]):
        return {"causality": "", "timing": 5, "turn": 99, "is_once": 0, "is_stacking": True}
    if any(k in hdr_lower for k in ["for every attack received", "with each attack received", "per attack received", "mỗi đòn bị đánh", "mỗi khi nhận đòn"]):
        return {"causality": '{"source":"24","compiled":24}', "timing": 7, "turn": 99, "is_once": 0, "is_stacking": True}
    if any(k in hdr_lower for k in ["at the start of each turn", "at start of each turn", "with each turn passed", "per turn passed", "mỗi lượt trôi qua", "đầu mỗi lượt"]):
        return {"causality": "", "timing": 1, "turn": 99, "is_once": 0, "is_stacking": True}

    # 5. Action Timings
    super_count_m = re.search(
        r'after\s+performing\s+(?:the\s+)?(\d+)(?:st|nd|rd|th)?\s*(?:or\s+more\s+)?super\s+attacks?\s+in\s+battle',
        hdr_lower
    )
    if super_count_m:
        cid = find_best_causality_id(44, 1, int(super_count_m.group(1)))
        return {"causality": build_causality_json(cid), "timing": 5, "turn": 0, "is_once": 0}
    hp_under_m = re.search(r'hp\s+is\s+(\d+)%\s+or\s+(?:less|below)', hdr_lower)
    if hp_under_m and re.search(r'(?:before|when)\s+receiving\s+an?\s+attack', hdr_lower):
        cid = find_best_causality_id(2, int(hp_under_m.group(1)))
        return {"causality": build_causality_json(cid), "timing": 6, "turn": 0, "is_once": 0}
    if re.search(r'after\s+receiving\s+an?\s+attack', hdr_lower):
        cid = find_best_causality_id(24)
        return {"causality": build_causality_json(cid), "timing": 7, "turn": 0, "is_once": 0}
    if re.search(r'when\s+receiving\s+(?:a\s+)?ki\s+blast\s+super\s+attack', hdr_lower):
        cid = find_best_causality_id(49, 1)
        return {"causality": build_causality_json(cid), "timing": 6, "turn": 0, "is_once": 0}
    if re.search(r'when\s+receiving\s+(?:a\s+)?super\s+attack', hdr_lower):
        cid = find_best_causality_id(40, 0)
        return {"causality": build_causality_json(cid), "timing": 6, "turn": 0, "is_once": 0}
    if re.search(r'when\s+attacking\s+for\s+the\s+first\s+time', hdr_lower):
        return {"causality": "", "timing": 4, "turn": 0, "is_once": 1}
    attacking_ki_m = re.search(r'when\s+attacking\s+with\s+(\d+)\s*(?:or\s+more\s*)?ki(?:\s+or\s+more)?', hdr_lower)
    if attacking_ki_m:
        cid = find_best_causality_id(3, round(int(attacking_ki_m.group(1)) * 100 / 3))
        return {"causality": build_causality_json(cid), "timing": 4, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["ultra super attack", "siêu tuyệt kỹ", "usa"]):
        cid = find_best_causality_id(40, 1)
        return {"causality": build_causality_json(cid), "timing": 4, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["when performing a super attack", "when launching a super attack", "khi tung tuyệt kỹ", "khi tung sa", "khi ra super attack"]):
        return {"causality": "", "timing": 4, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["when attacking", "when performing an attack", "khi tấn công", "khi ra đòn", "khi đánh"]):
        return {"causality": "", "timing": 4, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["when receiving an attack", "before receiving an attack", "khi nhận đòn", "khi bị tấn công"]):
        return {"causality": "", "timing": 6, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["after guard is activated", "sau khi kích hoạt guard", "sau khi đỡ đòn"]):
        cid = find_best_causality_id(30) or 711
        return {"causality": build_causality_json(cid), "timing": 6, "turn": 0, "is_once": 0}

    # 6. Slot Attacker position
    if any(k in hdr_lower for k in ["1st attacker", "in the 1st slot", "vị trí 1", "slot 1", "đứng đầu"]):
        cid = find_best_causality_id(19, 0) or 25
        return {"causality": build_causality_json(cid), "timing": 3, "turn": 0, "is_once": 0}
    if any(k in hdr_lower for k in ["2nd or 3rd attacker", "in the 2nd or 3rd slot", "slot 2 hoặc 3", "slot 2, 3", "vị trí 2 hoặc 3", "vị trí 2, 3"]):
        cid = find_best_causality_id(19, 2) or 33
        return {"causality": build_causality_json(cid), "timing": 3, "turn": 0, "is_once": 0}

    # 7. Enemy count
    if re.search(r'when facing\s*1\s*enemy|when there is\s*1\s*enemy|1\s*(?:kẻ\s*)?địch', hdr_lower):
        cid = find_best_causality_id(15, 1)
        return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}
    if re.search(r'when facing\s*(\d+)\s*or more enemies|when there are\s*(\d+)\s*or more enemies|(\d+)\s*(?:kẻ\s*)?địch trở lên|nhiều kẻ địch', hdr_lower):
        m = re.search(r'(\d+)', hdr_lower)
        cnt = int(m.group(1)) if m else 2
        cid = find_best_causality_id(15, cnt) or 22
        return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}

    # 8. HP Threshold
    hp_over_match = re.search(r'(?:hp is|hp)\s*(\d+)%\s*or\s*more', hdr_lower) or re.search(r'(?:above|over)\s*(\d+)%\s*hp', hdr_lower) or re.search(r'hp\s*(?:từ\s*)?(\d+)%\s*trở\s*lên', hdr_lower)
    if hp_over_match:
        cid = find_best_causality_id(1, int(hp_over_match.group(1)))
        return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}
    hp_under_match = re.search(r'hp\s*(?:is\s*)?(\d+)%\s*or\s*(?:less|below)', hdr_lower) or re.search(r'(?:under|below)\s*(\d+)%\s*hp', hdr_lower) or re.search(r'hp\s*(?:dưới|còn\s*dưới|từ\s*)?(\d+)%\s*trở\s*xuống', hdr_lower)
    if hp_under_match:
        cid = find_best_causality_id(2, int(hp_under_match.group(1)))
        return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}

    # 9. Ki Threshold
    ki_m = re.search(r'(?:with|at|when ki is|khi có|khi ki đạt)\s*(\d+)\s*(?:or more\s*)?(?:ki)?', hdr_lower)
    if ki_m and ("ki" in hdr_lower or int(ki_m.group(1)) in [12, 18, 20, 24]):
        k_val = int(ki_m.group(1))
        cau_v = round(k_val * 100 / 3)
        cid = find_best_causality_id(3, cau_v)
        return {"causality": build_causality_json(cid), "timing": 4, "turn": 0, "is_once": 0}

    # 10. Category enemy / ally
    cat_cache = get_card_categories_cache()
    cat_enemy_m = re.search(r'["\']?([^"\']+)["\']?\s+category\s+enemy', hdr_lower) or re.search(r'kẻ địch thuộc\s+(?:category\s+)?["\']?([^"\']+)["\']?', hdr_lower)
    if cat_enemy_m:
        cat_raw = cat_enemy_m.group(1).strip().lower()
        matched_cat_id = None
        for cat_name, cid in cat_cache.items():
            if cat_name in cat_raw or cat_raw in cat_name:
                matched_cat_id = cid
                break
        if matched_cat_id:
            cid = find_best_causality_id(34, 1, matched_cat_id, 1)
            return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}
            
    cat_ally_m = re.search(r'["\']?([^"\']+)["\']?\s+category\s+ally', hdr_lower) or re.search(r'đồng minh thuộc\s+(?:category\s+)?["\']?([^"\']+)["\']?', hdr_lower)
    if cat_ally_m:
        cat_raw = cat_ally_m.group(1).strip().lower()
        matched_cat_id = None
        for cat_name, cid in cat_cache.items():
            if cat_name in cat_raw or cat_raw in cat_name:
                matched_cat_id = cid
                break
        if matched_cat_id:
            cid = find_best_causality_id(34, 0, matched_cat_id, 1)
            return {"causality": build_causality_json(cid), "timing": 1, "turn": 0, "is_once": 0}

    return {"causality": "", "timing": None, "turn": None, "is_once": 0}

def resolve_header_causality(header_text):
    if not header_text:
        return ""
    rules = resolve_header_rules(header_text)
    return rules.get("causality", "")

def parse_single_line(line_text, current_header_condition="", passive_set_id=None):
    clean_line = line_text.strip()
    if not clean_line or clean_line.startswith('*') or clean_line.startswith('('):
        return []
        
    raw_clean = re.sub(r'^[\-–—\*\•\s]+', '', clean_line).strip()
    text_no_img = re.sub(r'\{passiveImg:[^\}]+\}', '', raw_clean).strip()
    # Common transcription mistakes in fan translations; normalize only known
    # spellings so the meaning of an unfamiliar sentence is not guessed.
    text_no_img = re.sub(r'\baddtional\b', 'additional', text_no_img, flags=re.I)
    text_no_img = re.sub(r'\batttacks\b', 'attacks', text_no_img, flags=re.I)
    text_no_img = re.sub(r'\bagains\b', 'against', text_no_img, flags=re.I)
    text_no_img = re.sub(r'\bnulif(?:ies|y)\b', 'nullifies', text_no_img, flags=re.I)
    text_no_img = text_no_img.replace("''", "'")
    if not text_no_img:
        return []

    hdr_lower = current_header_condition.lower()
    text_lower = text_no_img.lower()
    combined_context = (hdr_lower + " " + text_lower).strip()
    
    # Resolve header condition rules
    hdr_rules = resolve_header_rules(current_header_condition)
    
    # Check Entrance context
    is_entrance = "entrance animation" in hdr_lower
    turn_val = hdr_rules.get("turn") if hdr_rules.get("turn") is not None else 0
    is_once = hdr_rules.get("is_once", 0)
    if "{passiveimg:once}" in line_text.lower():
        is_once = 1
    if re.search(r'once\s+within\s+(?:the\s+|a\s+)?turn', text_no_img, re.I):
        is_once = 1
    
    turn_m = re.search(r'for\s*(\d+)\s*turn', text_no_img, re.I)
    if turn_m:
        turn_val = int(turn_m.group(1))
    elif is_entrance and turn_val == 0:
        turn_val = 4 # default entrance turn limit
    elif "{passiveimg:forever}" in line_text.lower():
        turn_val = 99
        
    # Timing
    exec_timing = hdr_rules.get("timing") if hdr_rules.get("timing") is not None else 1
    if "when attacking" in text_lower and exec_timing == 1:
        exec_timing = 4
    elif ("when receiving an attack" in text_lower or "after receiving an attack" in text_lower) and exec_timing == 1:
        exec_timing = 6

    # Causality from header rules
    caus_json = hdr_rules.get("causality", "")

    # Check Context Flags (flexible and robust)
    # 1. Ki Sphere detection (from header or line)
    is_ki_sphere = hdr_rules.get("is_ki_sphere", False) or bool(
        re.search(r'(?:per|for\s+each|for\s+every|with\s+each|each|every|mỗi|với\s+mỗi|khi\s+ăn|thu\s+thập)\s+.*?(?:ki\s+sphere|rainbow|ngọc|cầu\s+ki)', combined_context, re.I)
    ) or bool(
        re.search(r'(?:ki\s+sphere|rainbow\s+ki\s+sphere|ngọc\s+7\s+màu|cầu\s+ki)\s+(?:obtained|thu\s+được|nhận\s+được)', combined_context, re.I)
    ) or bool(
        re.search(r'\b(?:ki\s+sphere|cầu\s+ki)\b', hdr_lower)
    )

    bitmask = hdr_rules.get("bitmask", 63)
    if any(k in combined_context for k in ["rainbow", "7 màu", "bảy màu"]):
        bitmask = 32
    elif re.search(r'\bagl\b|nhanh nhẹn|xanh dương', combined_context): bitmask = 1
    elif re.search(r'\bteq\b|khéo léo|kỹ thuật|xanh lá', combined_context): bitmask = 2
    elif re.search(r'\bint\b|trí tuệ|tím', combined_context): bitmask = 4
    elif re.search(r'\bstr\b|sức mạnh|đỏ', combined_context): bitmask = 8
    elif re.search(r'\bphy\b|thể lực|cam|vàng', combined_context): bitmask = 16

    # 2. HP Scaling
    is_hp_scaling = ("the more hp remaining" in hdr_lower or "the less hp remaining" in hdr_lower or "càng nhiều hp" in hdr_lower or "càng ít hp" in hdr_lower)

    # 3. Stacking detection (Incremental boost)
    has_up_to = bool(re.search(r'\((?:up to|tối đa)\s*\+?(\d+)%?\)', text_no_img, re.I))
    has_forever = ("{passiveimg:forever}" in line_text.lower())
    has_stack_words = any(k in combined_context for k in [
        "with each attack", "per attack performed", "for every attack performed", "with each attack",
        "mỗi đòn đánh", "mỗi lần tấn công", "mỗi khi tấn công",
        "with each super attack", "per super attack performed", "for every super attack performed",
        "mỗi đòn tuyệt kỹ", "mỗi super attack", "mỗi sa",
        "with each attack received", "per attack received", "for every attack received",
        "mỗi đòn bị đánh", "mỗi khi nhận đòn", "mỗi lần nhận đòn",
        "with each turn passed", "per turn passed", "at the start of each turn", "at start of each turn",
        "mỗi lượt trôi qua", "đầu mỗi lượt",
        "evaded", "né được", "mỗi lần né"
    ])

    is_stacking = not is_hp_scaling and (
        hdr_rules.get("is_stacking", False) or
        (has_up_to and has_stack_words)
    )

    is_super_class_scaling = bool(re.search(r'\bper\s+(super|extreme)\s+class\s+ally', hdr_lower, re.I))
    is_category_scaling = bool(re.search(r'\bper\s+["\']?([^"\']+)["\']?\s+category ally', hdr_lower, re.I))

    generated_skills = []

    # 1. KI SPHERE
    if is_ki_sphere:
        # Ki per Ki sphere (Efficacy 96)
        ki_m = re.search(r'(?:receives? an additional\s*)?ki\s*\+(\d+)', text_no_img, re.I) or re.search(r'tăng\s*ki\s*\+(\d+)', text_no_img, re.I)
        if ki_m:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 96, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': bitmask, 'eff_value2': int(ki_m.group(1)), 'eff_value3': 0, 'efficacy_values': '{}'
            })
            
        # Stat per Ki sphere (Efficacy 68)
        ad_m = re.search(r'atk\s*&\s*def\s*\+?(\d+)%', text_no_img, re.I)
        if ad_m:
            val = int(ad_m.group(1))
            if bitmask == 63:
                generated_skills.append({
                    'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                    'efficacy_type': 61, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                    'probability': 100, 'eff_value1': val, 'eff_value2': val, 'eff_value3': 0, 'efficacy_values': '{}'
                })
            else:
                for stat_id in (1, 3):
                    generated_skills.append({
                        'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                        'efficacy_type': 68, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                        'probability': 100, 'eff_value1': bitmask, 'eff_value2': stat_id,
                        'eff_value3': val, 'efficacy_values': '{}'
                    })
        else:
            atk_k_m = re.search(r'\batk\s*\+?(\d+)%', text_no_img, re.I)
            if atk_k_m:
                val = int(atk_k_m.group(1))
                generated_skills.append({
                    'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                    'efficacy_type': 59 if bitmask == 63 else 68, 'calc_option': 2,
                    'turn': turn_val, 'is_once': is_once, 'probability': 100,
                    'eff_value1': val if bitmask == 63 else bitmask,
                    'eff_value2': 0 if bitmask == 63 else 1,
                    'eff_value3': 0 if bitmask == 63 else val, 'efficacy_values': '{}'
                })
            def_k_m = re.search(r'\bdef\s*\+?(\d+)%', text_no_img, re.I)
            if def_k_m:
                val = int(def_k_m.group(1))
                generated_skills.append({
                    'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                    'efficacy_type': 60 if bitmask == 63 else 68, 'calc_option': 2,
                    'turn': turn_val, 'is_once': is_once, 'probability': 100,
                    'eff_value1': val if bitmask == 63 else bitmask,
                    'eff_value2': 0 if bitmask == 63 else 3,
                    'eff_value3': 0 if bitmask == 63 else val, 'efficacy_values': '{}'
                })

        # Crit per Ki sphere (v2=4)
        crit_k_m = re.search(r'(?:critical hit|chí mạng)[^%\d]*\+?(\d+)%', text_no_img, re.I)
        if crit_k_m:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 68, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': bitmask, 'eff_value2': 4, 'eff_value3': int(crit_k_m.group(1)), 'efficacy_values': '{}'
            })

        # Dodge per Ki sphere (v2=5)
        dodge_k_m = re.search(r'(?:evad|dodg|né)[^%\d]*\+?(\d+)%', text_no_img, re.I)
        if dodge_k_m:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 68, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': bitmask, 'eff_value2': 5, 'eff_value3': int(dodge_k_m.group(1)), 'efficacy_values': '{}'
            })

        # Damage reduction per Ki sphere (v2=6)
        dr_k_m = re.search(r'(?:damage reduction|giảm sát thương)[^%\d]*\+?(\d+)%', text_no_img, re.I)
        if dr_k_m:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 68, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': bitmask, 'eff_value2': 6, 'eff_value3': int(dr_k_m.group(1)), 'efficacy_values': '{}'
            })

        # HP Recovery per Ki sphere (v2=2)
        rec_k_m = re.search(r'recovers?\s*(\d+)%?\s*hp', text_no_img, re.I) or re.search(r'hồi\s*(\d+)%?\s*hp', text_no_img, re.I)
        if rec_k_m:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 68, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': bitmask, 'eff_value2': 2, 'eff_value3': int(rec_k_m.group(1)), 'efficacy_values': '{}'
            })

    # 2. HP SCALING (Efficacy 71, 72, 73)
    elif is_hp_scaling:
        up_to_m = re.search(r'\(up to\s*(\d+)%\)', text_no_img, re.I)
        max_val = int(up_to_m.group(1)) if up_to_m else 200
        min_val = 1
        is_more = any(k in hdr_lower for k in ("the more hp remaining", "càng nhiều hp", "hp càng nhiều"))
        v_low = min_val if is_more else max_val
        v_high = max_val if is_more else min_val
        
        eff_hp = 73
        if "def" in text_lower and "atk" not in text_lower:
            eff_hp = 72
        elif "atk" in text_lower and "def" not in text_lower:
            eff_hp = 71

        generated_skills.append({
            'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
            'efficacy_type': eff_hp, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
            'probability': 100, 'eff_value1': v_low, 'eff_value2': v_high, 'eff_value3': 1100, 'efficacy_values': '{}'
        })

    # 3. STACKING (Efficacy 98)
    elif is_stacking:
        # Determine stack timing & causality
        if any(k in combined_context for k in ["receiv", "nhận đòn", "bị đánh"]):
            stack_timing = 7
            stack_caus = '{"source": "24", "compiled": 24}'
        elif any(k in combined_context for k in ["evaded", "né"]):
            stack_timing = 7
            stack_caus = '{"source": "365", "compiled": 365}'
        elif any(k in combined_context for k in ["start of each turn", "turn passed", "mỗi lượt", "đầu mỗi lượt"]):
            stack_timing = 1
            stack_caus = ""
        else:
            # Default for attack performed / when attacking / đòn đánh
            stack_timing = 5
            stack_caus = ""

        up_to_m = re.search(r'\((?:up to|tối đa)\s*\+?(\d+)%?\)', text_no_img, re.I)
        max_val = int(up_to_m.group(1)) if up_to_m else None
        stack_turn = 99 if (has_forever or turn_val == 0) else turn_val

        # Check ATK & DEF
        ad_inc_m = re.search(r'atk\s*&\s*def\s*\+?(\d+)%', text_no_img, re.I)
        if ad_inc_m:
            step_val = int(ad_inc_m.group(1))
            cap = max_val if max_val is not None else step_val * 5
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 0, 'efficacy_values': '{}'
            })
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 1, 'efficacy_values': '{}'
            })
        else:
            # Check ATK
            a_inc_m = re.search(r'\batk\s*\+?(\d+)%', text_no_img, re.I)
            if a_inc_m:
                step_val = int(a_inc_m.group(1))
                cap = max_val if max_val is not None else step_val * 5
                generated_skills.append({
                    'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                    'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                    'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 0, 'efficacy_values': '{}'
                })

            # Check DEF
            d_inc_m = re.search(r'\bdef\s*\+?(\d+)%', text_no_img, re.I)
            if d_inc_m:
                step_val = int(d_inc_m.group(1))
                cap = max_val if max_val is not None else step_val * 5
                generated_skills.append({
                    'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                    'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                    'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 1, 'efficacy_values': '{}'
                })

        # Check Critical Hit (eff_value3 = 2)
        crit_inc_m = re.search(r'(?:critical hit|chí mạng)[^%\d]*\+?(\d+)%', text_no_img, re.I) or re.search(r'(\d+)%[^%\d]*(?:critical hit|chí mạng)', text_no_img, re.I)
        if crit_inc_m:
            step_val = int(crit_inc_m.group(1))
            cap = max_val if max_val is not None else step_val * 5
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 2, 'efficacy_values': '{}'
            })

        # Check Dodge (eff_value3 = 3)
        dodge_inc_m = re.search(r'(?:evad|dodg|né)[^%\d]*\+?(\d+)%', text_no_img, re.I) or re.search(r'(\d+)%[^%\d]*(?:evad|dodg|né)', text_no_img, re.I)
        if dodge_inc_m:
            step_val = int(dodge_inc_m.group(1))
            cap = max_val if max_val is not None else step_val * 5
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 3, 'efficacy_values': '{}'
            })

        # Check Damage Reduction (eff_value3 = 4)
        dr_inc_m = re.search(r'(?:damage reduction|giảm sát thương)[^%\d]*\+?(\d+)%', text_no_img, re.I) or re.search(r'(\d+)%[^%\d]*(?:damage reduction|giảm sát thương)', text_no_img, re.I)
        if dr_inc_m:
            step_val = int(dr_inc_m.group(1))
            cap = max_val if max_val is not None else step_val * 5
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 2, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 4, 'efficacy_values': '{}'
            })

        # Check Ki (eff_value3 = 5, calc_option = 0)
        ki_inc_m = re.search(r'ki\s*\+(\d+)', text_no_img, re.I)
        if ki_inc_m:
            step_val = int(ki_inc_m.group(1))
            cap = max_val if max_val is not None else step_val * 5
            generated_skills.append({
                'exec_timing_type': stack_timing, 'target_type': 1, 'causality_conditions': stack_caus,
                'efficacy_type': 98, 'calc_option': 0, 'turn': stack_turn, 'is_once': 0,
                'probability': 100, 'eff_value1': step_val, 'eff_value2': cap, 'eff_value3': 5, 'efficacy_values': '{}'
            })

    # 4. CLASS ALLY SCALING ("Per Super Class ally on the team")
    elif is_super_class_scaling:
        cls_bitmask = 32 if "super" in hdr_lower else 64
        up_to_m = re.search(r'\(up to\s*(\d+)%\)', text_no_img, re.I)
        
        ad_m = re.search(r'atk\s*&\s*def\s*\+?(\d+)%', text_no_img, re.I)
        def_m = re.search(r'\bdef\s*\+?(\d+)%', text_no_img, re.I)
        atk_m = re.search(r'\batk\s*\+?(\d+)%', text_no_img, re.I)
        dr_m = re.search(r'(?:damage reduction(?: rate)?|reduces? damage(?: received)? by)\s*\+?(\d+)%', text_no_img, re.I)
        
        if ad_m or def_m or atk_m:
            step_val = int(ad_m.group(1)) if ad_m else (int(def_m.group(1)) if def_m else int(atk_m.group(1)))
            eff_t = 3 if ad_m else (2 if def_m else 1)
            max_total = int(up_to_m.group(1)) if up_to_m else step_val * 3
            
            rem = max_total
            step_num = 1
            while rem > 0 and step_num <= 7:
                curr_val = min(rem, step_val)
                c_id = 1796 + step_num if cls_bitmask == 32 else 0
                c_str = f'{{"source": "{c_id}", "compiled": {c_id}}}' if step_num > 1 else ""
                generated_skills.append({
                    'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': c_str,
                    'efficacy_type': eff_t, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                    'probability': 100, 'eff_value1': curr_val, 'eff_value2': curr_val if eff_t == 3 else 0, 'eff_value3': 0, 'efficacy_values': '{}'
                })
                rem -= curr_val
                step_num += 1

        if dr_m:
            step_dr = int(dr_m.group(1))
            max_dr = int(up_to_m.group(1)) if up_to_m else step_dr * 3
            num_steps = max_dr // step_dr if step_dr > 0 else 3
            for s_i in range(1, num_steps + 1):
                c_id = 1796 + s_i if cls_bitmask == 32 else 0
                c_str = f'{{"source": "{c_id}", "compiled": {c_id}}}' if s_i > 1 else ""
                generated_skills.append({
                    'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': c_str,
                    'efficacy_type': 13, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                    'probability': 100, 'eff_value1': 100 - step_dr, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
                })

    # 5. CATEGORY ALLY SCALING ("Per ... Category ally on the team")
    elif is_category_scaling:
        cat_cache = get_card_categories_cache()
        cat_match = re.search(r'per\s+["\']?([^"\']+)["\']?\s+category ally', hdr_lower, re.I)
        cat_raw = cat_match.group(1).strip().lower() if cat_match else ""
        if not cat_raw:
            hdr_m = re.search(r'["\']([^"\']+)["\']', current_header_condition)
            if hdr_m: cat_raw = hdr_m.group(1).strip().lower()

        matched_cat_id = None
        for cat_name, cid in cat_cache.items():
            if cat_name in cat_raw or cat_raw in cat_name:
                matched_cat_id = cid
                break

        if matched_cat_id:
            scope = 2 if ("same turn" in combined_context or "attacking in" in combined_context) else 0
            default_max = 3 if scope == 2 else 7
            up_to_m = re.search(r'\(up to\s*(\d+)%\)', text_no_img, re.I)

            ad_cat_m = re.search(r'atk\s*&\s*def\s*\+?(\d+)%', text_no_img, re.I)
            if ad_cat_m:
                val = int(ad_cat_m.group(1))
                max_count = min(default_max, int(up_to_m.group(1)) // val if up_to_m else default_max)
                for step in range(1, max_count + 1):
                    cid = find_best_causality_id(34, scope, matched_cat_id, step)
                    if cid is None:
                        continue
                    c_json = build_causality_json(cid)
                    generated_skills.append({
                        'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': c_json,
                        'efficacy_type': 3, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                        'probability': 100, 'eff_value1': val, 'eff_value2': val, 'eff_value3': 0, 'efficacy_values': '{}'
                    })

            dr_cat_m = re.search(r'(?:damage reduction(?: rate)?|reduces? damage(?: received)? by)\s*\+?(\d+)%', text_no_img, re.I)
            if dr_cat_m:
                val = int(dr_cat_m.group(1))
                max_count = min(default_max, int(up_to_m.group(1)) // val if up_to_m else default_max)
                for step in range(1, max_count + 1):
                    cid = find_best_causality_id(34, scope, matched_cat_id, step)
                    if cid is None:
                        continue
                    c_json = build_causality_json(cid)
                    generated_skills.append({
                        'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': c_json,
                        'efficacy_type': 13, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                        'probability': 100, 'eff_value1': 100 - val, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
                    })

    # 6. STANDARD DIRECT PASSIVE / MULTI-EFFECT LINE
    else:
        # Target detection
        target_type = 1
        enemy_stat_debuff = bool(re.search(r'\{passiveimg:down[^}]*\}', raw_clean, re.I))
        if enemy_stat_debuff and "extreme class enemies" in text_lower:
            target_type = 15
        elif enemy_stat_debuff and "super class enemies" in text_lower:
            target_type = 14
        elif enemy_stat_debuff and "all enemies" in text_lower:
            target_type = 4
        elif enemy_stat_debuff and ("attacked enemy" in text_lower or "enemy's" in text_lower):
            target_type = 3
            if exec_timing == 1:
                exec_timing = 4 if turn_m else 5
        elif "super class allies" in text_lower:
            target_type = 12
        elif "extreme class allies" in text_lower:
            target_type = 13
        elif "all allies" in text_lower or "allies'" in text_lower:
            target_type = 2
        stat_calc = 3 if enemy_stat_debuff and target_type in (3, 4, 14, 15) else 2
        stat_probability = 100
        if stat_calc == 3 and 'chance' in text_lower:
            if 'great chance' in text_lower: stat_probability = 70
            elif 'high chance' in text_lower: stat_probability = 50
            elif 'medium chance' in text_lower: stat_probability = 30
            elif 'rare chance' in text_lower: stat_probability = 7
            else: stat_probability = 10

        if re.search(r'survives?\s+k\.?o\.?\s+attacks?', text_lower):
            generated_skills.append({
                'exec_timing_type': 6, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 52, 'calc_option': 0, 'turn': 1, 'is_once': 0,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Dodge
        if re.search(r'(?:evad|dodge)', text_lower):
            d_rate = 50
            named_m = re.search(r'(rare|medium|high|great)\s*chance\s*of\s*(?:evading|dodging)', text_no_img, re.I)
            if named_m:
                g = named_m.group(1).lower()
                if g == 'rare': d_rate = 20
                elif g == 'medium': d_rate = 30
                elif g == 'high': d_rate = 50
                elif g == 'great': d_rate = 70
            else:
                pct_m = re.search(r'(\d+)%\s*(?:chance of\s*)?(?:evading|dodging)', text_no_img, re.I)
                if not pct_m:
                    pct_m = re.search(r'(?:evading|dodging)[^%\d]*\+?(\d+)%', text_no_img, re.I)
                if pct_m:
                    d_rate = int(pct_m.group(1))
                elif "great" in text_lower: d_rate = 70
                elif "medium" in text_lower: d_rate = 30
                elif "rare" in text_lower: d_rate = 20

            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 91, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': d_rate, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Ki
        ki_m = re.search(r'(?:allies[\'s]*\s*)?ki\s*\+(\d+)', text_no_img, re.I)
        if ki_m and not ("super attack" in text_lower and "ki +" not in text_lower):
            k_val = int(ki_m.group(1))
            class_support = target_type in (12, 13)
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                'efficacy_type': 83 if class_support else 5, 'calc_option': 0,
                'turn': turn_val, 'is_once': is_once, 'probability': 100,
                'eff_value1': (32 if target_type == 12 else 64) if class_support else k_val,
                'eff_value2': k_val if class_support else 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Guard
        if re.search(r'guards?\s*all\s*attacks?', text_lower):
            g_target = 12 if ("characters who also belong" in text_lower or "super class" in text_lower) else target_type
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': g_target, 'causality_conditions': caus_json,
                'efficacy_type': 78, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Super Effective
        if re.search(r'attacks?\s*(?:are\s*)?effective against all types?', text_lower):
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 76, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        if re.search(r'disables?\s+(?:the\s+)?enemy\'?s?\s+guard', text_lower):
            generated_skills.append({
                'exec_timing_type': 4 if exec_timing == 1 else exec_timing,
                'target_type': 3, 'causality_conditions': caus_json,
                'efficacy_type': 24, 'calc_option': 0, 'turn': 1, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        if re.search(r'(?:attacks?\s+(?:are\s+)?guaranteed\s+to\s+hit|always\s+hits?)', text_lower):
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1,
                'causality_conditions': caus_json, 'efficacy_type': 92,
                'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        if re.search(r'immune\s+to\s+negative\s+effects|prevents?\s+status\s+effects', text_lower):
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1,
                'causality_conditions': caus_json, 'efficacy_type': 50,
                'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        if re.search(r'\bunable\s+to\s+attack\b|\bcannot\s+attack\b', text_lower):
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1,
                'causality_conditions': caus_json, 'efficacy_type': 114,
                'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        absorb_m = re.search(r'recovers?\s+(\d+)%\s+of\s+damage\s+dealt\s+as\s+hp', text_lower)
        if absorb_m:
            generated_skills.append({
                'exec_timing_type': 5 if exec_timing == 1 else exec_timing,
                'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 28, 'calc_option': 0, 'turn': 1, 'is_once': is_once,
                'probability': 100, 'eff_value1': int(absorb_m.group(1)),
                'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Foresee Super Attack
        if re.search(r'foresees?\s*(?:enemy\'s\s*)?super attack', text_lower):
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 101, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Damage Reduction
        dr_m = re.search(r'(?:damage reduction(?: rate)?|reduces? damage(?: received)? by)\s*\+?(\d+)%', text_no_img, re.I)
        if dr_m:
            dr_val = int(dr_m.group(1))
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                'efficacy_type': 13, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 100 - dr_val, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Exchange / Standby
        if "exchange" in text_lower:
            generated_skills.append({
                'exec_timing_type': 1, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 131, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Ki Sphere Change (Efficacy 67)
        if re.search(r'changes?.*ki sphere', text_lower):
            target_orb = 32
            if "rainbow" in text_lower:
                target_orb = 32
            elif "to agl" in text_lower: target_orb = 1
            elif "to teq" in text_lower: target_orb = 2
            elif "to int" in text_lower: target_orb = 4
            elif "to str" in text_lower: target_orb = 8
            elif "to phy" in text_lower: target_orb = 16
            
            src_mask = 31
            if "agl excluded" in text_lower: src_mask = 30
            elif "teq excluded" in text_lower: src_mask = 29
            elif "int excluded" in text_lower: src_mask = 27
            elif "str excluded" in text_lower: src_mask = 23
            elif "phy excluded" in text_lower: src_mask = 15

            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 67, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': src_mask, 'eff_value2': target_orb, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check HP Recovery
        rec_m = re.search(r'recovers?\s*(\d+)%\s*hp', text_no_img, re.I)
        if rec_m:
            rec_val = int(rec_m.group(1))
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 4, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': rec_val, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Additional Attack
        if re.search(r'additional\s+(?:super\s+)?attacks?', text_lower):
            count_m = re.search(r'launches\s*(?:up\s+to\s+)?(\d+)\s*additional', text_lower)
            num_attacks = int(count_m.group(1)) if count_m else 1
            sa_chance = 100 if "additional super attack" in text_lower else (
                70 if "great chance" in text_lower else (
                50 if "high chance" in text_lower else (
                30 if "medium chance" in text_lower else 0)))
            for _ in range(num_attacks):
                generated_skills.append({
                    'exec_timing_type': exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                    'efficacy_type': 81, 'calc_option': 0, 'turn': turn_val, 'is_once': is_once,
                    'probability': 100, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': sa_chance, 'efficacy_values': '{}'
                })

        # Dokkan's action break is efficacy 111, not stun or SA seal.
        if (re.search(r"\b(?:break(?:ing)?|interrupt(?:s|ing)?)\b.*?\benemy(?:'s)?\s+action", text_lower)
                or re.search(r'\binterrupts?\s+(?:the\s+)?attacked\s+enemy\b', text_lower)):
            break_probability = (70 if 'great chance' in text_lower else
                                 50 if 'high chance' in text_lower else
                                 30 if 'medium chance' in text_lower else
                                 20 if 'rare chance' in text_lower else 100)
            generated_skills.append({
                'exec_timing_type': 5, 'target_type': 3, 'causality_conditions': caus_json,
                'efficacy_type': 111, 'calc_option': 0, 'turn': 1,
                'is_once': 1 if 'once' in text_lower else is_once,
                'probability': break_probability, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })

        # A countering nullification is a linked nullify + counter pair. The
        # capacity-cancellation row seen in official sets references the set ID.
        is_nullify = bool(re.search(r'\bnullif(?:y|ies|ying)\b', text_lower))
        is_counter = bool(re.search(r'\bcounters?\b', text_lower))
        if is_nullify:
            nullify_probability = (70 if 'great chance' in text_lower else
                                   50 if 'high chance' in text_lower else
                                   30 if 'medium chance' in text_lower else
                                   20 if 'rare chance' in text_lower else 100)
            generated_skills.append({
                'exec_timing_type': 6, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 119, 'calc_option': 0, 'turn': 1, 'is_once': is_once,
                'probability': nullify_probability, 'eff_value1': 0, 'eff_value2': 0,
                'eff_value3': 0, 'efficacy_values': '{}'
            })
            if is_counter:
                multiplier = (400 if 'ferocious' in text_lower else
                              300 if 'tremendous' in text_lower else
                              200 if 'enormous' in text_lower else 0)
                generated_skills.append({
                    'exec_timing_type': 6, 'target_type': 1, 'causality_conditions': caus_json,
                    'efficacy_type': 120, 'calc_option': 0, 'turn': 1, 'is_once': is_once,
                    'probability': nullify_probability, 'eff_value1': 0,
                    'eff_value2': multiplier, 'eff_value3': 0, 'efficacy_values': '{}'
                })
            if passive_set_id is not None:
                generated_skills.append({
                    'exec_timing_type': 7, 'target_type': 1, 'causality_conditions': '',
                    'efficacy_type': 110, 'calc_option': 0, 'turn': 1, 'is_once': 0,
                    'probability': 100, 'eff_value1': 2, 'eff_value2': int(passive_set_id),
                    'eff_value3': 0, 'efficacy_values': '{}'
                })

        # Check Critical Hit
        crit_m = re.search(r'(rare|medium|high|great)\s*chance of performing a critical hit', text_no_img, re.I)
        crit_pct_m = re.search(r'(?:critical hit|performing a critical hit)[^%\d]*\+?(\d+)%', text_no_img, re.I)
        if not crit_pct_m:
            crit_pct_m = re.search(r'(\d+)%\s*(?:chance of performing a\s*)?critical hit', text_no_img, re.I)
            
        if crit_m or crit_pct_m or re.search(r'performs?\s*a\s*critical hit', text_no_img, re.I) or "critical hit" in text_lower:
            c_rate = 100
            if crit_pct_m:
                c_rate = int(crit_pct_m.group(1))
            elif crit_m and crit_m.group(1):
                cg = crit_m.group(1).lower()
                if cg == 'great': c_rate = 70
                elif cg == 'high': c_rate = 50
                elif cg == 'medium': c_rate = 30
                elif cg == 'rare': c_rate = 20
            elif "great chance" in text_lower: c_rate = 70
            elif "high chance" in text_lower: c_rate = 50
            elif "medium chance" in text_lower: c_rate = 30
            elif "rare chance" in text_lower: c_rate = 20
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                'efficacy_type': 90, 'calc_option': 2, 'turn': turn_val, 'is_once': is_once,
                'probability': 100, 'eff_value1': c_rate, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Stun
        if re.search(r'stuns?\s*(?:the\s*)?(?:attacked\s*)?enemy', text_lower):
            stun_prob = 100
            if "great chance" in text_lower: stun_prob = 70
            elif "high chance" in text_lower: stun_prob = 50
            elif "medium chance" in text_lower: stun_prob = 30
            elif "rare chance" in text_lower: stun_prob = 20
            generated_skills.append({
                'exec_timing_type': 4 if exec_timing == 1 else exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 9, 'calc_option': 0, 'turn': turn_val or 2, 'is_once': is_once,
                'probability': stun_prob, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check Seal
        if re.search(r'seals?\s*(?:the\s*)?(?:attacked\s*)?enemy\'?s?\s*super attack', text_lower):
            seal_prob = 100
            if "great chance" in text_lower: seal_prob = 70
            elif "high chance" in text_lower: seal_prob = 50
            elif "medium chance" in text_lower: seal_prob = 30
            elif "rare chance" in text_lower: seal_prob = 20
            generated_skills.append({
                'exec_timing_type': 4 if exec_timing == 1 else exec_timing, 'target_type': 1, 'causality_conditions': caus_json,
                'efficacy_type': 10, 'calc_option': 0, 'turn': turn_val or 2, 'is_once': is_once,
                'probability': seal_prob, 'eff_value1': 0, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
            })

        # Check ATK & DEF +X%
        ad_m = re.search(r'atk\s*&\s*def\s*\+?(\d+)%', text_no_img, re.I)
        split_ad_m = re.search(r'\batk\s*\+?(\d+)%\s*(?:and|&)\s*def\s*\+?(\d+)%', text_no_img, re.I)
        if ad_m:
            val = int(ad_m.group(1))
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                'efficacy_type': 3, 'calc_option': stat_calc, 'turn': turn_val, 'is_once': is_once,
                'probability': stat_probability, 'eff_value1': val, 'eff_value2': val, 'eff_value3': 0, 'efficacy_values': '{}'
            })
        elif split_ad_m:
            generated_skills.append({
                'exec_timing_type': exec_timing, 'target_type': target_type,
                'causality_conditions': caus_json, 'efficacy_type': 3,
                'calc_option': stat_calc, 'turn': turn_val, 'is_once': is_once,
                'probability': stat_probability, 'eff_value1': int(split_ad_m.group(1)),
                'eff_value2': int(split_ad_m.group(2)), 'eff_value3': 0,
                'efficacy_values': '{}'
            })
        else:
            atk_m = re.search(r'\batk\s*\+?(\d+)%', text_no_img, re.I)
            if atk_m:
                val = int(atk_m.group(1))
                generated_skills.append({
                    'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                    'efficacy_type': 1, 'calc_option': stat_calc, 'turn': turn_val, 'is_once': is_once,
                    'probability': stat_probability, 'eff_value1': val, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
                })
            def_m = re.search(r'\bdef\s*\+?(\d+)%', text_no_img, re.I)
            if def_m:
                val = int(def_m.group(1))
                generated_skills.append({
                    'exec_timing_type': exec_timing, 'target_type': target_type, 'causality_conditions': caus_json,
                    'efficacy_type': 2, 'calc_option': stat_calc, 'turn': turn_val, 'is_once': is_once,
                    'probability': stat_probability, 'eff_value1': val, 'eff_value2': 0, 'eff_value3': 0, 'efficacy_values': '{}'
                })

    # In the game's passive_skills table, 1 is the ordinary persistent passive
    # duration. Zero here was a parser placeholder, not an intended duration.
    for skill in generated_skills:
        if skill.get('turn') == 0:
            skill['turn'] = 1
    return generated_skills

def split_passive_description(text):
    if not text:
        return []
    raw_lines = text.split('\n')
    lines = []
    current_line = ""
    for line in raw_lines:
        line_stripped = line.strip()
        if not line_stripped:
            continue
        if line_stripped.startswith(('-', '–', '—', '•', '*')):
            if current_line:
                lines.append(current_line)
            current_line = line_stripped
        else:
            if current_line:
                current_line += " " + line_stripped
            else:
                current_line = line_stripped
    if current_line:
        lines.append(current_line)
    return lines

def parse_full_passive_description(full_text):
    desc_lines = split_passive_description(full_text)
    current_header = ""
    compiled_skills = []

    for line_idx, line in enumerate(desc_lines):
        line_clean = line.strip()
        if not line_clean:
            continue
        if line_clean.startswith('*'):
            current_header = line_clean.replace('*', '').strip()
            continue
            
        skills_from_line = parse_single_line(line_clean, current_header)
        for sk in skills_from_line:
            sk['manual_desc_idx'] = line_idx
            compiled_skills.append(sk)

    return compiled_skills


def match_skills_to_description(skills, full_text, preferred_set_id=None):
    """Reverse-align DB efficacy rows with the same per-line compiler used to create them.

    This is display metadata only: uncertain rows stay unmatched rather than
    claiming a guessed description is an exact source.
    """
    lines = split_passive_description(full_text)
    header = ""
    candidates = []
    for line_idx, line in enumerate(lines):
        if line.startswith('*'):
            header = line.strip('* ').strip()
            continue
        for parsed in parse_single_line(line, header, preferred_set_id):
            candidates.append((line_idx, parsed))

    results = []
    count = max(len(skills), 1)
    line_count = max(len(lines), 1)
    for skill_idx, skill in enumerate(skills):
        skill_type = int(skill.get('efficacy_type') or 0)
        best = None
        for line_idx, candidate in candidates:
            if int(candidate.get('efficacy_type') or 0) != skill_type:
                continue
            score = 50.0
            for key in ('eff_value1', 'eff_value2', 'eff_value3'):
                actual = int(skill.get(key) or 0)
                expected = int(candidate.get(key) or 0)
                if actual and expected:
                    score += 13 if actual == expected else -8
                elif actual == expected == 0:
                    score += 1
            if int(skill.get('exec_timing_type') or 1) == int(candidate.get('exec_timing_type') or 1):
                score += 5
            if int(skill.get('probability') or 100) == int(candidate.get('probability') or 100):
                score += 3
            score -= 8 * abs(skill_idx / count - line_idx / line_count)
            if best is None or score > best[0]:
                best = (score, line_idx)
        if best and best[0] >= 49:
            results.append({'index': best[1], 'confidence': 'compiler'})
            continue

        # The compiler does not yet cover every game efficacy. Use a conservative
        # type-name + value fallback and label it as a suggestion in the UI.
        try:
            from modules.core.db import efficacy_dict
            label = str(efficacy_dict.get(skill_type, ''))
        except Exception:
            label = ''
        terms = [word for word in re.findall(r'[a-z]{3,}', label.lower())
                 if word not in {'boost', 'reduction', 'effect', 'chance', 'type', 'value', 'skill'}]
        if not terms:
            results.append({'index': None, 'confidence': None})
            continue
        values = {int(skill.get(key) or 0) for key in ('eff_value1', 'eff_value2', 'eff_value3')}
        values.discard(0)
        fallback = None
        for line_idx, line in enumerate(lines):
            if line.startswith('*'):
                continue
            low = line.lower()
            hits = sum(term in low for term in terms)
            if not hits:
                continue
            numbers = {int(n) for n in re.findall(r'\d+', low)}
            score = hits * 5 + (7 if numbers & values else 0)
            score -= 5 * abs(skill_idx / count - line_idx / line_count)
            if fallback is None or score > fallback[0]:
                fallback = (score, line_idx)
        results.append({'index': fallback[1], 'confidence': 'suggested'}
                       if fallback and fallback[0] >= 9 else {'index': None, 'confidence': None})

    # Relation order usually follows the itemized text. Fill only the remaining
    # gaps between confident anchors; the UI explicitly marks these as guesses.
    bullets = [idx for idx, line in enumerate(lines) if not line.startswith('*')]
    if bullets:
        for pos, result in enumerate(results):
            if result['index'] is not None:
                continue
            before = next((i for i in range(pos - 1, -1, -1) if results[i]['index'] is not None), None)
            after = next((i for i in range(pos + 1, len(results)) if results[i]['index'] is not None), None)
            if before is not None and after is not None:
                left, right = results[before]['index'], results[after]['index']
                target = left + (right - left) * (pos - before) / (after - before)
            elif before is not None:
                target = results[before]['index'] + (pos - before) * len(lines) / count
            elif after is not None:
                target = results[after]['index'] - (after - pos) * len(lines) / count
            else:
                target = bullets[min(len(bullets) - 1, int(pos * len(bullets) / count))]
            result['index'] = min(bullets, key=lambda idx: abs(idx - target))
            result['confidence'] = 'suggested'
    return results


def _exact_db_description_skills(full_text, preferred_set_id=None):
    """Reuse official rows only for an identical complete description."""
    if not os.path.isfile(DB_PATH):
        return []
    normalized = '\n'.join(line.rstrip() for line in full_text.strip().splitlines())
    if not normalized:
        return []
    try:
        with closing(sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            set_row = conn.execute(
                """SELECT id FROM passive_skill_sets
                   WHERE trim(itemized_description) = ?
                   ORDER BY CASE WHEN id = ? THEN 0 ELSE 1 END, id LIMIT 1""",
                (normalized, preferred_set_id)
            ).fetchone()
            if not set_row:
                # Official descriptions wrap long clauses over multiple lines.
                # Compare whitespace-normalized *whole* descriptions only; no
                # fuzzy partial match that could copy another character's skill.
                canonical = re.sub(r'\s+', ' ', normalized).strip().casefold()
                candidates = conn.execute(
                    'SELECT id, itemized_description FROM passive_skill_sets WHERE itemized_description IS NOT NULL'
                ).fetchall()
                matches = [row for row in candidates if re.sub(
                    r'\s+', ' ', row['itemized_description']
                ).strip().casefold() == canonical]
                if matches:
                    set_row = next(
                        (row for row in matches if row['id'] == preferred_set_id),
                        matches[0]
                    )
            if not set_row:
                return []
            rows = conn.execute("""
                SELECT p.* FROM passive_skill_set_relations AS r
                JOIN passive_skills AS p ON p.id = r.passive_skill_id
                WHERE r.passive_skill_set_id = ? ORDER BY r.id
            """, (set_row['id'],)).fetchall()
            result = []
            for row in rows:
                skill = dict(row)
                skill['_source_had_animation'] = bool(skill.get('passive_skill_effect_id'))
                for field in ('id', 'name', 'created_at', 'updated_at', 'passive_skill_effect_id'):
                    skill.pop(field, None)
                result.append(skill)
            return result
    except sqlite3.Error:
        return []


def _structured_db_template_skills(full_text, preferred_set_id=None):
    """Reuse a complete DB skill *shape* only when every word matches after
    numbers/icons are removed. Values are deliberately not guessed or remapped.
    """
    skeleton = normalize_text_skeleton(full_text)
    if len(skeleton.split()) < 15 or not os.path.isfile(DB_PATH):
        return [], None
    target_numbers = extract_numbers_from_text(full_text)
    try:
        with closing(sqlite3.connect(f"file:{DB_PATH}?mode=ro", uri=True)) as conn:
            conn.row_factory = sqlite3.Row
            candidates = []
            for row in conn.execute(
                'SELECT id, itemized_description FROM passive_skill_sets '
                'WHERE itemized_description IS NOT NULL'
            ):
                if normalize_text_skeleton(row['itemized_description']) != skeleton:
                    continue
                source_numbers = extract_numbers_from_text(row['itemized_description'])
                distance = sum(abs(a - b) for a, b in zip(target_numbers, source_numbers))
                distance += 1000 * abs(len(target_numbers) - len(source_numbers))
                priority = 0 if row['id'] == preferred_set_id else 1
                candidates.append((priority, distance, row['id']))
            if not candidates:
                return [], None
            source_id = min(candidates)[2]
            rows = conn.execute(
                'SELECT p.* FROM passive_skill_set_relations r '
                'JOIN passive_skills p ON p.id = r.passive_skill_id '
                'WHERE r.passive_skill_set_id = ? ORDER BY r.id', (source_id,)
            ).fetchall()
            skills = []
            for row in rows:
                skill = dict(row)
                for field in ('id', 'name', 'created_at', 'updated_at', 'passive_skill_effect_id'):
                    skill.pop(field, None)
                skills.append(skill)
            return skills, source_id
    except sqlite3.Error:
        return [], None


def compile_passive_description(full_text, preferred_set_id=None):
    """Return editable skill proposals with explicit coverage warnings."""
    lines = split_passive_description(full_text)
    if not lines:
        return {'skills': [], 'warnings': ['Mô tả đang trống.'], 'source': 'rules', 'compiler_version': COMPILER_VERSION}

    exact_skills = _exact_db_description_skills(full_text, preferred_set_id)
    if exact_skills:
        for skill, match in zip(exact_skills, match_skills_to_description(exact_skills, full_text, preferred_set_id)):
            if match['index'] is not None:
                skill['manual_desc_idx'] = match['index']
                skill['source_match_confidence'] = match['confidence']
        warnings = []
        if any(sk.pop('_source_had_animation', False) for sk in exact_skills):
            warnings.append('Mẫu gốc có animation passive; kiểm tra liên kết animation sau khi tạo.')
        if any(int(sk.get('efficacy_type') or 0) in (79, 103, 131) for sk in exact_skills):
            warnings.append('Có hiệu ứng biến hình/đổi nhân vật: kiểm tra lại ID thẻ đích sau khi tạo.')
        return {'skills': exact_skills, 'warnings': warnings, 'source': 'database', 'compiler_version': COMPILER_VERSION}

    skills = []
    warnings = []
    header = ''
    for line_idx, line in enumerate(lines):
        if line.startswith('*'):
            header = line.strip('* ').strip()
            rules = resolve_header_rules(header)
            logical_header = re.sub(r'\bor\s+(?:more|less|below|above)\b', '', header, flags=re.I)
            hp_on_receive = bool(re.search(r'hp\s+is\s+\d+%\s+or\s+(?:less|below)', header, re.I)
                                 and re.search(r'(?:before|when)\s+receiving\s+an?\s+attack', header, re.I))
            if not hp_on_receive and re.search(r'\b(?:and|or)\b|&&|\|\|', logical_header, re.I) and re.search(
                r'when|if|after|while|facing|khi|nếu|sau', header, re.I
            ):
                warnings.append(f'Điều kiện ghép cần kiểm tra thủ công: {header}')
            if rules.get('timing') is None and not rules.get('causality'):
                warnings.append(f'Điều kiện chưa nhận diện: {header}')
            elif not rules.get('causality') and re.search(
                r'hp\s+(?:is|above|below)|category\s+(?:enemy|ally)|'
                r'kẻ\s*địch\s*thuộc|đồng\s*minh\s*thuộc|'
                r'\b(?:slot|attacker)\s*[123]|when\s+facing|'
                r'after\s+guard|ultra\s+super\s+attack',
                header, re.I
            ):
                warnings.append(f'Chưa tìm thấy ID điều kiện chính xác cho: {header}')
            continue
        parsed = parse_single_line(line, header, preferred_set_id)
        if re.search(r'per\s+(?:super|extreme)\s+class\s+ally|per\s+.+?category\s+ally', header, re.I):
            warnings.append(f'Dòng {line_idx + 1}: kiểm tra điều kiện đếm đồng minh và mức trần.')
        if not parsed:
            warnings.append(f'Dòng {line_idx + 1} chưa sinh được hiệu ứng: {line}')
        if any(int(sk.get('efficacy_type') or 0) == 119 for sk in parsed):
            warnings.append(f'Dòng {line_idx + 1}: kiểm tra animation ID của nullify/counter (eff_value3) và capacity ID của efficacy 110; mô tả không chứa các ID này.')
            if preferred_set_id is None:
                warnings.append(f'Dòng {line_idx + 1}: chưa có passive set ID nên chưa thể sinh efficacy 110.')
            if any(int(sk.get('efficacy_type') or 0) == 120 and not sk.get('eff_value2') for sk in parsed):
                warnings.append(f'Dòng {line_idx + 1}: chưa có hệ số counter chính xác cho mức sức mạnh này; chỉnh eff_value2 của efficacy 120 theo mẫu DB.')
        if any(int(sk.get('efficacy_type') or 0) in (71, 72, 73) for sk in parsed):
            warnings.append(f'Dòng {line_idx + 1}: kiểm tra mức tối thiểu của HP scaling (DB có nhiều biến thể).')
        if any(int(sk.get('efficacy_type') or 0) == 98 for sk in parsed) and not re.search(
            r'\((?:up to|tối đa)\s*\+?\d+%?\)', line, re.I
        ):
            warnings.append(f'Dòng {line_idx + 1}: không có giới hạn stacking; parser đang dùng mức trần ước lượng.')
        for skill in parsed:
            skill['manual_desc_idx'] = line_idx
            skills.append(skill)
    if any('chưa sinh được hiệu ứng' in warning for warning in warnings):
        template_skills, template_id = _structured_db_template_skills(full_text, preferred_set_id)
        if template_skills:
            for skill, match in zip(template_skills, match_skills_to_description(template_skills, full_text, preferred_set_id)):
                if match['index'] is not None:
                    skill['manual_desc_idx'] = match['index']
                    skill['source_match_confidence'] = match['confidence']
            return {
                'skills': template_skills,
                'warnings': [
                    f'Khớp cấu trúc với passive set #{template_id} trong DB. '
                    'Các giá trị số và ID animation/capacity là của mẫu tham chiếu; '
                    'phải chỉnh và kiểm tra từng dòng trước khi Save.'
                ],
                'source': 'database-template', 'compiler_version': COMPILER_VERSION
            }
    return {'skills': skills, 'warnings': warnings, 'source': 'rules', 'compiler_version': COMPILER_VERSION}
