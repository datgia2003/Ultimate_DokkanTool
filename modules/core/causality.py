# -*- coding: utf-8 -*-
import json
import re
import math
import streamlit as st
from modules.core.db import (
    causality_dict, causality_details, target_type_dict, calc_option_dict,
    efficacy_dict, efficacy_details, category_dict, query_db_all
)

def parse_causality_json(json_str):
    if not json_str or str(json_str).strip() == '':
        return [], "AND"
    try:
        data = json.loads(json_str)
        source = str(data.get('source', ''))
        if '|' in source:
            op = "OR"
        else:
            op = "AND"
            
        import re
        ids = [int(x) for x in re.findall(r'\d+', source)]
        return ids, op
    except:
        return [], "AND"

def compile_causality_json(ids, op):
    if not ids:
        return ""
    if len(ids) == 1:
        return json.dumps({
            "source": str(ids[0]),
            "compiled": ids[0]
        }, separators=(',', ':'))
    
    op_char = "&" if op == "AND" else "|"
    source_str = op_char.join(map(str, ids))
    compiled_val = [op_char] + list(ids)
    return json.dumps({
        "source": source_str,
        "compiled": compiled_val
    }, separators=(',', ':'))

def parse_causality_expr(expr_str):
    if not expr_str or str(expr_str).strip() == '':
        return None
        
    # Remove all whitespace
    expr_clean = "".join(expr_str.split())
    
    import re
    tokens = re.findall(r'\d+|&|\||\(|\)', expr_clean)
    idx = [0]
    
    def parse_expression():
        terms = [parse_term()]
        while idx[0] < len(tokens) and tokens[idx[0]] == '|':
            idx[0] += 1
            terms.append(parse_term())
        if len(terms) == 1:
            return terms[0]
        flat_terms = []
        for t in terms:
            if isinstance(t, list) and len(t) > 0 and t[0] == '|':
                flat_terms.extend(t[1:])
            else:
                flat_terms.append(t)
        return ['|'] + flat_terms

    def parse_term():
        factors = [parse_factor()]
        while idx[0] < len(tokens) and tokens[idx[0]] == '&':
            idx[0] += 1
            factors.append(parse_factor())
        if len(factors) == 1:
            return factors[0]
        flat_factors = []
        for f in factors:
            if isinstance(f, list) and len(f) > 0 and f[0] == '&':
                flat_factors.extend(f[1:])
            else:
                flat_factors.append(f)
        return ['&'] + flat_factors

    def parse_factor():
        if idx[0] >= len(tokens):
            raise ValueError("Unexpected end of expression")
        token = tokens[idx[0]]
        if token == '(':
            idx[0] += 1
            expr = parse_expression()
            if idx[0] >= len(tokens) or tokens[idx[0]] != ')':
                raise ValueError("Missing ')'")
            idx[0] += 1
            return expr
        elif token.isdigit():
            idx[0] += 1
            return int(token)
        else:
            raise ValueError(f"Unexpected token: {token}")

    parsed = parse_expression()
    if idx[0] < len(tokens):
        raise ValueError(f"Extraneous token: {tokens[idx[0]]}")
    return parsed

def get_causality_expr_string(json_str):
    if not json_str or str(json_str).strip() == '':
        return ""
    try:
        import json
        data = json.loads(json_str)
        if isinstance(data, dict) and 'source' in data:
            return str(data['source'])
        return ""
    except:
        return str(json_str)


def get_causality_options():
    if 'causality_options_formatted' in st.session_state:
        return st.session_state['causality_options_formatted']
        
    if 'causalities_data' not in st.session_state:
        rows = query_db_all("SELECT * FROM skill_causalities")
        st.session_state['causalities_data'] = {r['id']: dict(r) for r in rows}
        
    causalities = st.session_state['causalities_data']
    options = {}
    for cid, r in causalities.items():
        ctype = r['causality_type']
        val1 = r['cau_val1']
        val2 = r['cau_val2']
        val3 = r['cau_val3']
        
        details = causality_details.get(ctype, {})
        c_name = details.get('name', f"Type {ctype}")
        
        v1_desc = details.get('v1')
        v2_desc = details.get('v2')
        v3_desc = details.get('v3')
        
        vals_parts = []
        if v1_desc: vals_parts.append(f"{v1_desc}: {val1}")
        elif val1 != 0: vals_parts.append(f"V1: {val1}")
            
        if v2_desc: vals_parts.append(f"{v2_desc}: {val2}")
        elif val2 != 0: vals_parts.append(f"V2: {val2}")
            
        if v3_desc: vals_parts.append(f"{v3_desc}: {val3}")
        elif val3 != 0: vals_parts.append(f"V3: {val3}")
        
        if not vals_parts:
            vals_str = "No values"
        else:
            vals_str = ", ".join(vals_parts)
            
        options[cid] = f"ID {cid}: {c_name} ({vals_str})"
        
    st.session_state['causality_options_formatted'] = options
    return options


def get_int_val(dict_obj, key, default=0):
    val = dict_obj.get(key)
    if val is None or val == '':
        return default
    try:
        return int(val)
    except:
        return default


def safe_int_or_none(val):
    if val is None or str(val).strip().upper() in ['', 'NONE', 'NULL']:
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        try:
            return int(float(val))
        except (ValueError, TypeError):
            return None


