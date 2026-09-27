import { fetchEffectPack, classifyMedia } from './effect-pack.js';
import {
  effectZIndex,
  movieZIndex,
  isCutinEffectId,
  isCardFlashCutinId,
} from './layers.js';
import { rateFromCents } from './audio-bus.js';
import { makeCardTextureImageMapAsync } from './card-resolve.js';
import { LwfLayer } from './lwf-player.js?v=dokkan2026_v30';
import { syncUsmAndLwf } from './usm-lwf-sync.js?v=eclipse61';

const FPS = 60;

const IS_LOW_RATE_FPS = 0;

const USM_LEAD_FRAMES = 0;

function clampStretch(v) {
  let n = Number(v);
  if (!Number.isFinite(n)) return 1;

  if (n < 0.5) n = 0.5;
  if (n > 2) n = 2;
  return n;
}

export class ActionBankRunner {
  constructor({ log, lwf, usm, chara, bg, screenFade, audio, koOverlay, hud, statusEl, onStatus, onDone, onPreloadProgress }) {
    this.log = log;
    this.lwf = lwf;
    this.usm = usm;
    this.chara = chara;
    this.bg = bg || null;
    this.screenFade = screenFade || null;
    this.audio = audio;
    this.koOverlay = koOverlay || null;
    this._koOverlayTimer = null;
    this._koOverlayShown = false;
    this._koTriggerFrame = null;
    this._lastDamageFrame = null;
    this._hasCustomKoEffect = false;
    this._koEffectWorkId = null;
    this._koEffectId = null;
    this._koEffectIntegrated = false;
    this._hideStockKoScreen = false;
    this._endPhaseFrame = null;
    this._koVisualEndFrame = null;
    this._koHoldUntil = 0;
    this._koHoldTimer = null;
    this.hud = hud;
    this.statusEl = statusEl;
    this.onStatus = onStatus;
    this.onDone = onDone;
    this.onPreloadProgress = onPreloadProgress || null;
    this.commands = [];
    this.autoTimeStretch = 1;
    this.autoTimeScales = new Map();
    this.phase = 0;
    this.frame = 0;
    this.state = 0;
    this.highSpeed = false;
    this.step = (1 << IS_LOW_RATE_FPS);
    this.raf = null;
    this._loopGen = 0;
    this.playing = false;
    this.userPaused = false;
    this.pausedHidden = false;
    this.lastMs = 0;
    this.accum = 0;
    this.maxFrame = 0;
    this.fired = new Set();
    this.activeEffects = new Map();
    this.enemySide = false;
    this.movieMode = false;
    this.koPreviewEnabled = false;
    this.reactionPreview = false;
    this._movieModeCutinSpawnFrames = new Set();
    this._movieSetupById = new Map();
    this._usmStartedIds = new Set();
    this._cmdIndex = 0;
    this.seMeta = new Map();
    this.effectTexRules = new Map();
    this.attackerCard = null;
    this.enemyCard = null;
    this.attackerCardId = 0;
    this.enemyCardId = 0;
    this.pauseRemain = 0;
    this.ready = false;
    this.turboLite = false;

    this.onRecordFrame = null;

    this._usmStartGate = false;
    this._gatePending = null;
    this._usmGateGen = 0;
    this._timelineSeeked = false;
    this._fastForwarding = false;

    this._wallEpochMs = null;
    this._wallStepsDone = 0;
    this._fxPrepared = new Map();
    this._visHandler = () => {
      if (document.hidden) {
        this.pausedHidden = true;
        this.audio?.suspend?.();
        this.usm?.setAbPause?.(true);
        this.usm?.setSyncPause?.(true);
        this.lwf?.setSyncPause?.(true);
        this.chara?.setSyncPause?.(true);
        this._cancelRenderLoop();
      } else {
        // Always release the browser-hidden latch. Previously this stayed true
        // when the page became visible while auto-pause had set userPaused,
        // leaving the render loop permanently frozen even after resume().
        this.pausedHidden = false;
        if (this.playing && !this.userPaused) {
          void this.audio?.resume?.();
          this.usm?.setAbPause?.(false);
          this.usm?.setSyncPause?.(false);
          this.lwf?.setSyncPause?.(false);
          this.chara?.setSyncPause?.(false);
          this._lastTickMs = performance.now();
          this.accum = 0;
          this._loop();
        }
      }
    };
    document.addEventListener('visibilitychange', this._visHandler);
  }
  _meta(workId) {
    workId = Number(workId);
      if (!this.seMeta.has(workId)) {
        this.seMeta.set(workId, {
          startMs: 0,
          stretch: null,
          pitch: 0,
          volKeys: [],
          pitchKeys: [],
        });
      }
    return this.seMeta.get(workId);
  }
  resetTimeline() {
    this._preloadGeneration = (this._preloadGeneration || 0) + 1;

    this.ready = false;
    this.turboLite = false;
    this.userPaused = false;
    this.stop({ clearVisuals: true, silent: true });
    this.commands = [];
    this.autoTimeStretch = 1;
    this.autoTimeScales = new Map();
    this.phase = 0;
    this.frame = 0;
    this.state = 0;
    this.fired.clear();
    this.activeEffects.clear();
    this._fxPrepared.clear();
    this.maxFrame = 0;
    this._cmdIndex = 0;
    this.seMeta.clear();
    this._voiceHints?.clear();
    this._moviesPrepared?.clear();
    this.effectTexRules = new Map();
    this.lwf?.clear();
    this.usm?.clear();
    this.chara?.clear();
    this.bg?.clear?.();
    this.screenFade?.clear?.();
    this._clearKoScreen();
    this.audio?.clear();
    this.onStatus?.('reset', this);
  }

  resetForRebind() {
    this._preloadGeneration = (this._preloadGeneration || 0) + 1;
    this.audio?.cancelPending?.();
    this.ready = false;
    this.turboLite = false;
    this.userPaused = false;
    if (this.playing || this.userPaused) {
      this.stop({ clearVisuals: false, silent: true });
    }
    this.playing = false;
    this.commands = [];
    this.autoTimeStretch = 1;
    this.autoTimeScales = new Map();
    this.phase = 0;
    this.frame = 0;
    this.state = 0;
    this.fired.clear();
    this.activeEffects.clear();
    this._fxPrepared.clear();
    this.maxFrame = 0;
    this._cmdIndex = 0;
    this.seMeta.clear();
    this._voiceHints?.clear();
    this._moviesPrepared?.clear();
    this.effectTexRules = new Map();
    this.pauseRemain = 0;
    this._clearKoScreen();

    this.lwf?.clear?.();
    this.usm?.clear?.();
    this.audio?.silence?.();
    this.chara?.resetTransforms?.();
    this.onStatus?.('reset', this);
  }

  _currentAutoTimeScale() {
    if (this.autoTimeScales?.has(this.phase)) {
      const v = Number(this.autoTimeScales.get(this.phase));
      return Number.isFinite(v) ? v : -1;
    }
    return -1;
  }

  setCards({ attacker, enemy, attackerId, enemyId } = {}) {
    this.attackerCard = attacker || null;
    this.enemyCard = enemy || null;
    this.attackerCardId = Number(attackerId) || attacker?.id || 0;
    this.enemyCardId = Number(enemyId) || enemy?.id || 0;
    this.chara?.setCards?.({ attacker, enemy });
  }
  async setBattleBg(bgId) {
    if (!this.bg) return;
    await this.bg.loadLevelBg(bgId);
  }
  async setDokkanField(fieldId) {
    if (!this.bg || !fieldId) return;
    await this.bg.loadDokkanField(fieldId);
  }
  prepare() {

    this.commands.forEach((c, i) => {
      c._ord = i;
    });
    this.commands.sort(
      (a, b) => (a.frame || 0) - (b.frame || 0) || (a._ord || 0) - (b._ord || 0),
    );
    const damageFrames = this.commands
      .filter((c) => c.type === 'dealDamage')
      .map((c) => Number(c.frame) || 0);
    this._lastDamageFrame = damageFrames.length ? Math.max(...damageFrames) : null;
    this._koTriggerFrame = null;
    this._hasCustomKoEffect = false;
    this._koEffectWorkId = null;
    this._koEffectId = null;
    this._koEffectIntegrated = false;
    this._hideStockKoScreen = this.commands.some((c) => c.type === 'hideKoScreen');
    this._endPhaseFrame = null;
    this._koVisualEndFrame = null;
    this.seMeta.clear();
    let endPhaseFrame = null;
    let maxKeyFrame = 0;
    for (const c of this.commands) {
      const f = Number(c.frame) || 0;
      if (c.type === 'endPhase') {

        endPhaseFrame = f;
        this._endPhaseFrame = f;
      }
      if (c.type !== 'setStartTimeMs' && c.type !== 'setTimeStretch') {
        maxKeyFrame = Math.max(maxKeyFrame, f);
      }
      if (c.type === 'setStartTimeMs' && c.workId != null) {
        this._meta(c.workId).startMs = Number(c.ms) || 0;
      }
      if (c.type === 'setTimeStretch' && c.workId != null) {
        this._meta(c.workId).stretch = clampStretch(c.stretch);
      }
      if (c.type === 'setPitch' && c.workId != null) {
        if (c.frame == null || Number.isNaN(Number(c.frame))) {
          this._meta(c.workId).pitch = Number(c.pitch) || 0;
        } else {
          this._meta(c.workId).pitchKeys.push({
            frame: Number(c.frame) || 0,
            pitch: Number(c.pitch) || 0,
          });
        }
      }
      if (
        (c.type === 'setSeVolumeByWorkId' || c.type === 'setSeVolume') &&
        c.workId != null
      ) {
        this._meta(c.workId).volKeys.push({
          frame: Number(c.frame) || 0,
          vol: c.vol,
        });
      }
    }

    if (this.koPreviewEnabled && this._lastDamageFrame != null) {
      const effectEntries = this.commands.filter(
        (c) =>
          c.type === 'entryEffect' ||
          c.type === 'entryEffectAwaken' ||
          c.type === 'entryEffectTraining',
      );
      const effectTailFrame = (entry) => {
        const workId = Number(entry?.workId);
        let tail = Number(entry?.frame) || 0;
        if (!Number.isFinite(workId)) return tail;
        for (const c of this.commands) {
          if (Number(c?.workId) !== workId) continue;
          if (!String(c?.type || '').startsWith('setEff')) continue;
          tail = Math.max(tail, Number(c.frame) || 0);
        }
        return tail;
      };
      const visibleEffectStart = (entry, afterFrame = null) => {
        const workId = Number(entry?.workId);
        const entryFrame = Number(entry?.frame) || 0;
        const keys = this.commands
          .filter((c) => c.type === 'setEffAlphaKey' && Number(c.workId) === workId)
          .sort((a, b) => (Number(a.frame) || 0) - (Number(b.frame) || 0));
        let previousAlpha = null;
        for (const key of keys) {
          const frame = Number(key.frame) || 0;
          const alpha = Number(key.a) || 0;
          if (frame < entryFrame) continue;
          if (afterFrame != null && frame <= afterFrame) {
            previousAlpha = alpha;
            continue;
          }
          if (alpha > 0 && (previousAlpha == null || previousAlpha <= 0)) return frame;
          previousAlpha = alpha;
        }
        return null;
      };

      // Finish/Super scripts commonly schedule their K.O. effect slightly
      // before endPhase, then place its animation keys far beyond endPhase.
      // Active scripts more often place it simply after dealDamage. Detect the
      // tail shape first so all three script families use the same path.
      const analyzedEffects = effectEntries
        .map((entry) => ({ entry, tail: effectTailFrame(entry) }))
        .sort((a, b) => b.tail - a.tail || (Number(b.entry.frame) || 0) - (Number(a.entry.frame) || 0));
      const tailCandidates = analyzedEffects
        .filter(({ entry, tail }) => {
          const start = Number(entry.frame) || 0;
          const crossesEnd = endPhaseFrame != null && tail > endPhaseFrame;
          const startsAtEnd = endPhaseFrame != null && start >= endPhaseFrame - 12;
          const lateEnough = start >= this._lastDamageFrame - 240;
          return lateEnough && (crossesEnd || startsAtEnd);
        });
      const afterDamage = analyzedEffects
        .filter(({ entry }) => {
          const start = Number(entry.frame) || 0;
          return start > this._lastDamageFrame && (endPhaseFrame == null || start <= endPhaseFrame + 240);
        })
        .sort((a, b) => (Number(b.entry.frame) || 0) - (Number(a.entry.frame) || 0))[0];
      // Some Finish/USM scripts contain K.O. inside the main effect that began
      // at frame 0. hideKoScreen is the reliable signal in those files; pick
      // the effect whose scripted keys actually span the ending instead of
      // falling back to the dealDamage frame.
      const integrated = this._hideStockKoScreen
        ? analyzedEffects.find(({ entry, tail }) => {
            const start = Number(entry.frame) || 0;
            return (
              start <= this._lastDamageFrame &&
              (endPhaseFrame == null || tail >= endPhaseFrame - 6)
            );
          })
        : null;
      const dedicated = tailCandidates[0] || null;
      const selected = dedicated || integrated || afterDamage || null;
      const koEffect = selected?.entry || null;
      this._hasCustomKoEffect = Boolean(koEffect);
      this._koEffectWorkId = koEffect?.workId ?? null;
      this._koEffectId = koEffect?.effectId ?? null;
      this._koEffectIntegrated = Boolean(koEffect && selected === integrated);
      this._koTriggerFrame = koEffect
        ? this._koEffectIntegrated
          ? visibleEffectStart(koEffect, this._lastDamageFrame) ?? Math.max(
              this._lastDamageFrame + 1,
              (endPhaseFrame ?? this._lastDamageFrame + 2) - 2,
            )
          : visibleEffectStart(koEffect) ?? (Number(koEffect.frame) || 0)
        : this._hideStockKoScreen && endPhaseFrame != null
          ? endPhaseFrame
          : this._lastDamageFrame;
      if (koEffect) {
        this.log(
          `K.O. effect detected · id=${koEffect.effectId ?? '?'} work=${koEffect.workId ?? '?'} ` +
            `start=${Number(koEffect.frame) || 0} tail=${effectTailFrame(koEffect)} endPhase=${endPhaseFrame}`,
        );
      }
    }

    // Several official scripts start their custom K.O. LWF only 1–2 frames
    // before endPhase, then animate it after endPhase. Preserve every scripted
    // visual key here; the exact LWF duration is added after preload.
    const fallbackKoEnd =
      this.koPreviewEnabled && this._hasCustomKoEffect && this._koTriggerFrame != null
        ? this._koTriggerFrame + 30
        : 0;
    const koTailFrame =
      endPhaseFrame != null && this.koPreviewEnabled && this._hasCustomKoEffect
        ? Math.max(endPhaseFrame, maxKeyFrame, fallbackKoEnd)
        : endPhaseFrame;
    this.maxFrame = endPhaseFrame != null
      ? this.reactionPreview ? Math.max(endPhaseFrame, maxKeyFrame) : koTailFrame
      : Math.max(maxKeyFrame, fallbackKoEnd, 60);
    if (endPhaseFrame != null) {
      const before = this.commands.length;
      this.commands = this.commands.filter(
        (c) => (Number(c.frame) || 0) <= this.maxFrame,
      );
      const dropped = before - this.commands.length;
      if (dropped > 0) {
        this.log(`endPhase@${endPhaseFrame}: dropped ${dropped} cmds past visual tail`);
      }
      if (this.maxFrame > endPhaseFrame) {
        this.log(`K.O. visual tail: endPhase ${endPhaseFrame} → frame ${this.maxFrame}`);
      }
    }
    this.state = 1;
    this.ready = false;
    this.turboLite = false;
    this.chara?.ensure(0);
    this.chara?.ensure(1);
    this.onStatus?.('bound', this);
    this._paintHud();
    const skips = this.commands.filter((c) => c.type === 'skipFrame');
    const movies = this.commands.filter((c) => c.type === 'setupMovie');
    this.log(
      `bound · endFrame=${this.maxFrame}` +
        (endPhaseFrame != null ? ' (endPhase)' : ' (max key)') +
        ` · abStep=${this.step}` +
        (this.highSpeed ? ' (2×)' : ' (1× full-frame)') +
        (this.autoTimeScales?.size
          ? ` · autoScale=${[...this.autoTimeScales.entries()].map(([ph, s]) => `${ph}:${s}`).join(',')}`
          : ''),
    );
    if (skips.length) {
      this.log(
        `  skipFrame ×${skips.length}: ` +
          skips
            .map((c) => `phase=${c.phase || 0}→f${c.toFrame ?? c.frame}`)
            .join(', '),
      );
    } else {
      this.log('  skipFrame: none (is _IS_SKIP_ on and rebound?)');
    }
    if (movies.length) {
      this.log(
        `  setupMovie: ` +
          movies
            .map(
              (c) =>
                `id=${c.contentId}@f${c.frame || 0}` +
                (c.movieFrame ? ` movF=${c.movieFrame}` : ''),
            )
            .join(', '),
      );
    }
  }
  setHighSpeed(on) {

    this.highSpeed = !!on;
    this.step = (on ? 2 : 1) << IS_LOW_RATE_FPS;

    this.usm?.setPlaybackRate?.(on ? 2 : 1);
  }

