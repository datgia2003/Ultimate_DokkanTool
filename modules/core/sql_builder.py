# -*- coding: utf-8 -*-
import os
import re
import json
import shutil
import datetime
import sqlite3
import streamlit as st
from modules.core.config import DB_PATH
from modules.core.db import get_db_connection, get_table_columns, get_relation_id, query_db_one, query_db_all
from modules.core.character import load_character_context
from modules.core.patch_sql import repeatable_animation_sql

CLONED_SKILL_TABLES = {'ultimate_specials', 'transformation_descriptions',
    'dokkan_field_active_skill_set_relations', 'standby_skill_set_finish_skill_set_relations'}

# -------------------------------------------------------------
# SQL Helper Functions
# -------------------------------------------------------------
def generate_sql_insert_or_replace(table_name, row_dict):
    cols = get_table_columns(table_name)
    valid_data = {k: v for k, v in row_dict.items() if k in cols}
    
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    if 'created_at' in cols and (valid_data.get('created_at') is None or valid_data.get('created_at') == ''):
        valid_data['created_at'] = now_str
    if 'updated_at' in cols:
        valid_data['updated_at'] = now_str
        
    keys = list(valid_data.keys())
    
    def format_val(val):
        if val is None:
            return "NULL"
        val_str = str(val)
        if val_str.startswith('[') or val_str.startswith('{'):
            escaped = val_str.replace("'", "''")
            return f"'{escaped}'"
        try:
            int(val_str)
            return val_str
        except ValueError:
            try:
                float(val_str)
                return val_str
            except ValueError:
                # Normalize Windows CRLF to LF, but preserve newlines for in-game text rendering
                val_clean = val_str.replace("\r\n", "\n")
                escaped = val_clean.replace("'", "''")
                return f"'{escaped}'"
    vals_str = ", ".join([format_val(valid_data[k]) for k in keys])
    cols_str = ", ".join([f'"{k}"' for k in keys])
    return f'INSERT OR REPLACE INTO "main"."{table_name}" ({cols_str}) VALUES ({vals_str});'

def generate_sql_nullify(table_name, row_id):
    try:
        with get_db_connection() as conn:
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name});")
            cols_info = cursor.fetchall()
    except Exception as e:
        return f"-- Error fetching columns for {table_name}: {e}"
        
    if not cols_info:
        return f"-- Error: No columns found for {table_name}"
        
    keys = []
    vals = []
    now_str = datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    
    for r in cols_info:
        # PRAGMA table_info returns: (cid, name, type, notnull, dflt_value, pk)
        col_name = r[1]
        col_type = r[2].upper()
        notnull = r[3]
        dflt_value = r[4]
        
        keys.append(f'"{col_name}"')
        if col_name == 'id':
            vals.append(str(row_id))
        elif col_name == 'created_at' or col_name == 'updated_at':
            vals.append(f"'{now_str}'")
        else:
            if notnull == 1:
                # If it's not null and has no default, we must provide a fallback value
                if dflt_value is not None:
                    vals.append(str(dflt_value))
                else:
                    if 'INT' in col_type or 'NUM' in col_type or 'REAL' in col_type:
                        vals.append("0")
                    elif 'DATE' in col_type or 'TIME' in col_type:
                        vals.append(f"'{now_str}'")
                    else:
                        vals.append("''")
            else:
                vals.append("NULL")
                
    cols_str = ", ".join(keys)
    vals_str = ", ".join(vals)
    return f'INSERT OR REPLACE INTO "main"."{table_name}" ({cols_str}) VALUES ({vals_str});'





def compile_character_sql(card_ctx, allocation_state=None):
    allocation_state = allocation_state if allocation_state is not None else {}
    lines = []
    
    # 1. Cards
    clean_card_name = str(card_ctx['card'].get('name', 'Unknown')).replace('\r\n', ' ').replace('\n', ' ')
    lines.append(f"-- Card: {clean_card_name} (ID: {card_ctx['card']['id']})")
    lines.append(generate_sql_insert_or_replace("cards", card_ctx['card']))

    # Category membership belongs to this card, including an explicitly empty list.
    cid = int(card_ctx['card']['id'])
    existing_categories = query_db_all('SELECT * FROM card_card_categories WHERE card_id=? ORDER BY num, id', (cid,))
    category_ids = card_ctx.get('category_ids')
    if category_ids is not None:
        existing_by_category = {int(row['card_category_id']): row for row in existing_categories}
        lines.append(f'DELETE FROM "card_card_categories" WHERE "card_id" = {cid};')
        next_id = allocation_state.get('next_category_relation_id')
        if next_id is None:
            next_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM card_card_categories')['id'])
        for index, category_id in enumerate(category_ids, 1):
            row = dict(existing_by_category.get(category_id) or {})
            if not row.get('id'):
                next_id += 1
                row['id'] = next_id
            row.update(card_id=cid, card_category_id=category_id, num=index)
            lines.append(generate_sql_insert_or_replace('card_card_categories', row))
        allocation_state['next_category_relation_id'] = next_id
    else:
        for row in existing_categories:
            lines.append(generate_sql_insert_or_replace('card_card_categories', row))
    
    # 2. Leader Skill
    if card_ctx.get('leader_set'):
        lines.append(generate_sql_insert_or_replace("leader_skill_sets", card_ctx['leader_set']))
        generated_subtargets = {}
        next_set_id = None
        next_target_id = None
        for sk in card_ctx['leader_skills']:
            skill = dict(sk)
            temporary_id = int(skill.get('sub_target_type_set_id') or 0)
            entries = skill.get('_sub_target_types')
            if temporary_id < 0 and entries:
                if temporary_id not in generated_subtargets:
                    if next_set_id is None:
                        next_set_id = allocation_state.get('next_subtarget_set_id')
                        next_target_id = allocation_state.get('next_subtarget_id')
                        if next_set_id is None:
                            next_set_id = int(query_db_one(
                                'SELECT COALESCE(MAX(id), 0) AS id FROM sub_target_type_sets')['id'])
                            next_target_id = int(query_db_one(
                                'SELECT COALESCE(MAX(id), 0) AS id FROM sub_target_types')['id'])
                    next_set_id += 1
                    generated_subtargets[temporary_id] = next_set_id
                    lines.append(generate_sql_insert_or_replace(
                        'sub_target_type_sets', {'id': next_set_id}))
                    for value_type, value in entries:
                        next_target_id += 1
                        lines.append(generate_sql_insert_or_replace('sub_target_types', {
                            'id': next_target_id,
                            'sub_target_type_set_id': next_set_id,
                            'target_value_type': int(value_type),
                            'target_value': int(value)
                        }))
                    allocation_state['next_subtarget_set_id'] = next_set_id
                    allocation_state['next_subtarget_id'] = next_target_id
                skill['sub_target_type_set_id'] = generated_subtargets[temporary_id]
            lines.append(generate_sql_insert_or_replace("leader_skills", skill))
            
    # 3. Passive Skill
    if card_ctx.get('passive_set'):
        lines.append(generate_sql_insert_or_replace("passive_skill_sets", card_ctx['passive_set']))
        p_set_id = int(card_ctx['passive_set']['id'])
        # The exported set is authoritative. Without this, a patch built after
        # replacing its skills would keep the original game's old relations.
        lines.append(f'DELETE FROM "passive_skill_set_relations" WHERE "passive_skill_set_id" = {p_set_id};')
        for idx, sk in enumerate(card_ctx['passive_skills']):
            lines.append(generate_sql_insert_or_replace("passive_skills", sk))
            rel_id = sk.get('relation_id')
            if rel_id is not None:
                try:
                    rel_id = int(rel_id)
                except (ValueError, TypeError):
                    rel_id = get_relation_id(p_set_id, idx)
            else:
                rel_id = get_relation_id(p_set_id, idx)
            rel_dict = {
                'id': rel_id,
                'passive_skill_set_id': p_set_id,
                'passive_skill_id': sk['id']
            }
            lines.append(generate_sql_insert_or_replace("passive_skill_set_relations", rel_dict))
        if card_ctx.get('passive_skill_effects'):
            for pse in card_ctx['passive_skill_effects']:
                lines.append(generate_sql_insert_or_replace("passive_skill_effects", pse))
            
    # 4. Active Skill
    if card_ctx.get('active_set'):
        lines.append(generate_sql_insert_or_replace("active_skill_sets", card_ctx['active_set']))
        if card_ctx.get('active_link'):
            lines.append(generate_sql_insert_or_replace("card_active_skills", card_ctx['active_link']))
        for sk in card_ctx['active_skills']:
            lines.append(generate_sql_insert_or_replace("active_skills", sk))
            
    # 5. Standby Skill
    if card_ctx.get('standby_set'):
        lines.append(generate_sql_insert_or_replace("standby_skill_sets", card_ctx['standby_set']))
        if card_ctx.get('standby_link'):
            lines.append(generate_sql_insert_or_replace("card_standby_skill_set_relations", card_ctx['standby_link']))
        for sk in card_ctx['standby_skills']:
            lines.append(generate_sql_insert_or_replace("standby_skills", sk))
            
    # 6. Finish Skills (support multiple)
    if card_ctx.get('finish_skill_sets'):
        for f_item in card_ctx['finish_skill_sets']:
            if f_item.get('set'):
                lines.append(generate_sql_insert_or_replace("finish_skill_sets", f_item['set']))
            if f_item.get('link'):
                lines.append(generate_sql_insert_or_replace("card_finish_skill_set_relations", f_item['link']))
            if f_item.get('special'):
                lines.append(generate_sql_insert_or_replace("finish_specials", f_item['special']))
            for sk in f_item.get('skills', []):
                lines.append(generate_sql_insert_or_replace("finish_skills", sk))
    elif card_ctx.get('finish_set'):
        lines.append(generate_sql_insert_or_replace("finish_skill_sets", card_ctx['finish_set']))
        if card_ctx.get('finish_link'):
            lines.append(generate_sql_insert_or_replace("card_finish_skill_set_relations", card_ctx['finish_link']))
        if card_ctx.get('finish_special'):
            lines.append(generate_sql_insert_or_replace("finish_specials", card_ctx['finish_special']))
        for sk in card_ctx.get('finish_skills', []):
            lines.append(generate_sql_insert_or_replace("finish_skills", sk))
            
    # 7. Specials (Super Attacks)
    if card_ctx.get('card_specials'):
        for cs in card_ctx['card_specials']:
            for sb in cs.get('bonuses', []):
                lines.append(generate_sql_insert_or_replace("special_bonuses", sb))
            if cs.get('special_set'):
                lines.append(generate_sql_insert_or_replace("special_sets", cs['special_set']))
            for se in cs.get('specials', []):
                lines.append(generate_sql_insert_or_replace("specials", se))
            lines.append(generate_sql_insert_or_replace("card_specials", cs))
            if cs.get('extra_special_option'):
                lines.append(generate_sql_insert_or_replace("extra_special_options", cs['extra_special_option']))
                
    # 8. Fields (Domains)
    if card_ctx.get('fields'):
        for f in card_ctx['fields']:
            f_data = {k: v for k, v in f.items() if k != 'efficacies'}
            lines.append(generate_sql_insert_or_replace("dokkan_fields", f_data))
            for eff in f.get('efficacies', []):
                lines.append(generate_sql_insert_or_replace("dokkan_field_efficacies", eff))
                
    # 9. Dokkan Field Relations
    if card_ctx.get('field_active_relations') or card_ctx.get('field_passive_relations'):
        for r in card_ctx.get('field_active_relations', []):
            lines.append(generate_sql_insert_or_replace("dokkan_field_active_skill_set_relations", r))
        for r in card_ctx.get('field_passive_relations', []):
            lines.append(generate_sql_insert_or_replace("dokkan_field_passive_skill_relations", r))
            
    # 10. Transformation Descriptions
    if card_ctx.get('transformation_descriptions'):
        for td in card_ctx['transformation_descriptions']:
            lines.append(generate_sql_insert_or_replace("transformation_descriptions", td))

    for row in card_ctx.get('_battle_params_compiled', []):
        lines.append(generate_sql_insert_or_replace('battle_params', row))

    for table, rows in card_ctx.get('_cloned_skill_rows', {}).items():
        if table in CLONED_SKILL_TABLES:
            for row in rows:
                lines.append(generate_sql_insert_or_replace(table, row))

    # Special Views (Active / Super / Finish Skill animations)
    if card_ctx.get('special_views'):
        lines.append("")
        lines.append(f"-- Special Views (Custom & Transmuted Animations)")
        for sv_item in card_ctx['special_views']:
            lines.append(generate_sql_insert_or_replace("special_views", sv_item))

    # Custom & Transmuted Animation SQL
    if card_ctx.get('custom_sql'):
        lines.append("")
        lines.append(f"-- Custom & Transmuted Statements")
        for c_sql in card_ctx['custom_sql']:
            if c_sql.strip():
                lines.append(c_sql.strip())
            
    # 11. Deletions (removed skills or relations)
    if card_ctx.get('deleted_rows'):
        lines.append("")
        lines.append(f"-- Deletions for card ID {card_ctx['card']['id']}")
        for del_entry in card_ctx['deleted_rows']:
            col = del_entry.get('id_col') or del_entry.get('col') or 'id'
            lines.append(f"DELETE FROM {del_entry['table']} WHERE {col} = {del_entry['id']};")
            
    return lines


