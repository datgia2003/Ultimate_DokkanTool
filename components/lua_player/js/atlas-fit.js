import { fetchFresh } from './fetch-fresh.js';

export function parseLwfTextures(bytes) {
  try {
    const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
    if (u8.length < 324 || String.fromCharCode(u8[0], u8[1], u8[2]) !== 'LWF') {
      return [];
    }
    const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const formatVersion = (u8[4] << 16) | (u8[5] << 8) | u8[6];
    const hasMcb = formatVersion >= 0x141211;
    const nItems = hasMcb ? 37 : 36;
    const itemBase = 32;
    const item = (i) => {
      const at = itemBase + i * 8;
      if (at + 8 > view.byteLength) return { offset: -1, length: 0 };
      return {
        offset: view.getInt32(at, true),
        length: view.getInt32(at + 4, true),
      };
    };
    const stringBytes = item(0);
    const texture = item(8);
    const stringData = item(nItems - 1);
    if (
      texture.length < 1 ||
      texture.offset < 0 ||
      stringBytes.offset < 0 ||
      stringData.offset < 0 ||
      stringBytes.offset + stringBytes.length > u8.length ||
      stringData.offset + stringData.length * 8 > u8.length ||
      texture.offset + texture.length * 20 > u8.length
    ) {
      return [];
    }
    const stringBlob = u8.subarray(
      stringBytes.offset,
      stringBytes.offset + stringBytes.length,
    );
    const strings = [];
    for (let i = 0; i < stringData.length; i++) {
      const soff = view.getInt32(stringData.offset + i * 8, true);
      const slen = view.getInt32(stringData.offset + i * 8 + 4, true);
      let s = '';
      if (soff >= 0 && slen > 0 && soff + slen <= stringBlob.length) {
        for (let j = 0; j < slen; j++) s += String.fromCharCode(stringBlob[soff + j] || 0);
      }
      strings.push(s);
    }
    const out = [];
    for (let i = 0; i < texture.length; i++) {
      const base = texture.offset + i * 20;
      const stringId = view.getInt32(base, true);
      const width = view.getInt32(base + 8, true);
      const height = view.getInt32(base + 12, true);
      const scale = view.getFloat32(base + 16, true);
      const filename = String(strings[stringId] || '')
        .replace(/\\/g, '/')
        .split('/')
        .pop();
      if (!filename) continue;
      out.push({ filename, width, height, scale });
    }
    return out;
  } catch {
    return [];
  }
}

export async function fitSheetBlobToTextureSize(sourceUrl, wantW, wantH) {
  const w = Math.max(1, wantW | 0);
  const h = Math.max(1, wantH | 0);
  const img = await new Promise((resolve, reject) => {
    const el = new Image();
    const src = String(sourceUrl || '');
    if (/^https?:\/\//i.test(src) && !/^https?:\/\/(?:localhost|127\.0\.0\.1)[:/]/i.test(src)) {
      el.crossOrigin = 'anonymous';
    }
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try {
        el.src = '';
      } catch {

      }
      reject(new Error(`sheet load timeout for fit ${w}x${h}`));
    }, 8000);
    el.onload = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(el);
    };
    el.onerror = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error(`failed to decode sheet for fit ${w}x${h}`));
    };
    el.src = src;
  });
  const sw = img.naturalWidth;
  const sh = img.naturalHeight;

  if (sw === w && sh === h) {
    return { url: sourceUrl, fitted: false, mode: 'match', fromW: sw, fromH: sh };
  }

  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, w, h);
  let mode = 'stretch';

  if (sw === h && sh === w && w !== h) {
    mode = 'rotate90';
    ctx.translate(w / 2, h / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(img, -sw / 2, -sh / 2);
  } else {
    ctx.drawImage(img, 0, 0, w, h);
  }

  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('canvas.toBlob failed while fitting atlas');
  return {
    url: URL.createObjectURL(blob),
    fitted: true,
    mode,
    fromW: sw,
    fromH: sh,
  };
}

function sheetKey(name) {
  let key = String(name || '').replace(/\\/g, '/');
  while (key.startsWith('./')) key = key.slice(2);
  while (key.startsWith('../')) key = key.slice(3);
  while (key.startsWith('/')) key = key.slice(1);
  return (key.split('/').pop() || key).toLowerCase();
}

function abortableTimeout(ms) {
  if (typeof AbortController === 'undefined') return { signal: undefined, clear() {} };
  const ctrl = new AbortController();
  const timer = setTimeout(() => {
    try {
      ctrl.abort();
    } catch {

    }
  }, ms);
  return {
    signal: ctrl.signal,
    clear() {
      clearTimeout(timer);
    },
  };
}

