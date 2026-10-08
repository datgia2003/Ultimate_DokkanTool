# -*- coding: utf-8 -*-
import json
from collections import defaultdict, deque
import sqlite3
import streamlit as st
from modules.core.db import get_db_connection, query_db_one, query_db_all, element_type_dict
from modules.core.assets import get_element_color

def build_full_chains_map():
    from collections import defaultdict, deque
    adj = defaultdict(list)
    undir = defaultdict(set)
    
    # 1. Active skills
    act_rows = query_db_all("""
        SELECT DISTINCT card_active_skills.card_id as base_id, active_skills.eff_val1 as target_id
        FROM card_active_skills
        JOIN active_skills ON card_active_skills.active_skill_set_id = active_skills.active_skill_set_id
        WHERE active_skills.efficacy_type IN (79, 103, 131) AND active_skills.eff_val1 IS NOT NULL AND active_skills.eff_val1 > 0
    """)
    for r in act_rows:
        b, t = int(r['base_id']), int(r['target_id'])
        if t not in adj[b]: adj[b].append(t)
        undir[b].add(t)
        undir[t].add(b)

    # 2. Passive skills
    pas_rows = query_db_all("""
        SELECT DISTINCT cards.id as base_id, passive_skills.eff_value1 as target_id
        FROM cards
        JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
        JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
        WHERE passive_skills.efficacy_type IN (79, 103, 131) AND passive_skills.eff_value1 IS NOT NULL AND passive_skills.eff_value1 > 0
    """)
    for r in pas_rows:
        b, t = int(r['base_id']), int(r['target_id'])
        if t not in adj[b]: adj[b].append(t)
        undir[b].add(t)
        undir[t].add(b)

    # 3. Standby skills
    stb_rows = query_db_all("""
        SELECT DISTINCT card_standby_skill_set_relations.card_id as base_id, standby_skills.efficacy_values
        FROM card_standby_skill_set_relations
        JOIN standby_skills ON card_standby_skill_set_relations.standby_skill_set_id = standby_skills.standby_skill_set_id
        WHERE standby_skills.efficacy_type IN (79, 103, 131) AND standby_skills.efficacy_values IS NOT NULL
    """)
    for r in stb_rows:
        b = int(r['base_id'])
        try:
            arr = json.loads(r['efficacy_values'])
            if isinstance(arr, list) and len(arr) > 0 and int(arr[0]) > 0:
                t = int(arr[0])
                if t not in adj[b]: adj[b].append(t)
                undir[b].add(t)
                undir[t].add(b)
        except:
            pass

    visited_all = set()
    chain_info = {} # card_id -> (root_id, chain_list, pos)
    
    all_nodes = set(undir.keys())
    for node in all_nodes:
        if node in visited_all:
            continue
            
        comp = []
        q = deque([node])
        seen = {node}
        while q:
            curr = q.popleft()
            comp.append(curr)
            for neighbor in undir[curr]:
                if neighbor not in seen:
                    seen.add(neighbor)
                    q.append(neighbor)
                    
        visited_all.update(comp)
        
        # Pick the canonical root for this component (prefer 1xxxxxx then lowest ID)
        root = sorted(comp, key=lambda x: (0 if str(x).startswith('1') else 1, x))[0]
        
        chain = []
        c_seen = set()
        q_order = deque([root])
        c_seen.add(root)
        while q_order:
            c_curr = q_order.popleft()
            chain.append(c_curr)
            for nxt in adj.get(c_curr, []):
                if nxt in seen and nxt not in c_seen:
                    c_seen.add(nxt)
                    q_order.append(nxt)
            for nxt in sorted(list(undir.get(c_curr, set()))):
                if nxt not in c_seen:
                    c_seen.add(nxt)
                    q_order.append(nxt)
                    
        for pos, cid in enumerate(chain):
            chain_info[cid] = (root, chain, pos)
            
    return chain_info

