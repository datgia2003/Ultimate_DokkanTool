# -*- coding: utf-8 -*-
"""Compile non-passive skills using database patterns and changed numbers."""

import re
import json
import sqlite3
import os
from difflib import SequenceMatcher
from collections import defaultdict, Counter
from functools import lru_cache
from modules.core.config import DB_PATH

COMPILER_VERSION = "2026-09-25.4"

_CATEGORIES = None
_SUBTARGETS = None
_CATEGORY_REGEX = None
_CATEGORY_IDS = None


def _category_data():
    global _CATEGORIES, _SUBTARGETS, _CATEGORY_REGEX, _CATEGORY_IDS
    if _CATEGORIES is None:
        with get_db_connection() as conn:
            _CATEGORIES = sorted(conn.execute('SELECT id, name FROM card_categories').fetchall(),
                                 key=lambda row: len(row[1]), reverse=True)
            _CATEGORY_IDS = {name.casefold(): cid for cid, name in _CATEGORIES}
            _CATEGORY_REGEX = re.compile(
                r'(?<!\w)(?:' + '|'.join(re.escape(name) for _, name in _CATEGORIES)
                + r')(?!\w)', re.I)
            sets = defaultdict(list)
            for sid, value_type, value in conn.execute(
                    'SELECT sub_target_type_set_id, target_value_type, target_value '
                    'FROM sub_target_types ORDER BY id'):
                sets[sid].append((value_type, value))
            _SUBTARGETS = dict(sets)
    return _CATEGORIES, _SUBTARGETS


@lru_cache(maxsize=30000)
def _category_mentions(description):
    _category_data()
    return tuple((match.start(), match.end(), _CATEGORY_IDS[match.group().casefold()])
                 for match in _CATEGORY_REGEX.finditer(description))


def _remap_leader_categories(skills, source_description, description):
    old = [cid for _, _, cid in _category_mentions(source_description)]
    new = [cid for _, _, cid in _category_mentions(description)]
    if old == new:
        return True
    if len(old) != len(new) or len(set(old)) != len(old):
        return False
    replacements = dict(zip(old, new))
    _, sets = _category_data()
    signature_to_id = {tuple(values): sid for sid, values in sorted(sets.items(), reverse=True)}
    used = set()
    pending = {}
    for skill in skills:
        sid = skill.get('sub_target_type_set_id')
        if not sid or sid not in sets:
            continue
        current = sets[sid]
        changed = [(value_type, replacements.get(value, value) if value_type == 1 else value)
                   for value_type, value in current]
        if changed != current:
            used.update(value for value_type, value in current if value_type == 1 and value in replacements)
            replacement = signature_to_id.get(tuple(changed))
            if replacement is None:
                signature = tuple(changed)
                replacement = pending.setdefault(signature, -len(pending) - 1)
                skill['_sub_target_types'] = [list(entry) for entry in changed]
            skill['sub_target_type_set_id'] = replacement
    return used == {cid for cid, target in replacements.items() if cid != target}


def _exact_database_skills(set_table, description_field, skill_table, set_field,
                           description, preferred_set_id, allow_empty=False):
    """Reuse real efficacy rows only when the full description matches.

    A numeric skeleton is unsafe here: the same Leader sentence may encode
    Ki +2 / 60% or Ki +3 / 100%, and category IDs are not in the text.
    """
    normalized = re.sub(r'\s+', ' ', description).strip().casefold()
    with get_db_connection() as conn:
        conn.row_factory = sqlite3.Row
        candidates = []
        if preferred_set_id:
            row = conn.execute(
                f'SELECT * FROM "{set_table}" WHERE id = ?',
                (int(preferred_set_id),)
            ).fetchone()
            if row:
                candidates.append(row)
        candidates.extend(conn.execute(
            f'SELECT * FROM "{set_table}" WHERE "{description_field}" = ? '
            'ORDER BY id DESC', (description,)
        ).fetchall())
        seen = set()
        for row in candidates:
            sid = row['id']
            if sid in seen:
                continue
            seen.add(sid)
            if re.sub(r'\s+', ' ', row[description_field] or '').strip().casefold() != normalized:
                continue
            skills = [dict(item) for item in conn.execute(
                f'SELECT * FROM "{skill_table}" WHERE "{set_field}" = ? ORDER BY id',
                (sid,)
            )]
            if skills or allow_empty:
                if not preferred_set_id or sid != int(preferred_set_id):
                    for skill in skills:
                        skill.pop('id', None)
                        skill.pop(set_field, None)
                        if preferred_set_id:
                            skill[set_field] = int(preferred_set_id)
                return dict(row), skills
    return None