def _merge_card_draft(card_ctx, card_id, changes, raw_sql, allocation_state=None):
    from modules.core.db import get_next_prefixed_id
    allocation_state = allocation_state if allocation_state is not None else {}

    if changes:
        # 1. Update card fields
        card_cols = get_table_columns("cards")
        for k, v in changes.items():
            if k in card_cols:
                card_ctx['card'][k] = v

        if 'link_skill_ids' in changes:
            link_ids = list(dict.fromkeys(int(value) for value in changes['link_skill_ids'] if int(value) > 0))
            if len(link_ids) > 7:
                raise ValueError('Một thẻ chỉ được có tối đa 7 link skill.')
            for link_id in link_ids:
                if not query_db_one('SELECT id FROM link_skills WHERE id=?', (link_id,)):
                    raise ValueError(f'Link skill #{link_id} không tồn tại.')
            for index in range(7):
                card_ctx['card'][f'link_skill{index + 1}_id'] = link_ids[index] if index < len(link_ids) else 0
        if 'category_ids' in changes:
            category_ids = list(dict.fromkeys(int(value) for value in changes['category_ids'] if int(value) > 0))
            for category_id in category_ids:
                if not query_db_one('SELECT id FROM card_categories WHERE id=?', (category_id,)):
                    raise ValueError(f'Category #{category_id} không tồn tại.')
            card_ctx['category_ids'] = category_ids

        # 2. Leader Skill
        if changes.get("leader_set"):
            ls_cols = get_table_columns("leader_skill_sets")
            valid_ls = {k: v for k, v in changes["leader_set"].items() if k in ls_cols}
            if card_ctx.get("leader_set"):
                card_ctx["leader_set"].update(valid_ls)
            else:
                card_ctx["leader_set"] = valid_ls
        if "leader_skills" in changes:
            card_ctx["leader_skills"] = changes["leader_skills"]

        # 3. Passive Skill Set & Skills
        if "passive_set" in changes and changes["passive_set"] is None:
            card_ctx["passive_set"] = None
            card_ctx["passive_skills"] = []
            card_ctx["passive_skill_effects"] = []
        elif changes.get("passive_set"):
            ps_cols = get_table_columns("passive_skill_sets")
            p_draft = dict(changes["passive_set"])
            if "itemized_description" not in p_draft and "description" in p_draft:
                p_draft["itemized_description"] = p_draft["description"]
            valid_ps = {k: v for k, v in p_draft.items() if k in ps_cols}
            if card_ctx.get("passive_set"):
                card_ctx["passive_set"].update(valid_ps)
            else:
                card_ctx["passive_set"] = valid_ps

        if "passive_skills" in changes:
            base_set_id = int(card_ctx['passive_set']['id']) if card_ctx.get('passive_set') and card_ctx['passive_set'].get('id') else card_id
            if changes.get("passive_replace_existing"):
                keep_transforms = changes.get('passive_keep_transform_effects', True)
                existing_tfs = [
                    sk for sk in card_ctx.get('passive_skills', [])
                    if sk.get('efficacy_type') in (79, 103, 131)
                ] if keep_transforms else []
                new_skills = []
                # Reserve original IDs before allocating generated rows. A
                # collision with a transform ID would silently replace its row.
                current_ids = [sk['id'] for sk in card_ctx.get('passive_skills', []) if sk.get('id')]
                next_relation_id = allocation_state.get('next_passive_relation_id')
                if next_relation_id is None:
                    next_relation_id = int(query_db_one(
                        'SELECT COALESCE(MAX(id), 0) AS id FROM passive_skill_set_relations')['id'])
                for idx, sk in enumerate(changes["passive_skills"]):
                    sk_dict = dict(sk)
                    if not sk_dict.get('id') and base_set_id > 0:
                        sk_dict['id'] = get_next_prefixed_id(base_set_id, current_ids)
                    elif not sk_dict.get('id'):
                        sk_dict['id'] = -(int(card_id) * 1000 + idx + 1)
                    current_ids.append(sk_dict['id'])
                    if not sk_dict.get('relation_id'):
                        next_relation_id += 1
                        sk_dict['relation_id'] = next_relation_id
                    if not sk_dict.get('name'):
                        sk_dict['name'] = card_ctx['passive_set'].get('name', 'Passive Skill') if card_ctx.get('passive_set') else 'Passive Skill'
                    new_skills.append(sk_dict)
                for tf in existing_tfs:
                    if not any(s.get('id') == tf.get('id') for s in new_skills):
                        new_skills.append(dict(tf))
                allocation_state['next_passive_relation_id'] = next_relation_id
                card_ctx['passive_skills'] = new_skills
            else:
                skill_map = {sk['id']: dict(sk) for sk in card_ctx.get('passive_skills', []) if sk.get('id')}
                for sk in changes["passive_skills"]:
                    sid = sk.get('id')
                    if sid and sid in skill_map:
                        skill_map[sid].update(sk)
                    else:
                        sk_dict = dict(sk)
                        if not sk_dict.get('id') and base_set_id > 0:
                            sk_dict['id'] = get_next_prefixed_id(base_set_id, list(skill_map.keys()))
                        elif not sk_dict.get('id'):
                            sk_dict['id'] = -(int(card_id) * 1000 + len(skill_map) + 1)
                        if not sk_dict.get('relation_id'):
                            sk_dict['relation_id'] = get_relation_id(base_set_id, len(skill_map)) if base_set_id > 0 else 0
                        skill_map[sk_dict['id']] = sk_dict
                card_ctx['passive_skills'] = list(skill_map.values())
        if "passive_skill_effects" in changes:
            card_ctx['passive_skill_effects'] = changes["passive_skill_effects"]

        # 4. Active Skill
        if "active_set" in changes and changes["active_set"] is None:
            card_ctx["active_set"] = None
            card_ctx["active_skills"] = []
        elif changes.get("active_set"):
            act_cols = get_table_columns("active_skill_sets")
            card_ctx['active_set'] = dict(card_ctx.get('active_set') or {})
            card_ctx["active_set"].update({k: v for k, v in changes["active_set"].items() if k in act_cols})
        if 'active_link' in changes:
            card_ctx['active_link'] = changes['active_link']
        if '_cloned_skill_rows' in changes:
            card_ctx['_cloned_skill_rows'] = changes['_cloned_skill_rows']
        if "active_skills" in changes:
            card_ctx["active_skills"] = changes["active_skills"]

        # The remaining editor tabs use nested draft keys. They must be merged
        # before both the live SQL preview and Save call compile_character_sql.
        if "standby_set" in changes:
            card_ctx["standby_set"] = changes["standby_set"]
        if "standby_link" in changes:
            card_ctx["standby_link"] = changes["standby_link"]
        if "standby_skills" in changes:
            card_ctx["standby_skills"] = changes["standby_skills"]
        if "finish_skill_sets" in changes:
            card_ctx["finish_skill_sets"] = changes["finish_skill_sets"]
            if not changes["finish_skill_sets"]:
                card_ctx["finish_set"] = None
                card_ctx["finish_link"] = None
                card_ctx["finish_special"] = None
                card_ctx["finish_skills"] = []
        if "card_specials" in changes:
            card_ctx["card_specials"] = changes["card_specials"]
        if "transformation_descriptions" in changes:
            card_ctx["transformation_descriptions"] = changes["transformation_descriptions"]
        if "battle_params_draft" in changes:
            card_ctx["_battle_params_draft"] = changes["battle_params_draft"]
        for field_key in ('fields', 'field_active_relations', 'field_passive_relations'):
            if field_key in changes:
                card_ctx[field_key] = changes[field_key]

        # 5. Deletions
        if changes.get("deleted_rows"):
            card_ctx.setdefault("deleted_rows", []).extend(changes["deleted_rows"])

    if raw_sql and raw_sql.strip():
        card_ctx.setdefault("custom_sql", []).append(raw_sql.strip())
    elif changes and changes.get("raw_sql") and str(changes["raw_sql"]).strip():
        card_ctx.setdefault("custom_sql", []).append(str(changes["raw_sql"]).strip())


