import { withPatchQuery } from './patch-context.js';

export function fetchFresh(url, init = {}) {
  return fetch(withPatchQuery(url), init);
}

export function stampFromResponse(res) {
  return res?.headers?.get?.('X-Asset-Stamp') || res?.headers?.get?.('ETag')?.replace(/"/g, '') || '';
}

export async function fetchWithProgress(url, onProgress, init = {}, timeoutMs = 120000) {
  const targetUrl = withPatchQuery(url);
  const controller = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const externalSignal = init.signal;
  let timedOut = false;
  const timer = controller ? setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, Math.max(1000, Number(timeoutMs) || 120000)) : null;
  if (controller && externalSignal) {
    if (externalSignal.aborted) controller.abort();
    else externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
  }
  let res;
  try {
    res = await fetch(targetUrl, { ...init, signal: controller?.signal || externalSignal });
  } catch (error) {
    if (timer) clearTimeout(timer);
    if (timedOut) throw new Error(`Request timed out after ${Math.round(timeoutMs / 1000)}s`);
    throw error;
  }
  if (!res.ok) {
    if (timer) clearTimeout(timer);
    throw new Error(`HTTP ${res.status}`);
  }
  const total = Number(res.headers.get('Content-Length')) || 0;
  if (typeof onProgress === 'function' && total > 0) {
    onProgress({ loaded: 0, total, percent: 0 });
  }
  if (!res.body || !res.body.getReader) {
    const blob = await res.blob();
    if (timer) clearTimeout(timer);
    if (typeof onProgress === 'function') {
      onProgress({ loaded: blob.size, total: blob.size, percent: 100 });
    }
    return { res, blob };
  }
  const reader = res.body.getReader();
  let loaded = 0;
  const chunks = [];
  let lastNotify = performance.now();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    const now = performance.now();
    if (now - lastNotify > 50 || loaded >= total) {
      lastNotify = now;
      const percent = total > 0 ? Math.min(99, Math.round((loaded / total) * 100)) : 0;
      if (typeof onProgress === 'function') {
        onProgress({ loaded, total, percent });
      }
    }
  }
  const mime = res.headers.get('Content-Type') || 'video/mp4';
  const blob = new Blob(chunks, { type: mime });
  if (timer) clearTimeout(timer);
  if (typeof onProgress === 'function') {
    onProgress({ loaded, total: Math.max(total, loaded), percent: 100 });
  }
  return { res, blob };
}
