import { withPatchQuery, getActivePatchId, getApiBase } from './patch-context.js';

const MASTER = 0.12;
const SE_DEFAULT = 0.35;
const VOICE_DEFAULT = 0.45;

function normalizeScriptVolume(volume, fallbackRel) {
  if (volume == null || volume < 0) return fallbackRel;

  if (volume > 1.5) return Math.max(0, volume / 100);
  return Math.max(0, volume);
}

export function rateFromCents(cents) {
  if (cents == null || !Number.isFinite(cents) || cents === 0) return 1;
  return 2 ** (Number(cents) / 1200);
}

export class AudioBus {
  constructor(log) {
    this.log = log || (() => {});
    this.ctx = null;
    this.master = null;
    this.cache = new Map();
    this._pending = new Map();
    this._controllers = new Set();
    this._loadGeneration = 0;
    this._disposed = false;
    this._cacheOrder = [];   // LRU tracking for cache eviction
    this._maxCacheSize = 60; // Bounded decoded audio, including voice aliases
    this._maxCacheBytes = 48 * 1024 * 1024;
    this.voices = new Map();
    this.volumeByWorkId = new Map();
    this.volumeByVoiceCue = new Map();
    this.fps = 30;
    this.stretch = 1;
    this.timelineGen = 0;
    this._sources = new Set();
    this._mixCapturing = false;
    this._mixEvents = [];
    this.muted = false;
    this.voiceLanguage = 'ja';
  }
  setVoiceLanguage(lang) {
    lang = (lang === 'en') ? 'en' : 'ja';
    this.voiceLanguage = lang;
    this.clearVoiceCache();
  }
  clearVoiceCache() {
    this.cancelPending();
    for (const k of Array.from(this.cache.keys())) {
      if (k.startsWith('voice:')) {
        this.cache.delete(k);
      }
    }
    this._cacheOrder = this._cacheOrder.filter(k => !k.startsWith('voice:'));
  }
  _trimCache() {
    const decodedBytes = () => {
      const unique = new Set();
      let total = 0;
      for (const buffer of this.cache.values()) {
        if (!buffer || unique.has(buffer)) continue;
        unique.add(buffer);
        total += (buffer.length || 0) * (buffer.numberOfChannels || 1) * 4;
      }
      return total;
    };
    while (this._cacheOrder.length > 1 &&
      (this._cacheOrder.length > this._maxCacheSize || decodedBytes() > this._maxCacheBytes)) {
      const oldest = this._cacheOrder.shift();
      this.cache.delete(oldest);
    }
  }
  _trackCacheKey(key) {
    const idx = this._cacheOrder.indexOf(key);
    if (idx > -1) this._cacheOrder.splice(idx, 1);
    this._cacheOrder.push(key);
    this._trimCache();
  }
  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.master?.gain) {
      this.master.gain.value = this.muted ? 0 : MASTER;
    }
  }
  toggleMute() {
    this.setMuted(!this.muted);
    return this.muted;
  }
  _ensureCtx() {
    if (this._disposed) return null;
    if (!this.ctx) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          this.ctx = new AC();
          this._remaster();
        }
      } catch (e) {
        this.log(`AudioContext init failed: ${e.message || e}`);
      }
    }
    if (this.ctx && this.ctx.state === 'suspended') {
      try {
        void this.ctx.resume().catch(() => {});
      } catch {}
    }
    return this.ctx;
  }
  async _ensureRunning() {
    const ctx = this._ensureCtx();
    if (!ctx) return null;
    if (ctx.state === 'suspended') {
      try {
        await ctx.resume();
      } catch {

      }
    }
    return ctx;
  }
  _remaster() {
    try {
      this.master?.disconnect();
    } catch {

    }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : MASTER;
    this.master.connect(this.ctx.destination);

    if (this._recordDest) {
      try {
        this.master.connect(this._recordDest);
      } catch {

      }
    }
  }

  getCaptureStream() {
    const ctx = this._ensureCtx();
    if (!this._recordDest) {
      this._recordDest = ctx.createMediaStreamDestination();
      try {
        this.master.connect(this._recordDest);
      } catch {

      }
    }
    return this._recordDest.stream;
  }
  beginTimeline({ fps = 30, stretch = 1 } = {}) {
    this._ensureCtx();
    this.fps = fps;

    this.stretch = 1;
    this.timelineGen += 1;

    this.silence();
    if (this._mixCapturing) this._mixEvents = [];
  }

  beginMixCapture() {
    this._mixCapturing = true;
    this._mixEvents = [];
  }
  endMixCapture() {
    this._mixCapturing = false;
  }
  _noteMix(kind, cueId, opts = {}) {
    if (!this._mixCapturing) return;
    this._mixEvents.push({
      kind,
      cueId: Number(cueId),
      frame: Number(opts.frame) || 0,
      offsetMs: Number(opts.offsetMs) || 0,
      endFrame: opts.endFrame != null ? Number(opts.endFrame) : null,
      playbackRate: Number(opts.playbackRate) || 1,
      volume: Number(opts.relVolume),
      cacheKey: opts.cacheKey || null,
    });
  }

  async renderMixWav(durationSec) {
    const events = this._mixEvents || [];
    if (!events.length) return null;
    const sr = 48000;
    const dur = Math.max(0.05, Number(durationSec) || 0);
    const frames = Math.max(1, Math.ceil(dur * sr));
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!OAC) return null;
    const offline = new OAC(2, frames, sr);
    const masterGain = offline.createGain();

    masterGain.gain.value = MASTER;
    masterGain.connect(offline.destination);

    for (const ev of events) {
      const key =
        ev.cacheKey ||
        (ev.kind === 'voice' ? `voice:${ev.cueId}:` : `se:${ev.cueId}`);
      let buf = this.cache.get(key);
      if (!buf && ev.kind === 'voice') {
        buf = this.cache.get(`voice:${ev.cueId}:`) || this.cache.get(`voice:${ev.cueId}`);
      }
      if (!buf) continue;
      let rate = Number(ev.playbackRate) || 1;
      if (rate < 0.35) rate = 0.35;
      if (rate > 3) rate = 3;
      const when = Math.max(0, (Number(ev.frame) || 0) / (this.fps || 30));
      const offsetSec = Math.max(
        0,
        Math.min(buf.duration - 0.001, (Number(ev.offsetMs) || 0) / 1000),
      );
      const src = offline.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      const g = offline.createGain();
      g.gain.value = Math.max(0, Number(ev.volume) || SE_DEFAULT);
      src.connect(g);
      g.connect(masterGain);
      let playForSec = null;
      if (ev.endFrame != null && Number(ev.endFrame) > Number(ev.frame)) {
        playForSec = (Number(ev.endFrame) - Number(ev.frame)) / (this.fps || 30);
      }
      try {
        if (playForSec != null) {
          src.start(
            when,
            offsetSec,
            Math.min(playForSec * rate, buf.duration - offsetSec),
          );
        } else if (offsetSec > 0) {
          src.start(when, offsetSec);
        } else {
          src.start(when);
        }
      } catch {

      }
    }

    const rendered = await offline.startRendering();
    return audioBufferToWavBlob(rendered);
  }

  silence() {
    for (const src of this._sources) {
      try {
        src.onended = null;
        src.stop(0);
        src.disconnect();
      } catch {

      }
    }
    this._sources.clear();
    this.voices.clear();
    if (this.ctx) this._remaster();
  }
  clearPlayingOnly() {
    this.silence();
  }
  clear() {
    this.cancelPending();
    this.silence();
    this.cache.clear();
    this._cacheOrder = [];
    this.volumeByWorkId.clear();
    this.volumeByVoiceCue.clear();
  }
  cancelPending() {
    this._loadGeneration += 1;
    this.timelineGen += 1;
    for (const controller of this._controllers) controller.abort();
    this._controllers.clear();
    this._pending.clear();
  }
  dispose() {
    this._disposed = true;
    this.clear();
    this._mixEvents = [];
    this.master?.disconnect();
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.master = null;
  }
  suspend() {
    try {
      this.ctx?.suspend?.();
    } catch {

    }
  }
  async resume() {
    if (!this.ctx) return;
    if (this.ctx.state !== 'suspended') return;
    try {
      await this.ctx.resume();
    } catch {

    }
  }
  setSeVolume(workId, volume) {
    workId = Number(workId);
    const rel = normalizeScriptVolume(volume, SE_DEFAULT);
    this.volumeByWorkId.set(workId, rel);
    const live = this.voices.get(workId);
    if (live?.gain && this.ctx) {
      live.gain.gain.setValueAtTime(rel, this.ctx.currentTime);
    }
  }
  setVoiceVolume(cueId, volume) {
    cueId = Number(cueId);
    const rel = normalizeScriptVolume(volume, VOICE_DEFAULT);
    this.volumeByVoiceCue.set(cueId, rel);
    const live = this.voices.get(`v:${cueId}`);
    if (live?.gain && this.ctx) {
      live.gain.gain.setValueAtTime(rel, this.ctx.currentTime);
    }
  }
  stopWork(workId) {
    const live = this.voices.get(Number(workId));
    if (!live?.src) return;
    try {
      live.src.stop(0);
      live.src.disconnect();
    } catch {

    }
    this._sources.delete(live.src);
    this.voices.delete(Number(workId));
  }
  async preloadSe(cueId) {
    const patch = getActivePatchId() || '';
    return this._load(`/api/se?cue=${encodeURIComponent(cueId)}`, `se:${cueId}:${patch}`);
  }
  async preloadVoice(cueId, packageHint = '') {
    const generation = this._loadGeneration;
    const lang = this.voiceLanguage || 'ja';
    const q = new URLSearchParams({ cue: String(cueId), lang: lang });
    if (packageHint) q.set('package', String(packageHint));
    const patch = getActivePatchId() || '';
    const cacheKey = `voice:${lang}:${cueId}:${packageHint || ''}:${patch}`;
    const buf = await this._load(`/api/voice?${q}`, cacheKey);
    if (buf && generation === this._loadGeneration && !this._disposed) {
      this.cache.set(`voice:${cueId}:${packageHint || ''}`, buf);
      this.cache.set(`voice:${cueId}:`, buf);
      this.cache.set(`voice:${cueId}`, buf);
      // Track alias keys in LRU (the primary key is tracked by _load)
      this._trackCacheKey(`voice:${cueId}:${packageHint || ''}`);
      this._trackCacheKey(`voice:${cueId}:`);
      this._trackCacheKey(`voice:${cueId}`);
    }
    return buf;
  }

  async playCue(
    cueId,
    {
      volume = -1,
      workId = null,
      frame = 0,
      offsetMs = 0,
      endFrame = null,
      playbackRate = 1,
    } = {},
  ) {
    cueId = Number(cueId);
    if (!Number.isFinite(cueId)) return;
    const gen = this.timelineGen;
    try {
      const buf = await this.preloadSe(cueId);
      if (!buf || gen !== this.timelineGen) return;
      const rel =
        workId != null && this.volumeByWorkId.has(workId)
          ? this.volumeByWorkId.get(workId)
          : normalizeScriptVolume(volume, SE_DEFAULT);
      this._noteMix('se', cueId, {
        frame,
        offsetMs,
        endFrame,
        playbackRate,
        relVolume: rel,
        cacheKey: `se:${cueId}`,
      });
      this._startNow(buf, rel, workId, {
        frame,
        offsetMs,
        endFrame,
        playbackRate,
      });
    } catch (e) {
      this.log(`SE ${cueId} failed: ${e.message || e}`);
    }
  }

  playCueNow(
    cueId,
    {
      volume = -1,
      workId = null,
      frame = 0,
      offsetMs = 0,
      endFrame = null,
      playbackRate = 1,
    } = {},
  ) {
    cueId = Number(cueId);
    if (!Number.isFinite(cueId)) return false;
    const buf = this.cache.get(`se:${cueId}`);
    if (!buf) return false;
    const rel =
      workId != null && this.volumeByWorkId.has(workId)
        ? this.volumeByWorkId.get(workId)
        : normalizeScriptVolume(volume, SE_DEFAULT);
    this._noteMix('se', cueId, {
      frame,
      offsetMs,
      endFrame,
      playbackRate,
      relVolume: rel,
      cacheKey: `se:${cueId}`,
    });
    this._startNow(buf, rel, workId, { frame, offsetMs, endFrame, playbackRate });
    return true;
  }

  playCueAt(
    cueId,
    when,
    {
      volume = -1,
      workId = null,
      frame = 0,
      offsetMs = 0,
      endFrame = null,
      playbackRate = 1,
    } = {},
  ) {
    cueId = Number(cueId);
    const buf = this.cache.get(`se:${cueId}`);
    if (!buf) {
      void this.playCue(cueId, { volume, workId, frame, offsetMs, endFrame, playbackRate });
      return;
    }
    const rel =
      workId != null && this.volumeByWorkId.has(workId)
        ? this.volumeByWorkId.get(workId)
        : normalizeScriptVolume(volume, SE_DEFAULT);
    this._noteMix('se', cueId, {
      frame,
      offsetMs,
      endFrame,
      playbackRate,
      relVolume: rel,
      cacheKey: `se:${cueId}`,
    });
    this._startAt(buf, rel, workId, when, { frame, offsetMs, endFrame, playbackRate });
  }
  playVoiceAt(cueId, when, { volume = -1, frame = 0 } = {}) {
    cueId = Number(cueId);
    const buf = this.cache.get(`voice:${cueId}`);
    if (!buf) {
      void this.playVoice(cueId, { volume, frame });
      return;
    }
    const rel = this.volumeByVoiceCue.has(cueId)
      ? this.volumeByVoiceCue.get(cueId)
      : normalizeScriptVolume(volume, VOICE_DEFAULT);
    this._noteMix('voice', cueId, {
      frame,
      relVolume: rel,
      cacheKey: `voice:${cueId}:`,
    });
    this._startAt(buf, rel, `v:${cueId}`, when, { frame });
  }
  _startAt(buf, relVolume, key, when, { frame = 0, offsetMs = 0, endFrame = null, playbackRate = 1 } = {}) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      const generation = this.timelineGen;
      void this._ensureRunning().then(() => {
        if (ctx.state === 'running' && generation === this.timelineGen && !this._disposed)
          this._startAt(buf, relVolume, key, when, { frame, offsetMs, endFrame, playbackRate });
      });
      return;
    }
    const startAt = Math.max(ctx.currentTime, Number(when) || ctx.currentTime);
    const offsetSec = Math.max(0, Math.min(buf.duration - 0.001, (Number(offsetMs) || 0) / 1000));
    let rate = Number(playbackRate) || 1;
    if (rate < 0.35) rate = 0.35;
    if (rate > 3) rate = 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, relVolume);
    src.connect(gain);
    gain.connect(this.master);
    this._sources.add(src);
    let playForSec = null;
    if (endFrame != null && Number(endFrame) > Number(frame)) {
      playForSec = (Number(endFrame) - Number(frame)) / this.fps;
      src.loop = false;
    }
    try {
      if (playForSec != null) {
        src.start(startAt, offsetSec, Math.min(playForSec * rate, buf.duration - offsetSec));
      } else if (offsetSec > 0) {
        src.start(startAt, offsetSec);
      } else {
        src.start(startAt);
      }
    } catch {
      try {
        src.start(0, offsetSec);
      } catch {

      }
    }
    if (key != null) {
      this.voices.set(key, { src, gain });
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        this._sources.delete(src);
        if (this.voices.get(key)?.src === src) this.voices.delete(key);
      };
    } else {
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        this._sources.delete(src);
      };
    }
  }
  async playVoice(cueId, { volume = -1, frame = 0, packageHint = '' } = {}) {
    cueId = Number(cueId);
    if (!Number.isFinite(cueId)) return;
    const gen = this.timelineGen;
    try {
      const buf = await this.preloadVoice(cueId, packageHint);
      if (!buf || gen !== this.timelineGen) return;
      const rel = this.volumeByVoiceCue.has(cueId)
        ? this.volumeByVoiceCue.get(cueId)
        : normalizeScriptVolume(volume, VOICE_DEFAULT);
      this._noteMix('voice', cueId, {
        frame,
        relVolume: rel,
        cacheKey: `voice:${cueId}:${packageHint || ''}`,
      });
      this._startNow(buf, rel, `v:${cueId}`, { frame });
    } catch (e) {
      this.log(`Voice ${cueId} failed: ${e.message || e}`);
    }
  }
  playVoiceNow(cueId, { volume = -1, frame = 0, packageHint = '' } = {}) {
    cueId = Number(cueId);
    if (!Number.isFinite(cueId)) return false;
    const buf =
      this.cache.get(`voice:${cueId}:${packageHint || ''}`) ||
      this.cache.get(`voice:${cueId}:`) ||
      this.cache.get(`voice:${cueId}`);
    if (!buf) return false;
    const rel = this.volumeByVoiceCue.has(cueId)
      ? this.volumeByVoiceCue.get(cueId)
      : normalizeScriptVolume(volume, VOICE_DEFAULT);
    this._noteMix('voice', cueId, {
      frame,
      relVolume: rel,
      cacheKey: `voice:${cueId}:${packageHint || ''}`,
    });
    this._startNow(buf, rel, `v:${cueId}`, { frame });
    return true;
  }
  _startNow(buf, relVolume, key, { frame = 0, offsetMs = 0, endFrame = null, playbackRate = 1 } = {}) {
    const ctx = this._ensureCtx();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      const generation = this.timelineGen;
      void this._ensureRunning().then(() => {
        if (ctx.state === 'running' && generation === this.timelineGen && !this._disposed)
          this._startNow(buf, relVolume, key, { frame, offsetMs, endFrame, playbackRate });
      });
      return;
    }
    const when = ctx.currentTime + 0.01;
    const offsetSec = Math.max(0, Math.min(buf.duration - 0.001, (Number(offsetMs) || 0) / 1000));
    let rate = Number(playbackRate) || 1;
    if (rate < 0.35) rate = 0.35;
    if (rate > 3) rate = 3;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.playbackRate.value = rate;
    const gain = ctx.createGain();
    gain.gain.value = Math.max(0, relVolume);
    src.connect(gain);
    gain.connect(this.master);
    this._sources.add(src);
    let playForSec = null;
    if (endFrame != null && Number(endFrame) > Number(frame)) {
      playForSec = (Number(endFrame) - Number(frame)) / this.fps;

      src.loop = false;
    }
    try {
      if (playForSec != null) {
        src.start(when, offsetSec, Math.min(playForSec * rate, buf.duration - offsetSec));
      } else if (offsetSec > 0) {
        src.start(when, offsetSec);
      } else {
        src.start(when);
      }
    } catch {
      try {
        src.start(0, offsetSec);
      } catch {

      }
    }
    if (key != null) {
      const prev = this.voices.get(key);
      if (prev?.src) {
        try {
          prev.src.stop(0);
          prev.src.disconnect();
        } catch {

        }
        this._sources.delete(prev.src);
      }
      this.voices.set(key, { src, gain });
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        this._sources.delete(src);
        if (this.voices.get(key)?.src === src) this.voices.delete(key);
      };
    } else {
      src.onended = () => {
        src.disconnect();
        gain.disconnect();
        this._sources.delete(src);
      };
    }
  }
  async _decodeAudioData(arrayBuffer, timeoutMs = 15000) {
    const ctx = this._ensureCtx();
    if (!ctx) throw new Error('Web Audio API không khả dụng trong ngữ cảnh này');

    return new Promise((resolve, reject) => {
      let done = false;
      const t = setTimeout(() => {
        if (!done) {
          done = true;
          reject(new Error('decodeAudioData timeout (>15s)'));
        }
      }, timeoutMs);

      try {
        const p = ctx.decodeAudioData(
          arrayBuffer.slice(0),
          (decoded) => {
            if (!done) {
              done = true;
              clearTimeout(t);
              resolve(decoded);
            }
          },
          (err) => {
            if (!done) {
              done = true;
              clearTimeout(t);
              reject(err || new Error('decodeAudioData giải mã thất bại'));
            }
          }
        );
        if (p && typeof p.then === 'function') {
          p.then(
            (decoded) => {
              if (!done) {
                done = true;
                clearTimeout(t);
                resolve(decoded);
              }
            },
            (err) => {
              if (!done) {
                done = true;
                clearTimeout(t);
                reject(err || new Error('decodeAudioData giải mã thất bại'));
              }
            }
          );
        }
      } catch (err) {
        if (!done) {
          done = true;
          clearTimeout(t);
          reject(err);
        }
      }
    });
  }

  async _load(url, cacheKey) {
    if (this._disposed) return null;
    if (this.cache.has(cacheKey)) return this.cache.get(cacheKey);
    if (this._pending.has(cacheKey)) return this._pending.get(cacheKey);
    const pending = this._fetchAudio(url, cacheKey, this._loadGeneration);
    this._pending.set(cacheKey, pending);
    try { return await pending; }
    finally { if (this._pending.get(cacheKey) === pending) this._pending.delete(cacheKey); }
  }

  async _fetchAudio(url, cacheKey, generation) {
    const cancelled = () => this._disposed || generation !== this._loadGeneration;

    const maxAttempts = 3;
    let lastMsg = '';

    const candidateBases = [
      getApiBase(),
      'http://127.0.0.1:' + (window.__SERVER_PORT__ || 8585),
      'http://localhost:' + (window.__SERVER_PORT__ || 8585),
    ];
    const uniqueBases = Array.from(new Set(candidateBases.filter(Boolean)));

    for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
      if (cancelled()) return null;
      const base = uniqueBases[attempt % uniqueBases.length];
      const targetUrl = withPatchQuery(url, base);
      const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
      if (ctrl) this._controllers.add(ctrl);
      const timer = ctrl && setTimeout(() => {
        try { ctrl.abort(); } catch {}
      }, cacheKey.startsWith('voice:') ? 60000 : 15000);

      try {
        const res = await fetch(targetUrl, ctrl ? { signal: ctrl.signal } : {});
        if (cancelled()) return null;
        if (!res.ok) {
          const err = await res.json().catch(() => ({}));
          lastMsg = String(err.error || res.status);
          if (res.status === 404 || res.status === 410) {
            this.log(`${cacheKey}: 404 Not Found (${targetUrl})`);
            this.cache.set(cacheKey, null);
            this._trackCacheKey(cacheKey);
            this.lastError = '404 Không tìm thấy file';
            return null;
          }
          throw new Error(lastMsg);
        }

        const ab = await res.arrayBuffer();
        if (!ab || ab.byteLength === 0) {
          throw new Error('File âm thanh rỗng (0 byte)');
        }

        const buf = await this._decodeAudioData(ab);
        if (cancelled()) return null;
        this.cache.set(cacheKey, buf);
        this._trackCacheKey(cacheKey);
        this.lastError = null;
        return buf;
      } catch (e) {
        if (cancelled()) return null;
        lastMsg = e?.name === 'AbortError' ? 'Quá thời gian tải (timeout)' : (e?.message || String(e));
        this.lastError = lastMsg;
        if (attempt < maxAttempts - 1) {
          await new Promise((r) => setTimeout(r, 200));
        }
      } finally {
        if (ctrl) this._controllers.delete(ctrl);
        if (timer) clearTimeout(timer);
      }
    }

    this.log(`${cacheKey}: ${lastMsg}`);
    this.lastError = lastMsg;
    return null;
  }
}

function audioBufferToWavBlob(buffer) {
  const numCh = buffer.numberOfChannels;
  const sr = buffer.sampleRate;
  const n = buffer.length;
  const dataBytes = n * numCh * 2;
  const out = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(out);
  const wstr = (off, s) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  wstr(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  wstr(8, 'WAVE');
  wstr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numCh, true);
  view.setUint32(24, sr, true);
  view.setUint32(28, sr * numCh * 2, true);
  view.setUint16(32, numCh * 2, true);
  view.setUint16(34, 16, true);
  wstr(36, 'data');
  view.setUint32(40, dataBytes, true);
  const chans = [];
  for (let c = 0; c < numCh; c++) chans.push(buffer.getChannelData(c));
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < numCh; c++) {
      let s = chans[c][i];
      s = s < -1 ? -1 : s > 1 ? 1 : s;
      view.setInt16(o, (s * 0x7fff) | 0, true);
      o += 2;
    }
  }
  return new Blob([out], { type: 'audio/wav' });
}