  setMovieMode(on) {
    this.movieMode = !!on;
    if (this.movieMode) this._rebuildMovieModeWindows();
  }

  _rebuildMovieModeWindows() {
    const spawn = new Set();
    for (const c of this.commands || []) {
      if (c?.type !== 'entryEffect' && c?.type !== 'entryEffectAwaken' && c?.type !== 'entryEffectTraining') {
        continue;
      }
      if (!isCutinEffectId(c.effectId)) continue;
      spawn.add(Number(c.frame) || 0);
    }
    this._movieModeCutinSpawnFrames = spawn;
    if (spawn.size) {
      this.log(
        `Movie Mode: skip cutin/pause at f${[...spawn].sort((a, b) => a - b).join(', f')}`,
      );
    }
  }

  _isMovieModeCutinFrame(frame) {
    if (!this.movieMode) return false;
    const f = Number(frame) || 0;
    for (const spawn of this._movieModeCutinSpawnFrames) {
      if (f >= spawn && f <= spawn + 100) return true;
    }
    return false;
  }

  _shouldSkipMovieModeAudio(cmd) {
    if (!this.movieMode) return false;
    return this._isMovieModeCutinFrame(cmd?.frame);
  }

  setTurboLite(on) {
    this.turboLite = Boolean(on);
  }

  setEnemySide(_on) {

    this.enemySide = false;
    this.chara?.setEnemyPlayMode?.(false);
  }

  async preload() {
    if (!this.commands.length) {
      this.ready = false;
    this.turboLite = false;
      return;
    }
    if (this.movieMode) this._rebuildMovieModeWindows();
    this.log('Preloading packs / SE / voice / chara / LWF…');
    if (this.statusEl) this.statusEl.textContent = 'Preloading…';
    this.chara?.setCards?.({ attacker: this.attackerCard, enemy: this.enemyCard });
    this.chara?.ensure(0);
    this.chara?.ensure(1);
    const loaded = await this._preloadAll();
    if (loaded === false) return;
    this.ready = true;
    this.onStatus?.('ready', this);
    this._paintHud();
  }
  play() {
    if (!this.ready || !this.commands.length) {
      this.log('Not ready — Load must finish preloading first');
      return false;
    }
    if (this.playing && this.userPaused) {
      void this.resume();
      return true;
    }
    if (this.playing) return true;
    this.chara?.clearRefOverrides?.();
    this.audio?._ensureCtx?.();
    void this.audio?.resume?.();
    this.audio?.beginTimeline({ fps: FPS, stretch: 1 });

    this.lwf?.resetForReplay?.();
    this.usm?.clearClips?.();
    this.activeEffects.clear();
    this.chara?.resetTransforms?.();
    this._movieSetupById = new Map();
    this._usmStartedIds = new Set();

    this.chara?.loadKeysFromCommands?.(this.commands);
    this.chara?.rebindAnimes?.();
    this.frame = 0;
    this.phase = 0;
    this.fired.clear();
    this._cmdIndex = 0;
    this._timelineSeeked = false;
    this.pauseRemain = 0;
    this._koHoldUntil = 0;
    if (this._koHoldTimer) clearTimeout(this._koHoldTimer);
    this._koHoldTimer = null;
    this._koOverlayShown = false;
    this._clearKoScreen();
    this.userPaused = false;
    this.usm?.setSyncPause?.(false);
    this.lwf?.setSyncPause?.(false);
    this.chara?.setSyncPause?.(false);
    this.state = 4;
    this.accum = 0;
    this._lastTickMs = null;
    this._usmStartGate = false;
    this._gatePending = null;
    this._wallEpochMs = null;
    this._wallStepsDone = 0;
    this.playing = true;
    this.pausedHidden = document.hidden;
    this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
    this.onStatus?.('playing', this);
    this.log(
      `Play · ${this.commands.length} cmds · end=${this.maxFrame}` +
        ` · step=${this.step}` +
        (this.highSpeed ? ' (2×)' : ' (1×)') +
        ` · LWF=${this._fxPrepared.size}`,
    );

    this._usmStartGate = true;
    this._paintHud();
    void this._primeMoviesUpTo(0)
      .then(() => this._prerollUsmLead(USM_LEAD_FRAMES))
      .catch((e) => this.log(`USM prime: ${e.message || e}`))
      .finally(() => {
        if (!this.playing) return;
        this._usmStartGate = false;
        const n = this.usm?.clips?.length || 0;
        if (n) this.log(`USM primed · clips=${n}`);
        this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
        if (this.pauseRemain <= 0 && !this.userPaused) {
          this.usm?.setVisible?.(true);
          this.usm?.setAbPause?.(false);
          this.usm?.setSyncPause?.(false);
        }
        this._fireAt(0);
        this.chara?.evalAllAtFrame?.(0);
        this.chara?.renderOnly?.();
        if (this.userPaused || this.pausedHidden || document.hidden) {
          this.usm?.setAbPause?.(true);
          this.usm?.setSyncPause?.(true);
          this.lwf?.setSyncPause?.(true);
          this.chara?.setSyncPause?.(true);
          return;
        }
        this._loop();
      });
    return true;
  }
  pause() {
    if (!this.playing || this.userPaused) return false;
    this.userPaused = true;
    this.audio?.suspend?.();
    this.usm?.setAbPause?.(true);
    this.usm?.setSyncPause?.(true);
    this.lwf?.setSyncPause?.(true);
    this.chara?.setSyncPause?.(true);
    this._cancelRenderLoop();
    this._lastTickMs = null;
    this.onStatus?.('paused', this);
    this._notifyParentFrame();
    this.log(`Paused @ f${this.frame}`);
    this._paintHud();
    return true;
  }
  async resume() {
    if (!this.playing || !this.userPaused) return false;
    if (document.hidden) {
      this.pausedHidden = true;
      return false;
    }
    // A visibilitychange can arrive before the Streamlit host-tab event. Clear
    // the hidden latch defensively whenever the document is visible again.
    this.pausedHidden = document.hidden;
    this.chara?.clearRefOverrides?.();
    if (this._timelineSeeked) {
      await this.applySeekForResume(this.frame);
    } else {
      this.snapCharaToScriptFrame(this.frame);
    }
    this.userPaused = false;
    await this.audio?.resume?.();
    this.usm?.setAbPause?.(false);
    this.usm?.setSyncPause?.(false);
    this.lwf?.setSyncPause?.(false);
    this.chara?.setSyncPause?.(false);
    this._lastTickMs = performance.now();
    this.accum = 0;
    this.onStatus?.('playing', this);
    this._notifyParentFrame();
    this.log(`Resume @ f${this.frame}`);
    try {
      this.lwf?.renderOnly?.();
      this.bg?.lwf?.renderOnly?.();
    } catch {}
    this._paintHud();
    this._loop();
    return true;
  }

  _notifyParentFrame() {
    try {
      window.parent?.postMessage({
        type: 'dokkan:lua-frame',
        frame: this.frame,
        maxFrame: this.maxFrame,
        playing: Boolean(this.playing && !this.userPaused && !this.pausedHidden),
        paused: Boolean(this.userPaused || this.pausedHidden),
      }, '*');
    } catch {}
  }

  snapCharaToScriptFrame(frame) {
    const f = Math.max(0, Math.round(Number(frame) || 0));
    for (const c of this.chara?.chars?.values?.() || []) {
      if (c) c.refOverride = false;
    }
    try {
      this.chara?.evalAllAtFrame?.(f);
      this.chara?.renderOnly?.();
    } catch {

    }
  }

