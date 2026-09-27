
function tcbTangent(pPrev, p0, p1, pNext, t, c, b, outgoing) {
  const s = 1 - t;
  if (outgoing) {
    const a = ((1 + b) * (1 - c)) / 2;
    const d = ((1 - b) * (1 + c)) / 2;
    return 0.5 * s * (a * (p0 - pPrev) + d * (p1 - p0));
  }
  const a = ((1 + b) * (1 + c)) / 2;
  const d = ((1 - b) * (1 - c)) / 2;
  return 0.5 * s * (a * (p1 - p0) + d * (pNext - p1));
}

function hermite(p0, p1, m0, m1, u) {
  const u2 = u * u;
  const u3 = u2 * u;
  const h00 = 2 * u3 - 3 * u2 + 1;
  const h10 = u3 - 2 * u2 + u;
  const h01 = -2 * u3 + 3 * u2;
  const h11 = u3 - u2;
  return h00 * p0 + h10 * m0 + h01 * p1 + h11 * m1;
}

export function interpolateComponent(keys, frame, compGet) {
  if (!keys?.length) return null;
  const f = Number(frame) || 0;
  if (f <= keys[0].frame) return compGet(keys[0]);
  if (f >= keys[keys.length - 1].frame) return compGet(keys[keys.length - 1]);

  let i = 0;
  while (i < keys.length - 1 && keys[i + 1].frame <= f) i += 1;
  const k0 = keys[i];
  const k1 = keys[i + 1];
  const span = k1.frame - k0.frame;
  if (span < 1) return compGet(k1);

  const u = (f - k0.frame) / span;
  const pPrev = compGet(keys[Math.max(0, i - 1)]);
  const p0 = compGet(k0);
  const p1 = compGet(k1);
  const pNext = compGet(keys[Math.min(keys.length - 1, i + 2)]);
  const t = k0.t ?? 0.5;
  const c = k0.c ?? -1;
  const b = k0.b ?? 0;
  const m0 = tcbTangent(pPrev, p0, p1, pNext, t, c, b, true);
  const m1 = tcbTangent(pPrev, p0, p1, pNext, t, c, b, false);
  return hermite(p0, p1, m0, m1, u);
}

export const DEFAULT_TCB = { t: 0.5, c: -1, b: 0 };

export function evalVec3Track(keys, frame, kind) {
  if (!keys?.length) {
    if (kind === 'scale') return { x: 1, y: 1, z: 0 };
    if (kind === 'pos') return { x: -5000, y: 0, z: 0 };
    return { x: 0, y: 0, z: 0 };
  }
  const sorted = [...keys].sort((a, b) => a.frame - b.frame || 0);
  if (kind === 'scale') {
    return {
      x: interpolateComponent(sorted, frame, (k) => Number(k.sx) || 1) ?? 1,
      y: interpolateComponent(sorted, frame, (k) => Number(k.sy) || 1) ?? 1,
      z: interpolateComponent(sorted, frame, (k) => Number(k.sz) || 0) ?? 0,
    };
  }
  if (kind === 'rot') {
    return {
      x: interpolateComponent(sorted, frame, (k) => Number(k.rot) || 0) ?? 0,
      y: 0,
      z: 0,
    };
  }
  return {
    x: interpolateComponent(sorted, frame, (k) => Number(k.x) || 0) ?? 0,
    y: interpolateComponent(sorted, frame, (k) => Number(k.y) || 0) ?? 0,
    z: interpolateComponent(sorted, frame, (k) => Number(k.z) || 0) ?? 0,
  };
}

/** ABCamera::calcScaleZ — clamp Z to [-128,128], then z/128 (or z*0.0065104 if z<0). */
export function calcScaleZ(z) {
  let a = Number(z) || 0;
  if (a > 128) a = 128;
  if (a < -128) a = -128;
  const k = a < 0 ? 0.0065104 : 0.0078125;
  return a * k;
}

/** ActionBankCharaView::Update — nodeScale = (1 - calcScaleZ(z)) * hugeMul * keyScale */
export function cameraScaleFactor(z) {
  return 1 - calcScaleZ(z);
}
