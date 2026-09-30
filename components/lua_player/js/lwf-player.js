
import {
  prepareAtlasFitOverrides,
  wrapImageMapWithAtlasFit,
  fetchLwfBytes,
  lwfBytesToObjectUrl,
} from './atlas-fit.js?v=eclipse22';
import {
  syncTextureMetricsToImages,
  preloadPatchedCardImages,
  applyPreloadedCardImages,
} from './texture-sync.js?v=eclipse24';
import { ensureLwfCanvasBlendModes } from './lwf-blend.js?v=dokkan2026_v30';
import { enqueueLwfLoad, loadLwfWithRetry } from './lwf-load.js';
import { cameraScaleFactor } from './tcb-keys.js?v=eclipse42';
import { withPatchQuery } from './patch-context.js';

function ensureTrailingSlash(url) {
  if (!url) return '';
  return url.endsWith('/') ? url : `${url}/`;
}

function extractSceneNames(lwfInstance) {
  if (
    !lwfInstance?.data ||
    !Array.isArray(lwfInstance.data.movieLinkages) ||
    !Array.isArray(lwfInstance.data.strings)
  ) {
    return [];
  }
  return lwfInstance.data.movieLinkages
    .map((link) => lwfInstance.data.strings[link.stringId])
    .filter((value) => typeof value === 'string' && value.length > 0);
}

function sceneAliases(preferred) {
  if (!preferred) return [];
  const out = [preferred];
  const underscored = preferred.replace(/(\d+)([a-z]+)$/i, '$1_$2');
  const glued = preferred.replace(/(\d+)_([a-z]+)$/i, '$1$2');
  out.push(underscored, glued);
  return [...new Set(out.filter(Boolean))];
}

function pickScene(lwfInstance, preferred) {
  const names = extractSceneNames(lwfInstance);
  if (preferred) {
    for (const cand of sceneAliases(preferred)) {
      if (names.includes(cand)) return cand;
    }
  }
  if (names.includes('ef_001')) return 'ef_001';
  const ef = names.find((n) => /^ef_/i.test(n));
  if (ef) return ef;
  return names.find((n) => n && n !== '_root') || names[0] || null;
}

function stageSizeFromDom(host) {

  void host;
  return { w: 852, h: 1536 };
}

function fxDisplayScale(lwfW, lwfH, stageW = 852, stageH = 1136) {
  const w = Number(lwfW) || 0;
  const h = Number(lwfH) || 0;
  if (w < 8 || h < 8) return { scaleX: 1, scaleY: 1, anchorY: 'middle' };
  const rx = stageW / w;
  const ry = stageH / h;

  if (Math.abs(rx - 2) < 0.25 && Math.abs(ry - 2) < 0.25) {
    return { scaleX: 2, scaleY: 2, anchorY: 'middle' };
  }
  if (w <= 480 && h <= 640) {
    return { scaleX: 2, scaleY: 2, anchorY: 'middle' };
  }

  if (Math.abs(w - stageW) < 8 && h > stageH + 32) {
    return { scaleX: 1, scaleY: 1, anchorY: 'middle' };
  }
  return { scaleX: 1, scaleY: 1, anchorY: 'middle' };
}

function halfDesignUnitScale(lwfW, lwfH, stageW = 852, stageH = 1136) {
  const d = fxDisplayScale(lwfW, lwfH, stageW, stageH);
  return d.scaleX === d.scaleY ? d.scaleX : d.scaleX;
}

const PUZZLE_CHARACTER_SIZE_SCALE = [
  0.8, 0.9, 1.1, 1.2, 1.35, 1.45, 1.5, 1.65, 1.75, 2.25, 2.5,
];

/** PuzzleCharacterSizeData::getPuzzleCharacterSizeScale — flt_1FC862C[0..10]. */
function puzzleCharacterSizeScale(chara) {
  const size = Number(
    chara?.characterSize ?? chara?.card?.character_size ?? 4,
  );
  if (!Number.isFinite(size) || size < 0) return 1.0;
  const idx = size | 0;
  if (idx >= 0 && idx <= 10) return PUZZLE_CHARACTER_SIZE_SCALE[idx];
  return 1.0;
}

function getEffScales(effectId, chara) {
  const id = Number(effectId) || 0;
  let scale = 1.0;

  if (id >= 300 && id <= 342) {
    scale = puzzleCharacterSizeScale(chara);
  }

  if (id >= 200 && id <= 243) {
    const useHuge = !!chara?.hugeScaleActive;
    const huge = Number(chara?.hugeMul) > 0 ? Number(chara.hugeMul) : 1;
    scale *= useHuge ? huge : 1;
  } else if (id === 700) {
    scale = puzzleCharacterSizeScale(chara);
  }
  return scale;
}