def _allocate_passive_relations(contexts, allocation_state):
    """Give new relations unused IDs instead of concatenating set/index digits."""
    limit = 2147483647
    owners = allocation_state.get('passive_relation_owners')
    if owners is None:
        owners = {int(r['id']): (int(r['passive_skill_set_id']), int(r['passive_skill_id']))
                  for r in query_db_all('SELECT id, passive_skill_set_id, passive_skill_id FROM passive_skill_set_relations')}
        allocation_state['passive_relation_owners'] = owners
    reserved = [int(sk.get('relation_id') or 0) for ctx in contexts for sk in ctx.get('passive_skills', [])]
    next_id = max([0, *(rid for rid in owners if 0 < rid <= limit), *(rid for rid in reserved if 0 < rid <= limit)])
    for ctx in contexts:
        if not ctx.get('passive_set'):
            continue
        for sk in ctx.get('passive_skills', []):
            owner = (int(ctx['passive_set']['id']), int(sk['id']))
            old_id = int(sk.get('relation_id') or 0)
            if 0 < old_id <= limit and owners.get(old_id, owner) == owner:
                owners[old_id] = owner
                continue
            next_id += 1
            if next_id > limit:
                raise ValueError('Không còn ID hợp lệ để tạo passive skill relation.')
            sk['relation_id'] = next_id
            owners[next_id] = owner
            if old_id > limit and owners.get(old_id) == owner:
                ctx.setdefault('deleted_rows', []).append({'table': 'passive_skill_set_relations', 'id': old_id})


def _allocate_battle_param_drafts(contexts, allocation_state):
    """Allocate globally unique battle-param numbers and row IDs for new 103 effects."""
    groups = []
    used_param_nos = {int(row['param_no']) for row in query_db_all(
        'SELECT DISTINCT param_no FROM battle_params') if int(row['param_no']) > 0}
    max_param_no = max(used_param_nos, default=0)
    next_row_id = allocation_state.get('next_battle_param_row_id')
    if next_row_id is None:
        next_row_id = int(query_db_one('SELECT COALESCE(MAX(id), 0) AS id FROM battle_params')['id'])

    for context in contexts:
        context['_battle_params_compiled'] = []
        for group in context.get('_battle_params_draft', []):
            key = str(group.get('draft_key') or '')
            if not key:
                continue
            has_owner = any(
                str(skill.get('_battle_param_draft_key') or '') == key
                for skill in (context.get('passive_skills', []) + context.get('active_skills', []) + context.get('standby_skills', []))
            )
            if has_owner:
                groups.append((context, group, key))

    for context, group, key in groups:
        requested = int(group.get('param_no') or 0)
        # A requested value can collide with the DB if another edit/save happened
        # after the UI loaded. Allocate a fresh high-water ID and update only the
        # skill carrying this draft key.
        param_no = requested
        if param_no <= 0 or param_no in used_param_nos:
            max_param_no = max(max_param_no, max(used_param_nos, default=0)) + 1
            param_no = max_param_no
        used_param_nos.add(param_no)
        group['param_no'] = param_no

        for skill in context.get('passive_skills', []):
            if str(skill.get('_battle_param_draft_key') or '') == key:
                skill['eff_value3'] = param_no
        for skill in context.get('active_skills', []):
            if str(skill.get('_battle_param_draft_key') or '') == key:
                skill['eff_val3'] = param_no
        for skill in context.get('standby_skills', []):
            if str(skill.get('_battle_param_draft_key') or '') != key:
                continue
            try:
                values = skill.get('efficacy_values')
                values = values if isinstance(values, list) else json.loads(values or '[]')
                if isinstance(values, list):
                    while len(values) < 3:
                        values.append(0)
                    values[2] = param_no
                    skill['efficacy_values'] = json.dumps(values, separators=(',', ':'))
            except (TypeError, ValueError):
                pass
        for item in group.get('rows', []):
            idx = int(item.get('idx', -1))
            if idx < 0:
                continue
            next_row_id += 1
            context['_battle_params_compiled'].append({
                'id': next_row_id,
                'param_no': param_no,
                'idx': idx,
                'value': int(item.get('value') or 0),
            })
    allocation_state['next_battle_param_row_id'] = next_row_id


def _allocate_passive_sets(contexts, allocation_state):
    """Resolve temporary passive set and efficacy IDs before SQL generation."""
    from modules.core.db import get_next_prefixed_id
    next_set_id = allocation_state.get('next_passive_set_id')
    set_map = {}
    for ctx in contexts:
        p_set = ctx.get('passive_set')
        if not p_set:
            continue
        old_set_id = int(p_set.get('id') or 0)
        if old_set_id > 0:
            continue
        if old_set_id not in set_map:
            if next_set_id is None:
                next_set_id = int(query_db_one(
                    'SELECT COALESCE(MAX(id), 0) AS id FROM passive_skill_sets')['id'])
            next_set_id += 1
            set_map[old_set_id] = next_set_id
        p_set['id'] = set_map[old_set_id]
        ctx['card']['passive_skill_set_id'] = p_set['id']
    if next_set_id is not None:
        allocation_state['next_passive_set_id'] = next_set_id

    next_skill_id_by_set = {}
    for ctx in contexts:
        p_set = ctx.get('passive_set')
        if not p_set:
            continue
        set_id = int(p_set['id'])
        id_map = {}
        existing = [int(sk['id']) for sk in ctx.get('passive_skills', []) if int(sk.get('id') or 0) > 0]
        for sk in ctx.get('passive_skills', []):
            old_id = int(sk.get('id') or 0)
            if old_id > 0:
                continue
            if set_id not in next_skill_id_by_set:
                next_skill_id_by_set[set_id] = existing
            new_id = get_next_prefixed_id(set_id, next_skill_id_by_set[set_id])
            next_skill_id_by_set[set_id].append(new_id)
            sk['id'] = new_id
            if old_id:
                id_map[old_id] = new_id
        if id_map:
            for row in ctx.get('_cloned_skill_rows', {}).get('transformation_descriptions', []):
                if row.get('skill_type') == 'PassiveSkill' and int(row.get('skill_id') or 0) in id_map:
                    row['skill_id'] = id_map[int(row['skill_id'])]