def get_textarea_height(text, min_h=100, line_h=24, padding=40):
    if not text:
        return min_h
    import math
    lines = str(text).split('\n')
    total_lines = 0
    for line in lines:
        line_len = len(line)
        total_lines += max(1, math.ceil(line_len / 55))
    return max(min_h, total_lines * line_h + padding)


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

def has_any_matching_number(sk, desc_lines, idx):
    if idx < 0 or idx >= len(desc_lines):
        return False
        
    eff_type = sk.get('efficacy_type', 0)
    if eff_type in [76, 77, 78]:
        return True
        
    primary_text = desc_lines[idx].lower()
    primary_nums = [int(n) for n in re.findall(r'\d+', primary_text)]
    
    sec_idx = find_secondary_line_idx(desc_lines, idx, sk.get('efficacy_type', 0))
    secondary_text = desc_lines[sec_idx].lower() if sec_idx >= 0 else ""
    secondary_nums = [int(n) for n in re.findall(r'\d+', secondary_text)] if secondary_text else []
    
    cond_header = find_closest_condition_header(desc_lines, idx)
    header_nums = [int(n) for n in re.findall(r'\d+', cond_header)] if cond_header else []
    
    all_nums = primary_nums + secondary_nums + header_nums
    
    # If the description has NO numbers, we allow the match (return True)
    if not all_nums:
        return True
        
    eff_type = get_int_val(sk, 'efficacy_type', 0)
    v1 = get_int_val(sk, 'eff_value1', 0)
    v2 = get_int_val(sk, 'eff_value2', 0)
    v3 = get_int_val(sk, 'eff_value3', 0)
    eff_val1 = get_int_val(sk, 'eff_val1', 0)
    eff_val2 = get_int_val(sk, 'eff_val2', 0)
    eff_val3 = get_int_val(sk, 'eff_val3', 0)
    
    val1 = v1 if v1 != 0 else eff_val1
    val2 = v2 if v2 != 0 else eff_val2
    val3 = v3 if v3 != 0 else eff_val3
    
    orig_val1 = get_int_val(sk, 'orig_eff_value1', val1)
    orig_val2 = get_int_val(sk, 'orig_eff_value2', val2)
    orig_val3 = get_int_val(sk, 'orig_eff_value3', val3)
    
    turn = get_int_val(sk, 'turn', 1)
    orig_turn = get_int_val(sk, 'orig_turn', turn)
    prob = get_int_val(sk, 'probability', get_int_val(sk, 'prob', 100))
    orig_prob = get_int_val(sk, 'orig_probability', prob)
    
    vals_to_check = []
    is_type_prefixed = (eff_type in [16, 17, 18, 20, 44, 96, 97, 98, 103, 110, 131, 79])
    if is_type_prefixed:
        if val2 > 0: vals_to_check.append(val2)
        if val3 > 0: vals_to_check.append(val3)
        if orig_val2 > 0: vals_to_check.append(orig_val2)
        if orig_val3 > 0: vals_to_check.append(orig_val3)
    else:
        if eff_type == 13:
            vals_to_check.append(100 - val1)
        elif val1 > 0:
            vals_to_check.append(val1)
        if val2 > 0: vals_to_check.append(val2)
        if val3 > 0: vals_to_check.append(val3)
        
        if eff_type == 13:
            vals_to_check.append(100 - orig_val1)
        elif orig_val1 > 0:
            vals_to_check.append(orig_val1)
        if orig_val2 > 0: vals_to_check.append(orig_val2)
        if orig_val3 > 0: vals_to_check.append(orig_val3)
        
    if turn > 1 and turn < 20:
        vals_to_check.extend([turn, turn - 1, turn + 1])
    if orig_turn > 1 and orig_turn < 20:
        vals_to_check.extend([orig_turn, orig_turn - 1, orig_turn + 1])
        
    if prob < 100:
        vals_to_check.append(prob)
    if orig_prob < 100:
        vals_to_check.append(orig_prob)
        
    c_ids, _ = parse_causality_json(sk.get('causality_conditions', ''))
    causalities_data = st.session_state.get('causalities_data', {})
    for cid in c_ids:
        c_rec = causalities_data.get(cid)
        if c_rec:
            for cv in [c_rec.get('cau_val1', 0), c_rec.get('cau_val2', 0), c_rec.get('cau_val3', 0)]:
                if cv > 0:
                    vals_to_check.append(cv)
                    
    # If the skill itself has no non-zero values/conditions to check, we allow the match (return True)
    if not vals_to_check:
        return True
        
    for val in vals_to_check:
        if val in all_nums:
            return True
            
    return False