@st.cache_data(show_spinner=False, max_entries=64)
def search_cards_filtered(keyword="", rarities_list=(5, 4, 3), elem_filter=None):
    params = []
    where_clauses = []
    
    if keyword and keyword.strip():
        kw = keyword.strip()
        search_pattern = f"%{kw}%"
        where_clauses.append("""(
            name LIKE ? 
            OR CAST(id AS TEXT) LIKE ? 
            OR CAST(passive_skill_set_id AS TEXT) LIKE ?
            OR CAST(leader_skill_set_id AS TEXT) LIKE ?
            OR id IN (SELECT card_id FROM card_active_skills WHERE CAST(active_skill_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT card_id FROM card_standby_skill_set_relations WHERE CAST(standby_skill_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT card_id FROM card_specials WHERE CAST(special_set_id AS TEXT) LIKE ?)
            OR id IN (SELECT cards.id FROM cards JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id WHERE CAST(passive_skill_set_relations.passive_skill_id AS TEXT) LIKE ?)
        )""")
        params.extend([search_pattern] * 8)
        
    if rarities_list:
        placeholders = ",".join(["?"] * len(rarities_list))
        where_clauses.append(f"rarity IN ({placeholders})")
        params.extend(list(rarities_list))
    else:
        where_clauses.append("rarity IN (5, 4, 3)")
        
    # Exclude non-playable / unawakened placeholder IDs ending in 0
    where_clauses.append("id % 10 != 0")
    
    # Only keep playable card IDs starting with 1 (base) or 4 (Dokkan Awakened / Transformed)
    where_clauses.append("(CAST(id AS TEXT) LIKE '1%' OR CAST(id AS TEXT) LIKE '4%')")
        
    if elem_filter is not None and elem_filter != "All Types":
        if isinstance(elem_filter, int):
            where_clauses.append("element = ?")
            params.append(elem_filter)
        elif isinstance(elem_filter, str):
            matching_eids = [eid for eid, name in element_type_dict.items() if elem_filter.lower() in name.lower()]
            if matching_eids:
                placeholders = ",".join(["?"] * len(matching_eids))
                where_clauses.append(f"element IN ({placeholders})")
                params.extend(matching_eids)
                
    where_str = " WHERE " + " AND ".join(where_clauses) if where_clauses else ""
    
    sql = f"""
        SELECT id, name, rarity, element, hp_max, atk_max, def_max, leader_skill_set_id, passive_skill_set_id
        FROM cards
        {where_str}
        LIMIT 400
    """
    raw_cards = [dict(r) for r in query_db_all(sql, tuple(params))]
    if not raw_cards:
        return []
        
    chain_map = build_full_chains_map()
    all_card_rarities = {c['id']: c.get('rarity', 0) for c in raw_cards}
    
    def sort_key(c):
        cid = c['id']
        if cid in chain_map:
            root_id, chain_list, pos = chain_map[cid]
        else:
            root_id = cid
            pos = 0
            
        root_rarity = all_card_rarities.get(root_id, c.get('rarity', 0))
        
        # Sort Priority:
        # 1. Root / Group Rarity DESC (LR -> UR -> SSR)
        # 2. Root / Group ID DESC (Newest units first)
        # 3. Position in transformation chain ASC (Base form 0 -> Form 1 -> Form 2...)
        # 4. Fallback Card ID DESC
        return (-root_rarity, -root_id, pos, -cid)
        
    raw_cards.sort(key=sort_key)
    return raw_cards



