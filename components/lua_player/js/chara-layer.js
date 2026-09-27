
import { charaZIndex } from './layers.js';
import { withPatchQuery } from './patch-context.js';
import {
  prepareAtlasFitOverrides,
  wrapImageMapWithAtlasFit,
  fetchLwfBytes,
  lwfBytesToObjectUrl,
} from './atlas-fit.js?v=eclipse21';
import {
  attachScene,
  centerMovie,
  extractSceneNames,
  fitLwfNative,
  fxDisplayScale,
  pickScene,
  puzzleCharacterSizeScale,
  sizeFxBody,
  stageSizeFromDom,
} from './lwf-player.js?v=eclipse53';
import { ensureLwfCanvasBlendModes } from './lwf-blend.js?v=dokkan2026_v30';
import { syncTextureMetricsToImages } from './texture-sync.js';
import { enqueueLwfLoad, loadLwfWithRetry, resetLwfLoadQueue } from './lwf-load.js';
import {
  DEFAULT_TCB,
  cameraScaleFactor,
  evalVec3Track,
} from './tcb-keys.js?v=eclipse42';
import { fetchEffectPack } from './effect-pack.js';

/** DPuzzleCharaAuraEff::setupAuraEffect — effect pack ids are 349+(aura_id%100)
 *  and optionally 349+((aura_id/100)%100). */
export function auraEffectIdsFromCardAuraId(auraId) {
  const id = Number(auraId);
  if (!Number.isFinite(id) || id < 1) return [];
  const out = [];
  const lo = id % 100;
  const hi = Math.floor(id / 100) % 100;
  if (lo > 0) out.push(349 + lo);
  if (hi > 0) out.push(349 + hi);
  return out;
}

export function auraEffectIdFromCardAuraId(auraId) {
  return auraEffectIdsFromCardAuraId(auraId)[0] ?? null;
}

/** Card aura_scale → local mul: (>0.1 ? scale-1 : 1).
 *  DB/game NULL/0 → 1; typical stored 2.0 → 1. Never treat missing as 1.0
 *  (that would become mul 0). */
export function cardAuraScaleMul(auraScale) {
  const s = Number(auraScale);
  if (!Number.isFinite(s) || s <= 0.1) return 1;
  return s - 1;
}

export const ANIME_STEM = {
  0: 'c00_idl_front',
  1: 'c01_idl_side',
  2: 'c02_idl_back',
  3: 'c03_dash',
  4: 'c04_guard',
  5: 'c05_dam_back',
  6: 'c06_dam_side',
  7: 'c07_dam_front',
  8: 'c08_dam_roll',
  9: 'c09_01_atc_punch',
  10: 'c09_02_atc_punch',
  11: 'c09_03_atc_punch',
  12: 'c10_01_atc_kick',
  13: 'c10_02_atc_kick',
  14: 'c10_03_atc_kick',
  15: 'c13_atc_down',
  16: 'c12_atc_front',
  17: 'c15_heapup',
  18: 'c16_heapup_back',
  19: 'c17_atc_energyball',
  30: 'c18_sp_atc_01',
  31: 'c18_sp_atc_02',
};

/** Pose list for ref UI: player then enemy for each stem — 0, 100, 1, 101, … */
export function animeOptionsForSide(_enemy = false) {
  const stems = Object.keys(ANIME_STEM)
    .map(Number)
    .sort((a, b) => a - b);
  const out = [];
  for (const n of stems) {
    out.push({
      animeId: n,
      stem: ANIME_STEM[n],
      label: `${n} · ${ANIME_STEM[n]} (p)`,
    });
    out.push({
      animeId: 100 + n,
      stem: ANIME_STEM[n],
      label: `${100 + n} · ${ANIME_STEM[n]} (e)`,
    });
  }
  return out;
}

export { clipForAnime };

function stageSize(host) {
  void host;
  return { w: 852, h: 1536 };
}

function isSpAnime(animeId) {
  const n = ((Number(animeId) % 100) + 100) % 100;
  return n === 30 || n === 31;
}

function isIdle(animeId) {
  const n = ((Number(animeId) % 100) + 100) % 100;
  return n <= 2;
}

function clipForAnime(lwf, animeId) {
  const names = extractSceneNames(lwf).filter(
    (n) => /^c\d/.test(n) && !/_empty/i.test(n),
  );
  const raw = Number(animeId) || 0;
  const n = ((raw % 100) + 100) % 100;
  const enemy = raw >= 100;
  const suf = enemy ? 'e' : 'p';
  const alt = enemy ? 'p' : 'e';

  const tryNames = [];
  if (n === 30 || n === 31) {
    const spN = n === 30 ? '01' : '02';
    tryNames.push(
      `c18_sp_atc_${suf}_${spN}`,
      `c18_sp_atc_${alt}_${spN}`,
      `c18_sp_atc_${suf}`,
      `c18_sp_atc_${alt}`,
    );
  } else {
    const stem = ANIME_STEM[n];
    if (stem) tryNames.push(`${stem}_${suf}`, `${stem}_${alt}`, stem);
  }

  for (const cand of tryNames) {
    if (cand && names.includes(cand)) return cand;
  }

  return (
    names.find((s) => s.includes('idl_front') && s.endsWith(`_${suf}`)) ||
    names[0] ||
    null
  );
}