function fitLwfNative(lwfInstance, canvas, opts = {}) {
  const nativeW = Math.max(1, Math.round(lwfInstance.width || canvas?.width || 1));
  const nativeH = Math.max(1, Math.round(lwfInstance.height || canvas?.height || 1));
  const scaleX = Math.max(
    0.01,
    Number(opts.scaleX) || Number(opts.unitScale) || 1,
  );
  const scaleY = Math.max(
    0.01,
    Number(opts.scaleY) || Number(opts.unitScale) || 1,
  );

  if (canvas.width !== nativeW) canvas.width = nativeW;
  if (canvas.height !== nativeH) canvas.height = nativeH;

  const dispW = nativeW * scaleX;
  const dispH = nativeH * scaleY;
  canvas.style.width = `${dispW}px`;
  canvas.style.height = `${dispH}px`;
  canvas.style.display = 'block';
  canvas.style.background = 'transparent';
  if (lwfInstance.stage) {
    lwfInstance.stage.width = nativeW;
    lwfInstance.stage.height = nativeH;
  }
  const prop = lwfInstance.property;
  if (prop) {
    if (typeof prop.scaleTo === 'function') prop.scaleTo(1, 1);
    else {
      prop.scaleX = 1;
      prop.scaleY = 1;
    }
    if (typeof prop.moveTo === 'function') prop.moveTo(0, 0);
    else {
      prop.x = 0;
      prop.y = 0;
    }
  }
  return {
    nativeW,
    nativeH,
    unitScale: scaleX,
    scaleX,
    scaleY,
    anchorY: opts.anchorY || 'middle',
    stageH: Number(opts.stageH) || 0,
    dispW,
    dispH,
  };
}

function sizeFxBody(wrap, canvas, dispW, dispH, opts = {}) {
  if (!wrap || !canvas) return;
  const w = dispW || canvas.width || 1;
  const h = dispH || canvas.height || 1;
  const stageH = Number(opts.stageH) || 0;
  const anchorY = opts.anchorY || 'middle';
  wrap.style.width = '0';
  wrap.style.height = '0';
  wrap.style.left = '0';
  wrap.style.top = '0';
  wrap.style.right = 'auto';
  wrap.style.bottom = 'auto';
  wrap.style.inset = 'auto';
  wrap.style.transformOrigin =
    anchorY === 'top' ? 'center top' : 'center center';
  canvas.style.position = 'absolute';
  canvas.style.left = '0';
  canvas.style.top = '0';
  canvas.style.marginLeft = `${-w / 2}px`;
  if (anchorY === 'top') {
    canvas.style.marginTop = '0';
  } else if (anchorY === 'phone' && stageH > 0 && h > stageH + 1) {
    canvas.style.marginTop = `${-stageH / 2}px`;
  } else {
    canvas.style.marginTop = `${-h / 2}px`;
  }
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
}

function centerMovie(lwfInstance, movieInstance) {
  if (!lwfInstance || !movieInstance) return;
  const cx = (lwfInstance.width || 0) / 2;
  const cy = (lwfInstance.height || 0) / 2;
  if (typeof movieInstance.x === 'number') movieInstance.x = cx;
  if (typeof movieInstance.y === 'number') movieInstance.y = cy;
}

function attachScene(
  lwfInstance,
  sceneName,
  attachName,
  { play = false, center = true } = {},
) {
  if (!sceneName || !lwfInstance?.rootMovie?.attachMovie) return null;
  const resolved = pickScene(lwfInstance, sceneName) || sceneName;
  const names = extractSceneNames(lwfInstance);
  if (names.length && !names.includes(resolved)) {
    throw new Error(
      `scene "${sceneName}" not in LWF (have: ${names.slice(0, 16).join(', ')})`,
    );
  }
  const movie = lwfInstance.rootMovie.attachMovie(resolved, attachName);
  if (!movie) return null;

  if (center) centerMovie(lwfInstance, movie);
  movie.active = true;
  if (play) {
    movie.playing = true;
    if (typeof movie.gotoAndPlay === 'function') movie.gotoAndPlay(1);
    else if (typeof movie.gotoFrame === 'function') movie.gotoFrame(1);
  } else {
    movie.playing = false;
    if (typeof movie.gotoAndStop === 'function') movie.gotoAndStop(1);
    else if (typeof movie.gotoFrame === 'function') movie.gotoFrame(1);
  }
  return movie;
}

export {
  extractSceneNames,
  pickScene,
  fitLwfNative,
  sizeFxBody,
  centerMovie,
  attachScene,
  stageSizeFromDom,
  fxDisplayScale,
  halfDesignUnitScale,
  getEffScales,
  puzzleCharacterSizeScale,
};

export class LwfLayer {
  constructor(hostEl, log) {
    this.host = hostEl;
    this.log = log || (() => {});
    this.players = [];
    this._loadChain = Promise.resolve();
    this._refLock = false;
  }
  clear() {
    for (const p of this.players) {
      try {
        p.atlasRevoke?.();
      } catch {

      }
      try {
        p.lwf?.destroy?.();
      } catch {

      }
    }
    this.players = [];
    this.host.innerHTML = '';
    this._loadChain = Promise.resolve();
  }
  stepFrames(frameCount = 1, fps = 30) {
    this.tickEffects(0, -1, (1 / fps) * frameCount);
  }

  updateEffectViews(phase, frame, dtSec = 1 / 30) {
    this.tickEffects(phase, frame, dtSec);
    this.renderOnly();
  }

