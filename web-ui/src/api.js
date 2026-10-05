// API Client for Dokkan Patch Studio
const BASE = '/api/v2'
let workspaceId = ''
export function setModWorkspace(id) { workspaceId = id || '' }
export function getModWorkspace() { return workspaceId }

async function req(path, options = {}) {
  const url = `${BASE}${path}`
  const response = await fetch(url, { ...options, headers: { ...options.headers, ...(workspaceId ? { 'X-Mod-Workspace': workspaceId } : {}) } })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(data.error || `HTTP ${response.status}: ${response.statusText}`)
  }
  return data
}

export const api = {
  cloneSkill: (kind, sourceId, targetId) => req(`/skills/clone?${new URLSearchParams({ kind, source_id: sourceId, target_id: targetId })}`),
  importMod: file => req('/mods/import', { method: 'POST', headers: { 'Content-Type': 'application/zip' }, body: file }),
  lookupAnimations: (slot, q, signal, options = {}) => req(`/animations/lookup?${new URLSearchParams({ slot, q, ...options })}`, { signal, cache: 'no-store' }),
  getHealth: () => req('/health'),
  getMeta: () => req('/meta'),
  getCardMemberships: signal => req('/card-memberships', { signal, cache: 'no-store' }),

  getCards: ({ q = '', rarities = '5,4,3', element = '', page = 1, limit = 24 } = {}, signal) => {
    const params = new URLSearchParams()
    if (q) params.set('q', q)
    if (rarities) params.set('rarities', rarities)
    if (element && element !== 'all') params.set('element', element)
    params.set('page', page)
    params.set('limit', limit)
    return req(`/cards?${params.toString()}`, { signal })
  },

  getEnemyCards: signal => req('/enemy-cards', { signal }),
  getCard: (id, signal) => req(`/cards/${id}`, { signal }),
  getChain: (id) => req(`/cards/${id}/chain`),
  resolveDraftAnimations: (payload, signal) => req('/animations/resolve-draft', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload), signal
  }),
  getAnimations: (id, signal) => req(`/cards/${id}/animations`, { signal }),
  getSourceAnimations: (id, signal) => req(`/cards/${id}/animations?source=database`, { signal, cache: 'no-store' }),
  getCharacterOst: (id, signal) => req(`/cards/${id}/ost`, { signal }),
  importCustomBgm: (wav, title) => req('/custom-bgm/import', {
    method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Audio-Title': encodeURIComponent(title || 'Custom OST') },
    body: wav
  }),
  saveCustomLua: (filename, content) => req('/custom-lua/save', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, content })
  }),
  getCustomLuaList: signal => req('/custom-lua/list', { signal, cache: 'no-store' }),
  previewCustomLua: (filename, content) => req('/custom-lua/preview', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ filename, content })
  }),
  searchAnimationSources: (q, signal, options = {}) => req(`/animation-sources?${new URLSearchParams({ q, ...options })}`, { signal }),
  getLuaSource: (path, signal) => req(`/lua/source?${new URLSearchParams({ path })}`, { signal, cache: 'no-store' }),
  refreshLuaSource: path => req(`/lua/source?${new URLSearchParams({ path, refresh: '1' })}`, { cache: 'no-store' }),
  transmuteAnimation: (payload) => req('/animations/transmute', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  }),
  compilePassive: (description, passiveSetId) => req('/passive/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, passive_set_id: passiveSetId })
  }),
  matchPassive: (description, skills, passiveSetId) => req('/passive/match', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, skills, passive_set_id: passiveSetId })
  }),
  compileLeader: (description, leaderSetId) => req('/leader/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, leader_set_id: leaderSetId })
  }),
  compileActive: (description, activeSetId, cardId) => req('/active/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, active_set_id: activeSetId, card_id: cardId })
  }),
  compileStandby: (description, standbySetId) => req('/standby/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, standby_set_id: standbySetId })
  }),
  compileSpecial: (description, specialSetId) => req('/special/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, special_set_id: specialSetId })
  }),
  compileFinish: (description, finishSetId) => req('/finish/compile', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ description, finish_set_id: finishSetId })
  }),

  getThumbUrl: (id, overrides = {}) => {
    const params = new URLSearchParams({ style: 'game', v: '4' })
    if (overrides.element != null) params.set('element', overrides.element)
    if (overrides.rarity != null) params.set('rarity', overrides.rarity)
    if (workspaceId) params.set('mod_workspace', workspaceId)
    return `${BASE}/thumb/${id}?${params}`
  },
  getAudioUrl: (kind, id) => `${BASE}/audio/${kind}/${id}`,

  previewSql: (id, changes = {}, rawSql = '') => {
    return req(`/cards/${id}/sql`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, raw_sql: rawSql })
    })
  },

  applyChanges: (id, changes = {}, rawSql = '') => {
    return req(`/cards/${id}/apply`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ changes, raw_sql: rawSql })
    })
  },

  previewExportSql: ({ cardId, changes = {}, rawSql = '' }) => {
    return req('/export/preview-sql', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ card_id: cardId, changes, raw_sql: rawSql })
    })
  },

  buildZip: ({ filename, meta, cardId, incSql = true, includeAssets = true, sqlContent = '', changes = {}, rawSql = '' }) => {
    return req('/export/build-zip', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        filename,
        meta,
        card_id: cardId,
        inc_sql: incSql,
        include_assets: includeAssets,
        sql_content: sqlContent,
        changes,
        raw_sql: rawSql
      })
    })
  },

  buildEclp: ({ zipPath, meta, cookie }) => {
    return req('/export/build-eclp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ zip_path: zipPath, meta, cookie })
    })
  },

  getBgmTracks: () => req('/bgm/tracks'),
  getCausalities: (q = '', limit = 60) => req(`/causalities?q=${encodeURIComponent(q)}&limit=${limit}`),
  getCausality: (id) => req(`/causalities/${id}`),
  saveCausality: (data) => req('/causalities', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  }),
  getConfig: () => req('/config'),
  saveConfig: (data) => req('/config', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data)
  })
}