# -------------------------------------------------------------
# Data Loader: Search & Aggregate Context
# -------------------------------------------------------------
def load_character_context(card_id=None, passive_id=None, leader_id=None, special_id=None):
    card = None
    if card_id:
        card = query_db_one("SELECT * FROM cards WHERE id = ?", (card_id,))
    elif passive_id:
        card = query_db_one("SELECT * FROM cards WHERE passive_skill_set_id = ?", (passive_id,))
        if not card:
            rel = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_set_id = ? OR passive_skill_id = ?", (passive_id, passive_id))
            if rel:
                card = query_db_one("SELECT * FROM cards WHERE passive_skill_set_id = ?", (rel['passive_skill_set_id'],))
    elif leader_id:
        card = query_db_one("SELECT * FROM cards WHERE leader_skill_set_id = ?", (leader_id,))
    elif special_id:
        card = query_db_one("SELECT cards.* FROM cards JOIN card_specials ON cards.id = card_specials.card_id WHERE card_specials.special_set_id = ?", (special_id,))
        if not card:
            spec = query_db_one("SELECT id FROM special_sets WHERE id = ?", (special_id,))
            if spec:
                card = query_db_one("SELECT cards.* FROM cards JOIN card_specials ON cards.id = card_specials.card_id WHERE card_specials.special_set_id = ?", (spec['id'],))

    if not card:
        return None

    ctx = {}
    ctx['deleted_rows'] = []
    ctx['card'] = dict(card)
    cid = card['id']
    
    # 1. Leader Skill
    l_set_id = card['leader_skill_set_id']
    ctx['leader_set'] = None
    ctx['leader_skills'] = []
    if l_set_id:
        l_set = query_db_one("SELECT * FROM leader_skill_sets WHERE id = ?", (l_set_id,))
        if l_set:
            ctx['leader_set'] = dict(l_set)
            ctx['leader_skills'] = [dict(r) for r in query_db_all("SELECT * FROM leader_skills WHERE leader_skill_set_id = ?", (l_set_id,))]

    # 2. Passive Skill
    p_set_id = card['passive_skill_set_id']
    ctx['passive_set'] = None
    ctx['passive_skills'] = []
    ctx['passive_skill_effects'] = []
    if p_set_id:
        p_set = query_db_one("SELECT * FROM passive_skill_sets WHERE id = ?", (p_set_id,))
        if p_set:
            ctx['passive_set'] = dict(p_set)
            rels = query_db_all("SELECT * FROM passive_skill_set_relations WHERE passive_skill_set_id = ?", (p_set_id,))
            skills = []
            for r in rels:
                s = query_db_one("SELECT * FROM passive_skills WHERE id = ?", (r['passive_skill_id'],))
                if s:
                    s_dict = dict(s)
                    s_dict['relation_id'] = r['id']
                    skills.append(s_dict)
                    pse_id = s.get('passive_skill_effect_id')
                    if pse_id:
                        pse = query_db_one("SELECT * FROM passive_skill_effects WHERE id = ?", (pse_id,))
                        if pse:
                            if not any(x['id'] == pse_id for x in ctx['passive_skill_effects']):
                                ctx['passive_skill_effects'].append(dict(pse))
            ctx['passive_skills'] = skills

    # 3. Active Skill
    ctx['active_link'] = None
    ctx['active_set'] = None
    ctx['active_skills'] = []
    cas = query_db_one("SELECT * FROM card_active_skills WHERE card_id = ?", (cid,))
    act_set_id = None
    if cas:
        ctx['active_link'] = dict(cas)
        act_set_id = cas['active_skill_set_id']
        if act_set_id:
            act_set = query_db_one("SELECT * FROM active_skill_sets WHERE id = ?", (act_set_id,))
            if act_set:
                ctx['active_set'] = dict(act_set)
                ctx['active_skills'] = [dict(r) for r in query_db_all("SELECT * FROM active_skills WHERE active_skill_set_id = ?", (act_set_id,))]

    # 4. Standby Skill
    ctx['standby_link'] = None
    ctx['standby_set'] = None
    ctx['standby_skills'] = []
    ctx['standby_finish_relations'] = []
    cssr = query_db_one("SELECT * FROM card_standby_skill_set_relations WHERE card_id = ?", (cid,))
    st_set_id = None
    if cssr:
        ctx['standby_link'] = dict(cssr)
        st_set_id = cssr['standby_skill_set_id']
        if st_set_id:
            st_set = query_db_one("SELECT * FROM standby_skill_sets WHERE id = ?", (st_set_id,))
            if st_set:
                ctx['standby_set'] = dict(st_set)
                ctx['standby_skills'] = [dict(r) for r in query_db_all("SELECT * FROM standby_skills WHERE standby_skill_set_id = ?", (st_set_id,))]
                ctx['standby_finish_relations'] = [dict(r) for r in query_db_all("""
                    SELECT relation.*, finish_skill_sets.name AS finish_name
                    FROM standby_skill_set_finish_skill_set_relations AS relation
                    LEFT JOIN finish_skill_sets ON finish_skill_sets.id = relation.finish_skill_set_id
                    WHERE relation.standby_skill_set_id = ?
                    ORDER BY relation.id ASC
                """, (st_set_id,))]

    # 5. Finish Skills (support multiple Finish Skills per card)
    ctx['finish_skill_sets'] = []
    cfsr_rows = query_db_all("SELECT * FROM card_finish_skill_set_relations WHERE card_id = ? ORDER BY id ASC", (cid,))
    for cfsr in cfsr_rows:
        item = {
            'link': dict(cfsr),
            'set': None,
            'skills': [],
            'special': None
        }
        f_set_id = cfsr['finish_skill_set_id']
        if f_set_id:
            f_set = query_db_one("SELECT * FROM finish_skill_sets WHERE id = ?", (f_set_id,))
            if f_set:
                item['set'] = dict(f_set)
                item['skills'] = [dict(r) for r in query_db_all("SELECT * FROM finish_skills WHERE finish_skill_set_id = ? ORDER BY id ASC", (f_set_id,))]
                f_spec_id = f_set.get('finish_special_id')
                if f_spec_id and f_spec_id != 0:
                    f_spec = query_db_one("SELECT * FROM finish_specials WHERE id = ?", (f_spec_id,))
                    if f_spec:
                        item['special'] = dict(f_spec)
        ctx['finish_skill_sets'].append(item)

    # Legacy compatibility fallback
    if ctx['finish_skill_sets']:
        first = ctx['finish_skill_sets'][0]
        ctx['finish_link'] = first['link']
        ctx['finish_set'] = first['set']
        ctx['finish_special'] = first['special']
        ctx['finish_skills'] = [sk for f_item in ctx['finish_skill_sets'] for sk in f_item.get('skills', [])]
    else:
        ctx['finish_link'] = None
        ctx['finish_set'] = None
        ctx['finish_skills'] = []
        ctx['finish_special'] = None

    # 6. Specials (Super Attacks)
    ctx['card_specials'] = []
    cs_rows = query_db_all("SELECT * FROM card_specials WHERE card_id = ?", (cid,))
    for cs in cs_rows:
        cs_dict = dict(cs)
        s_set_id = cs['special_set_id']
        cs_dict['special_set'] = None
        cs_dict['specials'] = []
        cs_dict['bonuses'] = []
        
        if s_set_id:
            s_set = query_db_one("SELECT * FROM special_sets WHERE id = ?", (s_set_id,))
            if s_set:
                cs_dict['special_set'] = dict(s_set)
                cs_dict['specials'] = [dict(r) for r in query_db_all("SELECT * FROM specials WHERE special_set_id = ?", (s_set_id,))]
                
            for bonus_col in ["special_bonus_id1", "special_bonus_id2"]:
                sb_id = cs[bonus_col]
                if sb_id and sb_id != 0:
                    sb = query_db_one("SELECT * FROM special_bonuses WHERE id = ?", (sb_id,))
                    if sb:
                        cs_dict['bonuses'].append(dict(sb))
                        
            eso = query_db_one("SELECT * FROM extra_special_options WHERE card_special_id = ?", (cs['id'],))
            if eso:
                cs_dict['extra_special_option'] = dict(eso)
                
        ctx['card_specials'].append(cs_dict)

    # Special Views (Active / Super / Finish Skill animations)
    ctx['special_views'] = []
    sv_ids = set()
    if ctx.get('active_set') and ctx['active_set'].get('special_view_id'):
        sv_ids.add(ctx['active_set']['special_view_id'])
    for f_item in ctx.get('finish_skill_sets', []):
        if f_item.get('set') and f_item['set'].get('special_view_id'):
            sv_ids.add(f_item['set']['special_view_id'])
    for cs_item in ctx.get('card_specials', []):
        for view_key in ('view_id', 'bonus_view_id1', 'bonus_view_id2'):
            if cs_item.get(view_key):
                sv_ids.add(cs_item[view_key])
    for sv_id in sv_ids:
        if sv_id and sv_id > 0:
            sv_row = query_db_one("SELECT * FROM special_views WHERE id = ?", (sv_id,))
            if sv_row:
                ctx['special_views'].append(dict(sv_row))

    # 7. Dokkan Field
    ctx['fields'] = []
    ctx['field_active_relations'] = []
    ctx['field_passive_relations'] = []
    field_ids = set()
    
    if act_set_id:
        f_rel = query_db_all("SELECT * FROM dokkan_field_active_skill_set_relations WHERE active_skill_set_id = ?", (act_set_id,))
        ctx['field_active_relations'] = [dict(r) for r in f_rel]
        for r in f_rel:
            field_ids.add(r['dokkan_field_id'])

    p_skills_ids = [s['id'] for s in ctx.get('passive_skills', [])]
    if p_skills_ids:
        placeholders = ",".join(["?"] * len(p_skills_ids))
        p_rel = query_db_all(f"SELECT * FROM dokkan_field_passive_skill_relations WHERE passive_skill_id IN ({placeholders})", tuple(p_skills_ids))
        ctx['field_passive_relations'] = [dict(r) for r in p_rel]
        for r in p_rel:
            field_ids.add(r['dokkan_field_id'])

    for f_id in field_ids:
        field = query_db_one("SELECT * FROM dokkan_fields WHERE id = ?", (f_id,))
        if field:
            f_dict = dict(field)
            f_dict['efficacies'] = [dict(r) for r in query_db_all("SELECT * FROM dokkan_field_efficacies WHERE dokkan_field_efficacy_set_id = ?", (field['dokkan_field_efficacy_set_id'],))]
            ctx['fields'].append(f_dict)

    # 8. Transformation Descriptions
    ctx['transformation_descriptions'] = []
    
    # Active skill transformations
    if ctx.get('active_skills'):
        active_ids = [s['id'] for s in ctx['active_skills']]
        placeholders = ",".join(["?"] * len(active_ids))
        tds = query_db_all(f"SELECT * FROM transformation_descriptions WHERE skill_type = 'ActiveSkill' AND skill_id IN ({placeholders})", tuple(active_ids))
        ctx['transformation_descriptions'].extend([dict(r) for r in tds])
        
    # Passive skill transformations
    if ctx.get('passive_skills'):
        passive_ids = [s['id'] for s in ctx['passive_skills']]
        placeholders = ",".join(["?"] * len(passive_ids))
        tds = query_db_all(f"SELECT * FROM transformation_descriptions WHERE skill_type = 'PassiveSkill' AND skill_id IN ({placeholders})", tuple(passive_ids))
        ctx['transformation_descriptions'].extend([dict(r) for r in tds])
        
    # Standby skill transformations
    if ctx.get('standby_skills'):
        standby_ids = [s['id'] for s in ctx['standby_skills']]
        placeholders = ",".join(["?"] * len(standby_ids))
        tds = query_db_all(f"SELECT * FROM transformation_descriptions WHERE skill_type = 'StandbySkill' AND skill_id IN ({placeholders})", tuple(standby_ids))
        ctx['transformation_descriptions'].extend([dict(r) for r in tds])
        
    # Finish skill transformations
    if ctx.get('finish_skills'):
        finish_ids = [s['id'] for s in ctx['finish_skills']]
        placeholders = ",".join(["?"] * len(finish_ids))
        tds = query_db_all(f"SELECT * FROM transformation_descriptions WHERE skill_type = 'FinishSkill' AND skill_id IN ({placeholders})", tuple(finish_ids))
        ctx['transformation_descriptions'].extend([dict(r) for r in tds])

    return ctx

