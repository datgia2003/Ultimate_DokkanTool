# -*- coding: utf-8 -*-
import os
import sqlite3
from contextlib import closing
import pandas as pd
import streamlit as st
from modules.core.config import DB_PATH, RULES_DIR
from modules.core.mod_workspace import database_path

# -------------------------------------------------------------
# Rules Loader Functions
# -------------------------------------------------------------
def load_excel_robust(path, key_column_name):
    if not os.path.exists(path):
        return pd.DataFrame()
    df = pd.read_excel(path, header=None)
    header_row_idx = None
    for idx, row in df.iterrows():
        row_str_values = [str(val).strip() for val in row.values]
        if key_column_name in row_str_values:
            header_row_idx = idx
            break
            
    if header_row_idx is None:
        return pd.DataFrame()
        
    headers = df.iloc[header_row_idx].tolist()
    headers = [str(h).strip() if pd.notna(h) else f"col_{i}" for i, h in enumerate(headers)]
    
    data_rows = df.iloc[header_row_idx + 1:]
    new_df = pd.DataFrame(data_rows.values, columns=headers)
    return new_df

@st.cache_data
def load_game_rules():
    exec_timing_dict = {}
    target_type_dict = {}
    calc_option_dict = {}
    efficacy_dict = {}
    efficacy_details = {}
    causality_dict = {}
    causality_details = {}
    element_type_dict = {}
    
    try:
        # Exec Timing
        df = load_excel_robust(os.path.join(RULES_DIR, "exec timing.xlsx"), "Exec Timing Type ID")
        for _, row in df.iterrows():
            try:
                tid = int(row['Exec Timing Type ID'])
                exec_timing_dict[tid] = f"{tid} - {row['Type']}"
            except: pass
            
        # Target Type
        df = load_excel_robust(os.path.join(RULES_DIR, "target type.xlsx"), "Target Type ID")
        for _, row in df.iterrows():
            try:
                tid = int(row['Target Type ID'])
                target_type_dict[tid] = f"{tid} - {row['Type']}"
            except: pass
            
        # Calc Option
        df = load_excel_robust(os.path.join(RULES_DIR, "calc option.xlsx"), "Calc Option ID")
        for _, row in df.iterrows():
            try:
                cid = int(row['Calc Option ID'])
                calc_option_dict[cid] = f"{cid} - {row['Type']}"
            except: pass
            
        # Efficacy Type
        df = load_excel_robust(os.path.join(RULES_DIR, "efficacy Type.xlsx"), "Efficacy ID")
        for _, row in df.iterrows():
            try:
                eid = int(row['Efficacy ID'])
                name = str(row['Name'])
                efficacy_dict[eid] = f"{eid} - {name}"
                efficacy_details[eid] = {
                    'name': name,
                    'desc': str(row.get('Description', '')),
                    'v1': str(row.get('ef_value1', '')),
                    'v2': str(row.get('ef_value2', '')),
                    'v3': str(row.get('ef_value3', '')),
                    'vals': str(row.get('efficacy_values', '')),
                    'notes': str(row.get('Notes', ''))
                }
            except: pass
            
        # Causality Condition
        df = load_excel_robust(os.path.join(RULES_DIR, "causality condition.xlsx"), "Causality ID")
        for _, row in df.iterrows():
            try:
                cid = int(row['Causality ID'])
                name = str(row['Causality'])
                causality_dict[cid] = f"{cid} - {name}"
                causality_details[cid] = {
                    'name': name,
                    'desc': str(row.get('Causality Description', '')),
                    'v1': str(row.get('Value 1', '')),
                    'v2': str(row.get('Value 2', '')),
                    'v3': str(row.get('Value 3', ''))
                }
            except: pass
            
        # Element Type
        try:
            df_elem = pd.read_excel(os.path.join(RULES_DIR, "element type.xlsx"), header=None)
            header_row_idx = None
            for idx, row in df_elem.iterrows():
                row_vals = [str(v).strip().lower() for v in row.values]
                if 'type' in row_vals and 'super' in row_vals:
                    header_row_idx = idx
                    break
            
            if header_row_idx is not None:
                headers = [str(h).strip() if pd.notna(h) else f"col_{i}" for i, h in enumerate(df_elem.iloc[header_row_idx].tolist())]
                for idx, row in df_elem.iloc[header_row_idx+1:].iterrows():
                    row_vals = list(row.values)
                    if not row_vals or pd.isna(row_vals[0]):
                        continue
                    type_name = str(row_vals[0]).strip()
                    for col_idx in range(1, len(headers)):
                        val = row_vals[col_idx]
                        col_name = headers[col_idx]
                        if pd.notna(val):
                            try:
                                elem_id = int(val)
                                if col_name == 'Neutral':
                                    desc = type_name
                                else:
                                    desc = f"{col_name} {type_name}"
                                element_type_dict[elem_id] = desc
                            except:
                                pass
        except:
            pass
    except Exception as e:
        st.warning(f"Error loading game rules Excel files: {e}. Dropdowns will fall back to integer inputs.")
        
    return exec_timing_dict, target_type_dict, calc_option_dict, efficacy_dict, efficacy_details, causality_dict, causality_details, element_type_dict