  tickEffects(phase, frame, dtSecOrNull = null, frameSteps = 1, opts = {}) {
    if (this._refLock) {
      this.renderOnly();
      return;
    }
    let steps = Math.max(1, Number(frameSteps) || 1);
    const wallDt = dtSecOrNull != null ? Number(dtSecOrNull) : NaN;
    const useWallDt = Number.isFinite(wallDt) && wallDt > 0;
    const unpausableOnly = !!opts?.unpausableOnly;
    for (const p of [...this.players]) {
      try {
        if (!p.lwf || p.expired || p.dormant) continue;
        if (Number.isFinite(p.timelineEnd) && frame >= p.timelineEnd) {
          this._softRetire(p);
          continue;
        }

        if (unpausableOnly && p.pausable !== false) continue;
        const startFrame = Number(p.startFrame) || 0;
        const local = Number(frame) - startFrame;
        const life = Number(p.life);
        const lifeOver =
          p.lifeLimited &&
          Number.isFinite(frame) &&
          frame >= 0 &&
          Number.isFinite(life) &&
          local > life;

        if (p.lifeLimited && !p.disposeOnEnd) p._holdingEnd = false;

        if (lifeOver) {
          this._softRetire(p);
          continue;
        }

        if (p._holdingEnd) continue;

        if (p._syncPaused && p.pausable !== false) {
          this._applyMoviePlaying(p, false);
          continue;
        }

        this._applyMoviePlaying(p, true);
        p._ticksAlive = (p._ticksAlive || 0) + 1;
        if (useWallDt) p.lwf.exec?.(wallDt);
        else this._advanceLwfFrames(p, steps);

        const end = this._movieEndState(p);
        if (!(end.reached || end.wrapped || end.nearEnd)) continue;

        if (this._shouldLoopClip(p)) {
          this._loopClip(p);
          continue;
        }
        const isCutscene = p.attr === 0x100 || p.attr === 0x80 || p.isMovie || p.life < 0;
        if (p.lifeLimited || (isCutscene && !LwfLayer.disposeOnMovieEnd(p.effectId))) {
          this._holdLastFrame(p);
          continue;
        }
        if (end.reached || end.wrapped || end.nearEnd) {
          this._softRetire(p);
          continue;
        }
      } catch {

      }
    }
  }

  _shouldLoopClip(p) {
    return !p?.forceHoldEnd && !!p?.lifeLimited && !p?.disposeOnEnd;
  }
  _loopClip(p) {
    const m = p.movie || p.lwf?.rootMovie;
    if (!m) return;
    p._holdingEnd = false;
    p._clipEnded = false;
    p._lastClipFrame = null;
    p._ticksAlive = 0;
    m.active = true;
    m.playing = true;
    if (typeof m.gotoAndPlay === 'function') m.gotoAndPlay(1);
    else if (typeof m.gotoFrame === 'function') m.gotoFrame(1);
  }

  _advanceLwfFrames(p, frameSteps = 1) {
    const lwf = p.lwf;
    if (!lwf) return;
    const fps = Math.max(1, Number(lwf.frameRate) || Number(lwf.data?.frameRate) || 30);

    const dt = frameSteps / fps;
    lwf.exec?.(dt);
  }

  static disposeOnMovieEnd(effectId) {
    const id = Number(effectId) || 0;
    if (id >= 1500 && id <= 1520) return true;
    if (id >= 1120 && id <= 1135) return true;
    if (id >= 3246 && id <= 3253) return true;
    return false;
  }
  _justWrapped(p) {
    return this._movieEndState(p).wrapped;
  }
  _holdLastFrame(p) {
    const m = p.movie || p.lwf?.rootMovie;
    if (m) {
      m.playing = false;
      const total = Number(m.totalFrames);
      if (typeof m.gotoAndStop === 'function' && total > 0) {
        m.gotoAndStop(Math.max(1, total));
      }
    }

    p._holdingEnd = true;
  }

  _movieEndState(p) {
    const m = p.movie || p.lwf?.rootMovie;
    if (!m) return { reached: false, wrapped: false, nearEnd: false };
    const total = Number(m.totalFrames);
    const cur = Number(m.currentFrame);
    const ticks = p._ticksAlive || 0;

    if (!(total > 2) || !Number.isFinite(cur)) {
      if (ticks >= 20 && m.playing === false) {
        return { reached: true, wrapped: false, nearEnd: false, atEnd: true };
      }
      return { reached: false, wrapped: false, nearEnd: false };
    }

    const minTicks = Math.min(12, Math.max(4, Math.floor(total * 0.15)));
    if (ticks < minTicks) {
      p._lastClipFrame = cur;
      return { reached: false, wrapped: false, nearEnd: false };
    }
    const wrapped =
      p._lastClipFrame != null &&
      p._lastClipFrame >= total - 1 &&
      cur <= 1;

    const nearEnd = !wrapped && cur >= total - 1;
    const atEnd = cur >= total;
    p._lastClipFrame = cur;
    return {
      reached: atEnd || wrapped,
      wrapped,
      atEnd,
      nearEnd,
    };
  }
  _movieReachedEnd(p) {
    return this._movieEndState(p).reached;
  }
  _movieFinished(p) {
    return this._movieEndState(p).reached;
  }