# -------------------------------------------------------------
# Form Chain Transformation Lookup
# -------------------------------------------------------------
def get_card_transformation_chain_details(card_id):
    """
    Finds the complete bidirectional transformation chain for a given card_id.
    Traverses forward (post-transformations) and backward (pre-transformations) recursively.
    Returns a list of card objects sorted in logical order (base -> next forms).
    """
    try:
        card_id = int(card_id)
    except:
        return []

    def fetch_card_info(cid):
        return query_db_one("SELECT id, name, rarity, element, character_id FROM cards WHERE id = ?", (cid,))

    def get_direct_relations(cid):
        forward = []
        backward = []

        # Forward Active (79, 103, 131)
        cas = query_db_all("""
            SELECT active_skills.eff_val1, active_skills.efficacy_type
            FROM card_active_skills 
            JOIN active_skills ON card_active_skills.active_skill_set_id = active_skills.active_skill_set_id 
            WHERE card_active_skills.card_id = ? AND active_skills.efficacy_type IN (79, 103, 131)
        """, (cid,))
        for r in cas:
            t_id = r['eff_val1']
            if t_id:
                t_str = 'Giant Form' if r['efficacy_type'] == 79 else ('Exchange Form' if r['efficacy_type'] == 131 else 'Active Transformation')
                forward.append((t_id, t_str))

        # Forward Standby (79, 103, 131)
        cssr = query_db_all("""
            SELECT standby_skills.efficacy_values, standby_skills.efficacy_type
            FROM card_standby_skill_set_relations 
            JOIN standby_skills ON card_standby_skill_set_relations.standby_skill_set_id = standby_skills.standby_skill_set_id 
            WHERE card_standby_skill_set_relations.card_id = ? AND standby_skills.efficacy_type IN (79, 103, 131)
        """, (cid,))
        for r in cssr:
            val_str = r['efficacy_values']
            if val_str:
                try:
                    arr = json.loads(val_str)
                    if isinstance(arr, list) and len(arr) > 0 and arr[0]:
                        t_str = 'Giant Standby' if r['efficacy_type'] == 79 else ('Exchange Form' if r['efficacy_type'] == 131 else 'Standby Form')
                        forward.append((arr[0], t_str))
                except:
                    pass

        # Forward Passive (79, 103, 131)
        ps = query_db_all("""
            SELECT passive_skills.eff_value1, passive_skills.efficacy_type
            FROM cards 
            JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
            JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
            WHERE cards.id = ? AND passive_skills.efficacy_type IN (79, 103, 131)
        """, (cid,))
        for r in ps:
            t_id = r['eff_value1']
            if t_id:
                t_str = 'Exchange Form' if r['efficacy_type'] == 131 else ('Giant Form' if r['efficacy_type'] == 79 else 'Passive Transformation')
                forward.append((t_id, t_str))

        # Backward Active
        pre_act = query_db_all("""
            SELECT card_active_skills.card_id, active_skills.efficacy_type
            FROM card_active_skills
            JOIN active_skills ON card_active_skills.active_skill_set_id = active_skills.active_skill_set_id
            WHERE active_skills.eff_val1 = ? AND active_skills.efficacy_type IN (79, 103, 131)
        """, (cid,))
        for r in pre_act:
            s_id = r['card_id']
            if s_id:
                backward.append((s_id, 'Base Form'))

        # Backward Standby
        pre_stb = query_db_all("""
            SELECT card_standby_skill_set_relations.card_id, standby_skills.efficacy_values
            FROM card_standby_skill_set_relations
            JOIN standby_skills ON card_standby_skill_set_relations.standby_skill_set_id = standby_skills.standby_skill_set_id
            WHERE standby_skills.efficacy_type IN (79, 103, 131)
        """)
        for r in pre_stb:
            try:
                values = json.loads(r.get('efficacy_values') or '[]')
                if not isinstance(values, list) or not values or int(values[0] or 0) != cid:
                    continue
            except (TypeError, ValueError, json.JSONDecodeError):
                continue
            s_id = r['card_id']
            if s_id:
                backward.append((s_id, 'Base Form'))

        # Backward Passive
        pre_pas = query_db_all("""
            SELECT cards.id
            FROM cards
            JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
            JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
            WHERE passive_skills.eff_value1 = ? AND passive_skills.efficacy_type IN (79, 103, 131)
        """, (cid,))
        for r in pre_pas:
            s_id = r['id']
            if s_id:
                backward.append((s_id, 'Base Form'))

        return forward, backward

    # BFS exploration
    queue = [card_id]
    all_nodes = set()
    node_types = {card_id: 'Base Form'}

    while queue:
        curr = queue.pop(0)
        if curr in all_nodes:
            continue
        all_nodes.add(curr)
        fwd, bwd = get_direct_relations(curr)
        for nid, ntype in fwd:
            if nid not in all_nodes:
                node_types[nid] = ntype
                queue.append(nid)
        for nid, ntype in bwd:
            if nid not in all_nodes:
                if nid not in node_types:
                    node_types[nid] = 'Base Form'
                queue.append(nid)

    if len(all_nodes) <= 1:
        return []

    sorted_cids = sorted(list(all_nodes), key=lambda x: (1 if str(x).startswith('4') else 0, x))

    results = []
    for cid in sorted_cids:
        c_info = fetch_card_info(cid)
        if c_info:
            results.append({
                'id': c_info['id'],
                'name': c_info['name'],
                'rarity': c_info.get('rarity', 0),
                'element': c_info.get('element', 0),
                'type': node_types.get(cid, 'Form'),
                'is_current': (cid == card_id)
            })

    return results

