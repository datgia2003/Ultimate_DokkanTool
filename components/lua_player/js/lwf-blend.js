
const BLEND_TO_COMPOSITE = {
  add: 'lighter',
  normal: 'source-over',
  multiply: 'multiply',
  screen: 'screen',

  subtract: 'difference',
};

function looksLikeSetGlobalComposite(fn) {
  if (typeof fn !== 'function') return false;
  try {
    const src = Function.prototype.toString.call(fn);
    return (
      src.includes('globalCompositeOperation') &&
      src.includes('lighter') &&
      (src.includes('multiply') || src.includes('screen')) &&
      !src.includes('destination-in')
    );
  } catch {
    return false;
  }
}

function patchFactoryProto(proto) {
  if (!proto) return false;
  const names = Object.getOwnPropertyNames(proto);
  let targetKey = null;
  for (const key of names) {
    const fn = proto[key];
    if (!looksLikeSetGlobalComposite(fn)) continue;
    targetKey = key;
    break;
  }
  if (!targetKey) return false;

  const existing = proto[targetKey];

  let modeField = 'renderBlendMode';
  try {
    const src = Function.prototype.toString.call(existing);
    const m = src.match(/this\.([\w$]+)\s*!==\s*[\w$]+/) || src.match(/this\.([\w$]+)=i/);
    if (m?.[1]) modeField = m[1];
  } catch {

  }

  // The bundled LWF renderer remembers one blend mode on the factory even
  // though it renders to the stage plus several mask/layer canvases. Switching
  // contexts can therefore leave the stage at source-over while the factory
  // incorrectly believes it is still using screen/add. That exposes the black
  // matte of flare textures and can also make masked sprites blink. Keep the
  // cache per 2D context and verify the real context state before skipping.
  const contextModes = new WeakMap();
  proto[targetKey] = function patchedSetGlobalComposite(ctx, blendMode) {
    if (!ctx) return;
    const composite = BLEND_TO_COMPOSITE[blendMode] || 'source-over';
    if (
      contextModes.get(ctx) === blendMode &&
      ctx.globalCompositeOperation === composite
    ) return;
    contextModes.set(ctx, blendMode);
    this[modeField] = blendMode;
    ctx.globalCompositeOperation = composite;
  };
  proto.__abBlendPatched = true;
  return true;
}

export function ensureLwfCanvasBlendModes() {
  try {
    const LWF = typeof window !== 'undefined' ? window.LWF : null;
    if (!LWF) return false;
    try {
      if (typeof LWF.useCanvasRenderer === 'function') {
        LWF.useCanvasRenderer();
      }
    } catch {

    }
    let ok = false;
    try {
      if (LWF.CanvasRendererFactory?.prototype) {
        ok = patchFactoryProto(LWF.CanvasRendererFactory.prototype) || ok;
      }
    } catch {

    }

    try {
      const cache = LWF.ResourceCache?.get?.() || null;
      const fac = cache?.rendererFactory || null;
      if (fac) ok = patchFactoryProto(Object.getPrototypeOf(fac)) || ok;
    } catch {

    }

    try {
      const fresh = new LWF.ResourceCache();
      const fac = fresh?.rendererFactory || null;
      if (fac) ok = patchFactoryProto(Object.getPrototypeOf(fac)) || ok;
    } catch {

    }

    return ok;
  } catch {
    return false;
  }
}
