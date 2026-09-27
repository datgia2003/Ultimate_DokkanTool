import { fetchFresh } from './fetch-fresh.js';
import { getActivePatchId } from './patch-context.js';

const cache = new Map();
let cacheOrder = [];
const MAX_EFFECT_CACHE = 30;

function packStamp(data) {
  return [data?.lwf?.stamp, data?.usm?.stamp, data?.lwf?.bytes, data?.usm?.bytes]
    .filter((x) => x != null && x !== '')
    .join('|');
}

export async function fetchEffectPack(id, { enemy = false } = {}) {
  const patch = getActivePatchId() || '';
  const key = `${id}:${enemy ? 1 : 0}:${patch}`;
  const qs = new URLSearchParams({ enemy: enemy ? '1' : '0' });
  if (patch) qs.set('patch', patch);
  const res = await fetchFresh(`/api/effect-pack/${id}?${qs}`);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `effect-pack ${id} failed`);
  const stamp = packStamp(data);
  const prev = cache.get(key);
  if (prev && prev.__stamp && stamp && prev.__stamp === stamp) {
    // Move to end of LRU order (most recently used)
    const idx = cacheOrder.indexOf(key);
    if (idx > -1) cacheOrder.splice(idx, 1);
    cacheOrder.push(key);
    return prev;
  }
  data.__stamp = stamp;
  cache.set(key, data);
  // LRU tracking
  const idx = cacheOrder.indexOf(key);
  if (idx > -1) cacheOrder.splice(idx, 1);
  cacheOrder.push(key);
  while (cacheOrder.length > MAX_EFFECT_CACHE) {
    const oldest = cacheOrder.shift();
    cache.delete(oldest);
  }
  return data;
}

export function clearEffectPackCache() {
  cache.clear();
  cacheOrder = [];
}

export function classifyMedia(pack) {
  if (!pack?.found) return { useLwf: false, useUsm: false };
  return {
    useLwf: Boolean(pack.lwf?.url),
    useUsm: Boolean(pack.usm?.url),
    scene: pack.scene_name || '',
    packName: pack.pack_name || '',
  };
}