def get_related_card_forms(card_id):
    related = []
    
    # 1. Post-transformations (active, standby, passive)
    # Active (79, 103, 131)
    cas = query_db_all("""
        SELECT active_skills.eff_val1, active_skills.efficacy_type
        FROM card_active_skills 
        JOIN active_skills ON card_active_skills.active_skill_set_id = active_skills.active_skill_set_id 
        WHERE card_active_skills.card_id = ? AND active_skills.efficacy_type IN (79, 103, 131)
    """, (card_id,))
    for r in cas:
        val = r['eff_val1']
        eff_t = r['efficacy_type']
        type_str = 'Target (Giant Active)' if eff_t == 79 else ('Target (Exchange Active)' if eff_t == 131 else 'Target (Active)')
        if val:
            card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (val,))
            if card_info:
                related.append({
                    'id': card_info['id'],
                    'name': card_info['name'],
                    'rarity': card_info.get('rarity', 0),
                    'element': card_info.get('element', 0),
                    'type': type_str
                })
                
    # Standby (79, 103, 131)
    cssr = query_db_all("""
        SELECT standby_skills.efficacy_values, standby_skills.efficacy_type
        FROM card_standby_skill_set_relations 
        JOIN standby_skills ON card_standby_skill_set_relations.standby_skill_set_id = standby_skills.standby_skill_set_id 
        WHERE card_standby_skill_set_relations.card_id = ? AND standby_skills.efficacy_type IN (79, 103, 131)
    """, (card_id,))
    for r in cssr:
        val_str = r['efficacy_values']
        eff_t = r['efficacy_type']
        type_str = 'Target (Giant Standby)' if eff_t == 79 else ('Target (Exchange Standby)' if eff_t == 131 else 'Target (Standby)')
        if val_str:
            try:
                arr = json.loads(val_str)
                if isinstance(arr, list) and len(arr) > 0:
                    target_id = arr[0]
                    card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (target_id,))
                    if card_info:
                        related.append({
                            'id': card_info['id'],
                            'name': card_info['name'],
                            'rarity': card_info.get('rarity', 0),
                            'element': card_info.get('element', 0),
                            'type': type_str
                        })
            except:
                pass

    # Passive (79, 103, 131)
    ps = query_db_all("""
        SELECT passive_skills.eff_value1, passive_skills.efficacy_type
        FROM cards 
        JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
        JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
        WHERE cards.id = ? AND passive_skills.efficacy_type IN (79, 103, 131)
    """, (card_id,))
    for r in ps:
        val = r['eff_value1']
        eff_t = r['efficacy_type']
        if eff_t == 79:
            type_str = 'Target (Giant Passive)'
        elif eff_t == 131:
            type_str = 'Target (Exchange Passive)'
        else:
            type_str = 'Target (Passive)'
        if val:
            card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (val,))
            if card_info:
                related.append({
                    'id': card_info['id'],
                    'name': card_info['name'],
                    'rarity': card_info.get('rarity', 0),
                    'element': card_info.get('element', 0),
                    'type': type_str
                })

    # 2. Pre-transformations (active, passive, standby)
    # Active (79, 103, 131)
    pre_cas = query_db_all("""
        SELECT card_active_skills.card_id, active_skills.efficacy_type
        FROM card_active_skills 
        JOIN active_skills ON card_active_skills.active_skill_set_id = active_skills.active_skill_set_id 
        WHERE active_skills.efficacy_type IN (79, 103, 131) AND active_skills.eff_val1 = ?
    """, (card_id,))
    for r in pre_cas:
        card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (r['card_id'],))
        eff_t = r['efficacy_type']
        type_str = 'Pre-Form (Giant Active)' if eff_t == 79 else ('Pre-Form (Exchange Active)' if eff_t == 131 else 'Pre-Form (Active)')
        if card_info:
            related.append({
                'id': card_info['id'],
                'name': card_info['name'],
                'rarity': card_info.get('rarity', 0),
                'element': card_info.get('element', 0),
                'type': type_str
            })

    # Passive (79, 103, 131)
    pre_ps = query_db_all("""
        SELECT cards.id, passive_skills.efficacy_type
        FROM cards
        JOIN passive_skill_set_relations ON cards.passive_skill_set_id = passive_skill_set_relations.passive_skill_set_id
        JOIN passive_skills ON passive_skill_set_relations.passive_skill_id = passive_skills.id
        WHERE passive_skills.efficacy_type IN (79, 103, 131) AND passive_skills.eff_value1 = ?
    """, (card_id,))
    for r in pre_ps:
        card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (r['id'],))
        eff_t = r['efficacy_type']
        if eff_t == 79:
            type_str = 'Pre-Form (Giant Passive)'
        elif eff_t == 131:
            type_str = 'Pre-Form (Exchange Passive)'
        else:
            type_str = 'Pre-Form (Passive)'
        if card_info:
            related.append({
                'id': card_info['id'],
                'name': card_info['name'],
                'rarity': card_info.get('rarity', 0),
                'element': card_info.get('element', 0),
                'type': type_str
            })

    # Standby (79, 103, 131)
    pre_stb = query_db_all("""
        SELECT card_standby_skill_set_relations.card_id, standby_skills.efficacy_type, standby_skills.efficacy_values
        FROM card_standby_skill_set_relations
        JOIN standby_skills ON card_standby_skill_set_relations.standby_skill_set_id = standby_skills.standby_skill_set_id
        WHERE standby_skills.efficacy_type IN (79, 103, 131)
    """)
    for r in pre_stb:
        try:
            values = json.loads(r.get('efficacy_values') or '[]')
            if not isinstance(values, list) or not values or int(values[0] or 0) != int(card_id):
                continue
        except (TypeError, ValueError, json.JSONDecodeError):
            continue
        card_info = query_db_one("SELECT id, name, rarity, element FROM cards WHERE id = ?", (r['card_id'],))
        eff_t = r['efficacy_type']
        type_str = 'Pre-Form (Giant Standby)' if eff_t == 79 else ('Pre-Form (Exchange Standby)' if eff_t == 131 else 'Pre-Form (Standby)')
        if card_info:
            related.append({
                'id': card_info['id'],
                'name': card_info['name'],
                'rarity': card_info.get('rarity', 0),
                'element': card_info.get('element', 0),
                'type': type_str
            })

    # Remove duplicates
    seen = set()
    unique_related = []
    for r in related:
        key = (r['id'], r['type'])
        if key not in seen:
            seen.add(key)
            unique_related.append(r)
            
    return unique_related