def _unsupported(kind):
    return f'Chưa tìm được mẫu cấu trúc phù hợp cho {kind} trong database.'


def _number_map(template_text, description):
    old = extract_numbers(template_text)
    new = extract_numbers(description)
    if len(old) != len(new):
        return None
    occurrences = {}
    for before, after in zip(old, new):
        occurrences.setdefault(before, []).append(after)
    mapping = {before: values[0] for before, values in occurrences.items()
               if len(set(values)) == 1}
    ambiguous = {before: values for before, values in occurrences.items()
                 if len(set(values)) > 1}
    return mapping, ambiguous


def _adapt_ambiguous(skills, ambiguous, kind):
    """Map repeated prose values to consecutive efficacy rows in clause order."""
    for before, targets in ambiguous.items():
        references = []
        json_values = {}
        for skill in skills:
            for field in ('eff_val1', 'eff_val2', 'eff_val3',
                          'eff_value1', 'eff_value2', 'eff_value3'):
                if skill.get(field) == before:
                    references.append((skill, field, None, None))
            raw = skill.get('efficacy_values')
            if raw:
                try:
                    value = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                json_values[id(skill)] = (skill, value)
                def visit(container):
                    if isinstance(container, list):
                        for index, item in enumerate(container):
                            if item == before and not isinstance(item, bool):
                                if not (kind == 'leader' and index == 0 and
                                        skill.get('efficacy_type') in (16, 17, 18, 19, 20, 82, 83)):
                                    references.append((skill, None, container, index))
                            else:
                                visit(item)
                    elif isinstance(container, dict):
                        for key, item in container.items():
                            if item == before and not isinstance(item, bool):
                                references.append((skill, None, container, key))
                            else:
                                visit(item)
                visit(value)
        if not references or len(references) % len(targets):
            continue
        group_size = len(references) // len(targets)
        for index, (skill, field, container, key) in enumerate(references):
            replacement = targets[index // group_size]
            if field:
                skill[field] = replacement
            else:
                container[key] = replacement
        for skill, value in json_values.values():
            skill['efficacy_values'] = json.dumps(
                value, ensure_ascii=False, separators=(',', ':'))


def _adapt_value(value, mapping):
    if isinstance(value, bool):
        return value
    if isinstance(value, int):
        return mapping.get(value, value)
    if isinstance(value, float):
        return mapping.get(value, value)
    if isinstance(value, list):
        return [_adapt_value(item, mapping) for item in value]
    if isinstance(value, dict):
        return {key: _adapt_value(item, mapping) for key, item in value.items()}
    return value


def _adapt_json(raw, mapping, efficacy_type=None, kind=None):
    if not raw:
        return raw
    try:
        value = json.loads(raw)
    except (TypeError, ValueError):
        return raw
    if kind == 'leader' and isinstance(value, list) and value:
        # The first slot in these efficacy types is an element/category mask.
        if efficacy_type in (16, 17, 18, 19, 20, 82, 83):
            value = [value[0], *[_adapt_value(item, mapping) for item in value[1:]]]
        elif efficacy_type == 13 and isinstance(value[0], (int, float)):
            inverse = {100 - old: 100 - new for old, new in mapping.items()}
            value = [_adapt_value(value[0], inverse),
                     *[_adapt_value(item, mapping) for item in value[1:]]]
        else:
            value = _adapt_value(value, mapping)
    else:
        value = _adapt_value(value, mapping)
    return json.dumps(value, ensure_ascii=False, separators=(',', ':'))


def _duration_map(source, description):
    pattern = r'\b(?:for|by for)\s+(\d+)\s+turns?\b'
    old = [int(value) for value in re.findall(pattern, source, re.I)]
    new = [int(value) for value in re.findall(pattern, description, re.I)]
    if len(old) != len(new):
        return {}
    return dict(zip(old, new))


def _adapt_standby_charge(skills, source, description):
    pattern = r'charge count\s+increases by\s+(\d+)\s+per Ki Sphere obtained by allies'
    old = re.search(pattern, source, re.I)
    new = re.search(pattern, description, re.I)
    if not old or not new or old.group(1) == new.group(1):
        return
    count = int(new.group(1))
    for skill in skills:
        if skill.get('efficacy_type') != 116:
            continue
        try:
            value = json.loads(skill.get('efficacy_values') or '{}')
        except (TypeError, ValueError):
            continue
        if isinstance(value, dict) and value.get('energy_ball') == {}:
            value['energy_ball'] = {'multiplier': [count] * 6} if count != 1 else {}
            skill['efficacy_values'] = json.dumps(value, ensure_ascii=False,
                                                   separators=(',', ':'))


def _template_skills(description, preferred_set_id, corpus, set_table,
                     description_field, skill_table, set_field, kind):
    skeleton = normalize_skeleton(description)
    wanted_numbers = extract_numbers(description)
    candidates = []
    for item in corpus:
        numbers = extract_numbers(item['desc'])
        if len(numbers) != len(wanted_numbers):
            continue
        if kind == 'special':
            similarity = SequenceMatcher(None, normalize_skeleton(_mask_damage_tier(description)),
                                         normalize_skeleton(_mask_damage_tier(item['desc']))).ratio()
        else:
            similarity = SequenceMatcher(None, skeleton, item['skel']).ratio()
        if similarity < (0.84 if kind == 'leader' else 0.90):
            continue
        if kind == 'leader' and len(_category_mentions(item['desc'])) != len(_category_mentions(description)):
            continue
        number_mapping = _number_map(item['desc'], description)
        if number_mapping is None:
            continue
        distance = sum(abs(a - b) / max(1, abs(a), abs(b))
                       for a, b in zip(numbers, wanted_numbers))
        preferred = bool(preferred_set_id and item['id'] == int(preferred_set_id))
        candidates.append((1 - similarity, 0 if preferred else 1, distance,
                           -item['id'], item, number_mapping))
    if not candidates:
        return None
    for _, _, _, _, template, (mapping, ambiguous) in sorted(candidates, key=lambda row: row[:4]):
        match = _exact_database_skills(set_table, description_field, skill_table,
                                       set_field, template['desc'], template['id'], allow_empty=kind == 'special')
        if not match:
            continue
        row, skills = match
        if kind == 'leader' and not _remap_leader_categories(skills, template['desc'], description):
            continue
        break
    else:
        return None
    durations = _duration_map(template['desc'], description)
    for skill in skills:
        if not preferred_set_id or row['id'] != int(preferred_set_id):
            skill.pop('id', None)
            skill.pop(set_field, None)
            if preferred_set_id:
                skill[set_field] = int(preferred_set_id)
        if 'efficacy_values' in skill:
            skill['efficacy_values'] = _adapt_json(
                skill['efficacy_values'], mapping, skill.get('efficacy_type'), kind)
        for field in ('eff_val1', 'eff_val2', 'eff_val3',
                      'eff_value1', 'eff_value2', 'eff_value3'):
            if field in skill:
                skill[field] = _adapt_value(skill[field], mapping)
        if 'turn' in skill:
            skill['turn'] = durations.get(skill['turn'], skill['turn'])
        if 'prob' in skill and 'chance' in description.lower():
            skill['prob'] = _adapt_value(skill['prob'], mapping)
    _adapt_ambiguous(skills, ambiguous, kind)
    if kind == 'standby':
        _adapt_standby_charge(skills, template['desc'], description)
    return row, skills

def normalize_skeleton(txt):
    """Chuẩn hóa văn bản thành dạng khung xương (xóa số, icon, khoảng trắng thừa)"""
    txt = re.sub(r'\{passiveImg:[^\}]+\}', '', str(txt or ''))
    txt = txt.replace("\\_", "_").replace("''", "'")
    for start, end, _ in reversed(_category_mentions(txt)):
        txt = txt[:start] + 'CATEGORY' + txt[end:]
    txt = re.sub(r'\bturns\b', 'turn', txt, flags=re.I)
    # Percent buffs and flat buffs use different calc_option values.
    txt = re.sub(r'(\d+)\s*%', r'\1 percent', txt)
    txt = re.sub(r'\d+', '#NUM#', txt)
    txt = re.sub(r'[^\w#\s]', ' ', txt)
    txt = re.sub(r'\s+', ' ', txt).strip().lower()
    return txt

def extract_numbers(txt):
    """Trích xuất danh sách các số nguyên"""
    txt = str(txt or '')
    for start, end, _ in reversed(_category_mentions(txt)):
        txt = txt[:start] + 'CATEGORY' + txt[end:]
    return [int(n) for n in re.findall(r'\d+', txt)]

def get_db_connection():
    return sqlite3.connect(DB_PATH)

# ==============================================================================
# 1. LEADER SKILL COMPILER
# ==============================================================================
_LEADER_CORPUS = None

def get_leader_corpus():
    global _LEADER_CORPUS
    if _LEADER_CORPUS is not None:
        return _LEADER_CORPUS
    corpus = []
    if os.path.exists(DB_PATH):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT id, description FROM leader_skill_sets WHERE description IS NOT NULL AND description != ''")
                sets = c.fetchall()
                c.execute("""
                    SELECT leader_skill_set_id, exec_timing_type, target_type, sub_target_type_set_id,
                           causality_conditions, efficacy_type, efficacy_values, calc_option
                    FROM leader_skills
                    ORDER BY id ASC
                """)
                skills_map = defaultdict(list)
                for r in c.fetchall():
                    skills_map[r[0]].append({
                        'exec_timing_type': r[1],
                        'target_type': r[2],
                        'sub_target_type_set_id': r[3],
                        'causality_conditions': r[4] or '',
                        'efficacy_type': r[5],
                        'efficacy_values': r[6] or '[0, 0, 0]',
                        'calc_option': r[7]
                    })
                for sid, desc in sets:
                    if sid in skills_map:
                        corpus.append({
                            'id': sid,
                            'desc': desc,
                            'skel': normalize_skeleton(desc),
                            'skills': skills_map[sid]
                        })
        except Exception as e:
            print(f"[skill_compilers] Leader corpus load error: {e}")
    _LEADER_CORPUS = corpus
    return _LEADER_CORPUS

def compile_leader_description(description, preferred_set_id=None):
    desc = str(description or '').strip()
    if not desc:
        return {'compiler_version': COMPILER_VERSION, 'skills': [], 'source': 'empty', 'warnings': []}

    exact = _exact_database_skills('leader_skill_sets', 'description',
                                   'leader_skills', 'leader_skill_set_id',
                                   desc, preferred_set_id)
    if exact:
        return {'compiler_version': COMPILER_VERSION, 'skills': exact[1],
                'source': 'database', 'warnings': []}
    template = _template_skills(desc, preferred_set_id, get_leader_corpus(),
                                'leader_skill_sets', 'description',
                                'leader_skills', 'leader_skill_set_id', 'leader')
    if template:
        return {'compiler_version': COMPILER_VERSION, 'skills': template[1],
                'source': 'database-template', 'warnings': []}
    return {'compiler_version': COMPILER_VERSION, 'skills': [],
            'source': 'unsupported', 'warnings': [_unsupported('Leader Skill')]}

# ==============================================================================
# 2. ACTIVE SKILL COMPILER
# ==============================================================================
_ACTIVE_CORPUS = None

def get_active_corpus():
    global _ACTIVE_CORPUS
    if _ACTIVE_CORPUS is not None:
        return _ACTIVE_CORPUS
    corpus = []
    if os.path.exists(DB_PATH):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT id, effect_description FROM active_skill_sets WHERE effect_description IS NOT NULL AND effect_description != ''")
                sets = c.fetchall()
                c.execute("""
                    SELECT active_skill_set_id, target_type, sub_target_type_set_id,
                           efficacy_type, calc_option,
                           eff_val1, eff_val2, eff_val3, efficacy_values
                    FROM active_skills
                    ORDER BY id ASC
                """)
                skills_map = defaultdict(list)
                for r in c.fetchall():
                    skills_map[r[0]].append({
                        'target_type': r[1],
                        'sub_target_type_set_id': r[2] or '',
                        'efficacy_type': r[3],
                        'calc_option': r[4] or 0,
                        'eff_val1': r[5] or 0,
                        'eff_val2': r[6] or 0,
                        'eff_val3': r[7] or 0,
                        'efficacy_values': r[8] or '{}'
                    })
                for sid, desc in sets:
                    if sid in skills_map:
                        corpus.append({
                            'id': sid,
                            'desc': desc,
                            'skel': normalize_skeleton(desc),
                            'skills': skills_map[sid]
                        })
        except Exception as e:
            print(f"[skill_compilers] Active corpus load error: {e}")
    _ACTIVE_CORPUS = corpus
    return _ACTIVE_CORPUS

def compile_active_description(description, preferred_set_id=None, card_id=None):
    desc = str(description or '').strip()
    if not desc:
        return {'compiler_version': COMPILER_VERSION, 'skills': [], 'source': 'empty', 'warnings': []}

    exact = _exact_database_skills('active_skill_sets', 'effect_description',
                                   'active_skills', 'active_skill_set_id',
                                   desc, preferred_set_id)
    if exact:
        return {'compiler_version': COMPILER_VERSION, 'skills': exact[1],
                'source': 'database', 'warnings': []}
    template = _template_skills(desc, preferred_set_id, get_active_corpus(),
                                'active_skill_sets', 'effect_description',
                                'active_skills', 'active_skill_set_id', 'active')
    if template:
        return {'compiler_version': COMPILER_VERSION, 'skills': template[1],
                'source': 'database-template', 'warnings': []}
    return {'compiler_version': COMPILER_VERSION, 'skills': [],
            'source': 'unsupported', 'warnings': [_unsupported('Active Skill')]}

# ==============================================================================
# 3. STANDBY SKILL COMPILER
# ==============================================================================
_STANDBY_CORPUS = None

def get_standby_corpus():
    global _STANDBY_CORPUS
    if _STANDBY_CORPUS is not None:
        return _STANDBY_CORPUS
    corpus = []
    if os.path.exists(DB_PATH):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT id, effect_description FROM standby_skill_sets WHERE effect_description IS NOT NULL AND effect_description != ''")
                sets = c.fetchall()
                c.execute("""
                    SELECT standby_skill_set_id, target_type, sub_target_type_set_id,
                           turn, efficacy_type, calc_option, efficacy_values
                    FROM standby_skills
                    ORDER BY id ASC
                """)
                skills_map = defaultdict(list)
                for r in c.fetchall():
                    skills_map[r[0]].append({
                        'target_type': r[1],
                        'sub_target_type_set_id': r[2] or '',
                        'turn': r[3] or 1,
                        'efficacy_type': r[4],
                        'calc_option': r[5] or 0,
                        'efficacy_values': r[6] or '{}'
                    })
                for sid, desc in sets:
                    if sid in skills_map:
                        corpus.append({
                            'id': sid,
                            'desc': desc,
                            'skel': normalize_skeleton(desc),
                            'skills': skills_map[sid]
                        })
        except Exception as e:
            print(f"[skill_compilers] Standby corpus load error: {e}")
    _STANDBY_CORPUS = corpus
    return _STANDBY_CORPUS

def compile_standby_description(description, preferred_set_id=None):
    desc = str(description or '').strip()
    if not desc:
        return {'compiler_version': COMPILER_VERSION, 'skills': [], 'source': 'empty', 'warnings': []}

    exact = _exact_database_skills('standby_skill_sets', 'effect_description',
                                   'standby_skills', 'standby_skill_set_id',
                                   desc, preferred_set_id)
    if exact:
        return {'compiler_version': COMPILER_VERSION, 'skills': exact[1],
                'source': 'database', 'warnings': []}
    template = _template_skills(desc, preferred_set_id, get_standby_corpus(),
                                'standby_skill_sets', 'effect_description',
                                'standby_skills', 'standby_skill_set_id', 'standby')
    if template:
        return {'compiler_version': COMPILER_VERSION, 'skills': template[1],
                'source': 'database-template', 'warnings': []}
    return {'compiler_version': COMPILER_VERSION, 'skills': [],
            'source': 'unsupported', 'warnings': [_unsupported('Standby Skill')]}

# ==============================================================================
# 4. SUPER ATTACK / SPECIALS COMPILER
# ==============================================================================
_SPECIAL_CORPUS = None

_DAMAGE_TIER = re.compile(r'\b(low|huge|destructive|extreme|mass|supreme|spreme|immense|mega[ -]colossal|colossal|ultimate|explosive)\s+damage\b', re.I)

def _damage_tier(description):
    match = _DAMAGE_TIER.search(str(description or ''))
    return match.group(1).lower().replace('mega colossal', 'mega-colossal').replace('spreme', 'supreme') if match else None

def _mask_damage_tier(description):
    return _DAMAGE_TIER.sub('TIER damage', str(description or ''))

def special_damage_profiles():
    counts = defaultdict(Counter)
    with get_db_connection() as conn:
        for desc, rate, bonus in conn.execute('SELECT description, increase_rate, lv_bonus FROM special_sets'):
            tier = _damage_tier(desc)
            if tier and rate is not None and bonus is not None:
                counts[tier][(rate, bonus)] += 1
    return [{'key': tier, 'label': tier.title(), 'increase_rate': values.most_common(1)[0][0][0],
             'lv_bonus': values.most_common(1)[0][0][1]} for tier, values in counts.items()]

def _special_damage_values(row, description):
    values = {'increase_rate': row['increase_rate'], 'lv_bonus': row['lv_bonus']}
    old, new = _damage_tier(row.get('description')), _damage_tier(description)
    if old and new and old != new:
        profiles = {item['key']: item for item in special_damage_profiles()}
        if old in profiles and new in profiles:
            # Retain adjustments associated with the template's other effects.
            values['increase_rate'] += profiles[new]['increase_rate'] - profiles[old]['increase_rate']
            values['lv_bonus'] = profiles[new]['lv_bonus']
    return values

def get_special_corpus():
    global _SPECIAL_CORPUS
    if _SPECIAL_CORPUS is not None:
        return _SPECIAL_CORPUS
    corpus = []
    if os.path.exists(DB_PATH):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("SELECT id, name, description, increase_rate, lv_bonus FROM special_sets WHERE description IS NOT NULL AND description != ''")
                sets = c.fetchall()
                c.execute("""
                    SELECT special_set_id, type, efficacy_type, target_type, calc_option,
                           turn, prob, causality_conditions, eff_value1, eff_value2, eff_value3
                    FROM specials
                    ORDER BY id ASC
                """)
                specials_map = defaultdict(list)
                for r in c.fetchall():
                    specials_map[r[0]].append({
                        'type': r[1] or 'Special::NormalEfficacySpecial',
                        'efficacy_type': r[2],
                        'target_type': r[3] or 1,
                        'calc_option': r[4] or 2,
                        'turn': r[5] or 1,
                        'prob': r[6] or 100,
                        'causality_conditions': r[7] or '',
                        'eff_value1': r[8] or 0,
                        'eff_value2': r[9] or 0,
                        'eff_value3': r[10] or 0
                    })
                for sid, name, desc, inc, lv in sets:
                    if desc:
                        corpus.append({
                            'id': sid,
                            'name': name,
                            'desc': desc,
                            'increase_rate': inc,
                            'lv_bonus': lv,
                            'skel': normalize_skeleton(desc),
                            'specials': specials_map.get(sid, [])
                        })
        except Exception as e:
            print(f"[skill_compilers] Special corpus load error: {e}")
    _SPECIAL_CORPUS = corpus
    return _SPECIAL_CORPUS

def compile_special_description(description, special_set_id=None):
    desc = str(description or '').strip()
    if not desc:
        return {'compiler_version': COMPILER_VERSION, 'specials': [], 'special_set': {}, 'source': 'empty', 'warnings': []}

    exact = _exact_database_skills('special_sets', 'description', 'specials',
                                   'special_set_id', desc, special_set_id, allow_empty=True)
    if exact:
        row, skills = exact
        return {'compiler_version': COMPILER_VERSION, 'specials': skills,
                'special_set': _special_damage_values(row, desc),
                'source': 'database', 'warnings': []}
    template = _template_skills(desc, special_set_id, get_special_corpus(),
                                'special_sets', 'description', 'specials',
                                'special_set_id', 'special')
    if template:
        row, skills = template
        return {'compiler_version': COMPILER_VERSION, 'specials': skills,
                'special_set': _special_damage_values(row, desc),
                'source': 'database-template', 'warnings': []}
    return {'compiler_version': COMPILER_VERSION, 'specials': [],
            'special_set': {}, 'source': 'unsupported',
            'warnings': [_unsupported('Super Attack')]}

# ==============================================================================
# 5. FINISH SKILL COMPILER
# ==============================================================================
_FINISH_CORPUS = None

def get_finish_corpus():
    global _FINISH_CORPUS
    if _FINISH_CORPUS is not None:
        return _FINISH_CORPUS
    corpus = []
    if os.path.exists(DB_PATH):
        try:
            with get_db_connection() as conn:
                c = conn.cursor()
                c.execute("""
                    SELECT s.id, s.effect_description, COALESCE(sp.increase_rate, 550)
                    FROM finish_skill_sets s
                    LEFT JOIN finish_specials sp ON s.finish_special_id = sp.id
                    WHERE s.effect_description IS NOT NULL AND s.effect_description != ''
                """)
                sets = c.fetchall()
                c.execute("""
                    SELECT finish_skill_set_id, target_type, target_type_values, sub_target_type_set_id,
                           turn, efficacy_type, calc_option, efficacy_values
                    FROM finish_skills
                    ORDER BY id ASC
                """)
                skills_map = defaultdict(list)
                for r in c.fetchall():
                    skills_map[r[0]].append({
                        'target_type': r[1] or 1,
                        'target_type_values': r[2] or '{}',
                        'sub_target_type_set_id': r[3] or '',
                        'turn': r[4] or 1,
                        'efficacy_type': r[5],
                        'calc_option': r[6] or 0,
                        'efficacy_values': r[7] or '{}'
                    })
                for sid, desc, inc_rate in sets:
                    if sid in skills_map:
                        corpus.append({
                            'id': sid,
                            'desc': desc,
                            'increase_rate': inc_rate,
                            'skel': normalize_skeleton(desc),
                            'skills': skills_map[sid]
                        })
        except Exception as e:
            print(f"[skill_compilers] Finish corpus load error: {e}")
    _FINISH_CORPUS = corpus
    return _FINISH_CORPUS

def compile_finish_description(description, finish_set_id=None):
    desc = str(description or '').strip()
    if not desc:
        return {'compiler_version': COMPILER_VERSION, 'skills': [], 'special': {'increase_rate': 550}, 'source': 'empty', 'warnings': []}

    exact = _exact_database_skills('finish_skill_sets', 'effect_description',
                                   'finish_skills', 'finish_skill_set_id',
                                   desc, finish_set_id)
    if exact:
        row, skills = exact
        with get_db_connection() as conn:
            special = conn.execute('SELECT * FROM finish_specials WHERE id = ?',
                                   (row['finish_special_id'],)).fetchone()
            columns = [item[1] for item in conn.execute('PRAGMA table_info(finish_specials)')]
        return {'compiler_version': COMPILER_VERSION, 'skills': skills,
                'special': dict(zip(columns, special)) if special else {},
                'source': 'database', 'warnings': []}
    template = _template_skills(desc, finish_set_id, get_finish_corpus(),
                                'finish_skill_sets', 'effect_description',
                                'finish_skills', 'finish_skill_set_id', 'finish')
    if template:
        row, skills = template
        with get_db_connection() as conn:
            special = conn.execute('SELECT * FROM finish_specials WHERE id = ?',
                                   (row['finish_special_id'],)).fetchone()
            columns = [item[1] for item in conn.execute('PRAGMA table_info(finish_specials)')]
        return {'compiler_version': COMPILER_VERSION, 'skills': skills,
                'special': dict(zip(columns, special)) if special else {},
                'source': 'database-template', 'warnings': []}
    return {'compiler_version': COMPILER_VERSION, 'skills': [], 'special': {},
            'source': 'unsupported', 'warnings': [_unsupported('Finish Skill')]}