def _allocate_new_attack_rows(contexts, allocation_state):
    """Resolve temporary draft IDs and their links without writing the database."""
    rows = []
    bonus_owners = {}
    option_owners = {}
    for ctx in contexts:
        if ctx.get('leader_set'):
            for row in ctx.get('leader_skills', []):
                row['leader_skill_set_id'] = ctx['leader_set']['id']
                rows.append(('leader_skills', row, {}))
        for kind, link_table in [('active', 'card_active_skills'), ('standby', 'card_standby_skill_set_relations')]:
            set_table, fk = kind + '_skill_sets', kind + '_skill_set_id'
            if ctx.get(kind + '_set'):
                rows.append((set_table, ctx[kind + '_set'], {'ultimate_special_id': 'ultimate_specials'} if kind == 'active' else {}))
                if not ctx.get(kind + '_link'):
                    ctx[kind + '_link'] = {'card_id': ctx['card']['id'], fk: ctx[kind + '_set']['id']}
                ctx[kind + '_link'][fk] = ctx[kind + '_set']['id']
                rows.append((link_table, ctx[kind + '_link'], {fk: set_table}))
                for row in ctx.get(kind + '_skills', []):
                    row[fk] = ctx[kind + '_set']['id']
                    rows.append((kind + '_skills', row, {fk: set_table}))
        for table, records in ctx.get('_cloned_skill_rows', {}).items():
            if table not in CLONED_SKILL_TABLES:
                continue
            for row in records:
                links = {'active_skill_set_id': 'active_skill_sets', 'standby_skill_set_id': 'standby_skill_sets'}
                if table == 'transformation_descriptions':
                    links = {'skill_id': {'ActiveSkill': 'active_skills', 'StandbySkill': 'standby_skills', 'PassiveSkill': 'passive_skills'}[row['skill_type']]}
                rows.append((table, row, links))
        for cs in ctx.get('card_specials', []):
            rows.append(('card_specials', cs, {'special_set_id': 'special_sets',
                'special_bonus_id1': 'special_bonuses', 'special_bonus_id2': 'special_bonuses'}))
            if cs.get('special_set'):
                rows.append(('special_sets', cs['special_set'], {}))
            rows.extend(('specials', row, {'special_set_id': 'special_sets'}) for row in cs.get('specials', []))
            for row in cs.get('bonuses', []):
                rows.append(('special_bonuses', row, {}))
                slot = 1 if row.get('id') == cs.get('special_bonus_id1') else 2
                bonus_owners[id(row)] = (cs, slot)
            if cs.get('extra_special_option'):
                option = cs['extra_special_option']
                owner = int(cs['id'])
                option_id = int(option.get('id') or 0)
                if option_id > 0:
                    stored = query_db_one('SELECT card_special_id FROM extra_special_options WHERE id=?', (option_id,))
                    prior_owner = option_owners.get(option_id, stored['card_special_id'] if stored else owner)
                    if int(prior_owner) != owner:
                        option['id'] = 0
                        option['_draftKey'] = f'ex-option-{owner}'
                    else:
                        option_owners[option_id] = owner
                option['card_special_id'] = owner
                cs['style'] = 'Extra'
                rows.append(('extra_special_options', option, {'card_special_id': 'card_specials'}))
        for item in ctx.get('finish_skill_sets', []):
            for key, table, links in [
                ('set', 'finish_skill_sets', {'finish_special_id': 'finish_specials'}),
                ('link', 'card_finish_skill_set_relations', {'finish_skill_set_id': 'finish_skill_sets'}),
                ('special', 'finish_specials', {})
            ]:
                if item.get(key):
                    rows.append((table, item[key], links))
            rows.extend(('finish_skills', row, {'finish_skill_set_id': 'finish_skill_sets'}) for row in item.get('skills', []))
        ctx['deleted_rows'] = [row for row in ctx.get('deleted_rows', []) if int(row.get('id') or 0) > 0]

    maxima = allocation_state.setdefault('attack_row_maxima', {})
    mapped = allocation_state.setdefault('attack_row_ids', {})
    used_bonus_ids = allocation_state.setdefault('used_bonus_ids', set())
    used_bonus_ids.update(int(row['id']) for row in query_db_all('SELECT id FROM special_bonuses'))
    used_bonus_ids.update(int(row.get('id') or 0) for table, row, _ in rows if table == 'special_bonuses' and int(row.get('id') or 0) > 0)
    schemas = {}
    for table, row, _ in rows:
        maxima[table] = max(maxima.get(table, 0), int(row.get('id') or 0))
    for table in maxima:
        maxima[table] = max(maxima[table], int(query_db_one(f'SELECT COALESCE(MAX(id), 0) AS id FROM {table}')['id']))
    for table, row, _ in rows:
        old_id = int(row.get('id') or 0)
        if old_id > 0:
            continue
        key = (table, old_id if old_id else row.get('_draftKey') or id(row))
        if key not in mapped:
            if table == 'special_bonuses':
                owner, slot = bonus_owners[id(row)]
                set_id = int(owner.get('special_set_id') or 0)
                if set_id < 0:
                    set_id = mapped[('special_sets', set_id)]
                candidate = set_id * 1000 + slot if 0 < set_id <= 2147482 else maxima[table] + 1
                while candidate in used_bonus_ids:
                    candidate += 1
                used_bonus_ids.add(candidate)
                maxima[table] = max(maxima[table], candidate)
                mapped[key] = candidate
            else:
                maxima[table] += 1
                mapped[key] = maxima[table]
        row['id'] = mapped[key]
        if table not in schemas:
            with get_db_connection() as conn:
                schemas[table] = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
        for column in schemas[table]:
            name, kind, required, default = column[1], column[2].upper(), column[3], column[4]
            if name in row or name in {'created_at', 'updated_at'} or not required or default is not None:
                continue
            row[name] = 0 if any(t in kind for t in ('INT', 'REAL', 'NUM')) else ''
    for _, row, links in rows:
        for column, target in links.items():
            old_id = int(row.get(column) or 0)
            if old_id < 0:
                row[column] = mapped[(target, old_id)]


def compile_character_chain_sql(card_id: int, changes: dict = None, raw_sql: str = None, allocation_state=None) -> str:
    from modules.core.character import get_full_transformation_chain

    card_ctx = load_character_context(card_id=card_id)
    if not card_ctx or not card_ctx.get('card'):
        return ""

    form_drafts = (changes or {}).get('_form_drafts') or {}
    form_custom_sql = (changes or {}).get('_form_custom_sql') or {}
    allocation_state = allocation_state if allocation_state is not None else {}
    selected_changes = form_drafts.get(str(card_id), changes)
    selected_raw_sql = form_custom_sql.get(str(card_id), raw_sql)
    _merge_card_draft(card_ctx, card_id, selected_changes, selected_raw_sql, allocation_state)

    chain_ids = get_full_transformation_chain(card_id, card_ctx)
    if not chain_ids:
        chain_ids = [card_id]

    sql_lines = []
    sql_lines.append("-- =============================================================")
    sql_lines.append(f"-- SQL PATCH FOR CHARACTER CHAIN (Loaded ID: {card_id})")
    chain_str = ", ".join(str(c) for c in chain_ids)
    sql_lines.append(f"-- Included Card IDs: {chain_str}")
    sql_lines.append("-- =============================================================")
    sql_lines.append("")

    contexts = []
    for cid in chain_ids:
        if cid == card_id:
            cctx = card_ctx
        else:
            cctx = load_character_context(card_id=cid)
            if cctx and (str(cid) in form_drafts or str(cid) in form_custom_sql):
                _merge_card_draft(cctx, cid, form_drafts.get(str(cid), {}),
                                  form_custom_sql.get(str(cid), ''), allocation_state)
        if cctx:
            contexts.append(cctx)

    # SA levels/forms can reference the same child row. Propagate only edited
    # fields so a later, unchanged copy cannot overwrite a draft in live SQL.
    shared_changes = {}
    baseline_rows = {}
    child_fields = {'special_set': 'special_sets', 'specials': 'specials',
                    'bonuses': 'special_bonuses', 'extra_special_option': 'extra_special_options'}
    def shared_rows(context):
        for special in context.get('card_specials', []):
            for field, table in child_fields.items():
                rows = special.get(field) or []
                if isinstance(rows, dict):
                    rows = [rows]
                for row in rows:
                    yield table, row
        for domain in context.get('fields', []):
            yield 'dokkan_fields', domain
            for row in domain.get('efficacies', []):
                yield 'dokkan_field_efficacies', row

    draft_order = [draft for cid, draft in form_drafts.items() if str(cid) != str(card_id)]
    draft_order.append(selected_changes or {})
    for draft in draft_order:
        for table, row in shared_rows(draft):
            if not row.get('id'):
                continue
            key = (table, int(row['id']))
            if key not in baseline_rows:
                baseline_rows[key] = query_db_one(f'SELECT * FROM {table} WHERE id=?', (key[1],)) or {}
            baseline = baseline_rows[key]
            columns = get_table_columns(table)
            delta = {k: v for k, v in row.items() if k in columns and k not in {'id', 'created_at', 'updated_at'}
                     and v != baseline.get(k)}
            if delta:
                shared_changes.setdefault(key, {}).update(delta)

    for cctx in contexts:
        for table, row in shared_rows(cctx):
            if row.get('id'):
                row.update(shared_changes.get((table, int(row['id'])), {}))
    _allocate_passive_sets(contexts, allocation_state)
    _allocate_new_attack_rows(contexts, allocation_state)
    _allocate_passive_relations(contexts, allocation_state)
    _allocate_battle_param_drafts(contexts, allocation_state)
    # Resolve views after merging drafts: changing a bonus must not leave its
    # referenced view out of the patch while exporting only stock animations.
    for context in contexts:
        views = {int(row['id']): row for row in context.get('special_views', [])}
        for attack in context.get('card_specials', []):
            for key in ('view_id', 'bonus_view_id1', 'bonus_view_id2'):
                view_id = int(attack.get(key) or 0)
                if view_id > 0 and view_id not in views:
                    view = query_db_one('SELECT * FROM special_views WHERE id=?', (view_id,))
                    if view:
                        views[view_id] = dict(view)
        context['special_views'] = list(views.values())
    custom_sql_tail = []
    for cctx in contexts:
        if cctx:
            custom_sql_tail.extend(cctx.pop('custom_sql', []))
            sql_lines.extend(compile_character_sql(cctx, allocation_state))
            sql_lines.append("")

    if custom_sql_tail:
        sql_lines.append("-- Custom SQL from form drafts (applied after card rows)")
        sql_lines.extend(statement.strip() for statement in custom_sql_tail if statement.strip())

    # Causality values are shared records. Emit draft overrides last so stock
    # rows included by any form cannot restore the database values.
    causality_drafts = {}
    for draft in draft_order:
        causality_drafts.update(draft.get('causality_drafts') or {})
    if causality_drafts:
        sql_lines.append('-- Causality values edited in the card workspace')
        for row in causality_drafts.values():
            row_id = int(row['id'])
            record = dict(query_db_one('SELECT * FROM skill_causalities WHERE id=?', (row_id,)) or {})
            record.update({key: row[key] for key in ('id', 'causality_type', 'cau_val1', 'cau_val2', 'cau_val3') if key in row})
            sql_lines.append(generate_sql_insert_or_replace('skill_causalities', record))

    return repeatable_animation_sql("\n".join(sql_lines).strip())