def match_skills_to_desc(skills, desc_lines):
    import re
    
    causalities_data = st.session_state.get('causalities_data', {})
    
    pairs = []
    for sk_idx, sk in enumerate(skills):
        eff_type = get_int_val(sk, 'efficacy_type', 0)
        v1 = get_int_val(sk, 'eff_value1', 0)
        v2 = get_int_val(sk, 'eff_value2', 0)
        v3 = get_int_val(sk, 'eff_value3', 0)
        eff_val1 = get_int_val(sk, 'eff_val1', 0)
        eff_val2 = get_int_val(sk, 'eff_val2', 0)
        eff_val3 = get_int_val(sk, 'eff_val3', 0)
        
        val1 = v1 if v1 != 0 else eff_val1
        val2 = v2 if v2 != 0 else eff_val2
        val3 = v3 if v3 != 0 else eff_val3
        
        turn = get_int_val(sk, 'turn', 1)
        prob = get_int_val(sk, 'probability', get_int_val(sk, 'prob', 100))
        c_ids, _ = parse_causality_json(sk.get('causality_conditions', ''))
        exec_timing = get_int_val(sk, 'exec_timing_type', 1)
        
        expected_pos = sk_idx * (len(desc_lines) / len(skills)) if len(skills) > 0 else 0
        
        for idx, line in enumerate(desc_lines):
            # Skip headers from being matched as effects
            if line.strip().startswith('*'):
                continue
                
            score = 0
            line_lower = line.lower()
            
            # Efficacy Type matches keywords
            if eff_type in [5, 20]: # Ki
                if "ki" in line_lower: score += 15
            elif eff_type in [3, 18, 44]: # ATK & DEF
                if "atk" in line_lower and "def" in line_lower: score += 20
                elif "atk" in line_lower or "def" in line_lower: score += 8
            elif eff_type in [1, 16]: # ATK
                if "atk" in line_lower and "def" not in line_lower: score += 15
                elif "atk" in line_lower: score += 6
            elif eff_type in [2, 17]: # DEF
                if "def" in line_lower and "atk" not in line_lower: score += 15
                elif "def" in line_lower: score += 6
            elif eff_type in [13]: # Damage reduction
                if "reduction" in line_lower or "reduces damage" in line_lower or "damage reduction" in line_lower: score += 15
            elif eff_type in [76]: # Super Effective Against All
                if any(w in line_lower for w in ["effective", "all type", "all-type"]):
                    score += 25
            elif eff_type in [77, 78]: # Guard
                if any(w in line_lower for w in ["guard"]):
                    score += 25
            elif eff_type in [90]: # Critical
                if "critical" in line_lower: score += 15
            elif eff_type in [91, 105]: # Evade
                if "evade" in line_lower or "evading" in line_lower or "dodge" in line_lower: score += 15
            elif eff_type in [81, 82]: # Additional
                if "additional" in line_lower: score += 15
            elif eff_type in [4]: # Recover HP
                if "recover" in line_lower or "hp" in line_lower: score += 15
                
            # General Efficacy Metadata matching
            eff_meta = efficacy_details.get(eff_type, {})
            if eff_meta:
                eff_words = []
                for field in ['name', 'desc']:
                    f_val = str(eff_meta.get(field, '')).lower()
                    for w in re.findall(r'[a-z]+', f_val):
                        if len(w) > 2 and w not in ['the', 'and', 'for', 'with', 'type', 'value', 'unknown', 'nan', 'description', 'notes', 'vals']:
                            eff_words.append(w)
                eff_words = list(dict.fromkeys(eff_words))
                
                matched_keywords = [w for w in eff_words if w in line_lower]
                if matched_keywords:
                    score += 6 * len(matched_keywords)
                    
            # Extract numbers
            numbers = [int(n) for n in re.findall(r'\d+', line)]
            
            # Value matching
            is_type_prefixed = (eff_type in [16, 17, 18, 20, 44, 96, 97, 98, 103, 110, 131, 79])
            if is_type_prefixed:
                type_names = {0: "agl", 1: "teq", 2: "int", 3: "str", 4: "phy"}
                t_val = sk.get('eff_value1', sk.get('eff_val1', -1))
                t_name = type_names.get(t_val)
                if t_name and t_name in line_lower:
                    score += 15
                
                # val1 represents type, skip matching it numerically to avoid noise
                if val2 > 0:
                    if val2 in numbers: score += 15
                if val3 > 0:
                    if val3 in numbers: score += 15
            else:
                if val1 > 0:
                    if val1 in numbers: score += 15
                    if eff_type == 13 and (100 - val1) in numbers: score += 20
                if val2 > 0:
                    if val2 in numbers: score += 15
                if val3 > 0:
                    if val3 in numbers: score += 15
                
            # Turn matching
            if turn > 1 and turn < 20:
                if any(t in numbers for t in [turn, turn - 1, turn + 1]):
                    score += 25
                if "turn" in line_lower:
                    score += 5
                else:
                    score -= 25
            else:
                # turn == 1
                turn_matches = re.findall(r'(\d+)\s*turns?', line_lower)
                if turn_matches:
                    if any(int(t) > 1 for t in turn_matches):
                        score -= 20
                
            # Probability / Chance matching
            if prob < 100:
                if prob in numbers: score += 10
                if prob == 70 and "great chance" in line_lower: score += 10
                if prob == 50 and "high chance" in line_lower: score += 10
                if prob == 30 and "medium chance" in line_lower: score += 10
                
            # Match causality conditions and execution timing to closest condition header
            cond_header = find_closest_condition_header(desc_lines, idx)
            if cond_header:
                cond_header_lower = cond_header.lower()
                header_nums = [int(n) for n in re.findall(r'\d+', cond_header)]
                
                # Exec Timing keyword matching
                if exec_timing in [3, 4, 5]:
                    if "attack" in cond_header_lower and not any(w in cond_header_lower for w in ["receive", "after being", "after receiving", "before receiving", "evad", "dodg"]):
                        score += 15
                elif exec_timing in [6, 7]:
                    if "attack" in cond_header_lower or "hit" in cond_header_lower or "receive" in cond_header_lower:
                        if any(w in cond_header_lower for w in ["receive", "after being", "after receiving", "before receiving", "hit", "attacked"]):
                            score += 15
                elif exec_timing == 1:
                    if "start of turn" in cond_header_lower or "turn start" in cond_header_lower:
                        score += 15
                elif exec_timing == 9:
                    if "end of turn" in cond_header_lower or "turn end" in cond_header_lower:
                        score += 15
                elif exec_timing == 14:
                    if "final blow" in cond_header_lower or "defeating" in cond_header_lower or "kills" in cond_header_lower:
                        score += 15
                elif exec_timing == 15:
                    if "ki sphere" in cond_header_lower or "orb" in cond_header_lower or "obtains" in cond_header_lower or "collects" in cond_header_lower:
                        score += 15
                
                if c_ids:
                    # Skill has conditions, and description has a condition header - good!
                    score += 5
                    
                    for cid in c_ids:
                        c_rec = causalities_data.get(cid)
                        if c_rec:
                            ctype = c_rec['causality_type']
                            details = causality_details.get(ctype, {})
                            
                            cau_v1 = c_rec.get('cau_val1', 0)
                            cau_v2 = c_rec.get('cau_val2', 0)
                            cau_v3 = c_rec.get('cau_val3', 0)
                            
                            # Check if category check
                            is_cat_check = (ctype in [34, 45]) or (ctype == 67 and cau_v1 == 0)
                            
                            if not is_cat_check:
                                if cau_v1 > 0 and cau_v1 in header_nums: score += 20
                                if cau_v2 > 0 and cau_v2 in header_nums: score += 20
                                if cau_v3 > 0 and cau_v3 in header_nums: score += 20
                            else:
                                cat_id = cau_v2
                                cat_name = category_dict.get(cat_id)
                                if cat_name:
                                    cat_name_lower = cat_name.lower()
                                    if cat_name_lower in cond_header_lower:
                                        score += 35
                                    else:
                                        score -= 25
                            
                            c_name = details.get('name', '').lower()
                            c_desc = details.get('desc', '').lower()
                            
                            # General Causality Metadata matching against condition header (only name and desc)
                            c_words = []
                            for field in ['name', 'desc']:
                                f_val = str(details.get(field, '')).lower()
                                for w in re.findall(r'[a-z]+', f_val):
                                    if len(w) > 2 and w not in ['the', 'and', 'for', 'with', 'type', 'value', 'unknown', 'nan', 'description', 'notes', 'vals']:
                                        c_words.append(w)
                            c_words = list(dict.fromkeys(c_words))
                            
                            matched_c_keywords = [w for w in c_words if w in cond_header_lower]
                            if matched_c_keywords:
                                score += 8 * len(matched_c_keywords)
                            
                            # HP checks
                            if "hp" in cond_header_lower and ("hp" in c_desc or "hp" in c_name):
                                score += 12
                                is_over = any(w in c_name or w in c_desc for w in ['over', 'above', 'more', 'greater', 'start', 'from'])
                                is_under = any(w in c_name or w in c_desc for w in ['under', 'below', 'less', 'fewer', 'within'])
                                
                                header_over = any(w in cond_header_lower for w in ['above', 'over', 'more', 'greater', 'or more', 'or above', 'at least', 'start', 'from'])
                                header_under = any(w in cond_header_lower for w in ['below', 'under', 'less', 'or less', 'fewer', 'or fewer', 'within'])
                                
                                if is_over and header_over: score += 15
                                elif is_under and header_under: score += 15
                                elif is_over and header_under: score -= 15
                                elif is_under and header_over: score -= 15
                                
                            # Ki checks
                            if ("ki" in cond_header_lower or "energy" in cond_header_lower) and ("ki" in c_desc or "ki" in c_name or "energy" in c_desc or "energy" in c_name):
                                score += 12
                                is_over = any(w in c_name or w in c_desc for w in ['over', 'above', 'more', 'greater', 'start', 'from'])
                                is_under = any(w in c_name or w in c_desc for w in ['under', 'below', 'less', 'fewer', 'within'])
                                
                                header_over = any(w in cond_header_lower for w in ['above', 'over', 'more', 'greater', 'or more', 'or above', 'at least', 'start', 'from'])
                                header_under = any(w in cond_header_lower for w in ['below', 'under', 'less', 'or less', 'fewer', 'or fewer', 'within'])
                                
                                if is_over and header_over: score += 15
                                elif is_under and header_under: score += 15
                                elif is_over and header_under: score -= 15
                                elif is_under and header_over: score -= 15
                                
                            # Turn checks
                            if "turn" in cond_header_lower and ("turn" in c_desc or "turn" in c_name):
                                score += 12
                                is_over = any(w in c_name or w in c_desc for w in ['over', 'above', 'more', 'greater', 'start', 'from', 'elapsed', 'passed'])
                                is_under = any(w in c_name or w in c_desc for w in ['under', 'below', 'less', 'fewer', 'within'])
                                
                                header_over = any(w in cond_header_lower for w in ['above', 'over', 'more', 'greater', 'or more', 'or above', 'at least', 'passed', 'elapsed', 'after'])
                                header_under = any(w in cond_header_lower for w in ['below', 'under', 'less', 'or less', 'fewer', 'or fewer', 'within'])
                                
                                if is_over and header_over: score += 15
                                elif is_under and header_under: score += 15
                                elif is_over and header_under: score -= 15
                                elif is_under and header_over: score -= 15
                                
                            # Enemy / Target checks
                            if ("enemy" in cond_header_lower or "enemies" in cond_header_lower or "target" in cond_header_lower) and \
                               ("enemy" in c_desc or "enemy" in c_name or "target" in c_desc or "target" in c_name):
                                score += 12
                                is_over = any(w in c_name or w in c_desc for w in ['over', 'above', 'more', 'greater', 'start', 'from'])
                                is_under = any(w in c_name or w in c_desc for w in ['under', 'below', 'less', 'fewer', 'within'])
                                
                                header_over = any(w in cond_header_lower for w in ['above', 'over', 'more', 'greater', 'or more', 'or above', 'at least'])
                                header_under = any(w in cond_header_lower for w in ['below', 'under', 'less', 'or less', 'fewer', 'or fewer', 'within'])
                                
                                if is_over and header_over: score += 15
                                elif is_under and header_under: score += 15
                                elif is_over and header_under: score -= 15
                                elif is_under and header_over: score -= 15
                                
                            # Attacking / attacked / damaged / hit checks
                            if ("attack" in cond_header_lower or "damaged" in cond_header_lower or "hit" in cond_header_lower or "receive" in cond_header_lower) and \
                               ("attack" in c_desc or "damage" in c_desc or "hit" in c_desc or "receive" in c_desc):
                                score += 15
                                
                            # Evade / dodge checks
                            if ("evad" in cond_header_lower or "dodg" in cond_header_lower) and \
                               ("evad" in c_desc or "dodg" in c_desc or "evad" in c_name):
                                score += 15
                                
                            # Guard checks
                            if "guard" in cond_header_lower and ("guard" in c_desc or "guard" in c_name):
                                score += 15
                                
                            # Revival checks
                            if ("revival" in cond_header_lower or "revive" in cond_header_lower) and \
                               ("revival" in c_desc or "revive" in c_desc or "revival" in c_name):
                                score += 15
                                
                            # Slot checks
                            if ctype in [14, 19, 41]:
                                if any(w in cond_header_lower for w in ["slot", "1st", "2nd", "3rd", "first"]):
                                    score += 15
                                    
                            # Super attack checks
                            if ctype in [40, 48, 49]:
                                if any(w in cond_header_lower for w in ["super attack", "special attack", "ultra super"]):
                                    score += 15
                                    
                            # Ki sphere checks
                            if ctype == 42:
                                if any(w in cond_header_lower for w in ["ki sphere", "orb", "obtains", "collects"]):
                                    score += 15
                else:
                    # Skill has NO conditions, but description has a condition header - penalty!
                    score -= 25
            else:
                if c_ids:
                    # Skill has conditions, but description has NO condition header - penalty!
                    score -= 25
                else:
                    # Skill has NO conditions, and description has NO condition header - bonus!
                    score += 10
                    
            # Penalty for distance from expected sequential line
            score -= 1.0 * abs(idx - expected_pos)
            
            pairs.append((score, sk_idx, idx))
            
    result = [-1] * len(skills)
    
    # 1. Enforce manual overrides first
    for sk_idx, sk in enumerate(skills):
        manual_idx = sk.get('manual_desc_idx')
        if manual_idx is not None:
            if manual_idx >= 0 and manual_idx < len(desc_lines):
                result[sk_idx] = manual_idx
            elif manual_idx == -1:
                result[sk_idx] = -1
                
    # 2. Independent matching (resolves one line matching many efficacy lines)
    for sk_idx in range(len(skills)):
        if result[sk_idx] == -1:
            best_idx = -1
            best_score = -10000
            for score, s_idx, idx in pairs:
                if s_idx == sk_idx and score > best_score:
                    best_score = score
                    best_idx = idx
            result[sk_idx] = best_idx
            
    # 3. Strict value check - clear match if absolutely no numerical data aligns
    for sk_idx in range(len(skills)):
        sk = skills[sk_idx]
        if sk.get('manual_desc_idx') is None:
            matched_idx = result[sk_idx]
            if matched_idx >= 0:
                if not has_any_matching_number(sk, desc_lines, matched_idx):
                    result[sk_idx] = -1
                    
    return result


