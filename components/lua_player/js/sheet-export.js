
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

const MATRIX_FLAG = 0x80000000;
const COLORTRANSFORM_FLAG = 0x80000000;
const OBJ_BITMAP = 3;
const OBJ_BITMAPEX = 4;

const IDENTITY_MATRIX = Object.freeze({
  scaleX: 1,
  scaleY: 1,
  skew0: 0,
  skew1: 0,
  translateX: 0,
  translateY: 0,
});

const IDENTITY_COLOR = Object.freeze({
  multi: Object.freeze({ red: 1, green: 1, blue: 1, alpha: 1 }),
  add: Object.freeze({ red: 0, green: 0, blue: 0, alpha: 0 }),
});

function crc32(u8) {
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = CRC_TABLE[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u16(n) {
  const b = new Uint8Array(2);
  new DataView(b.buffer).setUint16(0, n, true);
  return b;
}

function u32(n) {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n >>> 0, true);
  return b;
}

function encPath(path) {
  return new TextEncoder().encode(String(path).replace(/\\/g, '/'));
}

export function zipStore(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const f of files) {
    const name = encPath(f.path);
    const data = f.data instanceof Uint8Array ? f.data : new Uint8Array(f.data);
    const crc = crc32(data);
    const local = new Uint8Array(30 + name.length + data.length);
    local.set([0x50, 0x4b, 0x03, 0x04], 0);
    local.set(u16(20), 4);
    local.set(u16(0), 6);
    local.set(u16(0), 8);
    local.set(u16(0), 10);
    local.set(u16(0), 12);
    local.set(u32(crc), 14);
    local.set(u32(data.length), 18);
    local.set(u32(data.length), 22);
    local.set(u16(name.length), 26);
    local.set(u16(0), 28);
    local.set(name, 30);
    local.set(data, 30 + name.length);
    locals.push(local);

    const cen = new Uint8Array(46 + name.length);
    cen.set([0x50, 0x4b, 0x01, 0x02], 0);
    cen.set(u16(20), 4);
    cen.set(u16(20), 6);
    cen.set(u16(0), 8);
    cen.set(u16(0), 10);
    cen.set(u16(0), 12);
    cen.set(u16(0), 14);
    cen.set(u32(crc), 16);
    cen.set(u32(data.length), 20);
    cen.set(u32(data.length), 24);
    cen.set(u16(name.length), 28);
    cen.set(u16(0), 30);
    cen.set(u16(0), 32);
    cen.set(u16(0), 34);
    cen.set(u16(0), 36);
    cen.set(u32(0), 38);
    cen.set(u32(offset), 42);
    cen.set(name, 46);
    central.push(cen);
    offset += local.length;
  }
  const cenSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array(22);
  end.set([0x50, 0x4b, 0x05, 0x06], 0);
  end.set(u16(0), 4);
  end.set(u16(0), 6);
  end.set(u16(files.length), 8);
  end.set(u16(files.length), 10);
  end.set(u32(cenSize), 12);
  end.set(u32(offset), 16);
  end.set(u16(0), 20);

  const total = locals.reduce((s, l) => s + l.length, 0) + cenSize + end.length;
  const out = new Uint8Array(total);
  let o = 0;
  for (const l of locals) {
    out.set(l, o);
    o += l.length;
  }
  for (const c of central) {
    out.set(c, o);
    o += c.length;
  }
  out.set(end, o);
  return new Blob([out], { type: 'application/zip' });
}

function readStrings(u8, view, stringBytes, stringData) {
  const stringBlob = u8.subarray(
    stringBytes.offset,
    stringBytes.offset + stringBytes.length,
  );
  const strings = [];
  for (let i = 0; i < stringData.length; i++) {
    const soff = view.getInt32(stringData.offset + i * 8, true);
    const slen = view.getInt32(stringData.offset + i * 8 + 4, true);
    let s = '';
    for (let j = 0; j < slen; j++) s += String.fromCharCode(stringBlob[soff + j] || 0);
    strings.push(s);
  }
  return strings;
}