  releaseAll() {
    for (const p of [...this.players]) {
      if (!p.dormant) this._softRetire(p);
    }
  }

  releaseByAttr(attrMask) {
    const mask = Number(attrMask) >>> 0;
    if (!mask) {
      this.releaseAll();
      return;
    }
    for (const p of [...this.players]) {
      if (((Number(p.attr) >>> 0) & mask) !== 0) this._disposePlayer(p);
    }
  }

  finishByPhaseCount(phase, count) {
    const pPhase = Number(phase) || 0;
    const pCount = Number(count);
    if (!Number.isFinite(pCount) || pCount < 0) return;
    for (const p of [...this.players]) {
      if (p.expired || p.dormant) continue;
      const startPhase = Number(p.startPhase) || 0;
      const startFrame = Number(p.startFrame) || 0;
      if (startPhase <= pPhase && startFrame < pCount) {
        this._disposePlayer(p);
      }
    }
  }

  sweepFinished() {
    for (const p of [...this.players]) {
      if (p.expired || p._finished) this._disposePlayer(p);
    }
  }
  renderOnly() {
    for (const p of this.players) {
      try {
        if (!p.lwf || p.dormant || p.expired) continue;
        p.lwf.render?.();
      } catch {

      }
    }
  }

  getRootMovieFrame(player) {
    const p = player || this.getSyncPartner();
    if (!p) return null;
    const m = p.movie || p.lwf?.rootMovie;
    const cur = Number(m?.currentFrame);
    return Number.isFinite(cur) ? cur : null;
  }

  getSyncPartner(opts = {}) {
    const wantStart = Number(opts.startAbFrame);
    const hasWant = Number.isFinite(wantStart);
    let best = null;
    let bestScore = -Infinity;
    for (const p of this.players) {
      if (!p?.lwf || p.dormant || p.expired || p._holdingEnd) continue;
      const m = p.movie || p.lwf?.rootMovie;
      const total = Number(m?.totalFrames) || 0;
      if (total <= 2) continue;
      const start = Number(p.startFrame) || 0;

      let score = total;
      if (hasWant) {
        const d = Math.abs(start - wantStart);
        if (d > 8) continue;
        score += Math.max(0, 1000 - d * 50);
      }
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }

    return best;
  }

  setSyncPause(paused) {
    const on = !!paused;
    this._syncPausedAll = on;
    for (const p of this.players) {
      if (!p || p.dormant || p.expired) continue;
      if (p.pausable === false && !this._refLock) {
        p._syncPaused = false;
        this._applyMoviePlaying(p, true);
        continue;
      }
      p._syncPaused = on;
      this._applyMoviePlaying(p, !on);
    }
  }

  isRefLocked() {
    return !!this._refLock;
  }

  lockAtCurrent() {
    this._refLock = true;
    this.setSyncPause(true);
    for (const p of this.players) {
      if (!p?.lwf || p.dormant || p.expired) continue;
      p._syncPaused = true;
      p._refLocked = true;
      this._applyMoviePlaying(p, false);
      try {
        p.lwf.render?.();
      } catch {

      }
    }
  }

  unlockRef() {
    this._refLock = false;
    for (const p of this.players) {
      if (p) p._refLocked = false;
    }
  }

  seekPlayerToAbFrame(player, abFrame, abFps = 60) {
    const elapsed = Math.max(0, Number(abFrame) - (Number(player?.startFrame) || 0));
    const lwfFps = Number(player?.lwf?.frameRate) || 30;
    this._seekPlayerToElapsed(player, elapsed * lwfFps / abFps);
  }

  primePlayerToAbFrame(player, frame) {
    this.seekPlayerToAbFrame(player, frame);
    this._softRetire(player);
    player.timelinePrimedFrame = frame;
  }

  seekToAbFrame(abFrame, { frameStepsPerAb = 1, force = false } = {}) {
    if (this._refLock && !force) return;
    const f = Number(abFrame);
    if (!Number.isFinite(f)) return;
    for (const p of this.players) {
      if (!p?.lwf || p.expired) continue;
      if (Number.isFinite(p.timelineStart) && (f < p.timelineStart || f >= p.timelineEnd)) {
        if (!p.dormant) this._softRetire(p);
        continue;
      }
      const start = Number(p.startFrame) || 0;
      const elapsedAb = Math.floor(f - start);
      if (elapsedAb < 0) {
        if (!p.dormant) this._softRetire(p);
        continue;
      }
      const life = Number(p.life);
      if (
        p.lifeLimited &&
        Number.isFinite(life) &&
        life >= 0 &&
        elapsedAb > life
      ) {
        if (!p.dormant) this._softRetire(p);
        continue;
      }

      if (p.dormant || p._finished) {
        this.activatePlayer(p);
      }

      const execFrames = Math.max(0, elapsedAb * (Number(p.lwf.frameRate) || 30) / 60);
      this._seekPlayerToElapsed(p, execFrames);
    }
  }

  _flushLwf(lwf) {
    if (!lwf) return;
    try {
      if (typeof lwf.forceExecWithoutProgress === 'function') {
        lwf.forceExecWithoutProgress();
      } else if (typeof lwf.forceExec === 'function') {
        lwf.forceExec();
      } else {
        lwf.exec?.(0);
      }
    } catch {

    }
  }

