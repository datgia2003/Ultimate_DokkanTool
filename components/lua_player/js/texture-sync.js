
function basename(path) {
  return String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop()
    .toLowerCase();
}

function cardArtSuffix(base) {
  const m = String(base || '')
    .toLowerCase()
    .match(/^card_\d+[_-]?(.*?)(?:\.png)?$/i);
  if (!m) return null;
  return String(m[1] || '')
    .replace(/^_+/, '')
    .replace(/\.png$/i, '')
    .replace(/_/g, '');
}

function stubKeyFromCardFilename(filename) {
  const base = basename(filename);
  if (!/^card_/.test(base)) return null;
  const s = base.replace(/^card_\d+[_-]?/i, '').replace(/\.png$/i, '');
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

function findImageCache(lwf) {
  const out = [];
  const push = (c) => {
    if (c && typeof c === 'object' && !out.includes(c)) out.push(c);
  };
  const factory = lwf?.rendererFactory;

  push(factory?.z$w);
  push(factory?.cache);
  push(lwf?.resourceCache?.z$w);
  push(lwf?.resourceCache?.cache);
  try {
    const rc = window.LWF?.ResourceCache?.get?.();
    push(rc?.z$w);
    push(rc?.cache);
  } catch {

  }
  return out;
}

function factoryImageCaches(factory) {
  const out = [];
  if (factory?.z$w && typeof factory.z$w === 'object') out.push(factory.z$w);
  if (factory?.cache && typeof factory.cache === 'object' && factory.cache !== factory.z$w) {
    out.push(factory.cache);
  }

  if (!out.length && factory) {
    for (const key of Object.keys(factory)) {
      const v = factory[key];
      if (!v || typeof v !== 'object' || Array.isArray(v)) continue;
      const vals = Object.values(v);
      if (vals.length && vals.some((x) => x && typeof x === 'object' && x.width > 0 && x.src != null)) {
        out.push(v);
      }
    }
  }
  return out;
}

function lookupImage(caches, filename) {
  if (!filename) return null;
  const base = basename(filename);
  const baseNoExt = base.replace(/\.(png|jpe?g|webp|gif)$/i, '');
  const usable = (img) => img?.width > 16 && img?.height > 16;
  for (const cache of caches) {
    if (usable(cache[filename])) return cache[filename];
    if (usable(cache[base])) return cache[base];
    if (usable(cache[baseNoExt])) return cache[baseNoExt];
    for (const [k, v] of Object.entries(cache)) {
      if (!usable(v)) continue;
      const kb = basename(k);
      if (kb === base || kb === baseNoExt) return v;
      if (kb.replace(/\.(png|jpe?g|webp|gif)$/i, '') === baseNoExt) return v;
    }
  }

  const want = cardArtSuffix(base);
  if (want != null) {
    for (const cache of caches) {
      for (const [k, v] of Object.entries(cache)) {
        if (!usable(v)) continue;
        const kb = basename(k);
        if (!/^card_\d+/i.test(kb)) continue;
        if (cardArtSuffix(kb) === want) return v;
      }
    }
    if (want === 'character' || want === '') {
      for (const cache of caches) {
        for (const [k, v] of Object.entries(cache)) {
          if (!usable(v)) continue;
          if (/card_\d+_character\.png$/i.test(basename(k))) return v;
        }
      }
    }
  }
  return null;
}

function scaleFragment(f, sx, sy) {
  if (f.u != null) f.u *= sx;
  if (f.v != null) f.v *= sy;
  if (f.w != null) f.w *= sx;
  if (f.h != null) f.h *= sy;
  if (f.x != null) f.x *= sx;
  if (f.y != null) f.y *= sy;
  if (f.ow != null) f.ow *= sx;
  if (f.oh != null) f.oh *= sy;

  if (f.z$R != null) f.z$R *= sx;
  if (f.z$S != null) f.z$S *= sy;
  if (f.z$q != null) f.z$q *= sx;
  if (f.z$k != null) f.z$k *= sy;
  if (f.z$hk != null) f.z$hk *= sx;
  if (f.z$dk != null) f.z$dk *= sy;
}

function ctxFragment(ctx) {
  return ctx?.fragment || ctx?.z$P || null;
}

function ctxImage(ctx) {
  return ctx?.image || ctx?.z$Ha || null;
}

function setCtxImage(ctx, img) {
  if (!ctx || !img) return;
  if ('image' in ctx || ctx.image !== undefined) ctx.image = img;
  if ('z$Ha' in ctx || ctx.z$Ha !== undefined) ctx.z$Ha = img;

  ctx.image = img;
  ctx.z$Ha = img;
}

function fragTextureId(fragment) {
  if (!fragment) return null;
  return fragment.textureId ?? fragment.z$oe ?? null;
}

function fragUVWH(fragment) {
  return {
    x: Number(fragment.x) || 0,
    y: Number(fragment.y) || 0,
    u: Number(fragment.u ?? fragment.z$R) || 0,
    v: Number(fragment.v ?? fragment.z$S) || 0,
    w: Number(fragment.w ?? fragment.z$q) || 0,
    h: Number(fragment.h ?? fragment.z$k) || 0,
    rotated: !!(fragment.rotated ?? fragment.z$fb),
  };
}

function refreshBitmapContext(ctx, data) {
  const fragment = ctxFragment(ctx);
  const image = ctxImage(ctx);
  if (!fragment || !image) return;
  const tid = fragTextureId(fragment);
  const texture = tid != null ? data.textures?.[tid] : null;
  if (!texture) return;
  const imageWidth = image.width || 0;
  if (imageWidth < 1 || !(texture.width > 0)) return;

  let withPadding = /_withpadding/i.test(String(texture.filename || ''));
  let usableW = withPadding ? Math.max(1, imageWidth - 2) : imageWidth;
  const imageScale = usableW / texture.width;
  const texScale = Number(texture.scale) > 0 ? Number(texture.scale) : 1;
  ctx.scale = 1 / (texScale * imageScale);

  let { x, y, u, v, w, h, rotated } = fragUVWH(fragment);
  if (withPadding) {
    x -= 1;
    y -= 1;
    w += 2;
    h += 2;
  }
  const rx = Math.round(x * imageScale);
  const ry = Math.round(y * imageScale);
  let ru = Math.round(u * imageScale);
  let rv = Math.round(v * imageScale);
  let rw = Math.round((rotated ? h : w) * imageScale);
  let rh = Math.round((rotated ? w : h) * imageScale);

  if (ru + rw > image.width) rw = image.width - ru;
  if (rv + rh > image.height) rh = image.height - rv;

  ctx.x = rx;
  ctx.y = ry;
  ctx.u = ru;
  ctx.v = rv;
  ctx.w = rw;
  ctx.h = rh;
  ctx.z$R = ru;
  ctx.z$S = rv;
  ctx.z$q = rw;
  ctx.z$k = rh;
  ctx.imageHeight = h * imageScale;
  ctx.z$Pn = h * imageScale;
}

function collectBitmapContexts(factory) {
  const out = [];
  if (!factory) return out;
  const seen = new Set();
  const pushCtx = (c) => {
    if (!c || seen.has(c)) return;

    const ctx = ctxFragment(c) ? c : c.context || c.z$b || c;
    if (!ctxFragment(ctx)) return;
    seen.add(c);
    if (ctx !== c) seen.add(ctx);
    out.push(ctx);
  };
  for (const listName of ['bitmapContexts', 'bitmapExContexts', 'z$4a', 'z$5a']) {
    const list = factory[listName];
    if (Array.isArray(list)) list.forEach(pushCtx);
  }
  for (const key of Object.keys(factory)) {
    const list = factory[key];
    if (!Array.isArray(list) || list.length < 1) continue;
    let hits = 0;
    for (let i = 0; i < Math.min(list.length, 8); i++) {
      const c = list[i];
      if (ctxFragment(c) || ctxFragment(c?.context) || ctxFragment(c?.z$b)) hits += 1;
    }
    if (hits >= 2 || (hits === 1 && list.length === 1)) list.forEach(pushCtx);
  }
  return out;
}

function refreshContextsForTextureIds(lwf, texIds) {
  if (!texIds?.size) return 0;
  const factory = lwf?.rendererFactory;
  const data = lwf?.data;
  if (!factory || !data) return 0;
  const caches = factoryImageCaches(factory);
  let n = 0;
  const all = collectBitmapContexts(factory);
  for (const c of all) {
    const fragment = ctxFragment(c);
    const tid = fragTextureId(fragment);
    if (tid == null || !texIds.has(tid)) continue;
    const tex = data.textures?.[tid];
    if (tex) {
      const img = lookupImage(caches, tex.filename);
      if (img?.width) {
        setCtxImage(c, img);

        if (c.pattern != null) c.pattern = null;
      }
    }
    refreshBitmapContext(c, data);
    n += 1;
  }
  return n;
}

export function syncTextureMetricsToImages(lwf, log = () => {}) {
  const textures = lwf?.data?.textures;
  if (!Array.isArray(textures)) return 0;
  const frags = lwf?.data?.textureFragments || [];
  const caches = findImageCache(lwf);
  const touched = new Set();
  let fixed = 0;

  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    const oldW = Number(tex.width) || 0;
    const oldH = Number(tex.height) || 0;
    const fname = basename(tex.filename);
    const isStub = oldW <= 16 || oldH <= 16;
    const isCard = /^card_\d+/i.test(fname);
    if (!isStub && !isCard) continue;

    const img = lookupImage(caches, tex.filename);
    if (!img?.width || !img?.height) {
      if (isCard) log(`  stub sync miss ${fname} (no image in factory cache)`);
      continue;
    }
    const nw = (img.naturalWidth || img.width) | 0;
    const nh = (img.naturalHeight || img.height) | 0;
    if (nw <= 16 || nh <= 16) {
      if (isCard) log(`  stub sync skip ${fname}: image still ${nw}x${nh} (unmapped stub)`);
      continue;
    }
    if (nw < 2 || nh < 2) continue;

    const stubKey = stubKeyFromCardFilename(fname);
    if (
      isCard &&
      (stubKey === 'character' || stubKey === 'effect') &&
      oldW >= 256 &&
      oldH >= 256 &&
      (nw < oldW || nh < oldH)
    ) {
      log(`  stub sync keep ${fname}: layout ${oldW}x${oldH} (img ${nw}x${nh})`);
      touched.add(i);
      continue;
    }

    if (nw === oldW && nh === oldH) {
      if (isCard && nw > 16) touched.add(i);
      continue;
    }

    const sx = oldW > 0 ? nw / oldW : 1;
    const sy = oldH > 0 ? nh / oldH : 1;
    tex.width = nw;
    tex.height = nh;
    for (const f of frags) {
      const tid = f.textureId ?? f.texId ?? f.texture ?? f.z$oe;
      if (tid !== i && tid !== tex) continue;
      scaleFragment(f, sx, sy);
    }
    touched.add(i);
    fixed += 1;
    log(`  stub sync ${fname}: ${oldW}x${oldH} → ${nw}x${nh}`);
  }

  const rebound = refreshContextsForTextureIds(lwf, touched);
  if (fixed || rebound) {
    log(`  stub sync done fixed=${fixed} contexts=${rebound}`);
  }
  return fixed;
}