function leafName(s) {
  return String(s || '')
    .replace(/\\/g, '/')
    .split('/')
    .pop();
}

export function parseLwfTextures(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 324 || String.fromCharCode(u8[0], u8[1], u8[2]) !== 'LWF') {
    return {
      textures: [],
      fragments: [],
      strings: [],
      matrices: [],
      translates: [],
      colorTransforms: [],
      bitmaps: [],
      bitmapExs: [],
      objects: [],
      places: [],
      placeStates: [],
    };
  }
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const formatVersion = (u8[4] << 16) | (u8[5] << 8) | u8[6];
  const hasMcb = formatVersion >= 0x141211;
  const nItems = hasMcb ? 37 : 36;
  const item = (i) => ({
    offset: view.getInt32(32 + i * 8, true),
    length: view.getInt32(32 + i * 8 + 4, true),
  });

  const stringBytes = item(0);
  const translate = item(2);
  const matrix = item(3);
  const colorTransform = item(6);
  const objectData = item(7);
  const texture = item(8);
  const textureFragment = item(9);
  const bitmap = item(10);
  const bitmapEx = item(11);
  const place = item(26);
  const controlMoveM = item(27);
  const controlMoveC = item(28);
  const controlMoveMC = item(29);
  const controlMoveMCB = hasMcb ? item(30) : { offset: 0, length: 0 };
  const stringData = item(nItems - 1);

  const strings = readStrings(u8, view, stringBytes, stringData);

  const translates = [];
  for (let i = 0; i < translate.length; i++) {
    const base = translate.offset + i * 8;
    translates.push({
      translateX: view.getFloat32(base, true),
      translateY: view.getFloat32(base + 4, true),
    });
  }

  const matrices = [];
  for (let i = 0; i < matrix.length; i++) {
    const base = matrix.offset + i * 24;
    matrices.push({
      scaleX: view.getFloat32(base, true),
      scaleY: view.getFloat32(base + 4, true),
      skew0: view.getFloat32(base + 8, true),
      skew1: view.getFloat32(base + 12, true),
      translateX: view.getFloat32(base + 16, true),
      translateY: view.getFloat32(base + 20, true),
    });
  }

  const colorTransforms = [];
  for (let i = 0; i < colorTransform.length; i++) {
    const base = colorTransform.offset + i * 32;
    colorTransforms.push({
      multi: {
        red: view.getFloat32(base, true),
        green: view.getFloat32(base + 4, true),
        blue: view.getFloat32(base + 8, true),
        alpha: view.getFloat32(base + 12, true),
      },
      add: {
        red: view.getFloat32(base + 16, true),
        green: view.getFloat32(base + 20, true),
        blue: view.getFloat32(base + 24, true),
        alpha: view.getFloat32(base + 28, true),
      },
    });
  }

  const objects = [];
  for (let i = 0; i < objectData.length; i++) {
    const base = objectData.offset + i * 8;
    objects.push({
      objectType: view.getInt32(base, true),
      objectId: view.getInt32(base + 4, true),
    });
  }

  const textures = [];
  for (let i = 0; i < texture.length; i++) {
    const base = texture.offset + i * 20;
    const stringId = view.getInt32(base, true);
    const width = view.getInt32(base + 8, true);
    const height = view.getInt32(base + 12, true);
    const scale = view.getFloat32(base + 16, true);
    const filename = leafName(strings[stringId] || '');
    if (!filename) continue;
    textures.push({ filename, width, height, scale, index: i });
  }

  const bitmapItem = item(10);
  const fragBytes =
    bitmapItem.offset > textureFragment.offset
      ? bitmapItem.offset - textureFragment.offset
      : 0;
  const impliedFrag =
    textureFragment.length > 0 ? fragBytes / textureFragment.length : 0;
  const fragSize = impliedFrag >= 40 ? 44 : hasMcb ? 44 : 36;
  const fragments = [];
  if (textureFragment.length > 0 && textureFragment.offset >= 0) {
    for (let i = 0; i < textureFragment.length; i++) {
      const base = textureFragment.offset + i * fragSize;
      if (base + fragSize > u8.length) break;
      const stringId = view.getInt32(base, true);
      const textureId = view.getInt32(base + 4, true);
      const rotated = view.getInt32(base + 8, true);
      const x = view.getInt32(base + 12, true);
      const y = view.getInt32(base + 16, true);
      const u = view.getInt32(base + 20, true);
      const v = view.getInt32(base + 24, true);
      const w = view.getInt32(base + 28, true);
      const h = view.getInt32(base + 32, true);
      const ow = hasMcb ? view.getInt32(base + 36, true) : w;
      const oh = hasMcb ? view.getInt32(base + 40, true) : h;
      const raw = String(strings[stringId] || `frag_${i}`);
      const name = leafName(raw) || `frag_${i}`;
      fragments.push({
        name,
        rawName: raw,
        textureId,
        rotated: !!rotated,
        x,
        y,
        u,
        v,
        w,
        h,
        ow,
        oh,
      });
    }
  }

  const bitmaps = [];
  for (let i = 0; i < bitmap.length; i++) {
    const base = bitmap.offset + i * 8;
    bitmaps.push({
      matrixId: view.getInt32(base, true),
      textureFragmentId: view.getInt32(base + 4, true),
    });
  }

  const bitmapExs = [];
  for (let i = 0; i < bitmapEx.length; i++) {
    const base = bitmapEx.offset + i * 28;
    bitmapExs.push({
      matrixId: view.getInt32(base, true),
      textureFragmentId: view.getInt32(base + 4, true),
      attribute: view.getInt32(base + 8, true),
      u: view.getFloat32(base + 12, true),
      v: view.getFloat32(base + 16, true),
      w: view.getFloat32(base + 20, true),
      h: view.getFloat32(base + 24, true),
    });
  }

  const control = hasMcb ? item(31) : item(30);
  const frame = hasMcb ? item(32) : item(31);

  const places = [];
  for (let i = 0; i < place.length; i++) {
    const base = place.offset + i * 16;
    let depth = view.getInt32(base, true);
    const blendMode = (depth >>> 24) & 0xff;
    depth &= 0xffffff;
    places.push({
      depth,
      blendMode,
      objectId: view.getInt32(base + 4, true),
      instanceId: view.getInt32(base + 8, true),
      matrixId: view.getInt32(base + 12, true),
    });
  }

  const controlMoveMs = [];
  for (let i = 0; i < controlMoveM.length; i++) {
    const base = controlMoveM.offset + i * 8;
    controlMoveMs.push({
      placeId: view.getInt32(base, true),
      matrixId: view.getInt32(base + 4, true),
    });
  }
  const controlMoveCs = [];
  for (let i = 0; i < controlMoveC.length; i++) {
    const base = controlMoveC.offset + i * 8;
    controlMoveCs.push({
      placeId: view.getInt32(base, true),
      colorTransformId: view.getInt32(base + 4, true),
    });
  }
  const controlMoveMCs = [];
  for (let i = 0; i < controlMoveMC.length; i++) {
    const base = controlMoveMC.offset + i * 12;
    controlMoveMCs.push({
      placeId: view.getInt32(base, true),
      matrixId: view.getInt32(base + 4, true),
      colorTransformId: view.getInt32(base + 8, true),
    });
  }
  const controlMoveMCBs = [];
  for (let i = 0; i < controlMoveMCB.length; i++) {
    const base = controlMoveMCB.offset + i * 16;
    controlMoveMCBs.push({
      placeId: view.getInt32(base, true),
      matrixId: view.getInt32(base + 4, true),
      colorTransformId: view.getInt32(base + 8, true),
      blendMode: view.getInt32(base + 12, true),
    });
  }

  const controls = [];
  for (let i = 0; i < control.length; i++) {
    const base = control.offset + i * 8;
    controls.push({
      controlType: view.getInt32(base, true),
      controlId: view.getInt32(base + 4, true),
    });
  }
  const frames = [];
  for (let i = 0; i < frame.length; i++) {
    const base = frame.offset + i * 8;
    frames.push({
      controlOffset: view.getInt32(base, true),
      controls: view.getInt32(base + 4, true),
    });
  }

  const placeStates = places.map((p) => ({
    matrixId: p.matrixId | 0,
    colorTransformId: 0,
    keys: [{ matrixId: p.matrixId | 0, colorTransformId: 0 }],
  }));
  const applyCtrl = (ctrl) => {
    const t = ctrl.controlType | 0;
    const id = ctrl.controlId | 0;
    if (t === 1) {
      const m = controlMoveMs[id];
      if (!m || !placeStates[m.placeId]) return;
      const st = placeStates[m.placeId];
      st.matrixId = m.matrixId;
      st.keys.push({ matrixId: st.matrixId, colorTransformId: st.colorTransformId });
    } else if (t === 2) {
      const m = controlMoveCs[id];
      if (!m || !placeStates[m.placeId]) return;
      const st = placeStates[m.placeId];
      st.colorTransformId = m.colorTransformId;
      st.keys.push({ matrixId: st.matrixId, colorTransformId: st.colorTransformId });
    } else if (t === 3) {
      const m = controlMoveMCs[id];
      if (!m || !placeStates[m.placeId]) return;
      const st = placeStates[m.placeId];
      st.matrixId = m.matrixId;
      st.colorTransformId = m.colorTransformId;
      st.keys.push({ matrixId: st.matrixId, colorTransformId: st.colorTransformId });
    } else if (t === 5) {
      const m = controlMoveMCBs[id];
      if (!m || !placeStates[m.placeId]) return;
      const st = placeStates[m.placeId];
      st.matrixId = m.matrixId;
      st.colorTransformId = m.colorTransformId;
      st.keys.push({ matrixId: st.matrixId, colorTransformId: st.colorTransformId });
    }
  };
  for (const fr of frames) {
    for (let i = 0; i < fr.controls; i++) {
      const ctrl = controls[fr.controlOffset + i];
      if (ctrl) applyCtrl(ctrl);
    }
  }

  return {
    textures,
    fragments,
    strings,
    matrices,
    translates,
    colorTransforms,
    bitmaps,
    bitmapExs,
    objects,
    places,
    placeStates,
  };
}