  async scrubToFrame(frame, { accurateUsm = false } = {}) {
    const max = Math.max(0, Number(this.maxFrame) || 0);
    const f = Math.max(0, Math.min(max, Math.round(Number(frame) || 0)));
    this.frame = f;
    this._timelineSeeked = true;
    this.pauseRemain = 0;
    this._usmStartGate = false;
    this._gatePending = null;
    this.audio?.silence?.();
    const stepMul = this.highSpeed ? 2 : 1;
    try {
      await this.usm?.seekToAbFrame?.(f, FPS, { accurate: !!accurateUsm });
    } catch {

    }
    try {
      this.lwf?.seekToAbFrame?.(f, { frameStepsPerAb: stepMul });
    } catch {

    }
    try {
      this.usm?.setSyncPause?.(true);
      this.lwf?.setSyncPause?.(true);
      this.usm?.setAbPause?.(true);
    } catch {

    }
    this._paintHud();
    return f;
  }

  async applySeekForResume(frame) {
    const max = Math.max(0, Number(this.maxFrame) || 0);
    const f = Math.max(0, Math.min(max, Math.round(Number(frame) || 0)));
    this.frame = f;
    this._timelineSeeked = false;
    this.pauseRemain = 0;
    this._usmStartGate = false;
    this._gatePending = null;
    this.audio?.silence?.();
    this._rebuildFiredUpTo(f);
    this.snapCharaToScriptFrame(f);
    const stepMul = this.highSpeed ? 2 : 1;
    try {
      await this.usm?.seekToAbFrame?.(f, FPS);
    } catch {

    }
    try {
      this.lwf?.seekToAbFrame?.(f, { frameStepsPerAb: stepMul });
    } catch {

    }
    this._paintHud();
    return f;
  }

  resyncAfterSeek(frame) {
    return this.scrubToFrame(frame);
  }

  _rebuildFiredUpTo(frame) {
    const f = Math.max(0, Math.round(Number(frame) || 0));
    this.fired.clear();
    this._cmdIndex = 0;
    const cmds = this.commands || [];
    while (this._cmdIndex < cmds.length) {
      const cmd = cmds[this._cmdIndex];
      const cf = cmd.frame == null ? 0 : Number(cmd.frame);
      const due = Number.isFinite(cf) ? cf : 0;
      if (due > f) break;
      const idx = this._cmdIndex;
      this._cmdIndex += 1;
      if (
        cmd.type === 'setStartTimeMs' ||
        cmd.type === 'setTimeStretch' ||
        (cmd.type === 'setPitch' && cmd.frame == null)
      ) {
        continue;
      }
      this.fired.add(`${idx}:${cmd.type}:${cmd.frame}`);
    }
  }

  _replayCharaVisualUpTo(frame) {
    this.snapCharaToScriptFrame(frame);
  }

  _jumpToFrame(toFrame, { phase = null } = {}) {
    const max = Math.max(0, Number(this.maxFrame) || 0);
    let f = Math.max(0, Math.round(Number(toFrame) || 0));
    if (max > 0) f = Math.min(f, max);
    if (phase != null && Number.isFinite(Number(phase))) {
      this.phase = Number(phase) || 0;
    }

    this.log(`skipFrame jump → f${f} (phase ${this.phase})`);
    this.audio?.silence?.();
    this.pauseRemain = 0;
    this._usmStartGate = false;
    this._gatePending = null;
    this._usmGateGen = (this._usmGateGen || 0) + 1;
    this._movieSetupById = new Map();
    this._usmStartedIds = new Set();
    this._fastForwarding = true;

    const skipTypes = new Set([
      'playSe',
      'playSeVer2',
      'playSeLife',
      'playVoice',
      'stopSe',
      'stopSeQueueId',
      'stopSeIfDoubleSpeed',
      'setSeVolume',
      'setSeVolumeByWorkId',
      'setVoiceVolume',
      'setPitch',
      'setStartTimeMs',
      'setTimeStretch',
      'skipFrame',
      'endPhase',
      'pauseAll',
      'delayAll',
      'pauseChara',
      'delayChara',
    ]);

    try {
      this.lwf?.resetForReplay?.();
      this.usm?.clearClips?.();
      this.activeEffects.clear();
      this.chara?.clearRefOverrides?.();
      this.chara?.resetTransforms?.();
      this.chara?.loadKeysFromCommands?.(this.commands);

      this.fired.clear();
      this._cmdIndex = 0;

      const cmds = this.commands || [];
      const movieCmds = [];
      while (this._cmdIndex < cmds.length) {
        const cmd = cmds[this._cmdIndex];
        const cf = cmd.frame == null ? 0 : Number(cmd.frame);
        const due = Number.isFinite(cf) ? cf : 0;
        if (due > f) break;
        const idx = this._cmdIndex;
        this._cmdIndex += 1;
        if (
          cmd.type === 'setStartTimeMs' ||
          cmd.type === 'setTimeStretch' ||
          (cmd.type === 'setPitch' && cmd.frame == null)
        ) {
          continue;
        }
        this.fired.add(`${idx}:${cmd.type}:${cmd.frame}`);
        if (skipTypes.has(cmd.type)) continue;
        if (cmd.type === 'setupMovie') {
          movieCmds.push(cmd);
          continue;
        }
        try {
          this._exec(cmd);
        } catch (e) {
          this.log(`skipFrame exec ${cmd.type}: ${e.message || e}`);
        }
      }

      this.frame = f;
      this.snapCharaToScriptFrame(f);

      const stepMul = this.highSpeed ? 2 : 1;
      try {
        this.lwf?.seekToAbFrame?.(f, { frameStepsPerAb: stepMul });
      } catch {

      }

      for (const mcmd of movieCmds) {
        const contentId = Number(mcmd.contentId);
        const setupFrame = Number(mcmd.frame) || 0;
        const paired = (this.commands || []).find(
          (c) =>
            (c.type === 'entryEffect' ||
              c.type === 'entryEffectAwaken' ||
              c.type === 'entryEffectTraining') &&
            Number(c.effectId) === contentId &&
            (Number(c.frame) || 0) >= setupFrame,
        );
        let playCmd = mcmd;
        if (paired) {
          const entryFrame = Number(paired.frame) || 0;
          if (entryFrame > f) continue;
          playCmd = { ...mcmd, frame: entryFrame, movieFrame: 0 };
        }
        if (Number.isFinite(contentId)) this._usmStartedIds.add(contentId);
        void this._setupMovie(playCmd)
          .then(() => {
            if (!this.playing) return;
            try {
              this.usm?.seekToAbFrame?.(f, FPS);
              this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
            } catch {

            }
          })
          .catch((e) => {
            this.log(`skipFrame movie: ${e.message || e}`);
          });
      }

      this._lastTickMs = performance.now();
      this.accum = 0;
      this._wallEpochMs = performance.now();
      this._wallStepsDone = 0;
    } finally {
      this._fastForwarding = false;
    }
  }