def find_closest_condition_header(desc_lines, matched_idx):
    for i in range(matched_idx, -1, -1):
        line = desc_lines[i].strip()
        if line.startswith('*') and line.endswith('*'):
            return line
    return None

def find_closest_condition_header_idx(desc_lines, matched_idx):
    if matched_idx < 0 or matched_idx >= len(desc_lines):
        return -1
    for i in range(matched_idx, -1, -1):
        line = desc_lines[i].strip()
        if line.startswith('*') and line.endswith('*'):
            return i
    return -1

def find_secondary_line_idx(desc_lines, idx, eff_type):
    if idx < 0 or idx >= len(desc_lines):
        return -1
    primary_text = desc_lines[idx].lower()
    
    if eff_type in [3, 18]:
        if "atk" in primary_text and "def" not in primary_text:
            for adj in [idx + 1, idx - 1]:
                if adj >= 0 and adj < len(desc_lines):
                    adj_text = desc_lines[adj].lower()
                    if "def" in adj_text and "atk" not in adj_text:
                        if find_closest_condition_header(desc_lines, adj) == find_closest_condition_header(desc_lines, idx):
                            return adj
        elif "def" in primary_text and "atk" not in primary_text:
            for adj in [idx + 1, idx - 1]:
                if adj >= 0 and adj < len(desc_lines):
                    adj_text = desc_lines[adj].lower()
                    if "atk" in adj_text and "def" not in adj_text:
                        if find_closest_condition_header(desc_lines, adj) == find_closest_condition_header(desc_lines, idx):
                            return adj
    elif eff_type == 44:
        if "atk" in primary_text and "hp" not in primary_text:
            for adj in [idx + 1, idx - 1]:
                if adj >= 0 and adj < len(desc_lines):
                    adj_text = desc_lines[adj].lower()
                    if "hp" in adj_text and "atk" not in adj_text:
                        if find_closest_condition_header(desc_lines, adj) == find_closest_condition_header(desc_lines, idx):
                            return adj
        elif "hp" in primary_text and "atk" not in primary_text:
            for adj in [idx + 1, idx - 1]:
                if adj >= 0 and adj < len(desc_lines):
                    adj_text = desc_lines[adj].lower()
                    if "atk" in adj_text and "hp" not in adj_text:
                        if find_closest_condition_header(desc_lines, adj) == find_closest_condition_header(desc_lines, idx):
                            return adj
    return -1