function resolveMatrix(matrixId, matrices, translates) {
  const id = matrixId | 0;
  if (id & MATRIX_FLAG) {
    const t = translates[id & ~MATRIX_FLAG];
    if (!t) return { ...IDENTITY_MATRIX };
    return {
      ...IDENTITY_MATRIX,
      translateX: t.translateX,
      translateY: t.translateY,
    };
  }
  return matrices[id] ? { ...matrices[id] } : { ...IDENTITY_MATRIX };
}

function resolveColor(colorId, colorTransforms) {
  const id = colorId | 0;
  if (id & COLORTRANSFORM_FLAG) {

    return {
      multi: { ...IDENTITY_COLOR.multi },
      add: { ...IDENTITY_COLOR.add },
    };
  }
  const c = colorTransforms[id];
  if (!c) {
    return {
      multi: { ...IDENTITY_COLOR.multi },
      add: { ...IDENTITY_COLOR.add },
    };
  }
  return {
    multi: { ...c.multi },
    add: { ...c.add },
  };
}

function mulMatrix(a, b) {
  return {
    scaleX: a.scaleX * b.scaleX + a.skew0 * b.skew1,
    skew0: a.scaleX * b.skew0 + a.skew0 * b.scaleY,
    translateX: a.scaleX * b.translateX + a.skew0 * b.translateY + a.translateX,
    skew1: a.skew1 * b.scaleX + a.scaleY * b.skew1,
    scaleY: a.skew1 * b.skew0 + a.scaleY * b.scaleY,
    translateY: a.skew1 * b.translateX + a.scaleY * b.translateY + a.translateY,
  };
}

