"""Build independent skill drafts using read-only database queries."""
import uuid
from modules.core.character import load_character_context
from modules.core.db import query_db_all, query_db_one


def clone_skill(kind, source_id, target_id):
    if kind not in ('active', 'standby'):
        raise ValueError('Loại skill không hợp lệ.')
    source = load_character_context(card_id=int(source_id))
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
        ultimate = query_db_one('SELECT * FROM ultimate_specials WHERE id=?', (skill_set.get('ultimate_special_id'),))
        if ultimate:
            new_ultimate = copy(dict(ultimate))
            skill_set['ultimate_special_id'] = new_ultimate['id']
            extra['ultimate_specials'] = [new_ultimate]
        extra['dokkan_field_active_skill_set_relations'] = [
            {**copy(row), fk: skill_set['id']} for row in source.get('field_active_relations', [])]
    else:
        extra['standby_skill_set_finish_skill_set_relations'] = [
            {**copy(dict(row)), fk: skill_set['id']} for row in query_db_all(
                'SELECT * FROM standby_skill_set_finish_skill_set_relations WHERE standby_skill_set_id=?',
                (source['standby_set']['id'],))]
    return {kind + '_set': skill_set, kind + '_link': link,
            kind + '_skills': skills, '_cloned_skill_rows': extra}