def split_sql_statements(sql_text):
    statements = []
    current = []
    in_string = False
    escape = False
    
    chars = list(sql_text)
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        if in_string:
            if c == "'" and not escape:
                if i + 1 < n and chars[i+1] == "'":
                    current.append("'")
                    current.append("'")
                    i += 2
                    continue
                else:
                    in_string = False
            elif c == "\\":
                escape = not escape
            else:
                escape = False
            current.append(c)
        else:
            if c == "'":
                in_string = True
                escape = False
                current.append(c)
            elif c == ";":
                statements.append("".join(current).strip())
                current = []
            elif c == "-" and i + 1 < n and chars[i+1] == "-":
                while i < n and chars[i] != "\n":
                    i += 1
                continue
            else:
                current.append(c)
        i += 1
    if current:
        stmt = "".join(current).strip()
        if stmt:
            statements.append(stmt)
    return statements

def apply_sql_to_database(sql_text, db_path='database_decrypted.db'):
    if not sql_text or not sql_text.strip():
        return 0, "Chưa có câu lệnh SQL nào để thực thi."
    
    statements = split_sql_statements(sql_text)
    if not statements:
        return 0, "Không tìm thấy câu lệnh SQL hợp lệ."
        
    bak_path = f"{db_path}.bak"
    if not os.path.exists(bak_path):
        try:
            shutil.copy2(db_path, bak_path)
        except Exception:
            pass
            
    conn = None
    try:
        conn = sqlite3.connect(db_path, timeout=30.0)
        conn.isolation_level = None
        cur = conn.cursor()
        cur.execute("BEGIN TRANSACTION;")
        
        executed_count = 0
        for stmt in statements:
            s = stmt.strip()
            if not s or s.startswith('--'):
                continue
            cur.execute(s)
            executed_count += 1
            
        cur.execute("COMMIT;")
        conn.close()
        return executed_count, None
    except Exception as e:
        if conn:
            try:
                conn.execute("ROLLBACK;")
                conn.close()
            except Exception:
                pass
        return 0, str(e)

def split_values(values_str):
    vals = []
    current = []
    in_string = False
    escape = False
    chars = list(values_str)
    i = 0
    n = len(chars)
    while i < n:
        c = chars[i]
        if in_string:
            if c == "'" and not escape:
                if i + 1 < n and chars[i+1] == "'":
                    current.append("'")
                    i += 2
                    continue
                else:
                    in_string = False
            elif c == "\\":
                escape = not escape
            else:
                escape = False
            current.append(c)
        else:
            if c == "'":
                in_string = True
                escape = False
                current.append(c)
            elif c == ",":
                vals.append("".join(current).strip())
                current = []
            else:
                current.append(c)
        i += 1
    if current:
        vals.append("".join(current).strip())
    return vals

def parse_val(v_str):
    v_str = v_str.strip()
    if v_str.upper() == 'NULL':
        return None
    if v_str.startswith("'") and v_str.endswith("'"):
        s = v_str[1:-1]
        return s.replace("''", "'")
    try:
        return int(v_str)
    except ValueError:
        pass
    try:
        return float(v_str)
    except ValueError:
        pass
    return v_str

def parse_update_set_clause(set_str):
    parts = split_values(set_str)
    updates = {}
    for p in parts:
        if '=' in p:
            k_part, v_part = p.split('=', 1)
            k = k_part.strip().strip('"').strip("'")
            v = parse_val(v_part.strip())
            updates[k] = v
    return updates

def find_card_id_in_edited_contexts(table_name, row_id):
    for cid, ctx in st.session_state.get('edited_contexts', {}).items():
        if table_name == 'cards' and ctx['card'].get('id') == row_id:
            return cid
        if table_name == 'leader_skill_sets' and ctx.get('leader_set') and ctx['leader_set'].get('id') == row_id:
            return cid
        if table_name == 'leader_skills':
            for sk in ctx.get('leader_skills', []):
                if sk.get('id') == row_id:
                    return cid
        if table_name == 'passive_skill_sets' and ctx.get('passive_set') and ctx['passive_set'].get('id') == row_id:
            return cid
        if table_name == 'passive_skills':
            for sk in ctx.get('passive_skills', []):
                if sk.get('id') == row_id:
                    return cid
        if table_name == 'active_skill_sets' and ctx.get('active_set') and ctx['active_set'].get('id') == row_id:
            return cid
        if table_name == 'active_skills':
            for sk in ctx.get('active_skills', []):
                if sk.get('id') == row_id:
                    return cid
        if table_name == 'standby_skill_sets' and ctx.get('standby_set') and ctx['standby_set'].get('id') == row_id:
            return cid
        if table_name == 'standby_skills':
            for sk in ctx.get('standby_skills', []):
                if sk.get('id') == row_id:
                    return cid
        if table_name == 'finish_skill_sets':
            for f_item in ctx.get('finish_skill_sets', []):
                if f_item.get('set') and f_item['set'].get('id') == row_id:
                    return cid
            if ctx.get('finish_set') and ctx['finish_set'].get('id') == row_id:
                return cid
        if table_name == 'card_finish_skill_set_relations':
            for f_item in ctx.get('finish_skill_sets', []):
                if f_item.get('link') and f_item['link'].get('id') == row_id:
                    return cid
            if ctx.get('finish_link') and ctx['finish_link'].get('id') == row_id:
                return cid
        if table_name == 'finish_skills':
            for f_item in ctx.get('finish_skill_sets', []):
                for sk in f_item.get('skills', []):
                    if sk.get('id') == row_id:
                        return cid
            for sk in ctx.get('finish_skills', []):
                if sk.get('id') == row_id:
                    return cid
        if table_name == 'finish_specials':
            for f_item in ctx.get('finish_skill_sets', []):
                if f_item.get('special') and f_item['special'].get('id') == row_id:
                    return cid
            if ctx.get('finish_special') and ctx['finish_special'].get('id') == row_id:
                return cid
        if table_name == 'specials':
            for cs in ctx.get('card_specials', []):
                for se in cs.get('specials', []):
                    if se.get('id') == row_id:
                        return cid
        if table_name == 'special_sets':
            for cs in ctx.get('card_specials', []):
                if cs.get('special_set') and cs['special_set'].get('id') == row_id:
                    return cid
        if table_name == 'special_bonuses':
            for cs in ctx.get('card_specials', []):
                for sb in cs.get('bonuses', []):
                    if sb.get('id') == row_id:
                        return cid
        if table_name == 'card_specials':
            for cs in ctx.get('card_specials', []):
                if cs.get('id') == row_id:
                    return cid
        if table_name == 'dokkan_fields':
            for f in ctx.get('fields', []):
                if f.get('id') == row_id:
                    return cid
        if table_name == 'dokkan_field_efficacies':
            for f in ctx.get('fields', []):
                for eff in f.get('efficacies', []):
                    if eff.get('id') == row_id:
                        return cid
        if table_name == 'dokkan_field_active_skill_set_relations':
            for r in ctx.get('field_active_relations', []):
                if r.get('id') == row_id:
                    return cid
        if table_name == 'dokkan_field_passive_skill_relations':
            for r in ctx.get('field_passive_relations', []):
                if r.get('id') == row_id:
                    return cid
        if table_name == 'transformation_descriptions':
            for td in ctx.get('transformation_descriptions', []):
                if td.get('id') == row_id:
                    return cid
        if table_name == 'passive_skill_effects':
            for p in ctx.get('passive_skill_effects', []):
                if p.get('id') == row_id:
                    return cid
    return None