# Helper to load context in session state
def get_workspace_transformation_chain(card_id, overrides=None):
    """Follow a mod's own forward links without importing donor ancestors."""
    from modules.core.mod_workspace import current_workspace
    workspace = current_workspace.get()
    if not workspace:
        return None
    overrides = overrides or {}

    def descendants(root):
        result, seen, queue = [], set(), [int(root)]
        while queue:
            cid = queue.pop(0)
            if cid in seen or cid <= 0:
                continue
            seen.add(cid)
            ctx = overrides.get(cid) or load_character_context(card_id=cid)
            if not ctx:
                continue
            result.append(cid)
            for kind, value_key in [('passive', 'eff_value1'), ('active', 'eff_val1'), ('standby', None)]:
                for skill in ctx.get(kind + '_skills', []):
                    if int(skill.get('efficacy_type') or 0) not in (79, 103, 131):
                        continue
                    try:
                        if value_key:
                            target = int(skill.get(value_key) or 0)
                        else:
                            values = skill.get('efficacy_values') or '[]'
                            values = values if isinstance(values, list) else json.loads(values)
                            target = int(values[0]) if isinstance(values, list) and values else 0
                        if target > 0 and target not in seen:
                            queue.append(target)
                    except (TypeError, ValueError, json.JSONDecodeError):
                        continue
        return result

    root = workspace.get('selected_card_id') or card_id
    chain = descendants(root)
    return chain if int(card_id) in chain else descendants(card_id)