  stop({ clearVisuals = false, silent = false, silenceAudio = true } = {}) {
    const wasPlaying = this.playing;
    const wasPaused = this.userPaused;
    this.playing = false;
    this.userPaused = false;
    this.pauseRemain = 0;
    this._koHoldUntil = 0;
    if (this._koHoldTimer) clearTimeout(this._koHoldTimer);
    this._koHoldTimer = null;
    this._usmStartGate = false;
    this._gatePending = null;
    this._usmGateGen = (this._usmGateGen || 0) + 1;
    this._movieSetupById = new Map();
    this._usmStartedIds = new Set();
    this._clearKoScreen();
    this._cancelRenderLoop();
    if (silenceAudio) {
      this.audio?.silence?.() || this.audio?.clearPlayingOnly?.();
    }
    if (clearVisuals) {

      this.lwf?.clear?.();
      this.usm?.clear?.();
      this.screenFade?.clear?.();
      this._fxPrepared.clear();
      this.activeEffects.clear();
      this.fired.clear();
      this._cmdIndex = 0;
      this.frame = 0;
      this.chara?.resetTransforms?.();
    } else {

      this.lwf?.resetForReplay?.();
      this.usm?.clearClips?.();
      this.screenFade?.clear?.();
      this.activeEffects.clear();
      this.fired.clear();
      this._cmdIndex = 0;
      this.frame = 0;
      this.chara?.resetTransforms?.();
    }
    if (this.state === 4 || this.state === 8) this.state = 8;
    this._paintHud();
    if (!silent && (wasPlaying || wasPaused || clearVisuals)) {
      this.onStatus?.('stopped', this);
    }
  }
  async _preloadAll() {
    const preloadGeneration = this._preloadGeneration = (this._preloadGeneration || 0) + 1;
    const cancelled = () => preloadGeneration !== this._preloadGeneration;
    const seIds = new Set();
    const voiceIds = new Set();
    const effectCmds = [];
    const movieCmds = [];
    for (const c of this.commands) {
      if (c.type === 'playSe' || c.type === 'playSeVer2' || c.type === 'playSeLife') {
        if (c.cueId != null) seIds.add(Number(c.cueId));
      }
      if (c.type === 'playVoice' && c.cueId != null) {
        voiceIds.add(Number(c.cueId));

        if (!this._voiceHints) this._voiceHints = new Map();
        if (c.packageHint || c.name) {
          this._voiceHints.set(Number(c.cueId), String(c.packageHint || c.name || ''));
        }
      }
      if (
        c.type === 'entryEffect' ||
        c.type === 'entryEffectAwaken' ||
        c.type === 'entryEffectTraining'
      ) {
        effectCmds.push(c);
      }
      if (c.type === 'setupMovie') movieCmds.push(c);
    }

    const effectIds = [...new Set(effectCmds.map((c) => Number(c.effectId)).filter(Number.isFinite))];
    const movieIds = [...new Set(movieCmds.map((c) => Number(c.contentId)).filter(Number.isFinite))];
    const seList = [...seIds];
    const voiceList = [...voiceIds];
    // Start voices alongside visual loading, but do not start the timeline
    // until their first load has finished (otherwise frame-zero dialogue is late).
    const voiceWarmup = (async () => {
      for (let i = 0; i < voiceList.length && !cancelled(); i += 3) {
        await Promise.all(voiceList.slice(i, i + 3).map(id =>
          this.audio?.preloadVoice(id, this._voiceHints?.get(id) || '').catch(() => null)));
      }
    })();

    // Visual items: 1 chara model + N movies + M effects
    const visualTotal = Math.max(1, 1 + movieIds.length + effectCmds.length);
    let loadedVisuals = 0;
    const failedItems = [];
    const activeTasks = new Map();
    let latestActiveItem = 'Bắt đầu nạp tài nguyên...';

    const notifyStart = (itemName, kind = 'file', initialDetail = '') => {
      activeTasks.set(itemName, { startTime: performance.now(), percent: 0, detail: initialDetail });
      latestActiveItem = itemName;
      if (this.onPreloadProgress) {
        this.onPreloadProgress({
          loaded: loadedVisuals,
          total: visualTotal,
          percent: Math.min(99, Math.round((loadedVisuals / visualTotal) * 100)),
          item: itemName,
          isStarting: true,
          isOk: true,
          activeTasks: Array.from(activeTasks.entries()).map(([k, t]) => ({
            name: k,
            elapsed: ((performance.now() - t.startTime) / 1000).toFixed(1),
            percent: t.percent,
            detail: t.detail,
          })),
          failedItems: [...failedItems],
        });
      }
      if (this.statusEl) {
        this.statusEl.textContent = `Đang tải: ${itemName}...`;
      }
    };

    const notifyUpdate = (itemName, percent, detail = '') => {
      const t = activeTasks.get(itemName);
      if (t) {
        t.percent = percent;
        t.detail = detail;
      }
      if (this.statusEl) {
        this.statusEl.textContent = `${itemName} · ${detail || percent + '%'}`;
      }
    };

    const notifyProgress = (itemName, isOk = true, errorMsg = '') => {
      activeTasks.delete(itemName);
      loadedVisuals++;
      if (!isOk) {
        failedItems.push({ name: itemName, error: errorMsg || 'Lỗi nạp' });
      }
      const percent = Math.min(100, Math.round((loadedVisuals / visualTotal) * 100));
      if (this.onPreloadProgress) {
        this.onPreloadProgress({
          loaded: loadedVisuals,
          total: visualTotal,
          percent,
          item: itemName,
          isStarting: false,
          isOk,
          error: errorMsg,
          activeTasks: Array.from(activeTasks.entries()).map(([k, t]) => ({
            name: k,
            elapsed: ((performance.now() - t.startTime) / 1000).toFixed(1),
            percent: t.percent,
            detail: t.detail,
          })),
          failedItems: [...failedItems],
        });
      }
      if (this.statusEl) {
        this.statusEl.textContent = `Đang tải: ${percent}% · ${itemName}`;
      }
    };

    // Active timer ticker to update elapsed seconds and download progress smoothly
    const ticker = setInterval(() => {
      if (cancelled()) { clearInterval(ticker); return; }
      if (this.onPreloadProgress && activeTasks.size > 0) {
        const tasks = Array.from(activeTasks.entries()).map(([k, t]) => ({
          name: k,
          elapsed: ((performance.now() - t.startTime) / 1000).toFixed(1),
          percent: t.percent,
          detail: t.detail,
        }));
        this.onPreloadProgress({
          loaded: loadedVisuals,
          total: visualTotal,
          percent: Math.min(99, Math.round((loadedVisuals / visualTotal) * 100)),
          item: latestActiveItem,
          isStarting: true,
          isOk: true,
          activeTasks: tasks,
          failedItems: [...failedItems],
        });
      }
    }, 120);

    if (this.onPreloadProgress) {
      this.onPreloadProgress({
        loaded: 0,
        total: visualTotal,
        percent: 0,
        item: 'Bắt đầu nạp tài nguyên hoạt ảnh...',
        isOk: true,
        error: '',
        activeTasks: [],
        failedItems: [],
      });
    }

    const onSite = window.__ECLIPSE_TOOL__ === 'lua-player';

    // Prefetch effect and movie metadata
    this.log(`  Fetching metadata · effects=${effectIds.length} · movies=${movieIds.length}`);
    await Promise.all([
      ...effectIds.map(async (id) => {
        try {
          return await fetchEffectPack(id, { enemy: this.enemySide });
        } catch {
          return null;
        }
      }),
      ...movieIds.map(async (id) => {
        try {
          return await fetchEffectPack(id, { enemy: this.enemySide });
        } catch {
          return null;
        }
      }),
    ]);

    if (cancelled()) { clearInterval(ticker); return false; }
    // STEP 1: Load Characters
    const charaLabel = `Nhân vật (${this.attackerCard?.name || 'Card #' + (this.attackerCard?.id || '?')})`;
    notifyStart(charaLabel, 'chara');
    this.log('  [1/3] Loading characters…');
    try {
      await this.chara?.loadAll?.();
      this.log('  Characters ready');
      notifyProgress(charaLabel, true);
    } catch (e) {
      this.log(`  Chara load moved on: ${e.message || e}`);
      notifyProgress(charaLabel, false, e.message || 'Lỗi nạp nhân vật');
    }

    // STEP 2: Load Video Cutscenes / USM sequentially 1 by 1 with real-time download %
    this._moviesPrepared = new Map();
    for (let m = 0; m < movieIds.length; m++) {
      if (cancelled()) { clearInterval(ticker); return false; }
      const id = movieIds[m];
      let pack = null;
      try {
        pack = await fetchEffectPack(id, { enemy: this.enemySide });
      } catch (err) {
        this.log(`  setupMovie ${id} metadata fetch error: ${err.message || err}`);
      }

      const fname = pack?.usm?.rel ? (pack.usm.rel.split('/').pop() || `${id}.mp4`) : '';
      const movieLabel = fname ? `Video Cutscene #${id} (${fname})` : `Video Cutscene #${id}`;
      const initSizeMb = pack?.usm?.bytes ? (pack.usm.bytes / 1024 / 1024).toFixed(1) : '';
      const initDetail = initSizeMb ? `0% (0.0/${initSizeMb} MB)` : 'Đang kết nối tải...';
      notifyStart(movieLabel, 'movie', initDetail);

      if (pack?.usm?.rel) {
        this._moviesPrepared.set(id, pack);
        this.log(`  [2/3] Movie preload ${id} (${m + 1}/${movieIds.length})…`);
        try {
          await this.usm?.preloadFromAssetRel?.(pack.usm.rel, {
            stamp: pack.usm.stamp || '',
            onProgress: (p) => {
              const loadedMb = (p.loaded / 1024 / 1024).toFixed(1);
              const totalMb = p.total > 0 ? (p.total / 1024 / 1024).toFixed(1) : initSizeMb || '?';
              const detail = `${p.percent}% (${loadedMb}/${totalMb} MB)`;
              notifyUpdate(movieLabel, p.percent, detail);
            },
          });
          notifyProgress(movieLabel, true);
        } catch (e) {
          this.log(`  setupMovie preload ${id}: ${e.message || e}`);
          notifyProgress(movieLabel, false, e.message || 'Lỗi tải video');
        }
      } else {
        this.log(`  setupMovie ${id}: no USM (${pack?.media || 'missing'})`);
        notifyProgress(movieLabel, false, 'Không có tệp USM');
      }
    }

    if (cancelled()) { clearInterval(ticker); return false; }
    // STEP 3: Load Effect LWFs sequentially 1 by 1
    this._fxPrepared.clear();
    this.lwf?.clear?.();
    let loaded = 0;
    this.log(`  [3/3] Loading effect LWFs · ${effectCmds.length} sequentially`);
    for (let e = 0; e < effectCmds.length; e++) {
      if (cancelled()) { clearInterval(ticker); return false; }
      const cmd = effectCmds[e];
      const lbl = `Hoạt ảnh LWF #${cmd.effectId} (${e + 1}/${effectCmds.length})`;
      notifyStart(lbl, 'lwf');
      try {
        let ok = await this._prepareEffect(cmd);
        if (!ok) {
          this.log(`  effect ${cmd.effectId} initial prepare incomplete — retrying pass…`);
          ok = await this._prepareEffect(cmd);
        }
        if (ok) loaded += 1;
        notifyProgress(lbl, Boolean(ok), ok ? '' : 'Lỗi nạp LWF');
      } catch (err) {
        this.log(`  effect ${cmd.effectId} first attempt error: ${err.message || err} — retrying…`);
        try {
          const okRetry = await this._prepareEffect(cmd);
          if (okRetry) loaded += 1;
          notifyProgress(lbl, Boolean(okRetry), okRetry ? '' : 'Lỗi nạp LWF');
        } catch (err2) {
          notifyProgress(lbl, false, err.message || 'Lỗi nạp LWF');
        }
      }
    }

    if (cancelled()) { clearInterval(ticker); return false; }
    this._refineKoTimelineFromPreparedEffect();
    this._refineReactionTimelineFromPreparedEffects();
    if (this.koPreviewEnabled && this._hasCustomKoEffect) {
      const hasKoLwf = this._fxPrepared.has(Number(this._koEffectWorkId));
      const hasKoUsm = this._moviesPrepared?.has?.(Number(this._koEffectId));
      if (!hasKoLwf && !hasKoUsm) {
        this.log(
          `K.O. asset unavailable · effect=${this._koEffectId ?? '?'} ` +
            `→ fallback @ f${this._endPhaseFrame ?? this._lastDamageFrame ?? 0}`,
        );
        this._hasCustomKoEffect = false;
        this._koEffectIntegrated = false;
        this._koTriggerFrame = this._endPhaseFrame ?? this._lastDamageFrame;
      }
    }

    if (voiceList.length) {
      notifyStart('Voice nhân vật', 'audio');
      await voiceWarmup;
    }
    clearInterval(ticker);
    if (cancelled()) return false;

    if (this.onPreloadProgress) {
      this.onPreloadProgress({
        loaded: visualTotal,
        total: visualTotal,
        percent: 100,
        item: failedItems.length
          ? `Hoàn tất hình ảnh với ${failedItems.length} lỗi (âm thanh đang nạp ngầm)`
          : '✅ Sẵn sàng phát hoạt ảnh! (Âm thanh đang nạp ngầm)',
        isOk: failedItems.length === 0,
        error: '',
        failedItems: [...failedItems],
        finished: true,
      });
    }

    this.ready = true;
    this.onStatus?.('ready', this);
    this._paintHud();

    // STEP 4: Preload Audio SE & Voice asynchronously in the background without blocking animation playback
    const preloadAudioBackground = async () => {
      if (!seList.length && !voiceList.length) return;
      this.log(`  [Background] Audio preload starting · SE=${seList.length} · Voice=${voiceList.length}`);
      const concurrency = onSite ? 3 : 5;
      const queue = [
        ...seList.map((id) => ({ kind: 'se', id })),
      ];
      let done = 0;
      let ok = 0;
      for (let i = 0; i < queue.length; i += concurrency) {
        if (preloadGeneration !== this._preloadGeneration) return;
        const batch = queue.slice(i, i + concurrency);
        await Promise.all(
          batch.map(async (item) => {
            try {
              const buf =
                item.kind === 'se'
                  ? await this.audio?.preloadSe(item.id)
                  : await this.audio?.preloadVoice(item.id, item.hint || '');
              if (buf) ok += 1;
            } catch {
              // Ignore background audio errors; AudioBus will fetch on demand during playback
            } finally {
              done += 1;
            }
          }),
        );
        if (done === queue.length || done % 20 === 0) {
          this.log(`  [Background] Audio progress ${done}/${queue.length} · ok=${ok}`);
        }
      }
      this.log(`  [Background] Audio preload finished · ${ok}/${queue.length}`);
    };
    void preloadAudioBackground();

    this.log(
      `Preload done · LWF=${loaded}/${effectCmds.length}` +
        ` · USM=${this._moviesPrepared?.size || 0}/${movieIds.length}` +
        ` · SE=${seIds.size} · voice=${voiceIds.size}`,
    );
    const seSched = [...this.commands]
      .filter((c) => c.type === 'playSe' || c.type === 'playSeVer2' || c.type === 'playSeLife')
      .slice(0, 12)
      .map((c) => `${c.cueId}@f${c.frame || 0}`)
      .join(', ');
    if (seSched) this.log(`  SE schedule (first): ${seSched}`);
    const voSched = [...this.commands]
      .filter((c) => c.type === 'playVoice')
      .map((c) => `${c.cueId}@f${c.frame || 0}`)
      .join(', ');
    if (voSched) this.log(`  Voice schedule: ${voSched}`);
    if (!this.attackerCard?.found) this.log('  WARN: attacker card missing — set Attacker card id');
    if (!this.enemyCard?.found) this.log('  WARN: enemy card missing — set Enemy card id');
  }

  async preloadVoiceCues() {
    if (!this.commands || !this.audio) return;
    const voiceCmds = this.commands.filter((c) => c.type === 'playVoice' && c.cueId != null);
    const voiceIds = new Set(voiceCmds.map((c) => Number(c.cueId)));
    for (const id of voiceIds) {
      const hint = this._voiceHints?.get(id) || '';
      try {
        await this.audio.preloadVoice(id, hint);
      } catch {}
    }
  }