def sync_text_with_values(text, sk, is_secondary=False):
    import re
    
    v1_raw = get_int_val(sk, 'eff_value1', 0)
    eff_type = get_int_val(sk, 'efficacy_type', 0)
    if eff_type in [96, 97, 98] and v1_raw > 0:
        # En translation mapping
        en_names = {
            1: 'AGL', 2: 'TEQ', 4: 'INT', 8: 'STR', 16: 'PHY',
            32: 'Rainbow', 448: 'Candy', 4096: 'Carrots'
        }

        # En patterns
        types_pattern_en = r'\b(Rainbow|AGL|TEQ|INT|STR|PHY|Candy|Carrots?)\b'
        # Check if typed Ki sphere exists (e.g. STR Ki Sphere(s))
        has_typed_en = re.search(types_pattern_en + r'\s+Ki\s+Spheres?', text, re.IGNORECASE)
        # Check if untyped Ki sphere exists (e.g. Ki Sphere(s))
        has_untyped_en = re.search(r'\bKi\s+Spheres?\b', text, re.IGNORECASE)

        if has_typed_en:
            matched_type = has_typed_en.group(1)
            if v1_raw == 63:
                # Type -> Any: remove the type keyword
                text = re.sub(rf'\b{re.escape(matched_type)}\s+(Ki\s+Spheres?)', r'\1', text, flags=re.IGNORECASE)
            elif v1_raw in en_names:
                # Type -> Type: swap the type keyword
                new_type = en_names[v1_raw]
                text = re.sub(rf'\b{re.escape(matched_type)}\b', new_type, text, flags=re.IGNORECASE)
        elif has_untyped_en and v1_raw in en_names:
            # Untyped -> Type: insert the type keyword before 'Ki'
            new_type = en_names[v1_raw]
            text = re.sub(r'\b(Ki\s+Spheres?)\b', rf'{new_type} \1', text, flags=re.IGNORECASE)

    matches = list(re.finditer(r'\d+', text))
    if not matches:
        return text
        
    v1 = get_int_val(sk, 'eff_value1', 0)
    v2 = get_int_val(sk, 'eff_value2', 0)
    v3 = get_int_val(sk, 'eff_value3', 0)
    turn = get_int_val(sk, 'turn', 1)
    prob = get_int_val(sk, 'probability', 100)
    
    if eff_type == 13:
        v1_text = 100 - v1
    else:
        v1_text = v1
        
    orig_v1 = get_int_val(sk, 'orig_eff_value1', v1)
    orig_v2 = get_int_val(sk, 'orig_eff_value2', v2)
    orig_v3 = get_int_val(sk, 'orig_eff_value3', v3)
    orig_turn = get_int_val(sk, 'orig_turn', turn)
    orig_prob = get_int_val(sk, 'orig_probability', prob)
    
    if eff_type == 13:
        orig_v1_text = 100 - orig_v1
    else:
        orig_v1_text = orig_v1
        
    is_type_prefixed = (eff_type in [16, 17, 18, 20, 44, 96, 97, 98, 103, 110, 131, 79])
    
    field_configs = []
    
    # Add turn (only if turn > 1 and turn < 20)
    if turn > 1 and turn < 20:
        field_configs.append({
            'field': 'turn',
            'orig': orig_turn,
            'curr': turn
        })
        
    # Add probability (only if < 100)
    if prob < 100:
        field_configs.append({
            'field': 'probability',
            'orig': orig_prob,
            'curr': prob
        })
        
    # Add Value 1 (if not type prefixed)
    if not is_type_prefixed and v1_text != 0:
        field_configs.append({
            'field': 'eff_value1',
            'orig': orig_v1_text,
            'curr': v1_text
        })
        
    # Add Value 2
    if v2 != 0:
        field_configs.append({
            'field': 'eff_value2',
            'orig': orig_v2,
            'curr': v2
        })
        
    # Add Value 3
    if v3 != 0:
        field_configs.append({
            'field': 'eff_value3',
            'orig': orig_v3,
            'curr': v3
        })
        
    mapped_replacements = {}
    used_match_indices = set()
    
    for config in field_configs:
        best_match_idx = -1
        # 1. Exact match with original value in text
        for idx, match in enumerate(matches):
            if idx in used_match_indices:
                continue
            num = int(match.group(0))
            if num == config['orig']:
                best_match_idx = idx
                break
                
        # 2. Exact match with current value (if already replaced once)
        if best_match_idx == -1:
            for idx, match in enumerate(matches):
                if idx in used_match_indices:
                    continue
                num = int(match.group(0))
                if num == config['curr']:
                    best_match_idx = idx
                    break
                    
        # 3. Fallback to closest number in description text
        if best_match_idx == -1:
            min_diff = float('inf')
            for idx, match in enumerate(matches):
                if idx in used_match_indices:
                    continue
                num = int(match.group(0))
                diff = abs(num - config['orig'])
                if diff < min_diff:
                    min_diff = diff
                    best_match_idx = idx
                    
        if best_match_idx != -1:
            used_match_indices.add(best_match_idx)
            if config['orig'] != config['curr'] or int(matches[best_match_idx].group(0)) == config['orig']:
                mapped_replacements[best_match_idx] = str(config['curr'])
                
    new_text = ""
    last_idx = 0
    for idx, match in enumerate(matches):
        start, end = match.span()
        new_text += text[last_idx:start]
        if idx in mapped_replacements:
            new_text += mapped_replacements[idx]
        else:
            new_text += match.group(0)
        last_idx = end
    new_text += text[last_idx:]
    return new_text