  _seekPlayerToElapsed(p, elapsedFrames) {
    const lwf = p?.lwf;
    if (!lwf) return;
    const m = p.movie || lwf.rootMovie;
    if (!m) return;
    p.timelinePrimedFrame = null;
    const total = Math.max(1, Number(m.totalFrames) || 1);
    let elapsed = Math.max(0, Math.floor(Number(elapsedFrames) || 0));
    let target;
    if (p.lifeLimited && total > 1 && !p.disposeOnEnd) {
      target = (elapsed % total) + 1;
    } else {
      target = Math.min(total, elapsed + 1);
    }

    p._holdingEnd = false;
    p._clipEnded = false;
    p._finished = false;
    p.expired = false;
    p.dormant = false;
    if (p.wrap) {
      p.wrap.style.display = '';
      p.wrap.style.visibility = 'visible';
      p.wrap.style.opacity = String(Math.max(0, Math.min(1, p.alpha ?? 1)));
    }
    lwf.active = true;
    if (lwf.rootMovie) {
      lwf.rootMovie.active = true;
      lwf.rootMovie.playing = false;
    }
    m.active = true;
    m.playing = false;

    try {
      if (typeof m.gotoAndStop === 'function') m.gotoAndStop(target);
      else if (typeof m.gotoFrame === 'function') m.gotoFrame(target);
      else if (typeof m.gotoAndPlay === 'function') {
        m.gotoAndPlay(target);
        m.playing = false;
      }
    } catch {

    }

    this._flushLwf(lwf);

    let cur = Number(m.currentFrame);
    // Jumping only the outer movie leaves nested movies at their first frame.
    // Cropped timeline clips must execute the frames leading up to IN.
    const replayNested = Number.isFinite(p.timelineStart);
    if (replayNested || !Number.isFinite(cur) || Math.abs(cur - target) > 1) {
      try {
        if (typeof m.gotoAndPlay === 'function') m.gotoAndPlay(1);
        else if (typeof m.gotoFrame === 'function') m.gotoFrame(1);
        m.playing = true;
        this._flushLwf(lwf);
        const tick =
          Number(lwf.tick) > 0
            ? Number(lwf.tick)
            : 1 / Math.max(1, Number(lwf.frameRate) || 30);
        const hops = replayNested ? elapsed : Math.min(Math.max(0, target - 1), 4000);
        for (let i = 0; i < hops; i++) {
          lwf.exec?.(tick);
        }
        m.playing = false;
        this._flushLwf(lwf);
        cur = Number(m.currentFrame);
      } catch {

      }
    }

    const atEnd = total > 1 && (Number.isFinite(cur) ? cur : target) >= total;
    p._holdingEnd = atEnd && !p.lifeLimited;
    p._clipEnded = atEnd;
    p._lastClipFrame = Number.isFinite(cur) ? cur : target;
    p._ticksAlive = Math.max(1, elapsed + 1);
    if (this._refLock || this._syncPausedAll) {
      p._syncPaused = true;
      this._applyMoviePlaying(p, false);
    } else {
      p._syncPaused = false;
      this._applyMoviePlaying(p, true);
    }
    try {
      lwf.render?.();
    } catch {

    }
  }

  _applyMoviePlaying(p, playing) {
    const m = p?.movie || p?.lwf?.rootMovie;
    if (!m) return;
    try {
      m.playing = !!playing && !p._holdingEnd && !p.dormant && !p._syncPaused;
    } catch {

    }
  }

  activatePlayer(p, { preserveFrame = false } = {}) {
    if (!p) return;
    if (this._refLock) return;
    p.dormant = false;
    p.expired = false;
    p._clipEnded = false;
    p._holdingEnd = false;
    p._finished = false;
    p._heldRendered = false;
    p._lastClipFrame = null;
    p._ticksAlive = 0;
    p._endStreak = 0;
    p._seenNearEnd = false;
    p._syncPaused = false;

    if (p.preloadedCards?.size && p.lwf) {
      applyPreloadedCardImages(p.lwf, p.preloadedCards, this.log);
    }
    if (p.wrap) {
      p.wrap.style.display = '';
      p.wrap.style.visibility = 'visible';
      p.wrap.style.opacity = String(Math.max(0, Math.min(1, p.alpha ?? 1)));
      p.wrap.style.pointerEvents = 'none';
    }
    this._applyFx(p);
    if (p.lwf) p.lwf.active = true;
    if (p.lwf?.rootMovie) {
      p.lwf.rootMovie.active = true;
      p.lwf.rootMovie.playing = false;
    }

    const m = p.movie || p.lwf?.rootMovie;
    if (m) {
      m.active = true;
      m.playing = true;
      if (!preserveFrame) {
        if (typeof m.gotoAndPlay === 'function') m.gotoAndPlay(1);
        else if (typeof m.gotoFrame === 'function') m.gotoFrame(1);
      }
    }
    try {
      p.lwf?.exec?.(0);
      p.lwf?.render?.();
    } catch {

    }
  }
  resetForReplay() {
    for (const p of this.players) {
      try {
        if (Number.isFinite(p.timelineStart)) {
          const firstFrame = Math.max(p.timelineStart, p.startFrame);
          if (p.timelinePrimedFrame !== firstFrame) this.primePlayerToAbFrame(p, firstFrame);
          else this._softRetire(p);
          continue;
        }
        p.dormant = true;
        p.expired = false;
        p._clipEnded = false;
        p._holdingEnd = false;
        p._finished = false;
        p._heldRendered = false;
        p._lastClipFrame = null;
        p._ticksAlive = 0;
        p._endStreak = 0;
        p._seenNearEnd = false;
        if (p.wrap) {
          p.wrap.style.display = 'none';
          p.wrap.style.visibility = 'hidden';
          p.wrap.style.opacity = '0';
          p.wrap.style.pointerEvents = 'none';
        }
        if (p.lwf) p.lwf.active = false;
        const m = p.movie || p.lwf?.rootMovie;
        if (m) {
          m.playing = false;
          m.active = false;
          if (typeof m.gotoAndStop === 'function') m.gotoAndStop(1);
          else if (typeof m.gotoFrame === 'function') m.gotoFrame(1);
        }
      } catch {

      }
    }
  }
  _retirePlayer(p) {
    this._softRetire(p);
  }