  _loop() {
    this._cancelRenderLoop();
    const loopGen = this._loopGen;
    const frameSec = 1 / FPS;
    const tick = (now) => {
      if (loopGen !== this._loopGen || !this.playing) return;
      this.raf = null;

      if (this.userPaused || this.pausedHidden || document.hidden) {
        this._lastTickMs = now;
        this.lwf?.renderOnly?.();
        this.chara?.renderOnly?.();
        this.bg?.lwf?.renderOnly?.();
        this._paintHud();
        return;
      }

      if (this._usmStartGate) {
        this._lastTickMs = now;
        this.lwf?.renderOnly?.();
        this.chara?.renderOnly?.();
        this.bg?.lwf?.renderOnly?.();
        this.usm?.clips?.forEach?.((c) => {
          try {
            this.usm._blitClip?.(c);
          } catch {

          }
        });
        this._paintHud();
        this.raf = requestAnimationFrame(tick);
        return;
      }

      if (this._lastTickMs == null) {
        this._lastTickMs = now;
        this._wallEpochMs = now;
        this._wallStepsDone = 0;
      }

      const recording = !!this.onRecordFrame;
      const is2xMode = !!this.highSpeed;
      let steps = 0;
      const usmLive = !!this.usm?.hasActiveClips?.();

      if (usmLive) {
        syncUsmAndLwf(this.usm, this.lwf, this.chara);
      }

      if (recording) {

        this._advance(this.step);
        const visualSteps = is2xMode ? 2 : 1;
        const visualSec = frameSec * visualSteps;
        if (this.pauseRemain > 0) {

          this.usm?.setAbPause?.(true);
          this.lwf?.tickEffects?.(this.phase, this.frame, visualSec, 1, {
            unpausableOnly: true,
          });
          this.screenFade?.tick?.(visualSec);
        } else {
          syncUsmAndLwf(this.usm, this.lwf, this.chara);
          this.usm?.syncMasterTimer?.(frameSec);
          this.lwf?.tickEffects?.(this.phase, this.frame, visualSec);
          this.chara?.tick?.(visualSteps, FPS);
          this.bg?.tick?.(visualSec);
          this.screenFade?.tick?.(visualSec);
        }
        steps = 1;
        this._lastTickMs = now;
      } else {
        let dtSec = (now - this._lastTickMs) / 1000;
        this._lastTickMs = now;
        if (!(dtSec > 0) || dtSec > 0.08) dtSec = frameSec;
        this.accum += dtSec;

        const rate = is2xMode ? 2 : 1;
        const visualSec = dtSec * rate;
        const maxCatch = usmLive ? 2 : 4;
        while (this.accum >= frameSec && steps < maxCatch && this.playing) {
          if (this._usmStartGate) break;
          this.accum -= frameSec;
          this._advance(this.step);
          if (this.pauseRemain > 0) {
            this.usm?.setAbPause?.(true);
          } else {
            syncUsmAndLwf(this.usm, this.lwf, this.chara);
            this.usm?.syncMasterTimer?.(frameSec);
          }
          steps += 1;
        }
        if (this.accum > frameSec * 4) this.accum = frameSec;

        if (this.pauseRemain > 0) {
          this.lwf?.tickEffects?.(this.phase, this.frame, visualSec, 1, {
            unpausableOnly: true,
          });
          this.screenFade?.tick?.(visualSec);
        } else if (!this._usmStartGate) {
          this.lwf?.tickEffects?.(this.phase, this.frame, visualSec);
          this.chara?.tick?.(visualSec * FPS, FPS);
          this.bg?.tick?.(visualSec);
          this.screenFade?.tick?.(visualSec);
        }
      }

      if (this.pauseRemain <= 0) {
        this.usm?.setAbPause?.(false);
      }

      if (this._isKoVisualComplete()) {
        this._finishOrHoldKo();
      }

      this.lwf?.renderOnly?.();
      this.chara?.renderOnly?.();
      this.bg?.lwf?.renderOnly?.();
      this._paintHud();

      if (now - (this._parentFrameNoticeAt || 0) >= 100) {
        this._parentFrameNoticeAt = now;
        try {
          this._notifyParentFrame();
        } catch {}
      }

      void this._afterTick(tick, steps, loopGen);
    };
    this.accum = 0;
    this._lastTickMs = null;
    this._wallEpochMs = null;
    this._wallStepsDone = 0;
    this.raf = requestAnimationFrame(tick);
  }

  async _afterTick(tick, steps, loopGen) {
    if (steps > 0 && this.onRecordFrame) {
      this.usm?.setAbPause?.(true);
      try {
        await this.onRecordFrame(steps);
      } catch {

      } finally {
        if (this.playing && this.pauseRemain <= 0) {
          this.usm?.setAbPause?.(false);
        }
      }
    }
    if (
      this.playing &&
      loopGen === this._loopGen &&
      !this.userPaused &&
      !this.pausedHidden &&
      !document.hidden &&
      this._koHoldUntil <= 0
    ) {
      this.raf = requestAnimationFrame(tick);
    }
  }
  _advance(step = 1) {
    for (let s = 0; s < step; s++) {
      if (this._usmStartGate) return;
      if (this.frame > this.maxFrame) {
        this._finishOrHoldKo();
        return;
      }
      if (this.pauseRemain > 0) {
        this.pauseRemain -= 1;
        continue;
      }
      this._fireAt(this.frame);

      this.chara?.evalAllAtFrame?.(this.frame);

      this.lwf?.syncFollowParents?.(this.chara);
      if (!this.playing) return;

      if (this._usmStartGate) return;
      this.frame += 1;
      if (this.frame > this.maxFrame) {
        this._finishOrHoldKo();
        return;
      }
    }
  }
  _isKoVisualComplete() {
    if (
      !this.playing ||
      !this.koPreviewEnabled ||
      !this._hasCustomKoEffect ||
      this._koHoldUntil > 0 ||
      this._koTriggerFrame == null ||
      this.frame < Number(this._koTriggerFrame) ||
      (this._endPhaseFrame != null && this.frame < Number(this._endPhaseFrame))
    ) {
      return false;
    }
    const effect = this.activeEffects.get(this._koEffectWorkId);
    const player = effect?.player;
    const hasLwf = Boolean(player?.lwf);
    const lwfDone = !hasLwf || Boolean(player._holdingEnd || player._finished || player._clipEnded);
    const koClips = (this.usm?.clips || []).filter(
      (clip) => Number(clip?.contentId) === Number(this._koEffectId),
    );
    const usmDone = koClips.every((clip) => {
      const duration = Number(clip?.video?.duration);
      return Boolean(
        clip?.video?.ended ||
        (duration > 0 && Number(clip?.masterTime) >= duration - 1 / FPS)
      );
    });
    return (hasLwf || koClips.length > 0) && lwfDone && usmDone;
  }