def check_efficacy_line_match(sk, desc_lines, matched_idx, matched_idx2):
    if matched_idx < 0 or matched_idx >= len(desc_lines):
        return False
        
    eff_type = sk.get('efficacy_type', 0)
    if eff_type in [76, 77, 78]:
        return True
        
    import re
    primary_text = desc_lines[matched_idx]
    primary_nums = [int(n) for n in re.findall(r'\d+', primary_text)]
    
    secondary_text = desc_lines[matched_idx2] if (matched_idx2 >= 0 and matched_idx2 < len(desc_lines)) else ""
    secondary_nums = [int(n) for n in re.findall(r'\d+', secondary_text)] if secondary_text else []
    
    all_nums = primary_nums + secondary_nums
    
    eff_type = get_int_val(sk, 'efficacy_type', 0)
    v1 = get_int_val(sk, 'eff_value1', 0)
    v2 = get_int_val(sk, 'eff_value2', 0)
    v3 = get_int_val(sk, 'eff_value3', 0)
    eff_val1 = get_int_val(sk, 'eff_val1', 0)
    eff_val2 = get_int_val(sk, 'eff_val2', 0)
    eff_val3 = get_int_val(sk, 'eff_val3', 0)
    
    val1 = v1 if v1 != 0 else eff_val1
    val2 = v2 if v2 != 0 else eff_val2
    val3 = v3 if v3 != 0 else eff_val3
    
    turn = get_int_val(sk, 'turn', 1)
    prob = get_int_val(sk, 'probability', get_int_val(sk, 'prob', 100))
    
    orig_val1 = get_int_val(sk, 'orig_eff_value1', val1)
    orig_val2 = get_int_val(sk, 'orig_eff_value2', val2)
    orig_val3 = get_int_val(sk, 'orig_eff_value3', val3)
    orig_turn = get_int_val(sk, 'orig_turn', turn)
    orig_prob = get_int_val(sk, 'orig_probability', prob)
    
    expected_current = []
    is_type_prefixed = (eff_type in [16, 17, 18, 20, 44, 96, 97, 98, 103, 110, 131, 79])
    if is_type_prefixed:
        if val2 > 0: expected_current.append(val2)
        if val3 > 0: expected_current.append(val3)
    else:
        if eff_type == 13:
            expected_current.append(100 - val1)
        elif val1 > 0:
            expected_current.append(val1)
        if val2 > 0: expected_current.append(val2)
        if val3 > 0: expected_current.append(val3)
        
    if prob < 100:
        expected_current.append(prob)
        
    expected_original = []
    if is_type_prefixed:
        if orig_val2 > 0: expected_original.append(orig_val2)
        if orig_val3 > 0: expected_original.append(orig_val3)
    else:
        if eff_type == 13:
            expected_original.append(100 - orig_val1)
        elif orig_val1 > 0:
            expected_original.append(orig_val1)
        if orig_val2 > 0: expected_original.append(orig_val2)
        if orig_val3 > 0: expected_original.append(orig_val3)
        
    if orig_prob < 100:
        expected_original.append(orig_prob)
        
    turn_ok_current = True
    if turn > 1 and turn < 20:
        turn_ok_current = any(t in all_nums for t in [turn, turn - 1, turn + 1])
        
    turn_ok_original = True
    if orig_turn > 1 and orig_turn < 20:
        turn_ok_original = any(t in all_nums for t in [orig_turn, orig_turn - 1, orig_turn + 1])
        
    match_current = all(val in all_nums for val in expected_current) and turn_ok_current
    match_original = all(val in all_nums for val in expected_original) and turn_ok_original
    
    return (match_current or match_original)
            
    c_ids, _ = parse_causality_json(sk.get('causality_conditions', ''))
    if c_ids:
        cond_header = find_closest_condition_header(desc_lines, matched_idx)
        if not cond_header:
            return False
            
        header_nums = [int(n) for n in re.findall(r'\d+', cond_header)]
        causalities_data = st.session_state.get('causalities_data', {})
        for cid in c_ids:
            c_rec = causalities_data.get(cid)
            if c_rec:
                cau_v1 = c_rec.get('cau_val1', 0)
                cau_v2 = c_rec.get('cau_val2', 0)
                cau_v3 = c_rec.get('cau_val3', 0)
                
                for cv in [cau_v1, cau_v2, cau_v3]:
                    if cv > 0 and cv not in header_nums:
                        return False
                        
    return True