  _softRetire(p) {
    if (!p) return;
    p.dormant = true;
    p.expired = false;
    p._clipEnded = true;
    p._holdingEnd = false;
    p._finished = true;
    if (p.wrap) {
      p.wrap.style.visibility = 'hidden';
      p.wrap.style.opacity = '0';
      p.wrap.style.display = 'none';
      p.wrap.style.pointerEvents = 'none';
    }
    if (p.lwf) p.lwf.active = false;
    if (p.lwf?.rootMovie) {
      p.lwf.rootMovie.playing = false;
      p.lwf.rootMovie.active = false;
    }
    const m = p.movie || p.lwf?.rootMovie;
    if (m) {
      m.playing = false;
      m.active = false;
    }

    try {
      const ctx = p.canvas?.getContext?.('2d');
      if (ctx && p.canvas) ctx.clearRect(0, 0, p.canvas.width, p.canvas.height);
    } catch {

    }
  }
  _disposePlayer(p) {

    this._softRetire(p);
  }
  _destroyPlayer(p) {
    p.expired = true;
    p.dormant = true;
    const i = this.players.indexOf(p);
    if (i >= 0) this.players.splice(i, 1);
    try {
      p.atlasRevoke?.();
    } catch {

    }
    try {
      p.lwf?.destroy?.();
    } catch {

    }
    try {
      p.wrap?.remove?.();
    } catch {

    }
  }
  async addEffect({
    lwfUrl,
    baseUrl,
    sceneName,
    zIndex = 250,
    offsetX = 0,
    offsetY = 0,
    instanceKey = '',
    imageMap = null,
    startPhase = 0,
    startFrame = 0,
    life = -1,
    lifeLimited = false,
    disposeOnEnd = false,
    effectId = 0,
    attr = 0,
    dormant = false,
    cacheTag = '',
  }) {

    const job = this._loadChain.then(() =>
      this._addEffectNow({
        lwfUrl,
        baseUrl,
        sceneName,
        zIndex,
        offsetX,
        offsetY,
        instanceKey,
        imageMap,
        startPhase,
        startFrame,
        life,
        lifeLimited,
        disposeOnEnd,
        effectId,
        attr,
        dormant,
        cacheTag,
      }),
    );
    this._loadChain = job.catch(() => {});
    return job;
  }
  async _addEffectNow({
    lwfUrl,
    baseUrl,
    sceneName,
    zIndex = 250,
    offsetX = 0,
    offsetY = 0,
    instanceKey = '',
    imageMap = null,
    startPhase = 0,
    startFrame = 0,
    life = -1,
    lifeLimited = false,
    disposeOnEnd = false,
    effectId = 0,
    attr = 0,
    dormant = false,
    cacheTag = '',
  }) {
    if (typeof window.LWF === 'undefined') {
      throw new Error('LWF.js not loaded');
    }
    ensureLwfCanvasBlendModes();
    const { w: stageW, h: stageH } = stageSizeFromDom(this.host);
    const absoluteUrl =
      lwfUrl.startsWith('http') || lwfUrl.startsWith('/')
        ? lwfUrl
        : ensureTrailingSlash(baseUrl) + lwfUrl;
    const assetUrl = withPatchQuery(absoluteUrl);
    const pathOnly = absoluteUrl.split('?')[0];
    const base = ensureTrailingSlash(
      baseUrl || pathOnly.slice(0, pathOnly.lastIndexOf('/') + 1),
    );
    const wrap = document.createElement('div');
    wrap.className = 'lwf-fx';

    wrap.style.cssText = `position:absolute;left:0;top:0;width:0;height:0;z-index:${zIndex};pointer-events:none;visibility:${dormant ? 'hidden' : 'visible'};display:${dormant ? 'none' : ''};transform-origin:center center;opacity:${dormant ? '0' : '1'};`;
    wrap.dataset.scene = sceneName || '';
    wrap.dataset.z = String(zIndex);
    this.host.appendChild(wrap);
    const canvas = document.createElement('canvas');
    canvas.className = 'lwf-canvas';
    canvas.style.background = 'transparent';
    wrap.appendChild(canvas);
    const player = await this._load(canvas, {
      assetUrl,
      baseUrl: base,
      sceneName,
      instanceKey,
      imageMap,
      play: !dormant,
      cacheTag: cacheTag || instanceKey,
    });
    player.wrap = wrap;
    player.zIndex = zIndex;
    player.assetUrl = assetUrl;
    player.startPhase = startPhase;
    player.startFrame = startFrame;
    player.life = life;

    player.lifeLimited = !!lifeLimited;
    player.effectId = Number(effectId) || 0;
    player.disposeOnEnd =
      disposeOnEnd || LwfLayer.disposeOnMovieEnd(player.effectId);
    player.attr = attr;
    player.dormant = !!dormant;
    player.expired = false;
    player.workId = instanceKey;

    player.followParent = (Number(attr) & 0x60) !== 0;
    player.followScaleZ = (Number(attr) & 0x40) !== 0;
    player.parentCharaId = null;
    player.parentTag = 0;
    player.parentOffX = Number(offsetX) || 0;
    player.parentOffY = Number(offsetY) || 0;
    player.parentScaleX = 1;
    player.parentScaleY = 1;
    const wk = Number(String(instanceKey).split('_')[0]);
    player.workIdNum = Number.isFinite(wk) ? wk : NaN;
    player.stageW = stageW;
    player.stageH = stageH;
    player.x = Number(offsetX) || 0;
    player.y = Number(offsetY) || 0;
    player.z = 0;
    player.sx = 1;
    player.sy = 1;
    player.rot = 0;
    player.alpha = 1;
    sizeFxBody(wrap, canvas, player.dispW || player.nativeW, player.dispH || player.nativeH, {
      anchorY: player.anchorY || 'middle',
      stageH,
    });

    if (dormant) {
      if (player.lwf) player.lwf.active = false;
      const m = player.movie || player.lwf?.rootMovie;
      if (m) {
        m.playing = false;
        m.active = false;
      }
      wrap.style.display = 'none';
      wrap.style.visibility = 'hidden';
      wrap.style.opacity = '0';
    } else {
      this._applyFx(player);
    }
    this.players.push(player);

    return player;
  }
  _findByWorkId(workId) {
    const id = Number(workId);
    if (!Number.isFinite(id)) return null;
    for (const p of this.players) {
      if (p.workIdNum === id) return p;
      if (Number(p.workId) === id) return p;
      const head = Number(String(p.workId || '').split('_')[0]);
      if (head === id) return p;
    }
    return null;
  }