# Load rules
exec_timing_dict, target_type_dict, calc_option_dict, efficacy_dict, efficacy_details, causality_dict, causality_details, element_type_dict = load_game_rules()

# -------------------------------------------------------------
# Database Utility Functions
# -------------------------------------------------------------
def get_db_connection():
    return sqlite3.connect(database_path(DB_PATH).resolve().as_uri() + "?mode=ro", uri=True)

def query_db_one(query, params=()):
    with closing(get_db_connection()) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(query, params)
        row = cursor.fetchone()
        return dict(row) if row else None

def query_db_all(query, params=()):
    with closing(get_db_connection()) as conn:
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()
        cursor.execute(query, params)
        return [dict(r) for r in cursor.fetchall()]

def get_table_columns(table_name):
    try:
        with closing(get_db_connection()) as conn:
            cursor = conn.cursor()
            cursor.execute(f"PRAGMA table_info({table_name});")
            return [col[1] for col in cursor.fetchall()]
    except Exception as e:
        st.error(f"Error fetching columns for table {table_name}: {e}")
        return []

def load_category_dict():
    try:
        rows = query_db_all("SELECT id, name FROM card_categories")
        return {r['id']: r['name'] for r in rows}
    except Exception as e:
        return {}

category_dict = load_category_dict()


def get_next_prefixed_id(base_id, existing_ids):
    base_id_int = int(base_id)
    existing_ints = []
    for value in existing_ids or []:
        try:
            existing_ints.append(int(value))
        except (TypeError, ValueError):
            continue

    # Draft passive sets use negative temporary IDs. Prefixing a negative
    # value by string concatenation would produce invalid IDs such as
    # ``100-237...`` when the set ID is already used by a skill row.
    if base_id_int <= 0:
        if base_id_int not in existing_ints:
            return base_id_int
        candidate = min([base_id_int, *(value for value in existing_ints if value < 0)]) - 1
        while candidate in existing_ints:
            candidate -= 1
        return candidate

    if not existing_ints:
        return base_id_int
        
    if base_id_int not in existing_ints:
        return base_id_int
        
    prefixes = []
    base_str = str(base_id_int)
    for eid in existing_ints:
        eid_str = str(eid)
        if eid_str == base_str:
            continue
        if eid_str.endswith(base_str):
            prefix_part = eid_str[:-len(base_str)]
            try:
                prefixes.append(int(prefix_part))
            except ValueError:
                pass
                
    if not prefixes:
        next_prefix = 100
    else:
        next_prefix = max(prefixes) + 100
        
    return int(f"{next_prefix}{base_str}")

def get_relation_id(set_id, index, max_base_index=12):
    if index <= max_base_index:
        return set_id * 10000 + index
    else:
        prefix = (index - max_base_index) * 100
        return int(f"{prefix}{set_id:04d}{max_base_index:04d}")

# Safe Selectbox Indexing Helper
def get_index_safe(options, value, default=0):
    try:
        val_int = int(value)
        if val_int in options:
            return options.index(val_int)
    except:
        pass
    return default

def get_val_safe(row_dict, key, default):
    val = row_dict.get(key)
    if val is None or str(val).strip() == '':
        return default
    try:
        return int(val)
    except:
        return default