  _finishOrHoldKo() {
    if (this._koHoldUntil > 0) return;
    if (this.koPreviewEnabled && this._hasCustomKoEffect && this._koTriggerFrame != null) {
      this.frame = this.maxFrame;
      this._koHoldUntil = performance.now() + 2000;
      this.usm?.setAbPause?.(true);
      this.usm?.setSyncPause?.(true);
      this.lwf?.setSyncPause?.(true);
      this.chara?.setSyncPause?.(true);
      this.lwf?.renderOnly?.();
      this.chara?.renderOnly?.();
      this.bg?.lwf?.renderOnly?.();
      this.usm?.clips?.forEach?.((c) => {
        try { this.usm._blitClip?.(c); } catch {}
      });
      this.log(`K.O. final frame hold · 2.0s @ f${this.maxFrame}`);
      this._paintHud();
      if (this._koHoldTimer) clearTimeout(this._koHoldTimer);
      this._koHoldTimer = setTimeout(() => {
        this._koHoldTimer = null;
        if (!this.playing || this._koHoldUntil <= 0) return;
        this._koHoldUntil = 0;
        this._finish();
      }, 2000);
      return;
    }
    this._finish();
  }
  _finish() {
    if (this.state === 9 && !this.playing) return;
    this.state = 9;
    this.playing = false;
    this.pauseRemain = 0;
    this._koHoldUntil = 0;
    if (this._koHoldTimer) clearTimeout(this._koHoldTimer);
    this._koHoldTimer = null;
    this._cancelRenderLoop();
    this.activeEffects.clear();
    this._paintHud();
    this.onStatus?.('done', this);

    const done = this.onDone?.(this);
    const teardown = () => {
      this.lwf?.releaseAll?.();
      this.usm?.clearClips?.();
      this.audio?.silence?.() || this.audio?.clearPlayingOnly?.();
      this.screenFade?.clear?.();
      this._paintHud();
    };
    if (done && typeof done.then === 'function') {
      done.finally(teardown);
    } else {
      teardown();
    }
  }
  _fireAt(frame) {
    this._maybeShowKoScreen(frame);
    const cmds = this.commands;
    while (this._cmdIndex < cmds.length) {
      const cmd = this.commands[this._cmdIndex];
      const cf = cmd.frame == null ? 0 : Number(cmd.frame);
      const due = Number.isFinite(cf) ? cf : 0;
      if (due > frame) break;
      this._cmdIndex += 1;
      if (
        cmd.type === 'setStartTimeMs' ||
        cmd.type === 'setTimeStretch' ||
        (cmd.type === 'setPitch' && cmd.frame == null)
      ) {
        continue;
      }
      const key = `${this._cmdIndex - 1}:${cmd.type}:${cmd.frame}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      this._exec(cmd);
      if (!this.playing) return;
      if (cmd.type === 'skipFrame') return;
      if (cmd.type === 'setupMovie' && this._usmStartGate && !this._fastForwarding) {
        this._parkCmdsUntilUsmReady(frame);
        return;
      }
    }
  }

  _parkCmdsUntilUsmReady(frame) {
    const cmds = this.commands;
    this._gatePending = [];
    while (this._cmdIndex < cmds.length) {
      const cmd = cmds[this._cmdIndex];
      const cf = cmd.frame == null ? 0 : Number(cmd.frame);
      const due = Number.isFinite(cf) ? cf : 0;
      if (due > frame) break;
      const idx = this._cmdIndex;
      this._cmdIndex += 1;
      if (
        cmd.type === 'setStartTimeMs' ||
        cmd.type === 'setTimeStretch' ||
        (cmd.type === 'setPitch' && cmd.frame == null)
      ) {
        continue;
      }
      const key = `${idx}:${cmd.type}:${cmd.frame}`;
      if (this.fired.has(key)) continue;
      this.fired.add(key);
      this._gatePending.push(cmd);
    }
    if (this._gatePending.length) {
      this.log(`USM gate · deferred ${this._gatePending.length} same-frame cmd(s)`);
    }
  }

  _flushGatePending() {
    const pending = this._gatePending;
    this._gatePending = null;
    if (!pending?.length) return;
    for (const cmd of pending) {
      if (!this.playing) return;
      this._exec(cmd);
      if (!this.playing) return;
    }
  }
  _volumeForWork(workId, atFrame) {
    const meta = this.seMeta.get(Number(workId));
    if (!meta?.volKeys?.length) return null;
    let best = null;
    for (const k of meta.volKeys) {
      if (k.frame <= atFrame && (best == null || k.frame >= best.frame)) best = k;
    }
    return best ? best.vol : null;
  }
  _pitchForWork(workId, atFrame) {
    const meta = this.seMeta.get(Number(workId));
    if (!meta) return 0;
    let pitch = meta.pitch || 0;
    for (const k of meta.pitchKeys || []) {
      if (k.frame <= atFrame) pitch = k.pitch;
    }
    return pitch;
  }

  _clearKoScreen() {
    if (this._koOverlayTimer) {
      clearTimeout(this._koOverlayTimer);
      this._koOverlayTimer = null;
    }
    this.koOverlay?.classList?.remove('show');
    this.koOverlay?.setAttribute?.('aria-hidden', 'true');
  }

  _showKoScreen() {
    if (!this.koOverlay) return;
    this._koOverlayShown = true;
    this._clearKoScreen();
    // Force a fresh CSS animation when replaying/looping the same attack.
    void this.koOverlay.offsetWidth;
    this.koOverlay.setAttribute('aria-hidden', 'false');
    this.koOverlay.classList.add('show');
    this._koOverlayTimer = setTimeout(() => {
      this.koOverlay?.classList?.remove('show');
      this.koOverlay?.setAttribute?.('aria-hidden', 'true');
      this._koOverlayTimer = null;
    }, 1000);
  }

  _maybeShowKoScreen(frame) {
    if (!this.koPreviewEnabled || this._koOverlayShown || this._koTriggerFrame == null) return;
    if ((Number(frame) || 0) < Number(this._koTriggerFrame)) return;
    this._showKoScreen();
  }

  _exec(cmd) {
    switch (cmd.type) {
      case 'dealDamage':
        break;
      case 'hideKoScreen':
        this._clearKoScreen();
        break;
      case 'entryEffect':
      case 'entryEffectAwaken':
      case 'entryEffectTraining':
        this._entryEffect(cmd);
        break;
      case 'setupMovie': {
        this._onSetupMovie(cmd);
        break;
      }
      case 'stopMovie':
        this.usm?.stopAll?.();
        this.log(`stopMovie @ f${cmd.frame}`);
        break;
      case 'pauseMovie': {

        const flag = cmd.flag != null ? Number(cmd.flag) : cmd.args?.[1] != null ? Number(cmd.args[1]) : 1;
        const pause = flag !== 0;
        this.usm?.pauseAll?.(pause);
        this.log(`pauseMovie ${pause ? 'pause' : 'resume'} @ f${cmd.frame}`);
        break;
      }
      case 'visibleMovie': {
        const on = cmd.args?.[1] != null ? Number(cmd.args[1]) !== 0 : true;
        this.usm?.setVisible?.(on);
        this.log(`visibleMovie ${on ? 'on' : 'off'} @ f${cmd.frame}`);
        break;
      }
      case 'scaleMovie':

        break;
      case 'playSe':
      case 'playSeVer2':
      case 'playSeLife':
        this._playSe(cmd);
        break;
      case 'setSeVolumeByWorkId':
      case 'setSeVolume':
        this.audio?.setSeVolume(cmd.workId, cmd.vol);
        break;
      case 'setPitch':

        break;
      case 'stopSe':
      case 'stopSeQueueId':
        if (cmd.workId != null) this.audio?.stopWork(cmd.workId);
        else if (cmd.args?.[1] != null) this.audio?.stopWork(cmd.args[1]);
        break;
      case 'playVoice': {
        if (this._shouldSkipMovieModeAudio(cmd)) {
          this.log(`Movie Mode: skip voice @f${cmd.frame || 0}`);
          break;
        }
        const cueId = cmd.cueId ?? cmd.category;
        const volume = this.audio?.volumeByVoiceCue?.get(cmd.cueId) ?? -1;
        const packageHint = cmd.packageHint || cmd.name || '';
        this.log(`playVoice cue=${cueId} @f${cmd.frame || 0}`);
        if (
          !this.audio?.playVoiceNow?.(cueId, {
            volume,
            frame: cmd.frame || 0,
            packageHint,
          })
        ) {
          void this.audio?.playVoice(cueId, {
            volume,
            frame: cmd.frame || 0,
            packageHint,
          });
        }
        break;
      }
      case 'setVoiceVolume':
        this.audio?.setVoiceVolume(cmd.cueId, cmd.vol);
        break;
      case 'setPhase':
        this.phase = Number(cmd.phase) || 0;
        break;
      case 'gotoPhase':
        this.phase = Number(cmd.phase) || 0;
        this.log(`gotoPhase ${this.phase} @ f${cmd.frame}`);
        break;
      case 'skipFrame': {
        const skipPhase = Number(cmd.phase) || 0;
        const toFrame = Number(cmd.toFrame ?? cmd.args?.[2] ?? cmd.frame) || 0;
        this._jumpToFrame(toFrame, { phase: skipPhase });
        break;
      }
      case 'endPhase':
        if (this.reactionPreview) {
          // Reaction LWF/USM can outlive the script's endPhase. Keep its
          // visual tail; _advance() finishes naturally at maxFrame.
          this.log(`endPhase @ f${cmd.frame} → continue reaction to f${this.maxFrame}`);
        } else if (this.koPreviewEnabled && (Number(cmd.frame) || 0) < this.maxFrame) {
          // endPhase closes the battle phase, but official custom K.O. effects
          // can keep animating afterward. Do not tear down their LWF/USM here;
          // _advance() will finish normally at the preserved visual-tail frame.
          this.log(`endPhase @ f${cmd.frame} → continue K.O. tail to f${this.maxFrame}`);
        } else {
          this.log(`endPhase @ f${cmd.frame} → stop`);
          this.maxFrame = Number(cmd.frame) || this.maxFrame;
          this.frame = this.maxFrame;
          this._finish();
        }
        break;
      case 'pauseAll':
      case 'delayAll':
        if (this._isMovieModeCutinFrame(cmd.frame)) {
          this.log(`Movie Mode: skip ${cmd.type} @f${cmd.frame || 0}`);
          break;
        }
        this.pauseRemain = Math.max(this.pauseRemain, Number(cmd.duration) || 0);
        this.log(`${cmd.type} ${cmd.duration}f @ f${cmd.frame}`);
        break;
      case 'pauseChara':
      case 'delayChara':

        if (this._isMovieModeCutinFrame(cmd.frame)) {
          this.log(`Movie Mode: skip ${cmd.type} @f${cmd.frame || 0}`);
          break;
        }
        if ((Number(cmd.duration) || 0) > 0) {
          this.pauseRemain = Math.max(this.pauseRemain, Number(cmd.duration) || 0);
        }
        break;
      case 'setMoveKey':
        this.chara?.setMove(cmd.chara, cmd.x, cmd.y, cmd.z);
        break;
      case 'setScaleKey':
        this.chara?.setScale(cmd.chara, cmd.sx, cmd.sy);
        break;
      case 'setRotateKey':
        this.chara?.setRotate(cmd.chara, cmd.rot);
        break;
      case 'setAlphaKey':
        this.chara?.setAlpha(cmd.chara, cmd.alpha);
        break;
      case 'setDisp':
        this.chara?.setDisp(cmd.chara, cmd.disp);
        break;
      case 'setDrawFront':
        this.chara?.setDrawFront?.(
          cmd.chara ?? cmd.args?.[1],
          cmd.on ?? cmd.args?.[2] ?? 1,
        );
        break;
      case 'setEffMoveKey':
        this.lwf?.setEffMove?.(cmd.workId, cmd.a, cmd.b, cmd.c);
        break;
      case 'setEffScaleKey':
        this.lwf?.setEffScale?.(cmd.workId, cmd.a, cmd.b);
        break;
      case 'setEffRotateKey':
        this.lwf?.setEffRotate?.(cmd.workId, cmd.a);
        break;
      case 'setEffAlphaKey':
        this.lwf?.setEffAlpha?.(cmd.workId, cmd.a);
        break;
      case 'changeAnime':
        this.chara?.changeAnime(cmd.chara, cmd.anime, { stopAtEnd: false });
        break;
      case 'changeAnimeAndStop':
        this.chara?.changeAnimeAndStop?.(cmd.chara, cmd.anime) ||
          this.chara?.changeAnime(cmd.chara, cmd.anime, { stopAtEnd: true });
        break;
      case 'setAnimeLoop':
        this.chara?.setAnimeLoop?.(cmd.chara, cmd.loop);
        break;
      case 'setEnableAura':
        this.chara?.setAura?.(
          cmd.chara ?? cmd.args?.[1] ?? 0,
          cmd.on ?? cmd.args?.[2] ?? 1,
        );
        break;
      case 'removeAllEffect':

        this.lwf?.releaseAll?.();
        this.activeEffects.clear();
        this.log(`removeAllEffect @ f${cmd.frame}`);
        break;
      case 'setBgScroll': {
        const speed = cmd.speed ?? cmd.args?.[1] ?? 0;
        this.bg?.setScroll?.(speed);
        if (Number(speed) === 0) this.bg?.stopScroll?.();
        else this.bg?.startScroll?.(speed);
        break;
      }
      case 'startBgScroll': {
        const speed = cmd.speed ?? cmd.args?.[1] ?? 0;
        this.bg?.startScroll?.(speed);
        break;
      }
      case 'stopBgScroll':
        this.bg?.stopScroll?.();
        break;
      case 'setBgMoveKey':
        this.bg?.setMove?.(cmd.x ?? cmd.args?.[1], cmd.y ?? cmd.args?.[2]);
        break;
      case 'setBgScaleKey':
        this.bg?.setScale?.(cmd.sx ?? cmd.args?.[1], cmd.sy ?? cmd.args?.[2]);
        break;
      case 'setBgRotateKey':
        this.bg?.setRotate?.(cmd.rot ?? cmd.args?.[1]);
        break;
      case 'setQuake': {

        const dur = cmd.duration ?? cmd.args?.[1] ?? 10;
        const power = cmd.power ?? cmd.args?.[2] ?? 8;
        this.bg?.setQuake?.(power, dur);
        break;
      }
      case 'setShake':
      case 'setShakeKey': {

        const dur = cmd.duration ?? cmd.args?.[1] ?? 10;
        const power = cmd.power ?? cmd.args?.[2] ?? 8;
        this.bg?.setShake?.(power, dur);
        break;
      }
      case 'entryFadeBg': {
        if (this._isMovieModeCutinFrame(cmd.frame)) {
          this.log(`Movie Mode: skip entryFadeBg @f${cmd.frame || 0}`);
          break;
        }
        const a = cmd.args || [];

        this.bg?.entryFadeBg?.(
          cmd.fadeIn ?? a[1],
          cmd.hold ?? a[2],
          cmd.fadeOut ?? a[3],
          cmd.r ?? a[4],
          cmd.g ?? a[5],
          cmd.b ?? a[6],
          cmd.a ?? a[7],
        );
        break;
      }
      case 'entryFade': {
        if (this._isMovieModeCutinFrame(cmd.frame)) {
          this.log(`Movie Mode: skip entryFade @f${cmd.frame || 0}`);
          break;
        }
        const a = cmd.args || [];

        this.screenFade?.entryFade?.(
          a[1],
          a[2],
          a[3],
          a[4],
          a[5],
          a[6],
          a[7],
        );
        break;
      }
      case 'removeAllFade':
        this.screenFade?.clear?.();
        break;
      case 'removeAllFadeBg':
        this.bg?.clearFade?.();
        break;
      default:
        break;
    }
  }
  _playSe(cmd) {
    if (this._shouldSkipMovieModeAudio(cmd)) {
      const cueId = cmd.cueId ?? cmd.args?.[1];
      this.log(`Movie Mode: skip SE cue=${cueId} @f${cmd.frame || 0}`);
      return;
    }
    const workId = cmd.workId;
    const frame = cmd.frame || 0;
    const meta = workId != null ? this._meta(workId) : { startMs: 0, stretch: null };
    const bakedVol = workId != null ? this._volumeForWork(workId, frame) : null;
    const vol = bakedVol != null ? bakedVol : cmd.vol ?? -1;
    if (workId != null && bakedVol != null) {
      this.audio?.setSeVolume(workId, bakedVol);
    }
    const pitch = workId != null ? this._pitchForWork(workId, frame) : 0;

    let stretch = meta.stretch;
    if (stretch == null || !Number.isFinite(Number(stretch)) || Number(stretch) <= 0) {
      if (this.highSpeed) {
        const auto = this._currentAutoTimeScale();
        stretch = auto > 0 ? auto : 1;
      } else {
        stretch = 1;
      }
    }
    stretch = clampStretch(stretch);
    const rate = clampStretch(Number(stretch) * rateFromCents(pitch));
    const endFrame =
      cmd.endFrame != null && Number(cmd.endFrame) > frame ? Number(cmd.endFrame) : null;
    const cueId = cmd.cueId ?? cmd.args?.[1];
    this.audio?.playCueNow?.(cueId, {
      volume: vol,
      workId,
      frame,
      offsetMs: meta.startMs || 0,
      endFrame,
      playbackRate: rate,
    }) ||
      void this.audio?.playCue(cueId, {
        volume: vol,
        workId,
        frame,
        offsetMs: meta.startMs || 0,
        endFrame,
        playbackRate: rate,
      });
  }

  async _prepareEffect(cmd) {
    if (this.movieMode && isCutinEffectId(cmd.effectId)) {
      this.log(`Movie Mode: skip cutin prepare ${cmd.effectId}`);
      return false;
    }
    const workKey = Number(cmd.workId);
    if (Number.isFinite(workKey) && this._fxPrepared.has(workKey)) {
      return true;
    }
    const pack = await fetchEffectPack(cmd.effectId, { enemy: this.enemySide });
    const media = classifyMedia(pack);
    if (!pack.found) {
      this.log(`  effect_packs id ${cmd.effectId} not in DB`);
      return false;
    }
    if (!media.useLwf || !pack.lwf?.url) {
      return false;
    }
    const z = effectZIndex(cmd.attr, cmd.zOrder, cmd.effectId);
    const scene = String(pack.scene_name || '').trim();
    const url = pack.lwf.url;
    const base = url.slice(0, url.lastIndexOf('/') + 1);
    let rules = [...((this.effectTexRules && this.effectTexRules.get(Number(cmd.workId))) || [])];

    if (isCardFlashCutinId(cmd.effectId) && !rules.length) {
      rules = [
        { slot: 1, kind: 1 },
        { slot: 2, kind: 0 },
        { slot: 5, kind: 4 },
      ];
      this.log(`  cut-in ${cmd.effectId}: default replace rules (character+effect+sp_name)`);
    }

    let imageMap = null;
    let card = this.attackerCard;
    {
      const useEnemy =
        rules.some((r) => Number(r.kind) === 6) ||
        rules.some((r) => r.cardId && this.enemyCard?.id === r.cardId);
      if (useEnemy && this.enemyCard?.found) card = this.enemyCard;
      if (card?.found) {
        imageMap = await makeCardTextureImageMapAsync(base, card, rules, {
          ensureCardFlash: isCardFlashCutinId(cmd.effectId),
        });
        const tex = imageMap?._patchedTextures || card.textures || {};
        const keys = Object.entries(tex)
          .filter(([, v]) => v?.url)
          .map(([k]) => k);
        const charUrl = tex.character?.url || '';
        const effUrl = tex.effect?.url || '';
        const spUrl = tex.sp_name?.url || '';
        const short = (u) => {
          const s = String(u || '').split('?')[0];
          const parts = s.split('/');
          return parts.slice(-2).join('/');
        };
        this.log(
          `  card art map work=${cmd.workId} art=${card.art_id}` +
            ` scene=${scene || '(pickScene)'}` +
            ` tex=[${keys.join(',')}] rules=${rules.length}` +
            (useEnemy ? ' · enemy' : '') +
            (charUrl ? ` · char=${short(charUrl)}` : ' · char=MISSING') +
            (effUrl ? ` · eff=${short(effUrl)}` : ' · eff=MISSING') +
            (spUrl ? ` · sp=${short(spUrl)}` : ''),
        );
      } else if (LwfLayer.disposeOnMovieEnd(cmd.effectId)) {
        this.log(`  WARN: cut-in ${cmd.effectId} has no card textures (attacker missing?)`);
      }
    }
    if (!scene && isCutinEffectId(cmd.effectId)) {
      this.log(
        `  WARN: effect ${cmd.effectId} pack ${pack.pack_name || '?'} has empty scene_name` +
          ` — pickScene may attach the wrong ef_*`,
      );
    }
    const player = await this.lwf.addEffect({
      lwfUrl: url,
      baseUrl: base,
      sceneName: scene,
      zIndex: z,
      offsetX: cmd.x || 0,
      offsetY: cmd.y || 0,
      instanceKey: `${cmd.workId || 0}_${scene}`,
      imageMap,
      cacheTag: `${cmd.workId || 0}_${scene}_c${card?.art_id || 0}`,
      startPhase: 0,
      startFrame: Number(cmd.frame) || 0,
      life: Number(cmd.life),
      lifeLimited: !!cmd.lifeLimited,
      effectId: Number(cmd.effectId) || 0,
      disposeOnEnd: LwfLayer.disposeOnMovieEnd(cmd.effectId),
      attr: Number(cmd.attr) || 0,
      dormant: true,
    });
    if (Number.isFinite(workKey)) this._fxPrepared.set(workKey, { player, pack, cmd, z });
    return true;
  }

  _entryEffect(cmd) {
    try {
      if (this.movieMode && isCutinEffectId(cmd.effectId)) {
        this.log(`Movie Mode: skip cutin ${cmd.effectId} @f${cmd.frame}`);
        try {
          this.screenFade?.clear?.();
          this.bg?.clearFade?.();
        } catch {

        }
        return;
      }
      const workKey = Number(cmd.workId);
      let prepared =
        Number.isFinite(workKey) && this._fxPrepared.has(workKey)
          ? this._fxPrepared.get(workKey)
          : null;
      if (!prepared?.player?.lwf) {
        this.log(
          `PlayEffect ${cmd.effectId} work=${cmd.workId} not warm @f${cmd.frame} — loading…`,
        );
        void this._entryEffectAsync(cmd);
        return;
      }
      this._activatePreparedEffect(cmd, prepared);
    } catch (e) {
      this.log(`entryEffect error: ${e.message || e}`);
    }
  }
  async _entryEffectAsync(cmd) {
    try {
      const workKey = Number(cmd.workId);
      await this._prepareEffect(cmd);
      const prepared = this._fxPrepared.get(workKey);
      if (!prepared?.player?.lwf) {
        const pack = await fetchEffectPack(cmd.effectId, { enemy: this.enemySide });
        const media = classifyMedia(pack);
        const z = effectZIndex(cmd.attr, cmd.zOrder, cmd.effectId);
        this.log(
          `FX ${cmd.effectId} ${pack.pack_name || '?'} media=${pack.media || 'missing'} z=${z}`,
        );
        if (media.useUsm && pack.usm?.rel) {
          const id = Number(cmd.effectId);
          const setup = this._getMovieSetup(id);
          if (setup) {
            this._maybeStartMovieForEffect(id, Number(cmd.frame) || this.frame || 0);
          } else if (!this._usmStartedIds.has(id)) {
            this._usmStartedIds.add(id);
            await this.usm.playFromAssetRel(pack.usm.rel, {
              zIndex: z,
              startAbFrame: Number(cmd.frame) || this.frame || 0,
            });
            this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
          }
        }
        return;
      }

      if (!this.playing) return;
      const due = Number(cmd.frame) || 0;
      if (this.frame < due) return;
      this._activatePreparedEffect(cmd, prepared);
    } catch (e) {
      this.log(`entryEffect async error: ${e.message || e}`);
    }
  }
  _activatePreparedEffect(cmd, prepared) {
    const { player, pack, z } = prepared || {};
    if (!player?.lwf) return;
    player.startFrame = Number(cmd.frame) || 0;
    player.life = Number(cmd.life);
    const isKoEffect =
      this.koPreviewEnabled && Number(cmd.workId) === Number(this._koEffectWorkId);
    player.lifeLimited = isKoEffect ? false : !!cmd.lifeLimited;
    player.effectId = Number(cmd.effectId) || 0;
    player.disposeOnEnd = isKoEffect ? false : LwfLayer.disposeOnMovieEnd(cmd.effectId);
    player.forceHoldEnd = isKoEffect;

    player.pausable = cmd.pausable !== false;

    player.followParent = (Number(cmd.attr) & 0x60) !== 0;
    player.followScaleZ = (Number(cmd.attr) & 0x40) !== 0;
    player.parentCharaId = player.followParent ? Number(cmd.target) : null;
    player.parentTag = Number(cmd.tparam) || 0;
    player.parentOffX = Number(cmd.x) || 0;
    player.parentOffY = Number(cmd.y) || 0;
    if (player.followParent) {
      player.x = player.parentOffX;
      player.y = player.parentOffY;
    } else {
      if (cmd.x != null) player.x = Number(cmd.x) || 0;
      if (cmd.y != null) player.y = Number(cmd.y) || 0;
      player.parentScaleX = 1;
      player.parentScaleY = 1;
    }
    this.lwf?.activatePlayer?.(player);

    this._applyDueEffKeys(cmd.workId, Number(cmd.frame) || 0);
    this.lwf?.syncFollowParents?.(this.chara);
    const ps = Number(player.parentScaleX) || 1;
    const sx = Number(player.sx) || 1;
    this.activeEffects.set(cmd.workId, { cmd, player, pack, z });
    this._maybeStartMovieForEffect(cmd.effectId, Number(cmd.frame) || 0);
    this.log(
      `PlayEffect ${cmd.effectId} ${pack?.pack_name || '?'} ` +
        `scene=${player.sceneName || pack?.scene_name || '?'} @f${cmd.frame}` +
        (cmd.lifeLimited ? ` life=${cmd.life}` : '') +
        ` scale=${(sx * ps).toFixed(2)}` +
        (player.followParent
          ? ` follow=chara${player.parentCharaId}` +
            (player.parentTag ? ` tag=${player.parentTag}` : '') +
            ` off=(${player.parentOffX},${player.parentOffY})`
          : ` pos=(${player.x},${player.y})`),
    );
  }
  _applyDueEffKeys(workId, atFrame) {
    const wid = Number(workId);
    if (!Number.isFinite(wid)) return;
    let bestScl = null;
    let bestMove = null;
    let bestRot = null;
    let bestAlpha = null;
    for (const c of this.commands || []) {
      if (Number(c.workId) !== wid) continue;
      const f = Number(c.frame);
      if (!Number.isFinite(f) || f > atFrame) continue;
      if (c.type === 'setEffScaleKey') {
        if (!bestScl || f >= bestScl.frame) bestScl = { frame: f, a: c.a, b: c.b };
      } else if (c.type === 'setEffMoveKey') {
        if (!bestMove || f >= bestMove.frame) {
          bestMove = { frame: f, a: c.a, b: c.b, c: c.c };
        }
      } else if (c.type === 'setEffRotateKey') {
        if (!bestRot || f >= bestRot.frame) bestRot = { frame: f, a: c.a };
      } else if (c.type === 'setEffAlphaKey') {
        if (!bestAlpha || f >= bestAlpha.frame) bestAlpha = { frame: f, a: c.a };
      }
    }
    if (bestScl) this.lwf?.setEffScale?.(wid, bestScl.a, bestScl.b);
    if (bestMove) this.lwf?.setEffMove?.(wid, bestMove.a, bestMove.b, bestMove.c);
    if (bestRot) this.lwf?.setEffRotate?.(wid, bestRot.a);
    if (bestAlpha) this.lwf?.setEffAlpha?.(wid, bestAlpha.a);
  }
  _getMovieSetup(contentId) {
    const id = Number(contentId);
    if (!Number.isFinite(id)) return null;
    if (this._movieSetupById?.has(id)) return this._movieSetupById.get(id);
    return (
      (this.commands || []).find(
        (c) => c.type === 'setupMovie' && Number(c.contentId) === id,
      ) || null
    );
  }

  async _primeMoviesUpTo(abFrame) {
    const f = Math.max(0, Math.floor(Number(abFrame) || 0));
    const jobs = [];
    for (const c of this.commands || []) {
      if (c?.type !== 'setupMovie') continue;
      const contentId = Number(c.contentId);
      if (!Number.isFinite(contentId) || this._usmStartedIds.has(contentId)) continue;
      this._movieSetupById.set(contentId, c);
      const setupFrame = Number(c.frame) || 0;
      const paired = (this.commands || []).find(
        (e) =>
          (e.type === 'entryEffect' ||
            e.type === 'entryEffectAwaken' ||
            e.type === 'entryEffectTraining') &&
          Number(e.effectId) === contentId,
      );
      const entryFrame = paired ? Number(paired.frame) || 0 : setupFrame;
      const playFrame = paired ? entryFrame : setupFrame;
      if (playFrame > f) continue;
      this._usmStartedIds.add(contentId);
      const playCmd = {
        ...c,
        frame: playFrame,
        movieFrame: Number(c.movieFrame) || 0,
      };
      this.log(
        `USM prime ${contentId} @f${playFrame}` +
          (paired && entryFrame !== setupFrame ? ` (setup @f${setupFrame})` : ''),
      );
      jobs.push(this._setupMovie(playCmd, null));
    }
    if (!jobs.length) return;
    await Promise.all(jobs);
    if (this.playing && this.pauseRemain <= 0 && !this.userPaused) {
      this.usm?.setPlaybackRate?.(1);
      try {
        await this.usm?.seekToAbFrame?.(f - USM_LEAD_FRAMES, FPS);
      } catch {

      }
      this.usm?.setAbPause?.(true);
      this.usm?.setSyncPause?.(true);
    }
  }

  async _prerollUsmLead(frames = USM_LEAD_FRAMES) {
    const n = Math.max(0, Math.floor(Number(frames) || 0));
    if (!n || !this.usm?.clips?.length) return;
    if (!this.playing) return;
    this.log(`USM lead-in · ${n}f before LUA continues`);
    this.usm.setPlaybackRate?.(1);
    this.usm.setAbPause?.(true);
    this.usm.setSyncPause?.(true);
    const startAb = Number(this.usm.getStartAbFrame?.());
    const seekAb = Number.isFinite(startAb) ? startAb : -USM_LEAD_FRAMES;
    try {
      await this.usm.seekToAbFrame?.(seekAb, FPS);
    } catch {

    }
    try {
      await this.usm.stepByFrames?.(n, FPS);
    } catch (e) {
      this.log(`USM lead step: ${e.message || e}`);
    }
    this.usm.setAbPause?.(true);
    this.usm.setSyncPause?.(true);
    for (const c of this.usm.clips || []) {
      try {
        this.usm._blitClip?.(c);
      } catch {

      }
    }
  }

  _onSetupMovie(cmd) {
    const contentId = Number(cmd.contentId);
    if (!Number.isFinite(contentId)) return;
    this._movieSetupById.set(contentId, cmd);
    const setupFrame = Number(cmd.frame) || 0;
    const pairedSameOrLater = (this.commands || []).some(
      (c) =>
        (c.type === 'entryEffect' ||
          c.type === 'entryEffectAwaken' ||
          c.type === 'entryEffectTraining') &&
        Number(c.effectId) === contentId &&
        (Number(c.frame) || 0) >= setupFrame,
    );
    if (pairedSameOrLater) {
      this.log(
        `setupMovie ${contentId} @f${setupFrame}: armed — play on paired entryEffect`,
      );
      void this._warmMoviePack(contentId);
      return;
    }
    if (this._usmStartedIds.has(contentId)) return;
    this._usmStartedIds.add(contentId);
    this._usmStartGate = true;
    this.log(`USM gate · hold @ f${setupFrame} until movie ready`);
    void this._runUsmStartGate(cmd);
  }

  async _warmMoviePack(contentId) {
    try {
      const id = Number(contentId);
      let pack = this._moviesPrepared?.get?.(id);
      if (!pack) {
        pack = await fetchEffectPack(id, { enemy: this.enemySide });
        if (pack) this._moviesPrepared?.set?.(id, pack);
      }
      if (pack?.usm?.rel) {
        const cached = this.usm?._preload?.get?.(pack.usm.rel);
        if (!cached?.url) {
          if (cached?.promise) await cached.promise;
          else {
            await this.usm.preloadFromAssetRel(pack.usm.rel, {
              stamp: pack.usm.stamp || '',
            });
          }
        }
      }
    } catch (e) {
      this.log(`movie warm ${contentId}: ${e.message || e}`);
    }
  }

  _maybeStartMovieForEffect(effectId, atFrame) {
    if (this._fastForwarding) return;
    const id = Number(effectId);
    if (!Number.isFinite(id) || this._usmStartedIds.has(id)) return;
    const setup = this._getMovieSetup(id);
    if (!setup) return;
    const setupFrame = Number(setup.frame) || 0;
    const entryFrame = Number(atFrame) || 0;
    if (setupFrame > entryFrame) return;
    this._usmStartedIds.add(id);
    this.log(
      `USM play · entryEffect ${id} @f${entryFrame}` +
        (setupFrame !== entryFrame ? ` (setup was @f${setupFrame})` : ''),
    );
    const playCmd = {
      ...setup,
      frame: entryFrame,
      movieFrame: 0,
    };
    this._usmStartGate = true;
    const gen = (this._usmGateGen = (this._usmGateGen || 0) + 1);
    void this._setupMovie(playCmd, gen)
      .then(async () => {
        if (!this.playing || this._usmGateGen !== gen) return;
        if (this.reactionPreview) {
          this._refineReactionTimelineFromUsm(id, entryFrame);
        } else if (this.koPreviewEnabled && Number(this._koEffectId) === id) {
          this._refineKoTimelineFromUsm(id, entryFrame);
        }
        if (this.userPaused || this.usm?.isRefLocked?.()) {
          this.usm?.lockAtCurrent?.();
          return;
        }
        try {
          await this._prerollUsmLead(USM_LEAD_FRAMES);
        } catch {

        }
        if (!this.playing || this._usmGateGen !== gen) return;
        this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
        if (this.pauseRemain <= 0 && !this.userPaused) {
          this.usm?.setVisible?.(true);
          this.usm?.setAbPause?.(false);
          this.usm?.setSyncPause?.(false);
        }
      })
      .catch((e) => {
        this.log(`USM play ${id}: ${e.message || e}`);
      })
      .finally(() => {
        if (this._usmGateGen === gen) {
          this._usmStartGate = false;
          this._flushGatePending();
        }
      });
  }

  async _runUsmStartGate(cmd) {
    const gen = (this._usmGateGen = (this._usmGateGen || 0) + 1);
    const stillCurrent = () => this.playing && this._usmGateGen === gen;
    try {
      const setupP = this._setupMovie(cmd, gen);
      await Promise.race([
        setupP,
        new Promise((r) => setTimeout(r, 4000)),
      ]);
      if (!stillCurrent()) return;
      try {
        await setupP;
      } catch {

      }
      if (!stillCurrent()) return;
      try {
        await this._prerollUsmLead(USM_LEAD_FRAMES);
      } catch {

      }
      if (!stillCurrent()) return;
      if (this._wallEpochMs != null) {
        this._wallEpochMs = performance.now() - (this._wallStepsDone * 1000) / FPS;
      }
      const n = this.usm?.clips?.length || 0;
      this.log(`USM gate open · clips=${n} · timeline @ f${this.frame}`);
      this.usm?.setPlaybackRate?.(this.highSpeed ? 2 : 1);
      if (this.pauseRemain <= 0 && !this.userPaused) {
        this.usm?.setVisible?.(true);
        this.usm?.setAbPause?.(false);
        this.usm?.setSyncPause?.(false);
      }
    } catch (e) {
      if (stillCurrent()) {
        this.log(`USM gate failed: ${e.message || e}`);
      }
    } finally {
      this._usmStartGate = false;
      this._flushGatePending();
    }
  }

  async _setupMovie(cmd, gateGen = this._usmGateGen) {
    const contentId = Number(cmd.contentId);
    let pack =
      this._moviesPrepared?.get?.(contentId) ||
      (await fetchEffectPack(contentId, { enemy: this.enemySide }));
    if (gateGen != null && this._usmGateGen !== gateGen) return;
    const z = movieZIndex(cmd.flagA);
    this.log(
      `setupMovie ${contentId} → ${pack.media || 'missing'} ` +
        `${pack.usm?.rel || pack.lwf?.rel || ''} z=${z}`,
    );
    if (pack.usm?.rel) {
      const cached = this.usm?._preload?.get?.(pack.usm.rel);
      if (!cached?.url) {
        if (cached?.promise) {
          this.log(`setupMovie ${contentId}: awaiting movie preload…`);
          await cached.promise;
        } else {
          this.log(`setupMovie ${contentId}: movie not preloaded — loading now`);
          await this.usm.preloadFromAssetRel(pack.usm.rel, {
            stamp: pack.usm.stamp || '',
          });
        }
        if (gateGen != null && this._usmGateGen !== gateGen) return;
      }
      const atFrame = Number(cmd.frame) || 0;
      const movieFrame = Number(cmd.movieFrame) || 0;
      const startAbFrame = atFrame - movieFrame - USM_LEAD_FRAMES;
      await this.usm.playFromAssetRel(pack.usm.rel, {
        zIndex: z,
        contentId,
        startAbFrame,
        isCancelled: () => gateGen != null && this._usmGateGen !== gateGen,
      });
      if (gateGen != null && this._usmGateGen !== gateGen) return;
      if (this.userPaused || this.usm?.isRefLocked?.()) {
        this.usm?.lockAtCurrent?.();
        return;
      }
      this.usm?.setPlaybackRate?.(1);
      try {
        await this.usm?.seekToAbFrame?.(startAbFrame, FPS);
      } catch {

      }
      this.usm?.setAbPause?.(true);
      this.usm?.setSyncPause?.(true);
    } else if (pack.lwf?.url) {
      if (gateGen != null && this._usmGateGen !== gateGen) return;
      const url = pack.lwf.url;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      await this.lwf.addEffect({
        lwfUrl: url,
        baseUrl: base,
        sceneName: pack.scene_name,
        zIndex: z,
        instanceKey: `movie_${contentId}`,
        dormant: false,
      });
    } else {
      this.log(`setupMovie ${contentId}: no USM/LWF on disk`);
    }
  }
  _extendReactionVisualEnd(frame, source) {
    if (!this.reactionPreview || !Number.isFinite(frame)) return;
    // A broken duration must not leave a reaction player running forever.
    const cap = Math.max(Number(this._endPhaseFrame) || 0, this.maxFrame) + 900;
    const visualEnd = Math.min(Math.ceil(frame), cap);
    if (visualEnd > this.maxFrame) {
      this.log(`Reaction ${source} tail · f${this.maxFrame} → f${visualEnd}`);
      this.maxFrame = visualEnd;
    }
  }

  _refineReactionTimelineFromPreparedEffects() {
    if (!this.reactionPreview) return;
    for (const { player, cmd } of this._fxPrepared.values()) {
      const movie = player?.movie || player?.lwf?.rootMovie;
      const totalFrames = Number(movie?.totalFrames) || 0;
      if (totalFrames <= 1) continue;
      const lwfFps = Number(player?.lwf?.frameRate) || Number(player?.lwf?.data?.frameRate) || FPS;
      let life = Math.ceil(totalFrames * FPS / Math.max(1, lwfFps));
      if (cmd.lifeLimited && Number(cmd.life) > 0) life = Math.min(life, Number(cmd.life));
      this._extendReactionVisualEnd((Number(cmd.frame) || 0) + life, 'LWF');
    }
  }

  _refineReactionTimelineFromUsm(contentId, startFrame) {
    if (!this.reactionPreview) return;
    const clip = [...(this.usm?.clips || [])].reverse()
      .find((item) => Number(item?.contentId) === Number(contentId));
    const video = clip?.video;
    if (!video) return;
    const update = () => {
      const duration = Number(video.duration);
      if (Number.isFinite(duration) && duration > 0) {
        this._extendReactionVisualEnd((Number(startFrame) || 0) + duration * FPS, 'USM');
      }
    };
    update();
    if (!(Number(video.duration) > 0)) {
      video.addEventListener('loadedmetadata', update, { once: true });
    }
  }

  _refineKoTimelineFromPreparedEffect() {
    if (!this.koPreviewEnabled || !this._hasCustomKoEffect) return;
    const workId = Number(this._koEffectWorkId);
    if (!Number.isFinite(workId)) return;
    const prepared = this._fxPrepared.get(workId);
    const player = prepared?.player;
    const cmd = prepared?.cmd;
    const movie = player?.movie || player?.lwf?.rootMovie;
    const totalFrames = Number(movie?.totalFrames) || 0;
    const lwfFps = Number(player?.lwf?.frameRate) || Number(player?.lwf?.data?.frameRate) || FPS;
    const startFrame = Number(cmd?.frame) || Number(this._koTriggerFrame) || 0;
    const scriptLife = Number(cmd?.life) || 0;
    const lowRateStep = 1 << IS_LOW_RATE_FPS;
    const clipFrames = totalFrames > 1
      ? Math.ceil((totalFrames * FPS * lowRateStep) / Math.max(1, lwfFps))
      : 0;
    const labels = player?.lwf?.data?.labels || [];
    const strings = player?.lwf?.data?.strings || [];
    const koLabel = labels.find((label) => {
      const name = String(strings[label?.stringId] || label?.name || '');
      return /(^|[^a-z])(k[._ -]*o|knock[._ -]*out)([^a-z]|$)/i.test(name);
    });
    const labelLocalFrame = Number(
      koLabel?.frame ?? koLabel?.frameNo ?? koLabel?.index ?? koLabel?.z$9j,
    );
    if (
      Number.isFinite(labelLocalFrame) &&
      labelLocalFrame >= 0 &&
      (totalFrames <= 1 || labelLocalFrame <= totalFrames)
    ) {
      this._koTriggerFrame = startFrame + Math.ceil(
        (labelLocalFrame * FPS * lowRateStep) / Math.max(1, lwfFps),
      );
      this.log(`K.O. label frame · local=${labelLocalFrame} → f${this._koTriggerFrame}`);
    }
    const visualLength = Math.max(scriptLife, clipFrames, 30);
    const visualEnd = startFrame + visualLength;
    this._koVisualEndFrame = visualEnd;

    // K.O. is a one-shot: never recycle a life-limited clip. Keep its real
    // final frame visible until the runner's two-second final hold completes.
    if (player) {
      player.forceHoldEnd = true;
      player.lifeLimited = false;
      player.disposeOnEnd = false;
    }
    if (visualEnd > this.maxFrame) {
      const before = this.maxFrame;
      this.maxFrame = visualEnd;
      this.log(
        `K.O. LWF duration · ${totalFrames || '?'} frames @ ${lwfFps}fps ` +
          `→ timeline ${before} → ${this.maxFrame}`,
      );
    }
  }

  _refineKoTimelineFromUsm(contentId, startFrame) {
    const clip = [...(this.usm?.clips || [])]
      .reverse()
      .find((c) => Number(c?.contentId) === Number(contentId));
    const video = clip?.video;
    if (!video) return;
    const update = () => {
      const duration = Number(video.duration);
      if (!(duration > 0) || !Number.isFinite(duration)) return;
      const visualEnd = (Number(startFrame) || 0) + Math.ceil(duration * FPS * (1 << IS_LOW_RATE_FPS));
      this._koVisualEndFrame = Math.max(Number(this._koVisualEndFrame) || 0, visualEnd);
      if (visualEnd > this.maxFrame) {
        const before = this.maxFrame;
        this.maxFrame = visualEnd;
        this.log(`K.O. USM duration · ${duration.toFixed(2)}s → timeline ${before} → ${this.maxFrame}`);
      }
    };
    update();
    if (!(Number(video.duration) > 0)) {
      video.addEventListener('loadedmetadata', update, { once: true });
    }
  }

  _cancelRenderLoop() {
    this._loopGen += 1;
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  _paintHud() {
    const auto = this._currentAutoTimeScale();
    const text =
      `f${this.frame}/${this.maxFrame} · phase ${this.phase} · state ${this.state} · step ${this.step}` +
      (this.highSpeed ? ' · 2×' : '') +
      (this.highSpeed && auto > 0 && auto !== 1 ? ` · stretch ${auto}` : '') +
      (this.userPaused ? ' · paused' : '') +
      (this._usmStartGate ? ' · USM-gate' : '') +
      (this.pauseRemain > 0 ? ` · pause ${this.pauseRemain}` : '') +
      (this.pausedHidden || document.hidden ? ' · tab-paused' : '');
    if (this.hud) this.hud.textContent = text;
    if (this.statusEl && this.playing) {
      this.statusEl.textContent = `playing · ${text}`;
    }
  }
}