  setEffMove(workId, x, y, z = 0) {
    const p = this._findByWorkId(workId);
    if (!p) return;
    p.x = Number(x) || 0;
    p.y = Number(y) || 0;
    if (z !== undefined && z !== null) p.z = Number(z) || 0;
    this._applyFx(p);
  }

  setEffScale(workId, sx, sy) {
    const p = this._findByWorkId(workId);
    if (!p) return;
    p.sx = Number(sx) || 1;
    p.sy = sy != null ? Number(sy) || 1 : p.sx;
    this._applyFx(p);
  }

  setEffRotate(workId, rot) {
    const p = this._findByWorkId(workId);
    if (!p) return;
    p.rot = Number(rot) || 0;
    this._applyFx(p);
  }

  setEffAlpha(workId, a) {
    const p = this._findByWorkId(workId);
    if (!p) return;
    const n = Number(a);
    p.alpha = n > 1 ? n / 255 : n;
    this._applyFx(p);
  }

  _applyFx(p) {
    if (!p?.wrap) return;

    const { w, h } = stageSizeFromDom(this.host);
    p.stageW = w;
    p.stageH = h;
    const cx = w / 2 + (Number(p.x) || 0);
    const cy = h / 2 - (Number(p.y) || 0);
    const psx = Number(p.parentScaleX) > 0 ? Number(p.parentScaleX) : 1;
    const psy = Number(p.parentScaleY) > 0 ? Number(p.parentScaleY) : 1;

    const sx = (Number(p.sx) || 1) * psx;
    const sy = (Number(p.sy) || 1) * psy;
    const rot = Number(p.rot) || 0;
    p.wrap.style.transform = `translate(${cx}px, ${cy}px) rotate(${rot}deg) scale(${sx}, ${sy})`;
    if (p.dormant || p.expired) {
      p.wrap.style.display = 'none';
      p.wrap.style.visibility = 'hidden';
      p.wrap.style.opacity = '0';
    } else {
      p.wrap.style.display = '';
      p.wrap.style.visibility = 'visible';
      p.wrap.style.opacity = String(Math.max(0, Math.min(1, p.alpha ?? 1)));
    }
    if (p.z != null) {
      p.wrap.style.zIndex = String(
        (Number(p.zIndex) || 0) + Math.round(Number(p.z) || 0),
      );
    }
  }