def find_card_id_for_row(table_name, row_id):
    if table_name == 'cards':
        return row_id
    elif table_name == 'leader_skill_sets':
        r = query_db_one("SELECT id FROM cards WHERE leader_skill_set_id = ?", (row_id,))
        return r['id'] if r else None
    elif table_name == 'leader_skills':
        r = query_db_one("SELECT leader_skill_set_id FROM leader_skills WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT id FROM cards WHERE leader_skill_set_id = ?", (r['leader_skill_set_id'],))
            return c['id'] if c else None
    elif table_name == 'passive_skill_sets':
        r = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (row_id,))
        return r['id'] if r else None
    elif table_name == 'passive_skills':
        r = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (r['passive_skill_set_id'],))
            return c['id'] if c else None
    elif table_name == 'passive_skill_set_relations':
        r = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (r['passive_skill_set_id'],))
            return c['id'] if c else None
    elif table_name == 'card_active_skills':
        r = query_db_one("SELECT card_id FROM card_active_skills WHERE id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'active_skill_sets':
        r = query_db_one("SELECT card_id FROM card_active_skills WHERE active_skill_set_id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'active_skills':
        r = query_db_one("SELECT active_skill_set_id FROM active_skills WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT card_id FROM card_active_skills WHERE active_skill_set_id = ?", (r['active_skill_set_id'],))
            return c['card_id'] if c else None
    elif table_name == 'card_standby_skill_set_relations':
        r = query_db_one("SELECT card_id FROM card_standby_skill_set_relations WHERE id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'standby_skill_sets':
        r = query_db_one("SELECT card_id FROM card_standby_skill_set_relations WHERE standby_skill_set_id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'standby_skills':
        r = query_db_one("SELECT standby_skill_set_id FROM standby_skills WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT card_id FROM card_standby_skill_set_relations WHERE standby_skill_set_id = ?", (r['standby_skill_set_id'],))
            return c['card_id'] if c else None
    elif table_name == 'card_finish_skill_set_relations':
        r = query_db_one("SELECT card_id FROM card_finish_skill_set_relations WHERE id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'finish_skill_sets':
        r = query_db_one("SELECT card_id FROM card_finish_skill_set_relations WHERE finish_skill_set_id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'finish_skills':
        r = query_db_one("SELECT finish_skill_set_id FROM finish_skills WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT card_id FROM card_finish_skill_set_relations WHERE finish_skill_set_id = ?", (r['finish_skill_set_id'],))
            return c['card_id'] if c else None
    elif table_name == 'finish_specials':
        r = query_db_one("SELECT id FROM finish_skill_sets WHERE finish_special_id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT card_id FROM card_finish_skill_set_relations WHERE finish_skill_set_id = ?", (r['id'],))
            return c['card_id'] if c else None
    elif table_name == 'card_specials':
        r = query_db_one("SELECT card_id FROM card_specials WHERE id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'special_sets':
        r = query_db_one("SELECT card_id FROM card_specials WHERE special_set_id = ?", (row_id,))
        return r['card_id'] if r else None
    elif table_name == 'specials':
        r = query_db_one("SELECT special_set_id FROM specials WHERE id = ?", (row_id,))
        if r:
            c = query_db_one("SELECT card_id FROM card_specials WHERE special_set_id = ?", (r['special_set_id'],))
            return c['card_id'] if c else None
    elif table_name == 'special_bonuses':
        r = query_db_one("SELECT card_id FROM card_specials WHERE special_bonus_id1 = ? OR special_bonus_id2 = ?", (row_id, row_id))
        return r['card_id'] if r else None
    elif table_name == 'transformation_descriptions':
        r = query_db_one("SELECT skill_id, skill_type FROM transformation_descriptions WHERE id = ?", (row_id,))
        if r:
            skill_id = r['skill_id']
            skill_type = r['skill_type']
            if skill_type == 'ActiveSkill':
                act = query_db_one("SELECT active_skill_set_id FROM active_skills WHERE id = ?", (skill_id,))
                if act:
                    c = query_db_one("SELECT card_id FROM card_active_skills WHERE active_skill_set_id = ?", (act['active_skill_set_id'],))
                    return c['card_id'] if c else None
            elif skill_type == 'PassiveSkill':
                rel = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_id = ?", (skill_id,))
                if rel:
                    c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (rel['passive_skill_set_id'],))
                    return c['id'] if c else None
            elif skill_type == 'StandbySkill':
                stb = query_db_one("SELECT standby_skill_set_id FROM standby_skills WHERE id = ?", (skill_id,))
                if stb:
                    c = query_db_one("SELECT card_id FROM card_standby_skill_set_relations WHERE standby_skill_set_id = ?", (stb['standby_skill_set_id'],))
                    return c['card_id'] if c else None
            elif skill_type == 'FinishSkill':
                fin = query_db_one("SELECT finish_skill_set_id FROM finish_skills WHERE id = ?", (skill_id,))
                if fin:
                    c = query_db_one("SELECT card_id FROM card_finish_skill_set_relations WHERE finish_skill_set_id = ?", (fin['finish_skill_set_id'],))
                    return c['card_id'] if c else None
    elif table_name in ['dokkan_fields', 'dokkan_field_efficacies', 'dokkan_field_active_skill_set_relations', 'dokkan_field_passive_skill_relations']:
        field_id = row_id
        if table_name == 'dokkan_field_efficacies':
            eff = query_db_one("SELECT dokkan_field_efficacy_set_id FROM dokkan_field_efficacies WHERE id = ?", (row_id,))
            field_id = eff['dokkan_field_efficacy_set_id'] if eff else None
        elif table_name == 'dokkan_field_active_skill_set_relations':
            rel = query_db_one("SELECT active_skill_set_id FROM dokkan_field_active_skill_set_relations WHERE id = ?", (row_id,))
            if rel:
                c = query_db_one("SELECT card_id FROM card_active_skills WHERE active_skill_set_id = ?", (rel['active_skill_set_id'],))
                return c['card_id'] if c else None
        elif table_name == 'dokkan_field_passive_skill_relations':
            rel = query_db_one("SELECT passive_skill_id FROM dokkan_field_passive_skill_relations WHERE id = ?", (row_id,))
            if rel:
                p_rel = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_id = ?", (rel['passive_skill_id'],))
                if p_rel:
                    c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (p_rel['passive_skill_set_id'],))
                    return c['id'] if c else None
        
        if field_id:
            r = query_db_one("SELECT active_skill_set_id FROM dokkan_field_active_skill_set_relations WHERE dokkan_field_id = ?", (field_id,))
            if r:
                c = query_db_one("SELECT card_id FROM card_active_skills WHERE active_skill_set_id = ?", (r['active_skill_set_id'],))
                return c['card_id'] if c else None
            r = query_db_one("SELECT passive_skill_id FROM dokkan_field_passive_skill_relations WHERE dokkan_field_id = ?", (field_id,))
            if r:
                p_rel = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_id = ?", (r['passive_skill_id'],))
                if p_rel:
                    c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (p_rel['passive_skill_set_id'],))
                    return c['id'] if c else None
    elif table_name == 'passive_skill_effects':
        r = query_db_one("SELECT id FROM passive_skills WHERE passive_skill_effect_id = ?", (row_id,))
        if r:
            p_rel = query_db_one("SELECT passive_skill_set_id FROM passive_skill_set_relations WHERE passive_skill_id = ?", (r['id'],))
            if p_rel:
                c = query_db_one("SELECT id FROM cards WHERE passive_skill_set_id = ?", (p_rel['passive_skill_set_id'],))
                return c['id'] if c else None
    return None

def get_card_id_for_row(table_name, row_id):
    cid = find_card_id_in_edited_contexts(table_name, row_id)
    if cid is not None:
        return cid
    return find_card_id_for_row(table_name, row_id)

def apply_op_to_context(ctx, table_name, row_id, row_data, op_type):
    if op_type in ['insert', 'update']:
        row_data['id'] = row_id

    if table_name == 'cards':
        if op_type in ['insert', 'update']:
            ctx['card'].update(row_data)
            
    elif table_name == 'leader_skill_sets':
        if op_type in ['insert', 'update']:
            if ctx.get('leader_set') is None:
                ctx['leader_set'] = {}
            ctx['leader_set'].update(row_data)
        elif op_type == 'delete':
            ctx['leader_set'] = None
            ctx['leader_skills'] = []
            
    elif table_name == 'leader_skills':
        if op_type in ['insert', 'update']:
            found = False
            for sk in ctx.get('leader_skills', []):
                if sk.get('id') == row_id:
                    sk.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('leader_skills', []).append(row_data)
        elif op_type == 'delete':
            ctx['leader_skills'] = [sk for sk in ctx.get('leader_skills', []) if sk.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'leader_skills', 'id': row_id})
            
    elif table_name == 'passive_skill_sets':
        if op_type in ['insert', 'update']:
            if ctx.get('passive_set') is None:
                ctx['passive_set'] = {}
            ctx['passive_set'].update(row_data)
        elif op_type == 'delete':
            ctx['passive_set'] = None
            ctx['passive_skills'] = []
            
    elif table_name == 'passive_skills':
        if op_type in ['insert', 'update']:
            found = False
            for sk in ctx.get('passive_skills', []):
                if sk.get('id') == row_id:
                    sk.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('passive_skills', []).append(row_data)
        elif op_type == 'delete':
            ctx['passive_skills'] = [sk for sk in ctx.get('passive_skills', []) if sk.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'passive_skills', 'id': row_id})
            
    elif table_name == 'passive_skill_set_relations':
        if op_type in ['insert', 'update']:
            ps_id = row_data.get('passive_skill_id')
            if ps_id is not None:
                try:
                    ps_id_int = int(ps_id)
                    for sk in ctx.get('passive_skills', []):
                        if sk.get('id') is not None and int(sk['id']) == ps_id_int:
                            sk['relation_id'] = row_id
                except (ValueError, TypeError):
                    pass
        elif op_type == 'delete':
            ctx.setdefault('deleted_rows', []).append({'table': 'passive_skill_set_relations', 'id': row_id})
            try:
                row_id_int = int(row_id)
                for sk in ctx.get('passive_skills', []):
                    if sk.get('relation_id') is not None and int(sk['relation_id']) == row_id_int:
                        sk.pop('relation_id', None)
            except (ValueError, TypeError):
                for sk in ctx.get('passive_skills', []):
                    if sk.get('relation_id') == row_id:
                        sk.pop('relation_id', None)
            
    elif table_name == 'passive_skill_effects':
        if op_type in ['insert', 'update']:
            found = False
            for p in ctx.setdefault('passive_skill_effects', []):
                if p.get('id') == row_id:
                    p.update(row_data)
                    found = True
                    break
            if not found:
                ctx['passive_skill_effects'].append(row_data)
        elif op_type == 'delete':
            ctx['passive_skill_effects'] = [p for p in ctx.get('passive_skill_effects', []) if p.get('id') != row_id]
            
    elif table_name == 'card_active_skills':
        if op_type in ['insert', 'update']:
            if ctx.get('active_link') is None:
                ctx['active_link'] = {}
            ctx['active_link'].update(row_data)
        elif op_type == 'delete':
            ctx['active_link'] = None
            ctx['active_set'] = None
            ctx['active_skills'] = []
            
    elif table_name == 'active_skill_sets':
        if op_type in ['insert', 'update']:
            if ctx.get('active_set') is None:
                ctx['active_set'] = {}
            ctx['active_set'].update(row_data)
        elif op_type == 'delete':
            ctx['active_set'] = None
            ctx['active_skills'] = []
            
    elif table_name == 'active_skills':
        if op_type in ['insert', 'update']:
            found = False
            for sk in ctx.get('active_skills', []):
                if sk.get('id') == row_id:
                    sk.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('active_skills', []).append(row_data)
        elif op_type == 'delete':
            ctx['active_skills'] = [sk for sk in ctx.get('active_skills', []) if sk.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'active_skills', 'id': row_id})
            
    elif table_name == 'card_standby_skill_set_relations':
        if op_type in ['insert', 'update']:
            if ctx.get('standby_link') is None:
                ctx['standby_link'] = {}
            ctx['standby_link'].update(row_data)
        elif op_type == 'delete':
            ctx['standby_link'] = None
            ctx['standby_set'] = None
            ctx['standby_skills'] = []
            
    elif table_name == 'standby_skill_sets':
        if op_type in ['insert', 'update']:
            if ctx.get('standby_set') is None:
                ctx['standby_set'] = {}
            ctx['standby_set'].update(row_data)
        elif op_type == 'delete':
            ctx['standby_set'] = None
            ctx['standby_skills'] = []
            
    elif table_name == 'standby_skills':
        if op_type in ['insert', 'update']:
            found = False
            for sk in ctx.get('standby_skills', []):
                if sk.get('id') == row_id:
                    sk.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('standby_skills', []).append(row_data)
        elif op_type == 'delete':
            ctx['standby_skills'] = [sk for sk in ctx.get('standby_skills', []) if sk.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'standby_skills', 'id': row_id})
            
    elif table_name == 'card_finish_skill_set_relations':
        f_sets = ctx.setdefault('finish_skill_sets', [])
        if op_type in ['insert', 'update']:
            found = False
            for f_item in f_sets:
                if f_item.get('link') and f_item['link'].get('id') == row_id:
                    f_item['link'].update(row_data)
                    found = True
                    break
            if not found:
                f_sets.append({'link': row_data, 'set': None, 'skills': [], 'special': None})
        elif op_type == 'delete':
            ctx['finish_skill_sets'] = [f for f in f_sets if not (f.get('link') and f['link'].get('id') == row_id)]
            ctx.setdefault('deleted_rows', []).append({'table': 'card_finish_skill_set_relations', 'id': row_id})
        if ctx.get('finish_skill_sets'):
            ctx['finish_link'] = ctx['finish_skill_sets'][0].get('link')
            ctx['finish_set'] = ctx['finish_skill_sets'][0].get('set')
            ctx['finish_special'] = ctx['finish_skill_sets'][0].get('special')
            ctx['finish_skills'] = [sk for f in ctx['finish_skill_sets'] for sk in f.get('skills', [])]
        else:
            ctx['finish_link'] = None
            ctx['finish_set'] = None
            ctx['finish_special'] = None
            ctx['finish_skills'] = []
            
    elif table_name == 'finish_skill_sets':
        f_sets = ctx.setdefault('finish_skill_sets', [])
        if op_type in ['insert', 'update']:
            found = False
            for f_item in f_sets:
                if f_item.get('set') and f_item['set'].get('id') == row_id:
                    f_item['set'].update(row_data)
                    found = True
                    break
            if not found:
                f_sets.append({'link': None, 'set': row_data, 'skills': [], 'special': None})
        elif op_type == 'delete':
            ctx['finish_skill_sets'] = [f for f in f_sets if not (f.get('set') and f['set'].get('id') == row_id)]
            ctx.setdefault('deleted_rows', []).append({'table': 'finish_skill_sets', 'id': row_id})
        if ctx.get('finish_skill_sets'):
            ctx['finish_link'] = ctx['finish_skill_sets'][0].get('link')
            ctx['finish_set'] = ctx['finish_skill_sets'][0].get('set')
            ctx['finish_special'] = ctx['finish_skill_sets'][0].get('special')
            ctx['finish_skills'] = [sk for f in ctx['finish_skill_sets'] for sk in f.get('skills', [])]
        else:
            ctx['finish_link'] = None
            ctx['finish_set'] = None
            ctx['finish_special'] = None
            ctx['finish_skills'] = []
            
    elif table_name == 'finish_skills':
        f_sets = ctx.setdefault('finish_skill_sets', [])
        if op_type in ['insert', 'update']:
            found = False
            for f_item in f_sets:
                for sk in f_item.get('skills', []):
                    if sk.get('id') == row_id:
                        sk.update(row_data)
                        found = True
                        break
                if found:
                    break
            if not found:
                target_fset_id = row_data.get('finish_skill_set_id')
                added = False
                for f_item in f_sets:
                    if f_item.get('set') and f_item['set'].get('id') == target_fset_id:
                        f_item.setdefault('skills', []).append(row_data)
                        added = True
                        break
                if not added and f_sets:
                    f_sets[0].setdefault('skills', []).append(row_data)
        elif op_type == 'delete':
            for f_item in f_sets:
                f_item['skills'] = [sk for sk in f_item.get('skills', []) if sk.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'finish_skills', 'id': row_id})
        ctx['finish_skills'] = [sk for f in f_sets for sk in f.get('skills', [])]
            
    elif table_name == 'finish_specials':
        f_sets = ctx.setdefault('finish_skill_sets', [])
        if op_type in ['insert', 'update']:
            found = False
            for f_item in f_sets:
                if f_item.get('special') and f_item['special'].get('id') == row_id:
                    f_item['special'].update(row_data)
                    found = True
                    break
            if not found and f_sets:
                f_sets[0]['special'] = row_data
        elif op_type == 'delete':
            for f_item in f_sets:
                if f_item.get('special') and f_item['special'].get('id') == row_id:
                    f_item['special'] = None
            ctx.setdefault('deleted_rows', []).append({'table': 'finish_specials', 'id': row_id})
        if ctx.get('finish_skill_sets'):
            ctx['finish_special'] = ctx['finish_skill_sets'][0].get('special')
        else:
            ctx['finish_special'] = None
            
    elif table_name == 'card_specials':
        if op_type in ['insert', 'update']:
            found = False
            for cs in ctx.get('card_specials', []):
                if cs.get('id') == row_id:
                    cs.update(row_data)
                    found = True
                    break
            if not found:
                row_data.setdefault('special_set', None)
                row_data.setdefault('specials', [])
                row_data.setdefault('bonuses', [])
                ctx.setdefault('card_specials', []).append(row_data)
        elif op_type == 'delete':
            ctx['card_specials'] = [cs for cs in ctx.get('card_specials', []) if cs.get('id') != row_id]
            
    elif table_name == 'special_sets':
        if op_type in ['insert', 'update']:
            for cs in ctx.get('card_specials', []):
                if cs.get('special_set_id') == row_id or (cs.get('special_set') and cs['special_set'].get('id') == row_id):
                    if cs.get('special_set') is None:
                        cs['special_set'] = {}
                    cs['special_set'].update(row_data)
                    break
        elif op_type == 'delete':
            for cs in ctx.get('card_specials', []):
                if cs.get('special_set') and cs['special_set'].get('id') == row_id:
                    cs['special_set'] = None
                    cs['specials'] = []
                    
    elif table_name == 'specials':
        if op_type in ['insert', 'update']:
            set_id = row_data.get('special_set_id')
            found = False
            for cs in ctx.get('card_specials', []):
                if cs.get('special_set_id') == set_id:
                    for se in cs.get('specials', []):
                        if se.get('id') == row_id:
                            se.update(row_data)
                            found = True
                            break
                    if not found:
                        cs.setdefault('specials', []).append(row_data)
                        found = True
                    break
        elif op_type == 'delete':
            for cs in ctx.get('card_specials', []):
                cs['specials'] = [se for se in cs.get('specials', []) if se.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'specials', 'id': row_id})
            
    elif table_name == 'special_bonuses':
        if op_type in ['insert', 'update']:
            found = False
            for cs in ctx.get('card_specials', []):
                for sb in cs.get('bonuses', []):
                    if sb.get('id') == row_id:
                        sb.update(row_data)
                        found = True
                        break
                if found:
                    break
            if not found:
                for cs in ctx.get('card_specials', []):
                    if cs.get('special_bonus_id1') == row_id or cs.get('special_bonus_id2') == row_id:
                        cs.setdefault('bonuses', []).append(row_data)
                        break
        elif op_type == 'delete':
            for cs in ctx.get('card_specials', []):
                cs['bonuses'] = [sb for sb in cs.get('bonuses', []) if sb.get('id') != row_id]
                
    elif table_name == 'transformation_descriptions':
        if op_type in ['insert', 'update']:
            found = False
            for td in ctx.get('transformation_descriptions', []):
                if td.get('id') == row_id:
                    td.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('transformation_descriptions', []).append(row_data)
        elif op_type == 'delete':
            ctx['transformation_descriptions'] = [td for td in ctx.get('transformation_descriptions', []) if td.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'transformation_descriptions', 'id': row_id})
            
    elif table_name == 'dokkan_fields':
        if op_type in ['insert', 'update']:
            found = False
            for f in ctx.get('fields', []):
                if f.get('id') == row_id:
                    f.update(row_data)
                    found = True
                    break
            if not found:
                row_data.setdefault('efficacies', [])
                ctx.setdefault('fields', []).append(row_data)
        elif op_type == 'delete':
            ctx['fields'] = [f for f in ctx.get('fields', []) if f.get('id') != row_id]
            
    elif table_name == 'dokkan_field_efficacies':
        if op_type in ['insert', 'update']:
            set_id = row_data.get('dokkan_field_efficacy_set_id')
            found = False
            for f in ctx.get('fields', []):
                if f.get('id') == set_id:
                    for eff in f.get('efficacies', []):
                        if eff.get('id') == row_id:
                            eff.update(row_data)
                            found = True
                            break
                    if not found:
                        f.setdefault('efficacies', []).append(row_data)
                        found = True
                    break
        elif op_type == 'delete':
            for f in ctx.get('fields', []):
                f['efficacies'] = [eff for eff in f.get('efficacies', []) if eff.get('id') != row_id]
            ctx.setdefault('deleted_rows', []).append({'table': 'dokkan_field_efficacies', 'id': row_id})
            
    elif table_name == 'dokkan_field_active_skill_set_relations':
        if op_type in ['insert', 'update']:
            found = False
            for r in ctx.get('field_active_relations', []):
                if r.get('id') == row_id:
                    r.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('field_active_relations', []).append(row_data)
        elif op_type == 'delete':
            ctx['field_active_relations'] = [r for r in ctx.get('field_active_relations', []) if r.get('id') != row_id]
            
    elif table_name == 'dokkan_field_passive_skill_relations':
        if op_type in ['insert', 'update']:
            found = False
            for r in ctx.get('field_passive_relations', []):
                if r.get('id') == row_id:
                    r.update(row_data)
                    found = True
                    break
            if not found:
                ctx.setdefault('field_passive_relations', []).append(row_data)
        elif op_type == 'delete':
            ctx['field_passive_relations'] = [r for r in ctx.get('field_passive_relations', []) if r.get('id') != row_id]

