function adoptFengariFromCjs() {
  try {
    if (typeof module !== 'undefined' && module?.exports?.lua) {
      globalThis.fengari = module.exports;
      return;
    }
  } catch {
  }
  try {
    const ex = globalThis.exports;
    if (ex?.fengari?.lua) {
      globalThis.fengari = ex.fengari;
    }
  } catch {
  }
}

export function getFengari() {
  if (globalThis.fengari?.lua) return globalThis.fengari;
  adoptFengariFromCjs();
  return globalThis.fengari?.lua ? globalThis.fengari : null;
}

function fengariScriptUrl() {
  try {
    return new URL('../vendor/fengari-web.min.js?v=2', import.meta.url).href;
  } catch {
    return '/tools/lua-player/vendor/fengari-web.min.js?v=2';
  }
}

let fengariLoadPromise = null;

export function ensureFengari() {
  const existing = getFengari();
  if (existing) return Promise.resolve(existing);
  if (fengariLoadPromise) return fengariLoadPromise;
  fengariLoadPromise = new Promise((resolve, reject) => {
    if (typeof document === 'undefined') {
      reject(new Error('fengari-web failed to load'));
      return;
    }
    const s = document.createElement('script');
    s.src = fengariScriptUrl();
    s.async = false;
    s.dataset.eclipseFengari = '1';
    s.onload = () => {
      adoptFengariFromCjs();
      const f = getFengari();
      if (f) resolve(f);
      else reject(new Error('fengari-web failed to load'));
    };
    s.onerror = () => reject(new Error('fengari-web failed to load'));
    document.head.appendChild(s);
  }).catch((err) => {
    fengariLoadPromise = null;
    throw err;
  });
  return fengariLoadPromise;
}

function num(L, i) {
  const { lua } = getFengari();
  if (lua.lua_isnoneornil(L, i)) return 0;
  return Number(lua.lua_tonumber(L, i)) || 0;
}

function str(L, i) {
  const { lua, to_jsstring } = getFengari();
  if (lua.lua_isnoneornil(L, i)) return '';
  if (!lua.lua_isstring(L, i)) return String(lua.lua_tonumber(L, i) || '');
  const raw = lua.lua_tostring(L, i);
  if (!raw) return '';
  try {
    return to_jsstring(raw, 0, raw.length, true);
  } catch {
    return new TextDecoder('utf-8', { fatal: false }).decode(raw);
  }
}

function asciiChunkName(name) {
  const base = String(name || 'script').replace(/[^\x20-\x7E]/g, '_').slice(0, 60);
  return `@${base}`;
}

export function createLuaHost() {
  const fg = getFengari();
  if (!fg) {
    throw new Error('fengari-web failed to load');
  }
  const { lua, lauxlib, lualib, to_luastring } = fg;
  const L = lauxlib.luaL_newstate();
  lualib.luaL_openlibs(L);

  const register = (name, handler) => {
    lua.lua_pushcfunction(L, (LL) => {
      try {
        const ret = handler(LL);
        if (ret === undefined || ret === null) return 0;
        if (typeof ret === 'number') {
          lua.lua_pushnumber(LL, ret);
          return 1;
        }
        if (typeof ret === 'boolean') {
          lua.lua_pushboolean(LL, ret);
          return 1;
        }
        lua.lua_pushstring(LL, to_luastring(String(ret)));
        return 1;
      } catch (e) {
        const msg = String(e && e.message ? e.message : e).replace(/[^\x20-\x7E]/g, '?');
        lauxlib.luaL_error(LL, to_luastring(msg));
        return 0;
      }
    });
    lua.lua_setglobal(L, to_luastring(name));
  };

  const setGlobalNumber = (name, value) => {
    lua.lua_pushnumber(L, Number(value) || 0);
    lua.lua_setglobal(L, to_luastring(name));
  };

  const setGlobalString = (name, value) => {
    lua.lua_pushstring(L, to_luastring(String(value ?? '')));
    lua.lua_setglobal(L, to_luastring(name));
  };

  const run = (source, chunkName = 'script') => {
    const bytes =
      typeof TextEncoder !== 'undefined'
        ? new TextEncoder().encode(source)
        : to_luastring(source);
    const name = to_luastring(asciiChunkName(chunkName));
    const status = lauxlib.luaL_loadbuffer(L, bytes, bytes.length, name);
    if (status !== lua.LUA_OK) {
      const err = str(L, -1);
      lua.lua_pop(L, 1);
      throw new Error(`Lua load: ${err}`);
    }
    const call = lua.lua_pcall(L, 0, lua.LUA_MULTRET, 0);
    if (call !== lua.LUA_OK) {
      const err = str(L, -1);
      lua.lua_pop(L, 1);
      throw new Error(`Lua run: ${err}`);
    }
  };

  return { L, register, setGlobalNumber, setGlobalString, run, num, str };
}

export { num, str };
