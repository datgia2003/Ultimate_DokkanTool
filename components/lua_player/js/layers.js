
export const Z = {
  BG: 0,
  MOVIE: 40,
  EFF_BACK: 100,
  CHARA: 200,
  AURA: 220,
  EFF_DEFAULT: 200,
  EFF_FRONT: 300,

  CUTIN: 480,
  UI: 500,
};

export function isCutinEffectId(effectId) {
  const id = Number(effectId) || 0;
  return (
    (id >= 1500 && id <= 1520) ||
    (id >= 1120 && id <= 1135) ||
    (id >= 3246 && id <= 3253)
  );
}

export function isCardFlashCutinId(effectId) {
  const id = Number(effectId) || 0;
  if (id >= 1120 && id <= 1135) return true;
  if (id >= 3246 && id <= 3253) return true;
  if (id === 1504 || id === 1505) return false; // SP art / quote overlays
  if (id >= 1506 && id <= 1520) return true;
  return false;
}

export function isSpOverlayCutinId(effectId) {
  const id = Number(effectId) || 0;
  return id === 1504 || id === 1505;
}

export function effectZIndex(attr = 0, zOrder = 0, effectId = 0) {
  const a = Number(attr) >>> 0;
  const z = Number(zOrder) || 0;
  if (isCutinEffectId(effectId)) return Z.CUTIN + z;
  let band = Z.EFF_DEFAULT;
  if (a & 0x80) band = Z.EFF_BACK;
  if (a & 0x100) band = Z.EFF_FRONT;

  return band + z;
}

export function movieZIndex(flagA = 0) {

  return Z.MOVIE + (Number(flagA) || 0);
}

export function charaZIndex(charaId = 0, { drawFront = false } = {}) {

  const base = drawFront ? Z.EFF_FRONT + 10 : Z.CHARA;
  return base + (Number(charaId) === 0 ? 2 : 0);
}