  syncFollowParents(charaLayer) {
    if (!charaLayer) return;
    for (const p of this.players) {
      if (p.dormant || p.expired || !p.followParent) continue;
      const id = Number(p.parentCharaId);
      if (!Number.isFinite(id) || id < 0) {
        p.parentScaleX = 1;
        p.parentScaleY = 1;
        this._applyFx(p);
        continue;
      }
      const c =
        charaLayer.chars?.get?.(id) ||
        (typeof charaLayer.ensure === 'function' ? charaLayer.ensure(id) : null);
      if (!c) continue;

      p.x = (Number(c.x) || 0) + (Number(p.parentOffX) || 0);
      p.y = (Number(c.y) || 0) + (Number(p.parentOffY) || 0);
      const base = getEffScales(p.effectId, c);

      const zScale = p.followScaleZ ? cameraScaleFactor(c.z) : 1;
      p.parentScaleX = base * zScale;
      p.parentScaleY = base * zScale;
      this._applyFx(p);
    }
  }
  async _load(canvas, { assetUrl, baseUrl, sceneName, instanceKey = '', imageMap = null, play = false, cacheTag = '' }) {
    const log = this.log;
    const playersLen = this.players.length;
    const { w: stageW, h: stageH } = stageSizeFromDom(this.host);

    return enqueueLwfLoad(async () => {
      const defaultMap = (name) => {
        let key = String(name || '').replace(/\\/g, '/');
        while (key.startsWith('./')) key = key.slice(2);
        while (key.startsWith('/')) key = key.slice(1);
        return withPatchQuery(baseUrl + key);
      };
      const baseMap = typeof imageMap === 'function' ? imageMap : defaultMap;
      const bytes = await fetchLwfBytes(assetUrl);
      log(`LWF bytes ${bytes.byteLength}`);
      const atlas = await prepareAtlasFitOverrides(assetUrl, baseMap, {
        log,
        bytes,
        prefetchBlobs: window.__ECLIPSE_TOOL__ === 'lua-player',
      });
      const mapFn = wrapImageMapWithAtlasFit(baseMap, atlas.overrides);
      const objectUrl = lwfBytesToObjectUrl(bytes);
      const revokeObject = () => {
        try {
          URL.revokeObjectURL(objectUrl);
        } catch {

        }
      };

      const preloadedCards = await preloadPatchedCardImages(
        imageMap?._patchedTextures,
        log,
      );

      let cache;
      try {
        cache = new window.LWF.ResourceCache();
      } catch {
        cache = window.LWF.ResourceCache.get();
      }

      let movie = null;
      let scene = null;
      let fit = null;
      let synced = 0;
      let injected = 0;
      let lwfInstance = null;

      try {
        lwfInstance = await loadLwfWithRetry(
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
              injected = applyPreloadedCardImages(inst, preloadedCards, log);
              synced = syncTextureMetricsToImages(inst, log);
              const disp = fxDisplayScale(inst.width, inst.height, stageW, stageH);
              fit = fitLwfNative(inst, canvas, {
                scaleX: disp.scaleX,
                scaleY: disp.scaleY,
                anchorY: disp.anchorY,
                stageH,
              });

              inst.active = !!play;
              if (inst.rootMovie) {
                inst.rootMovie.active = !!play;
                inst.rootMovie.playing = false;
              }
              scene = pickScene(inst, sceneName);
              const attachName =
                'mc_' + (scene || 'root') + '_' + (instanceKey || '0');
              movie = scene
                ? attachScene(inst, scene, attachName, { play, center: true })
                : null;
              if (!play && movie) {
                movie.active = false;
                movie.playing = false;
              }
            },
          },
          {
            retries: 3,
            log,
            timeoutMs: 120000, // 2 minutes to allow downloading all textures from CDN on first play
          },
        );
      } catch (e) {
        revokeObject();
        atlas.revoke();
        throw e;
      }

      log(
        'LWF ready scene=' +
          (scene || '(root)') +
          ' key=' +
          (instanceKey || '-') +
          ' native=' +
          fit.nativeW +
          'x' +
          fit.nativeH +
          ' disp=' +
          Math.round(fit.dispW) +
          'x' +
          Math.round(fit.dispH) +
          (fit.anchorY && fit.anchorY !== 'middle' ? ' anchor=' + fit.anchorY : '') +
          ' players=' +
          (playersLen + 1) +
          (atlas.fitted ? ' · atlas-fit ' + atlas.fitted : '') +
          (synced ? ' · stub-sync ' + synced : '') +
          (injected ? ` · card-inject ${injected}` : ''),
      );

      return {
        lwf: lwfInstance,
        canvas,
        sceneName: scene,
        movie,
        assetUrl,
        cache,
        nativeW: fit.nativeW,
        nativeH: fit.nativeH,
        dispW: fit.dispW,
        dispH: fit.dispH,
        unitScale: fit.unitScale,
        scaleX: fit.scaleX,
        scaleY: fit.scaleY,
        anchorY: fit.anchorY || 'middle',
        atlasFits: atlas.fitted,
        atlasRevoke: () => {
          revokeObject();
          atlas.revoke();
        },
        preloadedCards,
      };
    });
  }
}