function cameraZ(z) {

  return cameraScaleFactor(z);
}

/** Native LWF pixels; AB scale is Node::setScale on the wrap (see Update). */
const CHARA_LWF_UNIT_SCALE = 1;

export class CharaLayer {
  constructor(hostEl, log) {
    this.host = hostEl;
    this.log = log || (() => {});
    this.chars = new Map();
    this._size = stageSize(hostEl);
    this.attacker = null;
    this.enemy = null;
    this.enemyPlayMode = false;
    this._syncPaused = false;
  }

  setEnemyPlayMode(_on) {

    this.enemyPlayMode = false;
  }

  clear() {
    for (const c of this.chars.values()) {
      this._disposeCardAura(c);
      try {
        c.atlasRevoke?.();
        c.spAtlasRevoke?.();
      } catch {

      }
      try {
        c.lwf?.destroy?.();
        c.spLwf?.destroy?.();
      } catch {

      }
      c.wrap?.remove();
    }
    this.chars.clear();
    this.host.querySelectorAll('[data-chara]').forEach((n) => n.remove());
    this.host.querySelectorAll('[data-card-aura]').forEach((n) => n.remove());
  }

  setCards({ attacker, enemy } = {}) {
    this.attacker = attacker || null;
    this.enemy = enemy || null;
    for (const [id, c] of this.chars) {
      c.card = id === 0 ? this.attacker : this.enemy;
      c.characterSize =
        Number(c.card?.character_size) || c.characterSize || 4;
    }
  }

  enableHugeScaleMode() {
    const allySize = Number(this.attacker?.character_size) || 4;
    const enemySize = Number(this.enemy?.character_size) || 4;
    const allyHuge = allySize >= 10;
    const enemyHuge = enemySize >= 10;
    let allyMul = 1;
    let enemyMul = 1;

    const active = allyHuge || enemyHuge;
    if (!allyHuge && enemyHuge) {
      allyMul = 0.5;
      enemyMul = 1.5;
    } else if (allyHuge && !enemyHuge) {
      allyMul = 1.5;
      enemyMul = 0.5;
    } else if (allyHuge && enemyHuge) {
      allyMul = 1.5;
      enemyMul = 1.5;
    }
    for (const [id, c] of this.chars) {
      c.hugeMul = id === 0 ? allyMul : enemyMul;
      c.hugeScaleActive = active;
      c.characterSize = id === 0 ? allySize : enemySize;
      this._apply(c);
    }
  }

  ensure(id) {
    id = Number(id) || 0;
    if (this.chars.has(id)) return this.chars.get(id);

    const wrap = document.createElement('div');
    wrap.dataset.chara = String(id);
    wrap.className = 'chara-view';
    wrap.style.cssText =
      `position:absolute;left:0;top:0;width:0;height:0;z-index:${charaZIndex(id)};` +
      'pointer-events:none;transform-origin:center center;';

    const canvas = document.createElement('canvas');
    canvas.className = 'chara-canvas';
    canvas.style.background = 'transparent';

    canvas.width = 1;
    canvas.height = 1;
    wrap.appendChild(canvas);
    this.host.appendChild(wrap);

    const state = {
      id,
      wrap,
      canvas,
      lwf: null,
      spLwf: null,
      spCanvas: null,
      movie: null,
      clip: null,
      nativeW: 0,
      nativeH: 0,
      dispW: 0,
      dispH: 0,
      spDispW: 0,
      spDispH: 0,
      unitScale: CHARA_LWF_UNIT_SCALE,
      x: -5000,
      y: 0,
      z: 0,
      sx: 1,
      sy: 1,
      hugeMul: 1,
      hugeScaleActive: false,
      characterSize: Number(
        (id === 0 ? this.attacker : this.enemy)?.character_size,
      ) || 4,
      rot: 0,
      alpha: 1,
      disp: 1,
      anime: id === 0 ? 0 : 100,
      loopAnime: true,
      stopAtEnd: false,
      clipEnded: false,
      lastClipFrame: null,
      useSp: false,
      drawFront: false,
      posKeys: [],
      sclKeys: [],
      rotKeys: [],
      card: id === 0 ? this.attacker : this.enemy,
      refOverride: false,
      auraEnabled: true,
      cardAura: null,
      cardAuras: [],
    };
    this.chars.set(id, state);
    this._apply(state);
    return state;
  }

  resetTransforms() {
    for (const c of this.chars.values()) {
      c.posKeys = [];
      c.sclKeys = [];
      c.rotKeys = [];
      c.x = -5000;
      c.y = 0;
      c.z = 0;
      c.sx = 1;
      c.sy = 1;
      c.rot = 0;
      c.alpha = 1;
      c.disp = 1;
      c.stopAtEnd = false;
      c.clipEnded = false;
      c.lastClipFrame = null;
      this._apply(c);
    }
  }

