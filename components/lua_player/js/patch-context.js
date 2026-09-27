/** Active wiki patch id for asset/media/audio API requests (embed + full player). */

let activePatchId = null;

export function setActivePatchId(patchId) {
  const raw = patchId == null ? '' : String(patchId).trim();
  activePatchId = raw && raw !== '0' ? raw : null;
}

export function getActivePatchId() {
  return activePatchId;
}

export function getApiBase() {
  const workspace = new URLSearchParams(window.location.search).get('mod_workspace');
  if (workspace && /^[a-f0-9]{32}$/.test(workspace)) {
    return `${window.location.origin}/api/v2/mod-assets/${workspace}`;
  }
  const port = window.__SERVER_PORT__ || 8585;
  const host = (typeof window !== 'undefined' && window.location && window.location.hostname) ? window.location.hostname : '127.0.0.1';
  const proto = (typeof window !== 'undefined' && window.location && window.location.protocol) ? window.location.protocol : 'http:';
  return `${proto}//${host}:${port}`;
}

/** Append ?patch= (or &patch=) and ensure full backend URL for same-origin API requests. */
export function withPatchQuery(url, customBase = null) {
  if (url == null || url === '') return url;
  let s = String(url);
  if (s.startsWith('blob:') || s.startsWith('data:') || s.startsWith('embed:')) return s;
  
  const base = customBase || getApiBase();
  if (s.startsWith('/')) {
    s = `${base}${s}`;
  } else if (!s.startsWith('http://') && !s.startsWith('https://')) {
    s = `${base}/${s}`;
  }
  
  const patch = activePatchId;
  if (!patch) return s;
  
  try {
    const u = new URL(s, base);
    if (u.searchParams.get('patch') === patch) {
      return u.toString();
    }
    u.searchParams.set('patch', patch);
    return u.toString();
  } catch {
    if (s.includes('patch=')) return s;
    return s.includes('?') ? `${s}&patch=${encodeURIComponent(patch)}` : `${s}?patch=${encodeURIComponent(patch)}`;
  }
}