export async function prefetchLwfSheetsToBlobs(lwfUrl, sheetUrlFor, opts = {}) {
  const log = opts.log || (() => {});
  const overrides = new Map();
  const blobUrls = [];
  const empty = {
    overrides,
    fitted: 0,
    revoke() {
      for (const url of blobUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {

        }
      }
      blobUrls.length = 0;
      overrides.clear();
    },
  };

  let bytes = opts.bytes || null;
  if (!bytes) {
    const lwfAbort = abortableTimeout(opts.lwfTimeoutMs || 12000);
    try {
      const res = await fetchFresh(
        lwfUrl,
        lwfAbort.signal ? { signal: lwfAbort.signal } : undefined,
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
    } catch (e) {
      log(`sheet prefetch: could not read LWF (${e.message || e})`);
      return empty;
    } finally {
      lwfAbort.clear();
    }
  } else if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes);
  }

  const textures = parseLwfTextures(bytes);
  const sheetTimeout = opts.sheetTimeoutMs || 8000;
  await Promise.all(
    textures.map(async (tex) => {
      const filename = String(tex.filename || '');
      if (!filename) return;
      if (/^card_\d+/i.test(filename)) return;
      const src = sheetUrlFor(filename);
      if (!src) return;
      const sheetAbort = abortableTimeout(sheetTimeout);
      try {
        const res = await fetchFresh(
          src,
          sheetAbort.signal ? { signal: sheetAbort.signal } : undefined,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const blob = await res.blob();
        if (!blob || blob.size < 8) throw new Error('empty sheet');
        const rawUrl = URL.createObjectURL(blob);
        let finalUrl = rawUrl;
        const wantW = Number(tex.width) || 0;
        const wantH = Number(tex.height) || 0;
        if (wantW >= 2 && wantH >= 2) {
          try {
            const fitted = await fitSheetBlobToTextureSize(rawUrl, wantW, wantH);
            if (fitted?.fitted && fitted.url) {
              finalUrl = fitted.url;
              try {
                URL.revokeObjectURL(rawUrl);
              } catch {

              }
            }
          } catch (fitErr) {
            log(`sheet fit fail ${filename}: ${fitErr.message || fitErr}`);
          }
        }
        overrides.set(sheetKey(filename), finalUrl);
        blobUrls.push(finalUrl);
      } catch (e) {
        log(`sheet prefetch fail ${filename}: ${e.message || e}`);
      } finally {
        sheetAbort.clear();
      }
    }),
  );

  log(`sheet prefetch ready · ${overrides.size}/${textures.length}`);
  return {
    overrides,
    fitted: overrides.size,
    revoke: empty.revoke,
  };
}

export async function prepareAtlasFitOverrides(lwfUrl, sheetUrlFor, opts = {}) {
  const log = opts.log || (() => {});
  const overrides = new Map();
  const blobUrls = [];
  let fitted = 0;

  if (opts.skip) {
    return { overrides, fitted: 0, revoke() {} };
  }

  if (
    opts.prefetchBlobs ||
    (typeof window !== 'undefined' && window.__ECLIPSE_TOOL__ === 'lua-player')
  ) {
    return prefetchLwfSheetsToBlobs(lwfUrl, sheetUrlFor, { log, ...opts });
  }

  let bytes = opts.bytes || null;
  if (!bytes) {
    try {
      const lwfAbort = abortableTimeout(12000);
      try {
        const res = await fetchFresh(
          lwfUrl,
          lwfAbort.signal ? { signal: lwfAbort.signal } : undefined,
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        bytes = new Uint8Array(await res.arrayBuffer());
      } finally {
        lwfAbort.clear();
      }
    } catch (e) {
      log(`atlas-fit: could not read LWF (${e.message || e})`);
      return { overrides, fitted: 0, revoke() {} };
    }
  } else if (!(bytes instanceof Uint8Array)) {
    bytes = new Uint8Array(bytes);
  }

  const textures = parseLwfTextures(bytes);
  for (const tex of textures) {
    if (tex.width < 2 || tex.height < 2) continue;
    if (tex.width <= 16 && tex.height <= 16) continue;

    if (/^card_\d+/i.test(String(tex.filename || ''))) continue;
    const src = sheetUrlFor(tex.filename);
    if (!src) continue;
    try {
      const result = await fitSheetBlobToTextureSize(src, tex.width, tex.height);
      if (!result.fitted) continue;
      overrides.set(sheetKey(tex.filename), result.url);
      blobUrls.push(result.url);
      fitted += 1;
      log(
        `atlas ${result.mode} ${tex.filename}: ${result.fromW}×${result.fromH} → ${tex.width}×${tex.height}`,
      );
    } catch (e) {
      log(`atlas fit failed ${tex.filename}: ${e.message || e}`);
    }
  }

  return {
    overrides,
    fitted,
    revoke() {
      for (const url of blobUrls) {
        try {
          URL.revokeObjectURL(url);
        } catch {

        }
      }
      blobUrls.length = 0;
      overrides.clear();
    },
  };
}

export async function fetchLwfBytes(lwfUrl, opts = {}) {
  const timeoutMs = opts.timeoutMs || 20000;
  const lwfAbort = abortableTimeout(timeoutMs);
  try {
    const res = await fetchFresh(
      lwfUrl,
      lwfAbort.signal ? { signal: lwfAbort.signal } : undefined,
    );
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    if (!buf || buf.byteLength < 8) {
      throw new Error(`LWF too small (${buf ? buf.byteLength : 0} bytes)`);
    }
    const bytes = new Uint8Array(buf);
    if (String.fromCharCode(bytes[0], bytes[1], bytes[2]) !== 'LWF') {
      throw new Error('Not an LWF file (bad magic)');
    }
    return bytes;
  } finally {
    lwfAbort.clear();
  }
}

export function lwfBytesToObjectUrl(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const copy = new Uint8Array(u8.byteLength);
  copy.set(u8);
  return URL.createObjectURL(new Blob([copy], { type: 'application/octet-stream' }));
}

export function wrapImageMapWithAtlasFit(innerMap, overrides) {
  return (name) => {
    const key = sheetKey(name);
    if (overrides?.has(key)) return overrides.get(key);
    if (!/\.(png|jpe?g|webp|gif)$/i.test(key)) {
      const withPng = `${key}.png`;
      if (overrides?.has(withPng)) return overrides.get(withPng);
    }
    if (typeof innerMap === 'function') return innerMap(name);
    return '';
  };
}
