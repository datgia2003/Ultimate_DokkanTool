from modules.core.db import query_db_all, query_db_one


def super_attack_tag(style, ki, has_extra=False):
    if style == 'Extra' or has_extra:
        return 'EX SA'
    label = 'Ultra SA' if style == 'Hyper' or int(ki or 0) >= 18 else 'SA'
    return label + (' · Conditional' if style == 'Condition' else '')


def _paged(sql, params, page, limit):
    page = max(1, int(page))
    limit = max(1, min(60, int(limit)))
    total = query_db_one(f'SELECT COUNT(*) n FROM ({sql})', params)['n']
    pages = max(1, (total + limit - 1) // limit)
    page = min(page, pages)
    items = query_db_all(sql + ' LIMIT ? OFFSET ?', (*params, limit, (page - 1) * limit))
    return dict(items=items, total=total, page=page, totalPages=pages, limit=limit)


def _rarity_filter(rarity, column):
    if str(rarity) in {'0', '1', '2', '3', '4', '5'}:
        return f' AND {column}=?', [int(rarity)]
    return '', []


def _name_relevance(column, term):
    # Rank the full result set before pagination; shorter matching names are closer.
    name = f'TRIM({column})'
    return (f'''CASE WHEN {name} = ? COLLATE NOCASE THEN 0
                    WHEN INSTR(LOWER({name}), LOWER(?)) = 1 THEN 1
                    ELSE 2 END, LENGTH({name}), ''', [term, term])


def search_animation_cards(query='', rarity='', page=1, limit=24, search_by='card_name'):
    term = query.strip()
    if not term:
        return dict(items=[], total=0, page=1, totalPages=1, limit=24)
    value = '%' + term + '%'
    clause, rarity_params = _rarity_filter(rarity, 'c.rarity')
    predicate = 'c.name LIKE ?'
    params = [value]
    if search_by == 'card_id':
        predicate = 'CAST(c.id AS TEXT) LIKE ?'
    elif search_by == 'move_name':
        predicate = '''EXISTS (SELECT 1 FROM card_specials cs JOIN special_sets ss ON ss.id=cs.special_set_id
            LEFT JOIN special_bonuses b1 ON b1.id=cs.special_bonus_id1
            LEFT JOIN special_bonuses b2 ON b2.id=cs.special_bonus_id2
            WHERE cs.card_id=c.id AND (ss.name LIKE ? OR b1.name LIKE ? OR b2.name LIKE ?))'''
        params = [value] * 3
        for slot, relation in [('active', 'card_active_skills'), ('standby', 'card_standby_skill_set_relations'), ('finish', 'card_finish_skill_set_relations')]:
            predicate += f''' OR EXISTS (SELECT 1 FROM {relation} r JOIN {slot}_skill_sets s
                ON s.id=r.{slot}_skill_set_id WHERE r.card_id=c.id AND s.name LIKE ?)'''
            params.append(value)
        predicate += ''' OR EXISTS (SELECT 1 FROM passive_skill_set_relations r JOIN passive_skills s ON s.id=r.passive_skill_id
            WHERE r.passive_skill_set_id=c.passive_skill_set_id AND s.name LIKE ? AND s.passive_skill_effect_id>0)'''
        params.append(value)
    relevance, relevance_params = _name_relevance('c.name', term) if search_by == 'card_name' else ('', [])
    sql = f'''SELECT c.id, c.name, c.rarity, c.element FROM cards c
        WHERE c.id % 10 != 0 AND CAST(c.id AS TEXT) NOT LIKE '9%'
        AND LENGTH(CAST(c.id AS TEXT)) <= 7 AND ({predicate}) {clause}
        ORDER BY {relevance}CASE WHEN c.id=? THEN 0 ELSE 1 END,
        CASE WHEN c.id < 5000000 THEN 0 ELSE 1 END, c.rarity DESC, c.id DESC'''
    return _paged(sql, [*params, *rarity_params, *relevance_params, int(term) if term.isdigit() else -1], page, limit)


def lookup_animations(slot, query='', rarity='', page=1, limit=24, search_by='card_name'):
    if not query.strip():
        return dict(items=[], total=0, page=1, totalPages=1, limit=24)
    if slot == 'super':
        base = '''FROM cards c JOIN card_specials s ON s.card_id=c.id
            LEFT JOIN special_sets ss ON ss.id=s.special_set_id'''
        queries = [f'''SELECT v.id, c.id card_id, c.name, c.rarity, v.script_name,
            COALESCE(NULLIF(ss.name, ''), 'Super Attack') move_name,
            COALESCE(NULLIF(ss.name, ''), 'Super Attack') animation_name,
            CASE WHEN s.style='Extra' OR e.id IS NOT NULL THEN 'EX SA'
                 WHEN s.style='Hyper' OR s.eball_num_start>=18 THEN 'Ultra SA'
                 ELSE 'SA' END || CASE WHEN s.style='Condition' THEN ' · Conditional' ELSE '' END move_tag
            {base} JOIN special_views v ON v.id=s.view_id
            LEFT JOIN extra_special_options e ON e.card_special_id=s.id''']
        for number in (1, 2):
            queries.append(f'''SELECT v.id, c.id card_id, c.name, c.rarity, v.script_name,
                COALESCE(NULLIF(ss.name, ''), 'Super Attack') || ' · ' || COALESCE(NULLIF(b.name, ''), 'Bonus {number}') move_name,
                COALESCE(NULLIF(b.name, ''), NULLIF(ss.name, ''), 'Bonus {number}') animation_name,
                'Bonus {number}' move_tag {base}
                JOIN special_views v ON v.id=s.bonus_view_id{number}
                LEFT JOIN special_bonuses b ON b.id=s.special_bonus_id{number}''')
        source = ' UNION ALL '.join(queries)
    else:
        if slot == 'entrance':
            joins = '''JOIN passive_skill_set_relations r ON r.passive_skill_set_id=c.passive_skill_set_id
                JOIN passive_skills s ON s.id=r.passive_skill_id
                JOIN passive_skill_effects v ON v.id=s.passive_skill_effect_id'''
        elif slot in {'active', 'standby', 'finish'}:
            relation = {'active': 'card_active_skills', 'standby': 'card_standby_skill_set_relations',
                        'finish': 'card_finish_skill_set_relations'}[slot]
            joins = f'JOIN {relation} r ON r.card_id=c.id JOIN {slot}_skill_sets s ON s.id=r.{slot}_skill_set_id JOIN special_views v ON v.id=s.special_view_id'
        else:
            raise ValueError('Loại animation không hợp lệ.')
        source = f'''SELECT v.id, c.id card_id, c.name, c.rarity, v.script_name,
            COALESCE(NULLIF(s.name, ''), '{slot.title()}') move_name,
            COALESCE(NULLIF(s.name, ''), '{slot.title()}') animation_name, '{slot.title()}' move_tag
            FROM cards c {joins}'''
    term = query.strip()
    value = '%' + term + '%'
    clause, rarity_params = _rarity_filter(rarity, 'rarity')
    column = {'card_name': 'name', 'card_id': 'CAST(card_id AS TEXT)', 'move_name': 'move_name',
              'animation_id': 'CAST(id AS TEXT)', 'script': 'script_name'}.get(search_by, 'name')
    relevance, relevance_params = _name_relevance(column, term) if search_by in {'card_name', 'move_name'} else ('', [])
    sql = f'''SELECT DISTINCT * FROM ({source}) WHERE script_name IS NOT NULL
        AND card_id % 10 != 0 AND CAST(card_id AS TEXT) NOT LIKE '9%'
        AND animation_name NOT LIKE '%(Extreme)%' AND {column} LIKE ? {clause}
        ORDER BY {relevance}CASE WHEN card_id=? THEN 0 ELSE 1 END,
            CASE WHEN card_id < 5000000 THEN 0 ELSE 1 END, card_id DESC, move_tag, id'''
    return _paged(sql, [value] + rarity_params + relevance_params + [int(term) if term.isdigit() else -1], page, limit)

def resolve_draft_animations(references, converted):
    """Resolve draft IDs for playback using read-only lookups, without applying SQL."""
    slots = {'entrance': ('passive_skill_effect', 'pse'), 'active': ('active_skill', 'bs'),
             'super': ('attack_sp', 'sp'), 'standby': ('standby_skill', 'stb'), 'finish': ('finish_skill', 'fi')}
    custom = {}
    for item in converted:
        slot = item.get('target_slot')
        record_id = item.get('target_pse_id') if slot == 'entrance' else item.get('special_view_id')
        if slot in slots and record_id:
            custom[('effect' if slot == 'entrance' else 'view', int(record_id))] = item
    results = []
    used = set()
    for ref in references:
        slot = ref.get('slot')
        record_id = int(ref.get('id') or 0)
        if slot not in slots or record_id <= 0:
            continue
        kind = 'effect' if slot == 'entrance' else 'view'
        converted_item = custom.get((kind, record_id))
        table = 'passive_skill_effects' if kind == 'effect' else 'special_views'
        row = converted_item or query_db_one(f'SELECT * FROM {table} WHERE id=?', (record_id,))
        folder, prefix = slots[slot]
        script = str((row or {}).get('script_name') or (f'{prefix}{record_id:04d}' if row else '')).removesuffix('.lua')
        if converted_item:
            folder = slots[converted_item['target_slot']][0]
        used.add((kind, record_id))
        results.append({
            'draft_key': ref.get('key'), 'type_key': slot, 'type': slot,
            'name': ref.get('name') or f'{slot.title()} #{record_id}',
            'move_tag': ref.get('move_tag'),
            'effect_id' if kind == 'effect' else 'special_view_id': record_id,
            'script_name': script, 'script_path': f'ab_script/{folder}/{script}.lua' if script else None,
            'bgm_id': ref.get('bgm_id', (row or {}).get('bgm_id')),
            'badge': 'Bản nháp' if row else f'Không tìm thấy ID {record_id}',
        })
    for (kind, record_id), item in custom.items():
        if (kind, record_id) in used:
            continue
        slot = item['target_slot']
        script = item.get('script_name')
        if script:
            results.append({
                'draft_key': f'converted:{slot}:{record_id}', 'type_key': slot, 'type': slot,
                'name': f"{slot.title()} · {item.get('source_name') or script}", 'badge': 'Custom · chưa gán',
                'effect_id' if kind == 'effect' else 'special_view_id': record_id,
                'script_name': script, 'script_path': f'ab_script/{slots[slot][0]}/{script}.lua',
                'bgm_id': item.get('bgm_id'),
            })
    return results