def auto_update_causality_values(sk, old_cond_text, new_cond_text):
    import re
    old_nums = [int(n) for n in re.findall(r'\d+', old_cond_text)]
    new_nums = [int(n) for n in re.findall(r'\d+', new_cond_text)]
    
    if len(old_nums) == len(new_nums) and len(old_nums) > 0:
        c_ids, _ = parse_causality_json(sk.get('causality_conditions', ''))
        causalities_data = st.session_state.get('causalities_data', {})
        for cid in c_ids:
            c_rec = causalities_data.get(cid)
            if c_rec:
                for idx, old_num in enumerate(old_nums):
                    new_num = new_nums[idx]
                    if old_num == new_num:
                        continue
                    if c_rec.get('cau_val1') == old_num:
                        c_rec['cau_val1'] = new_num
                    if c_rec.get('cau_val2') == old_num:
                        c_rec['cau_val2'] = new_num
                    if c_rec.get('cau_val3') == old_num:
                        c_rec['cau_val3'] = new_num

def auto_update_skill_values(sk, old_text, new_text):
    import re
    old_nums = [int(n) for n in re.findall(r'\d+', old_text)]
    new_nums = [int(n) for n in re.findall(r'\d+', new_text)]
    
    eff_type = sk.get('efficacy_type', 0)
    v1 = sk.get('eff_value1', 0)
    v2 = sk.get('eff_value2', 0)
    v3 = sk.get('eff_value3', 0)
    eff_val1 = sk.get('eff_val1', 0)
    eff_val2 = sk.get('eff_val2', 0)
    eff_val3 = sk.get('eff_val3', 0)
    
    val1 = v1 if v1 != 0 else eff_val1
    val2 = v2 if v2 != 0 else eff_val2
    val3 = v3 if v3 != 0 else eff_val3
    
    turn = sk.get('turn', 1)
    prob = sk.get('probability', 100)
    
    updates = {}
    
    # 1. Index-based alignment (if number of numbers is the same)
    if len(old_nums) == len(new_nums) and len(old_nums) > 0:
        for idx, old_num in enumerate(old_nums):
            new_num = new_nums[idx]
            if old_num == new_num:
                continue
                
            if not (eff_type in [16, 17, 18, 20, 44, 96, 97, 98, 103, 110, 131, 79]):
                if eff_type == 13 and (100 - val1) == old_num:
                    updates['eff_value1'] = 100 - new_num
                elif val1 == old_num:
                    updates['eff_value1'] = new_num
                
            if val2 == old_num:
                updates['eff_value2'] = new_num
                
            if val3 == old_num:
                updates['eff_value3'] = new_num
                
            if turn > 1 and turn < 20 and turn == old_num:
                updates['turn'] = new_num
                
            if prob < 100 and prob == old_num:
                updates['probability'] = new_num
                
    # 2. Keyword-based regex parsing fallback
    new_text_lower = new_text.lower()
    
    # Ki matching
    ki_match = re.search(r'ki \+(\d+)', new_text_lower)
    if ki_match and eff_type in [5, 20]:
        if eff_type == 5:
            updates['eff_value1'] = int(ki_match.group(1))
        elif eff_type == 20:
            updates['eff_value2'] = int(ki_match.group(1))
            
    # ATK/DEF/HP matching
    atk_def_match = re.search(r'atk\s*(?:&|and)\s*def\s*(\d+)%', new_text_lower)
    if atk_def_match:
        val = int(atk_def_match.group(1))
        if eff_type == 3:
            updates['eff_value1'] = val
            updates['eff_value2'] = val
        elif eff_type == 18:
            updates['eff_value2'] = val
            updates['eff_value3'] = val
    else:
        atk_match = re.search(r'atk\s*(\d+)%', new_text_lower)
        if atk_match:
            val = int(atk_match.group(1))
            if eff_type == 1:
                updates['eff_value1'] = val
            elif eff_type == 3:
                updates['eff_value1'] = val
            elif eff_type == 16:
                updates['eff_value2'] = val
            elif eff_type == 18:
                updates['eff_value2'] = val
            elif eff_type == 44:
                updates['eff_value2'] = val
                
        def_match = re.search(r'def\s*(\d+)%', new_text_lower)
        if def_match:
            val = int(def_match.group(1))
            if eff_type == 2:
                updates['eff_value1'] = val
            elif eff_type == 3:
                updates['eff_value2'] = val
            elif eff_type == 17:
                updates['eff_value2'] = val
            elif eff_type == 18:
                updates['eff_value3'] = val
                
        hp_match = re.search(r'hp\s*(\d+)%', new_text_lower)
        if hp_match:
            val = int(hp_match.group(1))
            if eff_type == 44:
                updates['eff_value3'] = val
                
    # Damage reduction
    dmg_red_match = re.search(r'damage reduction rate\s*(\d+)%', new_text_lower)
    if not dmg_red_match:
        dmg_red_match = re.search(r'reduces damage received by\s*(\d+)%', new_text_lower)
    if dmg_red_match and eff_type == 13:
        updates['eff_value1'] = 100 - int(dmg_red_match.group(1))
        
    # Turn matching
    turn_match = re.search(r'(\d+)\s*turn', new_text_lower)
    if turn_match:
        updates['turn'] = int(turn_match.group(1))
        
    # Probability matching
    prob_match = re.search(r'probability\s*(\d+)', new_text_lower)
    if prob_match:
        updates['probability'] = int(prob_match.group(1))
    elif "great chance" in new_text_lower:
        updates['probability'] = 70
    elif "high chance" in new_text_lower:
        updates['probability'] = 50
    elif "medium chance" in new_text_lower:
        updates['probability'] = 30
        
    return updates