def get_full_transformation_chain(start_card_id, current_ctx):
    workspace_chain = get_workspace_transformation_chain(start_card_id, {int(start_card_id): current_ctx})
    if workspace_chain is not None:
        return workspace_chain
    visited = set()
    to_visit = [start_card_id]
    
    while to_visit:
        curr_id = to_visit.pop(0)
        if curr_id in visited:
            continue
        visited.add(curr_id)
        
        neighbors = set()
        
        # 1. Check if we have this card in active edits cache
        curr_ctx = None
        if 'edited_contexts' in st.session_state and curr_id in st.session_state['edited_contexts']:
            curr_ctx = st.session_state['edited_contexts'][curr_id]
        elif curr_id == start_card_id:
            curr_ctx = current_ctx
            
        if curr_ctx:
            # Check active edits for new/edited post-transformations:
            # Active skills target (eff_val1)
            for sk in curr_ctx.get('active_skills', []):
                if sk.get('efficacy_type') in [79, 103, 131]:
                    val = sk.get('eff_val1')
                    if val:
                        neighbors.add(int(val))
            # Passive skills target (eff_value1)
            for sk in curr_ctx.get('passive_skills', []):
                if sk.get('efficacy_type') in [79, 103, 131]:
                    val = sk.get('eff_value1')
                    if val:
                        neighbors.add(int(val))
            # Standby skills target (efficacy_values[0])
            for sk in curr_ctx.get('standby_skills', []):
                if sk.get('efficacy_type') in [79, 103, 131]:
                    val_str = sk.get('efficacy_values')
                    if val_str:
                        try:
                            arr = json.loads(val_str)
                            if isinstance(arr, list) and len(arr) > 0:
                                neighbors.add(int(arr[0]))
                        except:
                            pass
                            
        # 2. Get relations from DB (post-transformations and pre-transformations)
        db_related = get_related_card_forms(curr_id)
        for r in db_related:
            neighbors.add(r['id'])
            
        for n in neighbors:
            if n not in visited:
                to_visit.append(n)
                
    return sorted(list(visited))