export function repairCardTextureMetrics(lwfInstance, log = () => {}) {
  return syncTextureMetricsToImages(lwfInstance, log);
}

function fitImageToTextureSize(img, tw, th) {
  const iw = img.naturalWidth || img.width || 0;
  const ih = img.naturalHeight || img.height || 0;
  if (iw < 2 || ih < 2 || tw < 2 || th < 2) return img;
  if (iw === tw && ih === th) return img;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) return img;
    ctx.clearRect(0, 0, tw, th);
    const scale = Math.max(tw / iw, th / ih);
    const nw = Math.max(1, Math.round(iw * scale));
    const nh = Math.max(1, Math.round(ih * scale));
    ctx.drawImage(img, ((tw - nw) / 2) | 0, ((th - nh) / 2) | 0, nw, nh);
    return canvas;
  } catch {
    return img;
  }
}

function loadHtmlImage(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`image load failed: ${url}`));
    img.src = url;
  });
}

function imageOpaqueRatio(img) {
  const w = img.naturalWidth || img.width || 0;
  const h = img.naturalHeight || img.height || 0;
  if (w < 2 || h < 2) return 0;
  try {
    const c = document.createElement('canvas');
    const tw = Math.min(64, w);
    const th = Math.min(64, h);
    c.width = tw;
    c.height = th;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    if (!ctx) return 1;
    ctx.drawImage(img, 0, 0, tw, th);
    const data = ctx.getImageData(0, 0, tw, th).data;
    let opaque = 0;
    for (let i = 3; i < data.length; i += 4) {
      if (data[i] > 12) opaque += 1;
    }
    return opaque / (tw * th);
  } catch {
    return 1;
  }
}