function mulColor(parent, child) {
  return {
    multi: {
      red: parent.multi.red * child.multi.red,
      green: parent.multi.green * child.multi.green,
      blue: parent.multi.blue * child.multi.blue,
      alpha: parent.multi.alpha * child.multi.alpha,
    },
    add: {
      red: parent.add.red * child.multi.red + child.add.red,
      green: parent.add.green * child.multi.green + child.add.green,
      blue: parent.add.blue * child.multi.blue + child.add.blue,
      alpha: parent.add.alpha * child.multi.alpha + child.add.alpha,
    },
  };
}

function round4(n) {
  return Math.round(Number(n) * 10000) / 10000;
}

function transformKey(matrix, color) {
  return [
    round4(matrix.scaleX),
    round4(matrix.scaleY),
    round4(matrix.skew0),
    round4(matrix.skew1),
    round4(color.multi.red),
    round4(color.multi.green),
    round4(color.multi.blue),
    round4(color.multi.alpha),
    round4(color.add.red),
    round4(color.add.green),
    round4(color.add.blue),
    round4(color.add.alpha),
  ].join(',');
}

function isIdentityTransform(matrix, color) {
  return (
    round4(matrix.scaleX) === 1 &&
    round4(matrix.scaleY) === 1 &&
    round4(matrix.skew0) === 0 &&
    round4(matrix.skew1) === 0 &&
    round4(color.multi.red) === 1 &&
    round4(color.multi.green) === 1 &&
    round4(color.multi.blue) === 1 &&
    round4(color.multi.alpha) === 1 &&
    round4(color.add.red) === 0 &&
    round4(color.add.green) === 0 &&
    round4(color.add.blue) === 0 &&
    round4(color.add.alpha) === 0
  );
}