  loadKeysFromCommands(commands = []) {
    for (const c of this.chars.values()) {
      c.posKeys = [];
      c.sclKeys = [];
      c.rotKeys = [];
    }
    for (const cmd of commands) {
      const id = Number(cmd.chara);
      if (!Number.isFinite(id)) continue;
      const c = this.ensure(id);
      const frame = Number(cmd.frame) || 0;
      const tcb = { ...DEFAULT_TCB };
      if (cmd.type === 'setMoveKey') {
        c.posKeys.push({
          frame,
          x: Number(cmd.x) || 0,
          y: Number(cmd.y) || 0,
          z: Number(cmd.z) || 0,
          ...tcb,
        });
      } else if (cmd.type === 'setScaleKey') {
        c.sclKeys.push({
          frame,
          sx: Number(cmd.sx) || 1,
          sy: Number(cmd.sy) || Number(cmd.sx) || 1,
          sz: 1,
          ...tcb,
        });
      } else if (cmd.type === 'setRotateKey') {
        c.rotKeys.push({
          frame,
          rot: Number(cmd.rot) || 0,
          ...tcb,
        });
      }
    }
    for (const c of this.chars.values()) {
      c.posKeys.sort((a, b) => a.frame - b.frame);
      c.sclKeys.sort((a, b) => a.frame - b.frame);
      c.rotKeys.sort((a, b) => a.frame - b.frame);
      this.evalAtFrame(c.id, 0);
    }
  }

  evalAtFrame(id, frame) {
    const c = this.ensure(id);
    if (c.refOverride) {
      this._apply(c);
      return;
    }
    const f = Number(frame) || 0;
    if (c.posKeys.length) {
      const p = evalVec3Track(c.posKeys, f, 'pos');
      c.x = p.x;
      c.y = p.y;
      c.z = p.z;
    }
    if (c.sclKeys.length) {
      const s = evalVec3Track(c.sclKeys, f, 'scale');
      c.sx = s.x;
      c.sy = s.y;
    }
    if (c.rotKeys.length) {
      const r = evalVec3Track(c.rotKeys, f, 'rot');
      c.rot = r.x;
    }
    this._apply(c);
  }

  evalAllAtFrame(frame) {
    for (const id of this.chars.keys()) this.evalAtFrame(id, frame);
  }

  async loadAll() {
    resetLwfLoadQueue();
    await this._loadChara(0);
    await this._loadChara(1);
    this.enableHugeScaleMode();
  }

  async _loadChara(id) {
    const c = this.ensure(id);
    const card = id === 0 ? this.attacker : this.enemy;
    c.card = card;
    if (!card?.found) {
      this.log(`chara ${id}: missing card`);
      return;
    }
    if (card.battle?.url) {
      try {
        this.log(`chara ${id}: loading battle…`);
        const loaded = await this._loadLwf(
          c.canvas,
          card.battle.url,
          card.battle.rel,
        );
        c.lwf = loaded.lwf;
        c.atlasRevoke = loaded.atlasRevoke;
        c.assetUrl = loaded.assetUrl;
        const fit = fitLwfNative(c.lwf, c.canvas, {
          unitScale: CHARA_LWF_UNIT_SCALE,
        });
        c.nativeW = fit.nativeW;
        c.nativeH = fit.nativeH;
        c.dispW = fit.dispW;
        c.dispH = fit.dispH;
        c.unitScale = CHARA_LWF_UNIT_SCALE;
        sizeFxBody(c.wrap, c.canvas, fit.dispW || fit.nativeW, fit.dispH || fit.nativeH);
        this.log(
          `chara ${id}: ${card.battle.rel} ${fit.nativeW}x${fit.nativeH}` +
            ` · unit=${CHARA_LWF_UNIT_SCALE}` +
            (loaded.atlasFits ? ` · atlas-fit ${loaded.atlasFits}` : '') +
            (loaded.texSync ? ` · stub-sync ${loaded.texSync}` : ''),
        );
      } catch (e) {
        this.log(`chara ${id} battle: ${e.message || e}`);
      }
    }
    if (card.sp?.url) {
      try {
        this.log(`chara ${id}: loading sp…`);
        const spCanvas = document.createElement('canvas');
        spCanvas.className = 'chara-canvas';
        spCanvas.style.display = 'none';
        spCanvas.style.background = 'transparent';
        c.wrap.appendChild(spCanvas);
        c.spCanvas = spCanvas;
        const loaded = await this._loadLwf(spCanvas, card.sp.url, card.sp.rel);
        c.spLwf = loaded.lwf;
        c.spAtlasRevoke = loaded.atlasRevoke;
        c.spAssetUrl = loaded.assetUrl;
        const fit = fitLwfNative(c.spLwf, spCanvas, {
          unitScale: CHARA_LWF_UNIT_SCALE,
        });
        c.spDispW = fit.dispW;
        c.spDispH = fit.dispH;
        sizeFxBody(c.wrap, spCanvas, fit.dispW || fit.nativeW, fit.dispH || fit.nativeH);
        this.log(
          `chara ${id}: sp ${card.sp.rel}` +
            ` · unit=${CHARA_LWF_UNIT_SCALE}` +
            (loaded.atlasFits ? ` · atlas-fit ${loaded.atlasFits}` : '') +
            (loaded.texSync ? ` · stub-sync ${loaded.texSync}` : ''),
        );
      } catch (e) {
        this.log(`chara ${id} sp: ${e.message || e}`);
      }
    }
    await this._setupCardAura(c);
    this.changeAnime(id, c.anime);
  }