export async function preloadPatchedCardImages(patchedTextures, log = () => {}) {
  const out = new Map();
  if (!patchedTextures || typeof patchedTextures !== 'object') return out;
  await Promise.all(
    Object.entries(patchedTextures).map(async ([kind, meta]) => {
      const url = meta?.url;
      if (!url) return;
      try {
        const img = await loadHtmlImage(url);
        const ratio = imageOpaqueRatio(img);

        const minRatio = kind === 'character' ? 0.005 : 0.02;
        if (ratio < minRatio) {
          log(`  card preload hollow ${kind}: ${(ratio * 100).toFixed(1)}% opaque ← ${url}`);
          return;
        }
        out.set(kind, img);
        log(
          `  card preload ${kind}: ${img.naturalWidth || img.width}x${img.naturalHeight || img.height}` +
            ` opaque=${(ratio * 100).toFixed(0)}% ← ${String(url).split('?')[0]}`,
        );
      } catch (e) {
        log(`  card preload fail ${kind}: ${e.message || e}`);
      }
    }),
  );
  return out;
}

export function applyPreloadedCardImages(lwf, preloaded, log = () => {}) {
  if (!preloaded?.size) return 0;
  const textures = lwf?.data?.textures;
  if (!Array.isArray(textures)) return 0;
  const factory = lwf?.rendererFactory;
  const caches = factoryImageCaches(factory);
  if (!caches.length) {
    log('  card inject: no factory image cache (z$w/cache)');
    return 0;
  }

  const touched = new Set();
  let n = 0;
  for (let i = 0; i < textures.length; i++) {
    const tex = textures[i];
    const fname = basename(tex.filename);
    const stub = stubKeyFromCardFilename(fname);
    if (!stub) continue;
    let img = preloaded.get(stub);
    if (!img && stub === 'character' && !preloaded.has('effect')) {
      img = preloaded.get('sp_cutin') || preloaded.get('cutin');
    }
    if (!img && (stub === 'sp_cutin' || stub === 'cutin')) {
      img = preloaded.get('sp_cutin') || preloaded.get('cutin') || preloaded.get('character');
    }
    if (!img) continue;
    const stubW = Number(tex.width) || 0;
    const stubH = Number(tex.height) || 0;
    if (
      (stub === 'character' || stub === 'effect') &&
      stubW >= 256 &&
      stubH >= 256
    ) {
      const fitted = fitImageToTextureSize(img, stubW, stubH);
      if (fitted !== img) {
        log(
          `  card fit ${fname}: ${img.naturalWidth || img.width}x${img.naturalHeight || img.height}` +
            ` → ${stubW}x${stubH}`,
        );
        img = fitted;
      }
    }
    let prevRatio = 0;
    for (const cache of caches) {
      const prev = cache[tex.filename] || cache[fname];
      if (prev) prevRatio = Math.max(prevRatio, imageOpaqueRatio(prev));
      cache[tex.filename] = img;
      cache[fname] = img;
      if (tex.filename && tex.filename !== fname) cache[String(tex.filename)] = img;
    }
    touched.add(i);
    n += 1;
    const dw = img.naturalWidth || img.width || 0;
    const dh = img.naturalHeight || img.height || 0;
    log(
      `  card inject ${fname} ← ${stub}` +
        ` ${dw}x${dh}` +
        ` caches=${caches.length}` +
        (prevRatio < 0.02 ? ' (replaced hollow stub)' : ''),
    );
  }
  if (touched.size) {

    const fixed = syncTextureMetricsToImages(lwf, log);

    const rebound = refreshContextsForTextureIds(lwf, touched);
    const totalCtx = collectBitmapContexts(factory).length;
    log(
      `  card inject rebound contexts=${rebound}/${totalCtx} metricFixes=${fixed}` +
        ` (z$Ha/z$P)`,
    );
  }
  return n;
}