function shortHash(key) {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

function collectFragmentTransforms(parsed) {
  const {
    matrices,
    translates,
    colorTransforms,
    bitmaps,
    bitmapExs,
    objects,
    places,
    placeStates,
  } = parsed;

  const byFrag = new Map();

  const add = (fragId, matrix, color) => {
    if (fragId == null || fragId < 0) return;
    if (isIdentityTransform(matrix, color)) return;
    const key = transformKey(matrix, color);
    let map = byFrag.get(fragId);
    if (!map) {
      map = new Map();
      byFrag.set(fragId, map);
    }
    if (!map.has(key)) map.set(key, { matrix, color, key });
  };

  const bmpMatrixOf = (bmp) => resolveMatrix(bmp.matrixId, matrices, translates);

  for (const bmp of bitmaps) {
    add(bmp.textureFragmentId, bmpMatrixOf(bmp), {
      multi: { ...IDENTITY_COLOR.multi },
      add: { ...IDENTITY_COLOR.add },
    });
  }
  for (const bmp of bitmapExs) {
    add(bmp.textureFragmentId, bmpMatrixOf(bmp), {
      multi: { ...IDENTITY_COLOR.multi },
      add: { ...IDENTITY_COLOR.add },
    });
  }

  for (let placeId = 0; placeId < places.length; placeId++) {
    const place = places[placeId];
    const obj = objects[place.objectId];
    if (!obj) continue;
    let bmp = null;
    if (obj.objectType === OBJ_BITMAP) bmp = bitmaps[obj.objectId];
    else if (obj.objectType === OBJ_BITMAPEX) bmp = bitmapExs[obj.objectId];
    if (!bmp) continue;

    const local = bmpMatrixOf(bmp);
    const keys = placeStates[placeId]?.keys || [
      { matrixId: place.matrixId, colorTransformId: 0 },
    ];
    for (const k of keys) {
      const placeM = resolveMatrix(k.matrixId, matrices, translates);
      const placeC = resolveColor(k.colorTransformId, colorTransforms);

      add(bmp.textureFragmentId, mulMatrix(placeM, local), placeC);
    }
  }

  return byFrag;
}

function loadImage(url) {
  return new Promise((resolve, reject) => {
    const el = new Image();
    el.crossOrigin = 'anonymous';
    el.onload = () => resolve(el);
    el.onerror = () => reject(new Error(`decode failed: ${String(url).slice(0, 80)}`));
    el.src = url;
  });
}

async function canvasToPngBytes(canvas) {
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('toBlob failed');
  return new Uint8Array(await blob.arrayBuffer());
}

export async function fitImageToSize(img, wantW, wantH) {
  const w = Math.max(1, wantW | 0);
  const h = Math.max(1, wantH | 0);
  const sw = img.naturalWidth || img.width;
  const sh = img.naturalHeight || img.height;
  if (sw === w && sh === h) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    c.getContext('2d').drawImage(img, 0, 0);
    return { canvas: c, fitted: false, mode: 'match', fromW: sw, fromH: sh };
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
  return { canvas: c, fitted: true, mode, fromW: sw, fromH: sh };
}

function safeName(name, fallback) {
  let s = String(name || fallback || 'unnamed')
    .replace(/[<>:"/\\|?*\x00-\x1f]/g, '_')
    .replace(/^\.+/, '_');
  if (!/\.(png|jpe?g|webp|gif)$/i.test(s)) s += '.png';
  return s;
}

function stemOf(filename) {
  return String(filename || 'img').replace(/\.(png|jpe?g|webp|gif)$/i, '');
}

function trimLargestOpaque(canvas, { alphaMin = 10 } = {}) {
  const w = canvas.width | 0;
  const h = canvas.height | 0;
  if (w < 2 || h < 2) return canvas;
  const ctx = canvas.getContext('2d');
  const img = ctx.getImageData(0, 0, w, h);
  const d = img.data;
  const seen = new Uint8Array(w * h);
  const at = (x, y) => y * w + x;

  let bestMask = null;
  let bestCount = 0;
  let bestBox = null;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const start = at(x, y);
      if (seen[start]) continue;
      if (d[start * 4 + 3] < alphaMin) {
        seen[start] = 1;
        continue;
      }
      let count = 0;
      let minx = x;
      let miny = y;
      let maxx = x;
      let maxy = y;
      const stack = [start];
      const pixels = [];
      seen[start] = 1;
      while (stack.length) {
        const p = stack.pop();
        pixels.push(p);
        const px = p % w;
        const py = (p / w) | 0;
        count += 1;
        if (px < minx) minx = px;
        if (py < miny) miny = py;
        if (px > maxx) maxx = px;
        if (py > maxy) maxy = py;
        for (const [dx, dy] of [
          [1, 0],
          [-1, 0],
          [0, 1],
          [0, -1],
        ]) {
          const nx = px + dx;
          const ny = py + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const n = at(nx, ny);
          if (seen[n]) continue;
          seen[n] = 1;
          if (d[n * 4 + 3] >= alphaMin) stack.push(n);
        }
      }
      if (count > bestCount) {
        bestCount = count;
        bestMask = pixels;
        bestBox = { minx, miny, maxx, maxy };
      }
    }
  }
  if (!bestMask || !bestBox || bestCount < 8) return canvas;

  const tw = bestBox.maxx - bestBox.minx + 1;
  const th = bestBox.maxy - bestBox.miny + 1;

  const out = document.createElement('canvas');
  out.width = tw;
  out.height = th;
  const outCtx = out.getContext('2d');
  const outImg = outCtx.createImageData(tw, th);
  const od = outImg.data;
  for (const p of bestMask) {
    const px = p % w;
    const py = (p / w) | 0;
    const ox = px - bestBox.minx;
    const oy = py - bestBox.miny;
    const si = p * 4;
    const di = (oy * tw + ox) * 4;
    od[di] = d[si];
    od[di + 1] = d[si + 1];
    od[di + 2] = d[si + 2];
    od[di + 3] = d[si + 3];
  }
  outCtx.putImageData(outImg, 0, 0);
  return out;
}

function cropFragment(sheetCanvas, frag, { clean = true } = {}) {
  const sw = sheetCanvas.width;
  const sh = sheetCanvas.height;
  let u = Number(frag.u) || 0;
  let v = Number(frag.v) || 0;
  let w = Math.max(1, Number(frag.w) || 1);
  let h = Math.max(1, Number(frag.h) || 1);
  u = Math.max(0, Math.min(sw - 1, u));
  v = Math.max(0, Math.min(sh - 1, v));
  w = Math.min(w, sw - u);
  h = Math.min(h, sh - v);
  if (w < 1 || h < 1) return null;

  const out = document.createElement('canvas');
  const ctx = out.getContext('2d');
  if (frag.rotated) {
    out.width = h;
    out.height = w;
    ctx.translate(0, w);
    ctx.rotate(-Math.PI / 2);
    ctx.drawImage(sheetCanvas, u, v, w, h, 0, 0, w, h);
  } else {
    out.width = w;
    out.height = h;
    ctx.drawImage(sheetCanvas, u, v, w, h, 0, 0, w, h);
  }
  return clean ? trimLargestOpaque(out) : out;
}

function applyTransformToImage(srcCanvas, matrix, color) {
  const w = srcCanvas.width;
  const h = srcCanvas.height;
  const a = matrix.scaleX;
  const b = matrix.skew1;
  const c = matrix.skew0;
  const d = matrix.scaleY;

  const corners = [
    [0, 0],
    [w, 0],
    [w, h],
    [0, h],
  ].map(([x, y]) => ({ x: a * x + c * y, y: b * x + d * y }));

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of corners) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const outW = Math.max(1, Math.ceil(maxX - minX));
  const outH = Math.max(1, Math.ceil(maxY - minY));

  if (outW > 8192 || outH > 8192) return null;

  const out = document.createElement('canvas');
  out.width = outW;
  out.height = outH;
  const ctx = out.getContext('2d');
  ctx.setTransform(a, b, c, d, -minX, -minY);
  ctx.drawImage(srcCanvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  const mr = color.multi.red;
  const mg = color.multi.green;
  const mb = color.multi.blue;
  const ma = color.multi.alpha;
  const ar = color.add.red * 255;
  const ag = color.add.green * 255;
  const ab = color.add.blue * 255;
  const aa = color.add.alpha * 255;
  const needsColor =
    round4(mr) !== 1 ||
    round4(mg) !== 1 ||
    round4(mb) !== 1 ||
    round4(ma) !== 1 ||
    round4(color.add.red) !== 0 ||
    round4(color.add.green) !== 0 ||
    round4(color.add.blue) !== 0 ||
    round4(color.add.alpha) !== 0;

  if (needsColor) {
    const img = ctx.getImageData(0, 0, outW, outH);
    const d = img.data;
    for (let i = 0; i < d.length; i += 4) {
      d[i] = Math.max(0, Math.min(255, d[i] * mr + ar));
      d[i + 1] = Math.max(0, Math.min(255, d[i + 1] * mg + ag));
      d[i + 2] = Math.max(0, Math.min(255, d[i + 2] * mb + ab));
      d[i + 3] = Math.max(0, Math.min(255, d[i + 3] * ma + aa));
    }
    ctx.putImageData(img, 0, 0);
  }
  return out;
}

export async function buildPackSheetFiles(opts) {
  const log = opts.log || (() => {});
  const exportTransforms = !!opts.exportTransforms;
  const cleanSlices = opts.cleanSlices !== false;
  const packName = String(opts.packName || 'lwf_pack')
    .replace(/[<>:"/\\|?*]/g, '_')
    .replace(/\.lwf$/i, '');

  const parsed = parseLwfTextures(opts.lwfBytes);
  const { textures, fragments } = parsed;
  const files = [];
  const fittedCanvases = new Map();
  const sheetMeta = [];

  for (const tex of textures) {
    const url = await opts.resolveSheetUrl(tex.filename);
    if (!url) {
      log(`split: missing sheet ${tex.filename}`);
      continue;
    }
    let img;
    try {
      img = await loadImage(url);
    } catch (e) {
      log(`split: ${tex.filename}: ${e.message || e}`);
      continue;
    }
    const fit = await fitImageToSize(img, tex.width, tex.height);
    fittedCanvases.set(tex.index, fit.canvas);
    sheetMeta.push({
      filename: tex.filename,
      declared: { w: tex.width, h: tex.height },
      disk: { w: fit.fromW, h: fit.fromH },
      mode: fit.mode,
    });
    if (fit.fitted) {
      log(
        `split fit ${tex.filename}: ${fit.fromW}×${fit.fromH} → ${tex.width}×${tex.height} (${fit.mode})`,
      );
    }
  }

  const usedNames = new Set();
  const sliced = [];
  for (let i = 0; i < fragments.length; i++) {
    const frag = fragments[i];
    const sheet = fittedCanvases.get(frag.textureId);
    if (!sheet) continue;
    const crop = cropFragment(sheet, frag, { clean: cleanSlices });
    if (!crop) continue;

    let base = safeName(frag.name, `frag_${i}`);
    if (usedNames.has(base.toLowerCase())) {
      base = safeName(`${stemOf(frag.name)}_${i}.png`, `frag_${i}.png`);
    }
    usedNames.add(base.toLowerCase());

    files.push({
      path: `${packName}/images/${base}`,
      data: await canvasToPngBytes(crop),
    });
    sliced.push({ fragIndex: i, name: base, canvas: crop });
  }

  let transformCount = 0;
  const transformManifest = [];

  if (exportTransforms) {
    const byFrag = collectFragmentTransforms(parsed);
    const seenFileKeys = new Set();

    for (const { fragIndex, name, canvas } of sliced) {
      const map = byFrag.get(fragIndex);
      if (!map?.size) continue;
      const stem = stemOf(name);
      let n = 0;
      for (const { matrix, color, key } of map.values()) {

        if (isIdentityTransform(matrix, color)) continue;
        const fileKey = `${fragIndex}:${key}`;
        if (seenFileKeys.has(fileKey)) continue;
        seenFileKeys.add(fileKey);

        const baked = applyTransformToImage(canvas, matrix, color);
        if (!baked) continue;
        const outName = safeName(`${stem}__${shortHash(key)}.png`);
        files.push({
          path: `${packName}/images_transformed/${outName}`,
          data: await canvasToPngBytes(baked),
        });
        transformManifest.push({
          source: name,
          file: outName,
          matrix: {
            scaleX: round4(matrix.scaleX),
            scaleY: round4(matrix.scaleY),
            skew0: round4(matrix.skew0),
            skew1: round4(matrix.skew1),
          },
          color: {
            multi: {
              red: round4(color.multi.red),
              green: round4(color.multi.green),
              blue: round4(color.multi.blue),
              alpha: round4(color.multi.alpha),
            },
            add: {
              red: round4(color.add.red),
              green: round4(color.add.green),
              blue: round4(color.add.blue),
              alpha: round4(color.add.alpha),
            },
          },
        });
        n += 1;
        transformCount += 1;
      }
      if (n) log(`split xform ${name}: ${n} unique transform(s)`);
    }
  }

  return {
    files,
    packName,
    sheetCount: sheetMeta.length,
    fragmentCount: sliced.length,
    transformCount,
  };
}

export async function exportSheetsZip(packs, zipName = 'lwf-sheets.zip') {
  const all = [];
  let imageCount = 0;
  let transformCount = 0;
  for (const pack of packs) {
    const built = await buildPackSheetFiles(pack);
    all.push(...built.files);
    imageCount += built.fragmentCount;
    transformCount += built.transformCount || 0;
  }
  if (!all.length) throw new Error('No sheets to export');
  const blob = zipStore(all);
  return { blob, fileCount: all.length, zipName, imageCount, transformCount };
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
