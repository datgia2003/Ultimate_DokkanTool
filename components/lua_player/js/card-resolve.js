import { fetchFresh } from './fetch-fresh.js';
import { getActivePatchId, withPatchQuery } from './patch-context.js';

const cache = new Map();
let cacheOrder = [];
const MAX_CARD_CACHE = 20;

async function readJsonResponse(res, label) {
  const text = await res.text();
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${label}: empty response (${res.status})`);
  }
  if (trimmed[0] !== '{' && trimmed[0] !== '[') {
    throw new Error(
      `${label}: expected JSON, got ${res.status} ` +
        `(${trimmed.slice(0, 80).replace(/\s+/g, ' ')}). Restart ab-lua-player server.py.`,
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch (e) {
    throw new Error(`${label}: JSON parse failed — ${e.message}`);
  }
}

function cardStamp(data) {
  const parts = [
    data?.battle?.stamp,
    data?.sp?.stamp,
    data?.idle?.stamp,
    data?.textures?.character?.stamp,
    data?.textures?.effect?.stamp,
  ];
  return parts.filter(Boolean).join('|');
}

export async function fetchCard(cardId) {
  const id = Number(cardId);
  if (!Number.isFinite(id) || id <= 0) {
    return { found: false, id };
  }
  const patch = getActivePatchId() || '';
  const cacheKey = `${id}:${patch}`;
  const qs = patch ? `?patch=${encodeURIComponent(patch)}` : '';
  const res = await fetchFresh(`/api/card/${id}${qs}`);
  const data = await readJsonResponse(res, `card ${id}`);
  if (!res.ok) throw new Error(data.error || `card ${id} failed`);
  const stamp = cardStamp(data);
  const prev = cache.get(cacheKey);
  if (prev && prev.__stamp && stamp && prev.__stamp === stamp) {
    // Move to end of LRU order
    const idx = cacheOrder.indexOf(cacheKey);
    if (idx > -1) cacheOrder.splice(idx, 1);
    cacheOrder.push(cacheKey);
    return prev;
  }
  data.__stamp = stamp;
  cache.set(cacheKey, data);
  // LRU tracking
  const idx = cacheOrder.indexOf(cacheKey);
  if (idx > -1) cacheOrder.splice(idx, 1);
  cacheOrder.push(cacheKey);
  while (cacheOrder.length > MAX_CARD_CACHE) {
    const oldest = cacheOrder.shift();
    cache.delete(oldest);
  }
  return data;
}

export function clearCardCache() {
  cache.clear();
  cacheOrder = [];
}

export const REPLACE_KIND = {
  0: 'character',
  1: 'effect',
  2: 'sp_cutin',
  3: 'cutin',
  4: 'sp_name',
  5: 'sp_phrase',
  6: 'sp_cutin',
  7: 'cutin',
};

export const REPLACE_SLOT = {
  1: 'effect',
  2: 'character',
  3: 'sp_cutin',
  4: 'sp_phrase',
  5: 'sp_name',
  6: 'cutin',
  7: 'sp_name',
};

export function stubKeyFromFilename(filename) {
  const base = String(filename || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
  if (!/(?:^|_)?card_/i.test(base)) return null;
  const s = base.replace(/^(?:images_)?card_\d+[_-]?/i, '').replace(/\.png$/i, '');
  if (s.includes('sp_cutin') || s.includes('spcutin')) return 'sp_cutin';
  if (s.includes('sp_name') || s.includes('spname')) return 'sp_name';
  if (s.includes('sp_phrase') || s.includes('spphrase')) return 'sp_phrase';
  if (/(^|_)cutin/.test(`_${s}`) && !s.includes('sp')) return 'cutin';
  if (s.includes('character')) return 'character';
  if (s.includes('effect')) return 'effect';
  if (s.includes('bg')) return 'bg';
  if (s.includes('circle')) return 'circle';
  if (!s) return 'character';
  return null;
}

function artKeyForKind(kind) {
  return REPLACE_KIND[Number(kind)] || null;
}

export function makeCardTextureImageMap(baseUrl, card, extraRules = []) {
  const textures = card?.textures || {};
  const artId = card?.art_id;

  const byStub = new Map();

  if (artId && textures) {
    for (const key of ['character', 'effect', 'sp_cutin', 'cutin', 'sp_name', 'sp_phrase']) {
      if (textures[key]?.url) byStub.set(key, textures[key].url);
    }
  }

  for (const rule of extraRules || []) {
    if (rule?.filename) {
      const stub = REPLACE_SLOT[Number(rule.slot)] || stubKeyFromFilename(String(rule.filename));
      if (stub) byStub.set(stub, rule.filename);
      continue;
    }
    const stub = REPLACE_SLOT[Number(rule.slot)];
    const artKey = artKeyForKind(rule.kind);
    const url = artKey && textures[artKey]?.url ? textures[artKey].url : null;
    if (!url) continue;
    if (stub) byStub.set(stub, url);
    byStub.set(artKey, url);
    const kindN = Number(rule.kind);
    if (
      artKey === 'sp_cutin' ||
      artKey === 'cutin' ||
      kindN === 2 ||
      kindN === 3 ||
      kindN === 6 ||
      kindN === 7
    ) {
      byStub.set('character', url);
      byStub.set('sp_cutin', url);
      byStub.set('cutin', url);
    }
    if (artKey === 'sp_phrase' || artKey === 'sp_name' || kindN === 4 || kindN === 5) {
      byStub.set(artKey, url);
    }
  }

  const basePath = String(baseUrl || '').split('?')[0];
  const prefix = basePath.endsWith('/') ? basePath : `${basePath}/`;
  const abs = (url) => {
    if (!url) return null;
    if (/^https?:\/\//i.test(url) || url.startsWith('/')) return url;
    return prefix + url;
  };

  return (name) => {
    let key = String(name || '').replace(/\\/g, '/');
    while (key.startsWith('./')) key = key.slice(2);
    while (key.startsWith('/')) key = key.slice(1);
    const base = key.split('/').pop() || key;

    if (/(?:^|_)?card_\d+/i.test(base) && artId) {
      const stub = stubKeyFromFilename(base);
      const url = stub && byStub.has(stub) ? byStub.get(stub) : null;
      const out = abs(url);
      if (out) return withPatchQuery(out);
    }
    return withPatchQuery(prefix + key);
  };
}

async function verifyAssetUrl(url, { minBytes = 100 } = {}) {
  if (!url) return null;
  try {
    const res = await fetchFresh(url, { method: 'GET' });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    if (buf.byteLength < minBytes) return null;
    return url;
  } catch {
    return null;
  }
}

export async function makeCardTextureImageMapAsync(baseUrl, card, extraRules = [], opts = {}) {
  const textures = { ...(card?.textures || {}) };
  const artId = card?.art_id;

  const kinds = ['character', 'effect', 'bg', 'cutin', 'sp_cutin', 'sp_name', 'sp_phrase', 'circle'];
  const verified = {};
  await Promise.all(
    kinds.map(async (kind) => {
      const url = textures[kind]?.url;
      if (!url) return;
      if (String(url).includes('/composite')) return;

      const minBytes = kind === 'effect' || kind === 'bg' ? 4000 : kind === 'character' ? 2000 : 100;
      const ok = await verifyAssetUrl(url, { minBytes });
      if (ok) verified[kind] = ok;
    }),
  );

  const patched = {};
  for (const [kind, url] of Object.entries(verified)) {
    patched[kind] = { ...(textures[kind] || {}), url };
  }

  const fitUrl = (kind, url) => {
    if (!url || !card?.id) return url;
    if (kind === 'sp_name') {
      return withPatchQuery(`/api/card/${card.id}/fit/${kind}.png?w=1024&h=256&v=3`);
    }
    if (kind === 'sp_phrase') {
      return withPatchQuery(`/api/card/${card.id}/fit/${kind}.png?w=1024&h=512&v=3`);
    }
    return withPatchQuery(url);
  };

  for (const kind of Object.keys(patched)) {
    patched[kind] = {
      ...patched[kind],
      url: fitUrl(kind, patched[kind].url),
      sourceUrl: patched[kind].url,
    };
  }

  for (const rule of extraRules || []) {
    const artKey = artKeyForKind(rule.kind);
    if (!artKey || !patched[artKey]) continue;
    const kindN = Number(rule.kind);
    if (
      artKey === 'sp_cutin' ||
      artKey === 'cutin' ||
      kindN === 2 ||
      kindN === 3 ||
      kindN === 6 ||
      kindN === 7
    ) {
      patched.character = patched[artKey];
      patched.sp_cutin = patched.sp_cutin || patched[artKey];
      patched.cutin = patched.cutin || patched[artKey];
    }
  }

  if (opts?.ensureCardFlash) {
    for (const key of ['character', 'effect', 'sp_name']) {
      if (!patched[key] && verified[key]) {
        patched[key] = {
          ...(textures[key] || {}),
          url: fitUrl(key, verified[key]),
          sourceUrl: verified[key],
        };
      }
    }
  }

  const imageMap = makeCardTextureImageMap(
    baseUrl,
    { ...card, art_id: artId, textures: patched },
    extraRules,
  );
  imageMap._patchedTextures = patched;
  imageMap._replaceRules = extraRules || [];
  return imageMap;
}

export { syncTextureMetricsToImages, repairCardTextureMetrics } from './texture-sync.js';