  async _loadLwf(canvas, url, relForLog) {
    if (typeof window.LWF === 'undefined') {
      throw new Error('LWF.js not loaded');
    }
    ensureLwfCanvasBlendModes();
    const rawUrl = String(url || '');
    const pathOnly = rawUrl.split('?')[0];
    const assetUrl = withPatchQuery(rawUrl);
    const base = pathOnly.slice(0, pathOnly.lastIndexOf('/') + 1);
    const log = this.log;

    return enqueueLwfLoad(async () => {
      const defaultMap = (name) => {
        let key = String(name || '').replace(/\\/g, '/');
        while (key.startsWith('./')) key = key.slice(2);
        while (key.startsWith('/')) key = key.slice(1);
        return withPatchQuery(base + key);
      };
      log(`LWF fetch ${relForLog || assetUrl.split('/').slice(-2).join('/')}`);
      const bytes = await fetchLwfBytes(assetUrl);
      log(`LWF bytes ${bytes.byteLength}`);
      const atlas = await prepareAtlasFitOverrides(assetUrl, defaultMap, {
        log,
        bytes,
        prefetchBlobs: window.__ECLIPSE_TOOL__ === 'lua-player',
      });
      const mapFn = wrapImageMapWithAtlasFit(defaultMap, atlas.overrides);
      const objectUrl = lwfBytesToObjectUrl(bytes);
      const revokeObject = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {

        }
      };

      let cache;
      try {
        cache = new window.LWF.ResourceCache();
      } catch {
        cache = window.LWF.ResourceCache.get();
      }

      let texSync = 0;
      let lwf = null;
      const onSite = window.__ECLIPSE_TOOL__ === 'lua-player';
      try {
        lwf = await loadLwfWithRetry(
          cache,
          {
            lwf: objectUrl,
            prefix: '',
            stage: canvas,
            worker: false,
            setBackgroundColor: 0,
            useBackgroundColor: false,
            imageMap: mapFn,
            onload(inst) {
              if (inst.rendererFactory && inst.rendererFactory.setBackgroundColor) {
                inst.rendererFactory.setBackgroundColor(0);
              }
              texSync = syncTextureMetricsToImages(inst, log);
              inst.active = true;
              if (inst.rootMovie) {
                inst.rootMovie.active = true;
                inst.rootMovie.playing = false;
              }
            },
          },
          {
            retries: onSite ? 1 : 2,
            log,
            timeoutMs: onSite ? 25000 : 60000,
          },
        );
      } catch (e) {
        revokeObject();
        atlas.revoke();
        throw e;
      }

      const prevRevoke = atlas.revoke;
      return {
        lwf,
        texSync,
        atlasFits: atlas.fitted,
        atlasRevoke: () => {
          revokeObject();
          prevRevoke();
        },
        assetUrl,
      };
    });
  }

  setMove(id, x, y, z = 0) {
    const c = this.ensure(id);
    if (c.refOverride) {
      c.x = Number(x) || 0;
      c.y = Number(y) || 0;
      c.z = Number(z) || 0;
      this._apply(c);
      return;
    }
    if (c.posKeys.length) return;
    c.x = Number(x) || 0;
    c.y = Number(y) || 0;
    c.z = Number(z) || 0;
    this._apply(c);
  }

  setRefMode(on) {
    this.refMode = !!on;
    if (!this.refMode) {
      for (const c of this.chars.values()) {
        c.refOverride = false;
      }
    }
  }

  clearRefOverrides() {
    this.refMode = false;
    for (const c of this.chars.values()) {
      c.refOverride = false;
    }
  }

  resetRefPosition(id, frame = 0) {
    const c = this.chars.get(Number(id));
    if (!c) return null;
    c.refOverride = false;
    this.evalAtFrame(Number(id), Number(frame) || 0);
    return this.getRefSnapshot(id);
  }

  _bringRefOnStage(c) {
    if (!c) return;
    c.disp = 1;
    c.alpha = 1;
    const x = Number(c.x) || 0;
    const y = Number(c.y) || 0;
    if (Math.abs(x) > 2000 || Math.abs(y) > 2000) {
      c.x = c.id === 0 ? -120 : 120;
      c.y = 0;
    }
  }

  setRefVisible(id, visible = true) {
    const c = this.ensure(id);
    c.refOverride = true;
    c.disp = visible ? 1 : 0;
    if (visible) {
      c.alpha = 1;
      this._bringRefOnStage(c);
    }
    this._apply(c);
  }

  setRefMove(id, x, y, z = 0) {
    const c = this.ensure(id);
    c.refOverride = true;
    c.disp = 1;
    c.x = Number(x) || 0;
    c.y = Number(y) || 0;
    c.z = Number(z) || 0;
    this._apply(c);
  }

  setRefZ(id, z = 0) {
    const c = this.ensure(id);
    c.refOverride = true;
    c.z = Number(z) || 0;
    this._apply(c);
  }

  setRefScale(id, sx, sy) {
    const c = this.ensure(id);
    c.refOverride = true;
    const x = Number(sx);
    const y = sy == null ? x : Number(sy);
    c.sx = Number.isFinite(x) ? x : 1;
    c.sy = Number.isFinite(y) ? y : c.sx;
    this._apply(c);
  }

  setRefRotate(id, rot) {
    const c = this.ensure(id);
    c.refOverride = true;
    c.rot = Number(rot) || 0;
    this._apply(c);
  }

  listAnimeOptions(id) {
    const c = this.chars.get(Number(id));
    const opts = animeOptionsForSide();
    if (!c) return opts;
    const lwf = c.useSp ? c.spLwf : c.lwf;
    return opts.map((o) => {
      const clip = lwf ? clipForAnime(lwf, o.animeId) : null;
      return { ...o, clip: clip || null, available: !!clip };
    });
  }

  getRefSnapshot(id) {
    const c = this.chars.get(Number(id));
    if (!c) return null;
    const movie = c.movie;
    const total = Number(movie?.totalFrames) || 0;
    const cur = Number(movie?.currentFrame) || 0;
    return {
      id: c.id,
      x: Number(c.x) || 0,
      y: Number(c.y) || 0,
      z: Number(c.z) || 0,
      sx: Number(c.sx) || 1,
      sy: Number(c.sy) || 1,
      rot: Number(c.rot) || 0,
      disp: Number(c.disp) ? 1 : 0,
      alpha: c.alpha != null && Number.isFinite(Number(c.alpha)) ? Number(c.alpha) : 1,
      anime: Number(c.anime) || 0,
      clip: c.clip || null,
      clipFrame: cur,
      clipFrames: total,
      useSp: !!c.useSp,
      loopAnime: !!c.loopAnime,
      stopAtEnd: !!c.stopAtEnd,
      hugeMul: Number(c.hugeMul) || 1,
    };
  }

  captureEntryState() {
    const chars = [];
    for (const c of this.chars.values()) {
      const snap = this.getRefSnapshot(c.id);
      if (snap) chars.push(snap);
    }
    return { chars };
  }

  restoreEntryState(snapshot) {
    if (!snapshot?.chars?.length) return;
    for (const snap of snapshot.chars) {
      const c = this.chars.get(Number(snap.id));
      if (!c) continue;
      c.refOverride = true;
      c.x = Number(snap.x) || 0;
      c.y = Number(snap.y) || 0;
      c.z = Number(snap.z) || 0;
      c.sx = Number(snap.sx) || 1;
      c.sy = Number(snap.sy) || 1;
      c.rot = Number(snap.rot) || 0;
      c.disp = Number(snap.disp) ? 1 : 0;
      c.alpha = snap.alpha != null ? Number(snap.alpha) : 1;
      c.hugeMul = Number(snap.hugeMul) > 0 ? Number(snap.hugeMul) : 1;
      c.loopAnime = !!snap.loopAnime;
      c.stopAtEnd = !!snap.stopAtEnd;
      const anime = Number(snap.anime) || 0;
      if (Number(c.anime) !== anime || !!c.useSp !== !!snap.useSp) {
        this.changeAnime(c.id, anime, { stopAtEnd: !!snap.stopAtEnd });
      }
      const clipFrame = Number(snap.clipFrame) || 0;
      if (clipFrame > 0) this.seekClipFrame(c.id, clipFrame);
      this._apply(c);
    }
    this.renderOnly();
  }

  seekClipFrame(id, frame) {
    const c = this.chars.get(Number(id));
    if (!c?.movie) return null;
    const m = c.movie;
    const total = Math.max(1, Number(m.totalFrames) || 1);
    const f = Math.max(1, Math.min(total, Math.round(Number(frame) || 1)));
    try {
      m.playing = false;
      m.gotoAndStop?.(f);
      c.clipEnded = f >= total;
      c.lastClipFrame = f;
      c.loopAnime = false;
      (c.useSp ? c.spLwf : c.lwf)?.render?.();
    } catch {

    }
    return this.getRefSnapshot(id);
  }

  stepClipFrame(id, delta = 1) {
    const snap = this.getRefSnapshot(id);
    if (!snap) return null;
    return this.seekClipFrame(id, (snap.clipFrame || 1) + Number(delta || 0));
  }

  setScale(id, sx, sy) {
    const c = this.ensure(id);
    if (c.refOverride) {
      this.setRefScale(id, sx, sy);
      return;
    }
    if (c.sclKeys.length) return;
    c.sx = sx;
    c.sy = sy ?? sx;
    this._apply(c);
  }

  setRotate(id, rot) {
    const c = this.ensure(id);
    if (c.refOverride) {
      this.setRefRotate(id, rot);
      return;
    }
    if (c.rotKeys.length) return;
    c.rot = rot;
    this._apply(c);
  }

  setAlpha(id, a) {
    const c = this.ensure(id);
    c.alpha = a > 1 ? a / 255 : a;
    this._apply(c);
  }

  setDisp(id, visible) {
    const c = this.ensure(id);
    c.disp = Number(visible) ? 1 : 0;
    this._apply(c);
  }

  setDrawFront(id, on) {
    const c = this.ensure(id);
    c.drawFront = Boolean(Number(on));
    this._apply(c);
  }

  setAnimeLoop(id, loop) {
    const c = this.ensure(id);
    c.loopAnime = !!loop;
    if (!c.loopAnime && c.movie) c.stopAtEnd = true;
  }

  changeAnime(id, anime, { stopAtEnd = false } = {}) {
    const c = this.ensure(id);
    const animeNo = Number(anime) || 0;
    c.anime = animeNo;
    c.stopAtEnd = !!stopAtEnd;
    c.clipEnded = false;
    c.lastClipFrame = null;
    if (!stopAtEnd) c.loopAnime = isIdle(animeNo) ? true : c.loopAnime !== false;

    const useSp = isSpAnime(animeNo) && c.spLwf;
    c.useSp = !!useSp;
    if (c.spCanvas) c.spCanvas.style.display = useSp ? 'block' : 'none';
    c.canvas.style.display = useSp ? 'none' : 'block';

    const lwf = useSp ? c.spLwf : c.lwf;
    const canvas = useSp ? c.spCanvas : c.canvas;
    if (!lwf?.rootMovie) {
      this._apply(c);
      return;
    }

    let clip = clipForAnime(lwf, animeNo);
    if (!clip && useSp) {
      const names = extractSceneNames(lwf);
      clip =
        names.find((s) => /^ef_/i.test(s)) ||
        names.find((s) => /^c\d/.test(s) && !/_empty/i.test(s)) ||
        names.find((s) => s && s !== '_root');
    }

    if (!clip && useSp && c.lwf?.rootMovie) {
      clip = clipForAnime(c.lwf, animeNo);
      if (clip) {
        c.useSp = false;
        if (c.spCanvas) c.spCanvas.style.display = 'none';
        c.canvas.style.display = 'block';
        this._setMovie(c, c.lwf, c.canvas, clip);
        this._apply(c);
        return;
      }
    }
    if (!clip) {
      this.log(`chara ${id}: no movie for anime ${animeNo}`);
      this._apply(c);
      return;
    }
    this._setMovie(c, lwf, canvas, clip);
    this._apply(c);
  }

  changeAnimeAndStop(id, anime) {
    this.changeAnime(id, anime, { stopAtEnd: true });
  }

  _setMovie(c, lwf, canvas, clip) {
    const name = `pose_${c.id}`;

    if (c.movie && c.clip === clip) {
      c.movie.active = true;
      c.movie.visible = true;
      if (typeof c.movie.setVisible === 'function') c.movie.setVisible(true);

      if (!c.movie.playing) {
        c.movie.playing = true;
        c.movie.gotoAndPlay?.(1);
      }
      return;
    }

    try {
      lwf.rootMovie.detachMovie?.(name);
    } catch {

    }

    lwf.rootMovie.active = true;
    lwf.rootMovie.playing = false;

    let movie = null;
    try {
      movie = attachScene(lwf, clip, name, { play: true, center: true });
    } catch (e) {
      this.log(`chara ${c.id}: setMovie(${clip}) ${e.message || e}`);
      c.movie = null;
      c.clip = null;
      return;
    }
    if (!movie) {
      this.log(`chara ${c.id}: setMovie(${clip}) failed`);
      c.movie = null;
      c.clip = null;
      return;
    }

    centerMovie(lwf, movie);
    movie.active = true;
    if (typeof movie.setVisible === 'function') movie.setVisible(true);

    const sp = !!c.useSp;
    const needFit = sp
      ? !(c.spDispW > 0 && c.spDispH > 0)
      : !(c.dispW > 0 && c.dispH > 0);
    if (needFit || !c.nativeW || !c.nativeH) {
      const fit = fitLwfNative(lwf, canvas, {
        unitScale: CHARA_LWF_UNIT_SCALE,
      });
      if (!sp) {
        c.nativeW = fit.nativeW;
        c.nativeH = fit.nativeH;
        c.dispW = fit.dispW;
        c.dispH = fit.dispH;
      } else {
        c.spDispW = fit.dispW;
        c.spDispH = fit.dispH;
      }
      c.unitScale = CHARA_LWF_UNIT_SCALE;
    }
    const dw = sp ? c.spDispW || c.dispW : c.dispW;
    const dh = sp ? c.spDispH || c.dispH : c.dispH;
    sizeFxBody(c.wrap, canvas, dw || c.nativeW, dh || c.nativeH);

    c.movie = movie;
    c.clip = clip;
    c.clipEnded = false;
    c.lastClipFrame = null;
    this.log(`chara ${c.id}: setMovie ${clip}`);

    try {
      lwf.exec?.(0);
      lwf.render?.();
    } catch {

    }
  }

  setAura(charaId, enabled = true) {
    const c = this.chars.get(Number(charaId));
    if (!c) return;
    c.auraEnabled = !!enabled;
    this._applyCardAura(c);
  }

  _auraLayers(c) {
    if (c?.cardAuras?.length) return c.cardAuras;
    return c?.cardAura ? [c.cardAura] : [];
  }

  async _setupCardAura(c) {
    this._disposeCardAura(c);
    const card = c.card;
    const auraId = Number(card?.aura_id);
    if (!card?.found || !Number.isFinite(auraId) || auraId < 1) return;

    const effectIds = auraEffectIdsFromCardAuraId(auraId);
    if (!effectIds.length) return;

    const modes = [2];
    if (auraId >> 4 >= 0x271) modes.push(3);

    c.cardAuras = [];
    for (const mode of modes) {
      for (const effectId of effectIds) {
        try {
          await this._loadOneCardAura(c, {
            auraId,
            effectId,
            mode,
            cardScale: Number(card.aura_scale),
            offsetX: Number(card.aura_offset_x) || 0,
            offsetY: Number(card.aura_offset_y) || 0,
            front: !!card.is_aura_front,
          });
        } catch (e) {
          this.log(
            `chara ${c.id} card-aura eff=${effectId} mode=${mode}: ${e.message || e}`,
          );
        }
      }
    }
    c.cardAura = c.cardAuras[0] || null;
    this._applyCardAura(c);
  }

  async _loadOneCardAura(c, opts) {
    const { auraId, effectId, mode, cardScale, offsetX, offsetY, front } = opts;
    const pack = await fetchEffectPack(effectId, { enemy: c.id === 1 });
    if (!pack?.found || !pack.lwf?.url) {
      this.log(`chara ${c.id} card-aura ${auraId}: pack ${effectId} missing`);
      return;
    }

    const wrap = document.createElement('div');
    wrap.className = 'lwf-fx card-aura';
    wrap.dataset.cardAura = String(c.id);
    wrap.style.cssText =
      'position:absolute;left:0;top:0;width:0;height:0;pointer-events:none;' +
      'transform-origin:center center;visibility:hidden;';

    if (front) c.wrap.appendChild(wrap);
    else c.wrap.insertBefore(wrap, c.wrap.firstChild);

    const canvas = document.createElement('canvas');
    canvas.className = 'lwf-canvas';
    canvas.style.background = 'transparent';
    wrap.appendChild(canvas);

    const { w: stageW, h: stageH } = stageSizeFromDom(this.host);
    const assetUrl = withPatchQuery(String(pack.lwf.url || ''));
    const loaded = await this._loadLwf(canvas, assetUrl, pack.lwf.rel || '');
    const lwf = loaded.lwf;
    const disp = fxDisplayScale(lwf.width, lwf.height, stageW, stageH);
    const fit = fitLwfNative(lwf, canvas, {
      scaleX: disp.scaleX,
      scaleY: disp.scaleY,
      anchorY: 'middle',
      stageH,
    });
    sizeFxBody(wrap, canvas, fit.dispW, fit.dispH, { anchorY: 'middle' });

    const scene = pickScene(lwf, pack.scene_name || 'ef_001');
    let movie = null;
    if (scene && lwf.rootMovie?.attachMovie) {
      movie = attachScene(lwf, scene, `card_aura_${c.id}_${effectId}_${mode}`, {
        play: true,
        center: true,
      });
    }
    if (lwf.rootMovie) {
      lwf.rootMovie.active = true;
      lwf.rootMovie.playing = false;
    }
    lwf.active = true;

    const scaleNum = Number(cardScale);
    const layer = {
      wrap,
      canvas,
      lwf,
      movie,
      atlasRevoke: loaded.atlasRevoke,
      effectId,
      auraId,
      mode,
      cardScale: Number.isFinite(scaleNum) ? scaleNum : 0,
      offsetX,
      offsetY,
      front,
      nativeW: fit.nativeW,
      nativeH: fit.nativeH,
      dispW: fit.dispW,
      dispH: fit.dispH,
    };
    c.cardAuras.push(layer);

    const size = puzzleCharacterSizeScale(c);
    const mul = cardAuraScaleMul(layer.cardScale);
    const modeScl = mode === 3 ? size * 2 : size;
    this.log(
      `chara ${c.id}: card-aura id=${auraId} eff=${effectId} mode=${mode} ` +
        `${pack.pack_name}/${scene || '?'} ` +
        `cardScale=${layer.cardScale} → mul=${mul.toFixed(3)} ` +
        `size=${size.toFixed(3)} local=${(mul * modeScl).toFixed(3)} ` +
        `off=(${offsetX},${offsetY})` +
        (front ? ' front' : ' back'),
    );
  }

  _disposeCardAura(c) {
    for (const a of this._auraLayers(c)) {
      try {
        a.atlasRevoke?.();
      } catch {

      }
      try {
        a.lwf?.destroy?.();
      } catch {

      }
      a.wrap?.remove?.();
    }
    c.cardAura = null;
    c.cardAuras = [];
  }

  _applyCardAura(c) {
    const layers = this._auraLayers(c);
    if (!layers.length) return;

    const size = puzzleCharacterSizeScale(c);
    const animeN = ((Number(c.anime) % 100) + 100) % 100;
    const auraByAnime = animeN !== 7;
    const show =
      !!c.disp && c.auraEnabled !== false && auraByAnime;

    for (const a of layers) {
      if (!a?.wrap) continue;
      const mode = Number(a.mode) || 2;
      const yBase = mode === 3 ? size * -200 : size * -140;
      const modeScl = mode === 3 ? size * 2 : size;
      const mul = cardAuraScaleMul(a.cardScale);
      const localS = mul * modeScl;
      const lx = Number(a.offsetX) || 0;
      const ly = -(yBase + (Number(a.offsetY) || 0));
      a.wrap.style.transform = `translate(${lx}px, ${ly}px) scale(${localS}, ${localS})`;
      a.wrap.style.zIndex = a.front ? '2' : '-1';
      a.wrap.style.visibility = show ? 'visible' : 'hidden';
      a.wrap.style.opacity = show ? '1' : '0';
    }
  }

  rebindAnimes() {
    for (const c of this.chars.values()) {
      this.changeAnime(c.id, c.anime, { stopAtEnd: !!c.stopAtEnd });
    }
  }

  stepFrames(n = 1, fps = 30) {
    this.tick(n, fps);
    this.renderOnly();
  }

  setSyncPause(paused) {
    this._syncPaused = !!paused;
  }

  tick(n = 1, fps = 30) {
    if (this._syncPaused) return;
    const dt = (1 / fps) * n;
    for (const c of this.chars.values()) {
      try {
        const lwf = c.useSp ? c.spLwf : c.lwf;
        if (!lwf) continue;
        if (c.clipEnded && !c.useSp) continue;
        lwf.exec?.(dt);
        if (!c.useSp) {
          this._loopOrHold(c);
        }
      } catch {

      }

      try {
        if (!c.disp || c.auraEnabled === false) continue;
        for (const al of this._auraLayers(c)) {
          if (!al?.lwf) continue;
          al.lwf.exec?.(dt);
          const m = al.movie;
          if (!m) continue;
          const total = Number(m.totalFrames);
          const cur = Number(m.currentFrame);
          if (total > 1 && (cur >= total || m.playing === false)) {
            m.playing = true;
            m.gotoAndPlay?.(1);
          }
        }
      } catch {

      }
    }
  }

  _loopOrHold(c) {
    if (!c.movie) return;
    const m = c.movie;
    const total = Number(m.totalFrames);
    const cur = Number(m.currentFrame);
    if (!(total > 1) || !Number.isFinite(cur)) return;

    if (c.loopAnime && !c.stopAtEnd) {

      if (cur >= total || (m.playing === false && cur >= total - 1)) {
        m.playing = true;
        m.gotoAndPlay?.(1);
      }
      c.lastClipFrame = Number(m.currentFrame);
      return;
    }

    this._hold(c);
  }

  _hold(c) {
    if ((!c.stopAtEnd && c.loopAnime) || !c.movie) return;
    const m = c.movie;
    const total = Number(m.totalFrames);
    const cur = Number(m.currentFrame);
    if (!(total > 1) || !Number.isFinite(cur)) return;
    const wrapped =
      c.lastClipFrame != null && c.lastClipFrame >= total - 1 && cur <= 1 && m.playing;
    if (cur >= total || wrapped) {
      m.playing = false;
      m.gotoAndStop?.(total);
      c.clipEnded = true;
    }
    c.lastClipFrame = Number(m.currentFrame);
  }

  renderOnly() {
    for (const c of this.chars.values()) {
      try {
        if (!c.disp || !c.movie) continue;
        (c.useSp ? c.spLwf : c.lwf)?.render?.();
      } catch {

      }
      try {
        if (!c.disp || c.auraEnabled === false) continue;
        for (const al of this._auraLayers(c)) {
          al?.lwf?.render?.();
        }
      } catch {

      }
    }
  }

  _apply(c) {
    if (!c?.wrap) return;

    this._size = stageSize(this.host);
    const { w, h } = this._size;
    const cx = w / 2 + (c.x || 0);
    const cy = h / 2 - (c.y || 0);
    const huge = Number(c.hugeMul) > 0 ? Number(c.hugeMul) : 1;
    const cam = cameraZ(c.z);
    const sx = (Number(c.sx) || 1) * cam * huge;
    const sy = (Number(c.sy) || 1) * cam * huge;
    c.wrap.style.transform = `translate(${cx}px, ${cy}px) rotate(${c.rot || 0}deg) scale(${sx}, ${sy})`;
    c.wrap.style.opacity = String(c.disp ? Math.max(0, Math.min(1, c.alpha ?? 1)) : 0);
    c.wrap.style.zIndex = String(
      charaZIndex(c.id, { drawFront: !!c.drawFront }) + Math.round(c.z || 0),
    );
    this._applyCardAura(c);
  }
}
