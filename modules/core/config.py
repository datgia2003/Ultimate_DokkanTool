# -*- coding: utf-8 -*-
import os

TOOL_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
TOOL_RUNTIME_DIR = os.path.join(TOOL_ROOT, ".runtime")
TOOL_TEMP_DIR = os.path.join(TOOL_RUNTIME_DIR, "temp")
TOOL_CACHE_HOME = os.path.join(TOOL_RUNTIME_DIR, "cache")
TOOL_STREAMLIT_DIR = os.path.join(TOOL_RUNTIME_DIR, "streamlit")
for _tool_dir in (TOOL_RUNTIME_DIR, TOOL_TEMP_DIR, TOOL_CACHE_HOME, TOOL_STREAMLIT_DIR):
    os.makedirs(_tool_dir, exist_ok=True)
os.environ["TEMP"] = TOOL_TEMP_DIR
os.environ["TMP"] = TOOL_TEMP_DIR
os.environ["TMPDIR"] = TOOL_TEMP_DIR
os.environ["XDG_CACHE_HOME"] = TOOL_CACHE_HOME
os.environ["MPLCONFIGDIR"] = os.path.join(TOOL_CACHE_HOME, "matplotlib")
os.environ["STREAMLIT_CONFIG_DIR"] = TOOL_STREAMLIT_DIR

DB_PATH = os.path.join(TOOL_ROOT, "database_decrypted.db")
RULES_DIR = os.path.join(TOOL_ROOT, "game rules")
GAME_RES_DIR = os.path.join(TOOL_ROOT, "game res")
BGM_DIR = os.path.join(GAME_RES_DIR, "bgm")
THUMB_DIR = os.path.join(GAME_RES_DIR, "thumb")
PATCHES_DIR = os.path.join(TOOL_ROOT, "patches")
VGMSTREAM_CLI = os.path.abspath(os.path.join(TOOL_ROOT, "tools", "vgmstream", "vgmstream-cli.exe"))
BGM_SERVER_PORT = 8585
