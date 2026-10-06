"""Build independent skill drafts using read-only database queries."""
import uuid
from modules.core.character import load_character_context
from modules.core.db import query_db_all, query_db_one
from modules.core.mod_workspace import use_workspace


def clone_skill(kind, source_id, target_id):
    if kind not in ('active', 'standby', 'passive'):
        raise ValueError('Loại skill không hợp lệ.')
    with use_workspace(None):
        source = load_character_context(card_id=int(source_id))
        source_ultimate = query_db_one('SELECT * FROM ultimate_specials WHERE id=?',
            ((source or {}).get('active_set', {}).get('ultimate_special_id'),)) if kind == 'active' and (source or {}).get('active_set') else None
        source_finish_relations = query_db_all(
            'SELECT * FROM standby_skill_set_finish_skill_set_relations WHERE standby_skill_set_id=?',
            (source['standby_set']['id'],)) if kind == 'standby' and (source or {}).get('standby_set') else []
    target = load_character_context(card_id=int(target_id))
    if not target or not target.get('card'):
        raise ValueError('Không tìm thấy thẻ đích.')
    if not source or not source.get(kind + '_set'):
        raise ValueError('Thẻ nguồn không có skill này.')
    counter = -(uuid.uuid4().int & ((1 << 48) - 1))
    def copy(row):
        nonlocal counter
        counter -= 1
        return {**row, 'id': counter}
    skill_set = copy(source[kind + '_set'])
    if kind == 'passive':
        original_skills = target.get('passive_skills', [])
        original_set_id = int(target['card'].get('passive_skill_set_id') or 0)
        if original_set_id > 0:
            skill_set['id'] = original_set_id
        skills = []
        next_id = max([int(row['id']) for row in original_skills], default=max(original_set_id - 1, 0))
        for index, row in enumerate(source['passive_skills']):
            if index < len(original_skills):
                original = original_skills[index]
                skill = {**row, 'id': original['id'], 'relation_id': original.get('relation_id', 0)}
            elif original_set_id > 0:
                next_id += 1
                while query_db_one('SELECT id FROM passive_skills WHERE id=?', (next_id,)):
                    next_id += 1
                skill = {**row, 'id': next_id, 'relation_id': 0}
            else:
                skill = {**copy(row), 'relation_id': 0}
            skills.append(skill)
        ids = {old['id']: new['id'] for old, new in zip(source['passive_skills'], skills)}
        descriptions = [
            {**copy(row), 'skill_id': ids[row['skill_id']]}
            for row in source.get('transformation_descriptions', [])
            if row.get('skill_type') == 'PassiveSkill' and row.get('skill_id') in ids
        ]
        extra = {'transformation_descriptions': descriptions}
        return {
            'passive_set': skill_set,
            'passive_skill_set_id': skill_set['id'],
            'passive_skills': skills,
            'passive_skill_effects': source.get('passive_skill_effects', []),
            '_cloned_skill_rows': extra,
            'passive_replace_existing': True,
            'passive_keep_transform_effects': False,
        }
    fk = kind + '_skill_set_id'
    link = {**(target.get(kind + '_link') or copy({})), 'card_id': int(target_id), fk: skill_set['id']}
    skills = [{**copy(row), fk: skill_set['id']} for row in source[kind + '_skills']]
    ids = {old['id']: new['id'] for old, new in zip(source[kind + '_skills'], skills)}
    extra = {}
    descriptions = []
    for row in source.get('transformation_descriptions', []):
        if row['skill_type'] == kind.title() + 'Skill' and row['skill_id'] in ids:
            descriptions.append({**copy(row), 'skill_id': ids[row['skill_id']]})
    extra['transformation_descriptions'] = descriptions
    if kind == 'active':
        extra['ultimate_specials'] = []
        ultimate = source_ultimate
        if ultimate:
            new_ultimate = copy(dict(ultimate))
            skill_set['ultimate_special_id'] = new_ultimate['id']
            extra['ultimate_specials'] = [new_ultimate]
        extra['dokkan_field_active_skill_set_relations'] = [
            {**copy(row), fk: skill_set['id']} for row in source.get('field_active_relations', [])]
    else:
        extra['standby_skill_set_finish_skill_set_relations'] = [
            {**copy(dict(row)), fk: skill_set['id']} for row in source_finish_relations]
    return {kind + '_set': skill_set, kind + '_link': link,
            kind + '_skills': skills, '_cloned_skill_rows': extra}