def process_imported_sql(sql_patch_text):
    import re
    statements = split_sql_statements(sql_patch_text)
    
    applied_count = 0
    errors = []
    operations = []
    
    for stmt in statements:
        stmt = stmt.strip()
        if not stmt:
            continue
        
        delete_match = re.match(r"(?i)^DELETE\s+FROM\s+(?:['\"`]?\w+['\"`]?\.)?['\"`]?(\w+)['\"`]?\s+WHERE\s+['\"`]?id['\"`]?\s*=\s*['\"`]?(\d+)['\"`]?$", stmt)
        if delete_match:
            table_name = delete_match.group(1)
            row_id = int(delete_match.group(2))
            operations.append({
                'type': 'delete',
                'table': table_name,
                'id': row_id,
                'data': {}
            })
            continue
            
        insert_match = re.match(r"(?i)^INSERT\s+(?:OR\s+REPLACE\s+)?INTO\s+(?:['\"`]?\w+['\"`]?\.)?['\"`]?(\w+)['\"`]?\s*\(([^)]+)\)\s*VALUES\s*\((.+)\)$", stmt, re.DOTALL)
        if insert_match:
            table_name = insert_match.group(1)
            cols_str = insert_match.group(2)
            vals_str = insert_match.group(3)
            
            cols = [c.strip().strip('"').strip("'").strip('`') for c in cols_str.split(',')]
            vals_raw = split_values(vals_str)
            vals = [parse_val(v) for v in vals_raw]
            
            if len(cols) != len(vals):
                errors.append(f"Column and value length mismatch: {stmt[:100]}...")
                continue
                
            row_data = dict(zip(cols, vals))
            row_id = row_data.get('id')
            if row_id is None:
                errors.append(f"Missing 'id' column: {stmt[:100]}...")
                continue
                
            operations.append({
                'type': 'insert',
                'table': table_name,
                'id': int(row_id),
                'data': row_data
            })
            continue
            
        update_match = re.match(r"(?i)^UPDATE\s+(?:['\"`]?\w+['\"`]?\.)?['\"`]?(\w+)['\"`]?\s+SET\s+(.+?)\s+WHERE\s+['\"`]?id['\"`]?\s*=\s*['\"`]?(\d+)['\"`]?$", stmt, re.DOTALL)
        if update_match:
            table_name = update_match.group(1)
            set_clause = update_match.group(2)
            row_id = int(update_match.group(3))
            
            row_data = parse_update_set_clause(set_clause)
            operations.append({
                'type': 'update',
                'table': table_name,
                'id': row_id,
                'data': row_data
            })
            continue
            
        if stmt.startswith("--") or not stmt:
            continue
        errors.append(f"Unrecognized SQL format: {stmt[:100]}...")

    for op in operations:
        table_name = op['table']
        row_id = op['id']
        row_data = op['data']
        op_type = op['type']
        
        card_id = get_card_id_for_row(table_name, row_id)
        if not card_id:
            active_cid = st.session_state.get('loaded_card_id')
            if active_cid:
                card_id = active_cid
            else:
                errors.append(f"Could not associate table '{table_name}' ID {row_id} with any card.")
                continue
                
        if 'edited_contexts' not in st.session_state:
            st.session_state['edited_contexts'] = {}
            
        if card_id not in st.session_state['edited_contexts']:
            loaded_ctx = load_character_context(card_id=card_id)
            if loaded_ctx:
                st.session_state['edited_contexts'][card_id] = loaded_ctx
            else:
                errors.append(f"Failed to load character context for Card ID {card_id}.")
                continue
                
        ctx_obj = st.session_state['edited_contexts'][card_id]
        try:
            apply_op_to_context(ctx_obj, table_name, row_id, row_data, op_type)
            applied_count += 1
        except Exception as e:
            errors.append(f"Error applying update to table '{table_name}' ID {row_id}: {e}")
            
    return applied_count, errors

def import_sql_patch(sql_text):
    applied_count, errors = process_imported_sql(sql_text)
    
    loaded_card_id = st.session_state.get('loaded_card_id')
    if loaded_card_id and 'edited_contexts' in st.session_state and loaded_card_id in st.session_state['edited_contexts']:
        st.session_state['character_ctx'] = st.session_state['edited_contexts'][loaded_card_id]
        
    prefixes = [
        'ls_', 'ps_', 'act_', 'sb_', 'fn_', 'se_', 'cs_', 
        'sb1_', 'sb2_', 'trans_', 'td_', 'fd_', 'rel_', 'eso_'
    ]
    keys_to_clear = []
    for k in st.session_state.keys():
        if any(k.startswith(pfx) for pfx in prefixes):
            keys_to_clear.append(k)
    for k in keys_to_clear:
        del st.session_state[k]
        
    st.session_state['ps_desc_version'] = st.session_state.get('ps_desc_version', 0) + 1
    
    return applied_count, errors

