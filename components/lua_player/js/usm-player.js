import { movieZIndex } from './layers.js';
import { fetchFresh, stampFromResponse, fetchWithProgress } from './fetch-fresh.js';
import { withPatchQuery } from './patch-context.js';

const DRIFT_SEEK_SEC = 0.35;

function compileShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const detail = gl.getShaderInfoLog(shader) || 'unknown shader error';
    gl.deleteShader(shader);
    throw new Error(detail);
  }
  return shader;
}

function createChromaRenderer(canvas) {
  try {
    const gl = canvas.getContext('webgl', {
      alpha: true,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: true,
    });
    if (!gl) return null;
    const vs = compileShader(gl, gl.VERTEX_SHADER, `
      attribute vec2 a_position;
      attribute vec2 a_uv;
      varying vec2 v_uv;
      void main() {
        gl_Position = vec4(a_position, 0.0, 1.0);
        v_uv = a_uv;
      }
    `);
    const fs = compileShader(gl, gl.FRAGMENT_SHADER, `
      precision mediump float;
      uniform sampler2D u_frame;
      varying vec2 v_uv;
      void main() {
        vec4 color = texture2D(u_frame, v_uv);
        float rb = max(color.r, color.b);
        float dominance = color.g - rb;
        // Dokkan's Sofdec/USM overlays use a bright green matte. Use a soft
        // threshold so compression noise and antialiased edges disappear too.
        float key = smoothstep(0.18, 0.42, dominance) * smoothstep(0.48, 0.78, color.g);
        float edge = smoothstep(0.07, 0.25, dominance) * smoothstep(0.32, 0.66, color.g);
        color.g = mix(color.g, min(color.g, rb * 1.10), edge * 0.78);
        color.a *= 1.0 - key;
        if (color.a < 0.01) discard;
        gl_FragColor = color;
      }
    `);
    const program = gl.createProgram();
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      throw new Error(gl.getProgramInfoLog(program) || 'shader link failed');
    }
    const positionBuffer = gl.createBuffer();
    const uvBuffer = gl.createBuffer();
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    // The quad UVs already use DOM/video top-left orientation. Flipping the
    // upload as well inverted every USM frame vertically.
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.clearColor(0, 0, 0, 0);
    return {
      gl,
      program,
      positionBuffer,
      uvBuffer,
      texture,
      positionLoc: gl.getAttribLocation(program, 'a_position'),
      uvLoc: gl.getAttribLocation(program, 'a_uv'),
    };
  } catch {
    return null;
  }
}

function disposeChromaRenderer(renderer) {
  if (!renderer?.gl) return;
  const { gl } = renderer;
  try {
    gl.deleteTexture(renderer.texture);
    gl.deleteBuffer(renderer.positionBuffer);
    gl.deleteBuffer(renderer.uvBuffer);
    gl.deleteProgram(renderer.program);
  } catch {
    // Context may already be lost while Streamlit tears down the iframe.
  }
}

function renderChromaFrame(renderer, video, canvas, dx, dy, dw, dh) {
  const { gl } = renderer;
  const x1 = (dx / canvas.width) * 2 - 1;
  const x2 = ((dx + dw) / canvas.width) * 2 - 1;
  const y1 = 1 - (dy / canvas.height) * 2;
  const y2 = 1 - ((dy + dh) / canvas.height) * 2;
  const positions = new Float32Array([
    x1, y1, x2, y1, x1, y2,
    x1, y2, x2, y1, x2, y2,
  ]);
  const uvs = new Float32Array([
    0, 0, 1, 0, 0, 1,
    0, 1, 1, 0, 1, 1,
  ]);
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.useProgram(renderer.program);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.positionBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
  gl.enableVertexAttribArray(renderer.positionLoc);
  gl.vertexAttribPointer(renderer.positionLoc, 2, gl.FLOAT, false, 0, 0);
  gl.bindBuffer(gl.ARRAY_BUFFER, renderer.uvBuffer);
  gl.bufferData(gl.ARRAY_BUFFER, uvs, gl.STATIC_DRAW);
  gl.enableVertexAttribArray(renderer.uvLoc);
  gl.vertexAttribPointer(renderer.uvLoc, 2, gl.FLOAT, false, 0, 0);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderer.texture);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
  gl.drawArrays(gl.TRIANGLES, 0, 6);
}

function removeGreenMatte2d(ctx, x, y, w, h) {
  const sx = Math.max(0, Math.floor(x));
  const sy = Math.max(0, Math.floor(y));
  const sw = Math.max(1, Math.min(ctx.canvas.width - sx, Math.ceil(w)));
  const sh = Math.max(1, Math.min(ctx.canvas.height - sy, Math.ceil(h)));
  const frame = ctx.getImageData(sx, sy, sw, sh);
  const p = frame.data;
  for (let i = 0; i < p.length; i += 4) {
    const r = p[i] / 255;
    const g = p[i + 1] / 255;
    const b = p[i + 2] / 255;
    const dominance = g - Math.max(r, b);
    const key = Math.max(0, Math.min(1, (dominance - 0.18) / 0.24)) *
      Math.max(0, Math.min(1, (g - 0.48) / 0.30));
    if (key <= 0) continue;
    p[i + 1] = Math.min(p[i + 1], Math.round(Math.max(p[i], p[i + 2]) * 1.1));
    p[i + 3] = Math.round(p[i + 3] * (1 - key));
  }
  ctx.putImageData(frame, sx, sy);
}

export class UsmLayer {
  constructor(hostEl, log) {
    this.host = hostEl;
    this.log = log || (() => {});
    this.clips = [];
    this._preload = new Map();
    this._preloadGen = 0;
    this._playbackRate = 1;
    this._refLock = false;
  }

  clear() {
    this.clearClips();
    this.clearPreload();
  }

  clearClips() {
    for (const c of this.clips) c.destroy();
    this.clips = [];
    for (const child of [...this.host.children]) {
      if (!child.classList?.contains('movie-clip')) continue;
      child.remove();
    }
  }

  clearPreload() {
    this._preloadGen += 1;
    for (const e of this._preload.values()) {
      this._disposeEntryMedia(e);
    }
    this._preload.clear();
  }

  _disposeEntryMedia(entry) {
    if (!entry) return;
    if (entry.url) {
      try {
        URL.revokeObjectURL(entry.url);
      } catch {

      }
      entry.url = null;
    }
    entry.video = null;
    entry.warmVideo = null;
    entry.warmUrl = null;
  }

  async _sourceStamp(relPath) {
    const rel = String(relPath || '').replace(/^\/+/, '');
    const assetUrl = withPatchQuery(`/assets/${rel
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')}`);
    try {
      const res = await fetchFresh(assetUrl, { method: 'HEAD' });
      if (res.ok) return stampFromResponse(res) || '';
    } catch {

    }
    try {
      const res = await fetchFresh(assetUrl, {
        method: 'GET',
        headers: { Range: 'bytes=0-0' },
      });
      if (res.ok || res.status === 206) return stampFromResponse(res) || '';
    } catch {

    }
    return '';
  }

  async preloadFromAssetRel(relPath, opts = {}) {
    const key = String(relPath || '');
    if (!key) return null;
    const stamp = opts.stamp || '';
    const generation = this._preloadGen;
    const prev = this._preload.get(key);
    if (prev?.url) {
      if (!stamp || !prev.stamp || prev.stamp === stamp) {
        if (stamp && !prev.stamp) prev.stamp = stamp;
        if (typeof opts.onProgress === 'function') {
          const size = prev.blob?.size || prev.bytes || 0;
          opts.onProgress({ loaded: size, total: size, percent: 100 });
        }
        return prev;
      }
      this._disposeEntryMedia(prev);
      this._preload.delete(key);
    }
    if (prev?.promise) return prev.promise;

    const pending = { rel: key, stamp: stamp || '', blob: null, url: null, promise: null };
    const promise = (async () => {
      this.log(`Movie preload ${key}…`);

      let blob;
      let streamUrl = null;
      let bytes = 0;
      let outStamp = stamp;
      if (window.__ECLIPSE_TOOL__ === 'lua-player') {
        // Probe the MP4 with one range request. The video element then streams
        // from the file on disk instead of retaining the whole MP4 as a Blob.
        try {
          const got = await this._probeServerMp4(key, opts.onProgress);
          streamUrl = got.url;
          bytes = got.bytes;
          outStamp = got.stamp || stamp;
        } catch (serverError) {
          this.log(`MP4 streaming unavailable (${serverError.message || serverError}); trying client USM pipeline…`);
          const got = await this._preloadViaClientPipeline(key, opts.onProgress);
          blob = got.blob;
          outStamp = got.stamp || stamp;
        }
      } else {
        const url = `/api/usm?path=${encodeURIComponent(key)}&reencode=1`;
        const { res, blob: fblob } = await fetchWithProgress(url, opts.onProgress);
        if (!res.ok) {
          let errBody = {};
          try { errBody = JSON.parse(await fblob.text()); } catch {}
          throw new Error(errBody.error || `Movie decode failed (${res.status})`);
        }
        outStamp = stampFromResponse(res) || stamp;
        blob = fblob;
      }

      if (generation !== this._preloadGen) throw new Error('Movie preload cancelled');
      const entry = {
        blob,
        rel: key,
        stamp: outStamp,
        url: streamUrl || URL.createObjectURL(blob),
        bytes: bytes || blob?.size || 0,
        video: null,
      };
      this._preload.set(key, entry);
      this.log(`Movie ready ${key} · ${(entry.bytes / 1024 / 1024).toFixed(2)} MB${streamUrl ? ' · streamed' : ' · fallback Blob'}`);
      return entry;
    })().catch((e) => {
      if (this._preload.get(key) === pending) this._preload.delete(key);
      throw e;
    });

    pending.promise = promise;
    this._preload.set(key, pending);
    return promise;
  }

  async _probeServerMp4(key, onProgress) {
    const url = withPatchQuery(`/api/usm?path=${encodeURIComponent(key)}&reencode=1`);
    const res = await fetch(url, { headers: { Range: 'bytes=0-31' } });
    if (res.status !== 206) {
      await res.body?.cancel();
      throw new Error(`Movie endpoint cannot stream ranges (${res.status})`);
    }
    const header = new Uint8Array(await res.arrayBuffer());
    if (header.length < 8 || String.fromCharCode(...header.slice(4, 8)) !== 'ftyp') {
      throw new Error('Movie endpoint did not return MP4 data');
    }
    const range = res.headers.get('Content-Range');
    const bytes = Number(range?.split('/').pop()) || Number(res.headers.get('Content-Length')) || 0;
    if (typeof onProgress === 'function') onProgress({ loaded: bytes, total: bytes, percent: 100 });
    return { url, bytes, stamp: stampFromResponse(res) };
  }

  async _preloadViaServerMp4(key, onProgress) {
    const url = `/api/usm?path=${encodeURIComponent(key)}&reencode=1`;
    const { res, blob } = await fetchWithProgress(url, onProgress, {}, 180000);
    if (!res.ok || !blob?.size) {
      throw new Error(`Movie endpoint failed (${res.status})`);
    }
    const type = String(blob.type || res.headers.get('Content-Type') || '').toLowerCase();
    if (type.includes('json')) {
      let detail = '';
      try { detail = JSON.parse(await blob.text()).error || ''; } catch {}
      throw new Error(detail || 'Movie endpoint returned JSON instead of MP4');
    }
    return { blob, stamp: stampFromResponse(res) };
  }

  async _preloadViaClientPipeline(key, onProgress) {
    const rel = String(key).replace(/^\/+/, '');
    const assetUrl = withPatchQuery(`/assets/${rel
      .split('/')
      .filter(Boolean)
      .map(encodeURIComponent)
      .join('/')}`);
    const { res, blob: usmBlob } = await fetchWithProgress(assetUrl, onProgress);
    if (!res.ok) throw new Error(`Movie asset missing (${res.status}): ${key}`);
    const stamp = stampFromResponse(res);
    const buf = await usmBlob.arrayBuffer();
    const name = String(key).split('/').pop() || 'movie.usm';
    const file = new File([buf], name, { type: 'application/octet-stream' });
    let openUsmFn;
    try {
      const mod = await import('./usm-pipeline/pipeline.js');
      openUsmFn = mod.openUsm;
    } catch {
      const mod = await import('/tools/usm-player/js/pipeline.js');
      openUsmFn = mod.openUsm;
    }
    try {
      const onWebsite = window.__ECLIPSE_TOOL__ === 'lua-player';
      const result = await openUsmFn(file, this.log, {
        preferServer: !onWebsite,
        forceFfmpeg: false,
        reencode: true,
      });
      return { blob: new Blob([result.mp4], { type: 'video/mp4' }), stamp };
    } catch (e) {
      this.log(`Client USM path failed (${e.message || e}); trying /api/usm…`);
      const { res: apiRes, blob: apiBlob } = await fetchWithProgress(
        `/api/usm?path=${encodeURIComponent(key)}&reencode=1`,
        onProgress,
      );
      if (!apiRes.ok) {
        let errBody = {};
        try { errBody = JSON.parse(await apiBlob.text()); } catch {}
        const detail = errBody.error || e.message || `Movie decode failed (${apiRes.status})`;
        this.log(`USM FAIL ${key}: ${detail}`);
        throw new Error(detail);
      }
      return {
        blob: apiBlob,
        stamp: stampFromResponse(apiRes) || stamp,
      };
    }
  }

  _mediaDiag(video) {
    if (!video) return 'no-video';
    const err = video.error;
    return (
      `rs=${video.readyState} net=${video.networkState}` +
      ` ${video.videoWidth || 0}x${video.videoHeight || 0}` +
      ` paused=${video.paused ? 1 : 0}` +
      (err ? ` err=${err.code}` : '')
    );
  }

  _makeClipShell({ zIndex, contentId, startAbFrame, key, entry }) {
    const wrap = document.createElement('div');
    wrap.className = 'movie-clip';
    wrap.style.cssText = `position:absolute;inset:0;z-index:${zIndex};pointer-events:none;visibility:hidden;`;

    let canvas = document.createElement('canvas');
    canvas.width = 852;
    canvas.height = 1536;
    canvas.className = 'movie-layer';
    const chroma = createChromaRenderer(canvas);
    let ctx = chroma ? null : canvas.getContext('2d', { willReadFrequently: true });
    // A failed shader compile can lock that canvas to WebGL. Recreate only the
    // surface so the 2D chroma fallback still works on older GPUs/drivers.
    if (!chroma && !ctx) {
      canvas = document.createElement('canvas');
      canvas.width = 852;
      canvas.height = 1536;
      canvas.className = 'movie-layer';
      ctx = canvas.getContext('2d', { willReadFrequently: true });
    }

    wrap.append(canvas);
    this.host.appendChild(wrap);

    const clip = {
      wrap,
      video: null,
      canvas,
      ctx,
      chroma,
      objectUrl: null,
      raf: null,
      videoFrameCallback: null,
      _scheduleBlit: null,
      _cancelBlit: null,
      rel: key,
      contentId: Number(contentId) || 0,
      startAbFrame: Number(startAbFrame) || 0,
      visible: false,
      fps: 30,
      masterTime: 0,
      _lastOk: false,
      _syncPaused: false,
      _userPaused: false,
      _abPaused: false,
      _effectivePaused: true,
      _seekInFlight: false,
      _entry: entry || null,
      destroy() {
        this._cancelBlit?.();
        disposeChromaRenderer(this.chroma);
        this.chroma = null;
        const v = this.video;
        this.video = null;
        if (v) {
          try {
            v.pause();
          } catch {

          }
          try {
            v.removeAttribute('src');
            v.load();
            v.remove();
          } catch {

          }
        }
        if (this.canvas) {
          this.canvas.width = 1;
          this.canvas.height = 1;
        }
        this.wrap?.remove?.();
      },
    };
    return clip;
  }

  async playFromAssetRel(
    relPath,
    {
      zIndex = movieZIndex(0),
      contentId = 0,
      startAbFrame = 0,
      retainPrevious = false,
      isCancelled = null,
    } = {},
  ) {
    const cancelled = () => (typeof isCancelled === 'function' ? !!isCancelled() : false);
    const key = String(relPath || '');
    let entry = this._preload.get(key);
    if (!entry) {
      entry = await this.preloadFromAssetRel(key);
    } else if (entry.promise) {
      entry = await entry.promise;
    }
    if (cancelled()) throw new Error('Movie play cancelled');
    if (this._refLock) throw new Error('Movie play blocked (ref lock)');
    if (!entry?.url) {
      if (entry?.blob) entry.url = URL.createObjectURL(entry.blob);
      else entry.url = withPatchQuery(`/api/usm?path=${encodeURIComponent(key)}&reencode=1`);
    }

    for (const c of [...this.clips]) {
      if (!retainPrevious && (c.contentId === contentId || c.rel === key)) {
        c.destroy();
        const i = this.clips.indexOf(c);
        if (i >= 0) this.clips.splice(i, 1);
      }
    }

    const clip = this._makeClipShell({ zIndex, contentId, startAbFrame, key, entry });
    const video = document.createElement('video');
    video.className = 'movie-decode';
    video.muted = true;
    video.defaultMuted = true;
    video.playsInline = true;
    video.crossOrigin = 'anonymous';
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.setAttribute('muted', '');
    video.preload = 'auto';
    video.disablePictureInPicture = true;
    video.src = entry.url;
    clip.wrap.insertBefore(video, clip.canvas);
    clip.video = video;
    clip._entry = entry;

    video.playbackRate = this._playbackRate;
    clip._attachedAt = performance.now();
    clip._abPaused = true;
    clip._syncPaused = true;
    try {
      video.pause();
    } catch {

    }

    if (cancelled()) {
      clip.destroy();
      throw new Error('Movie play cancelled');
    }

    try {
      await this._waitVideoReady(video);
      if (cancelled()) throw new Error('Movie play cancelled');
    } catch (error) {
      clip.destroy();
      throw error;
    }

    const isPaused = () => (
      this._refLock || clip._timelineInactive || clip._syncPaused || clip._userPaused || clip._abPaused || video.ended
    );
    const cancelBlit = () => {
      if (clip.raf) cancelAnimationFrame(clip.raf);
      clip.raf = null;
      if (clip.videoFrameCallback != null && typeof video.cancelVideoFrameCallback === 'function') {
        try { video.cancelVideoFrameCallback(clip.videoFrameCallback); } catch {}
      }
      clip.videoFrameCallback = null;
    };
    const scheduleBlit = () => {
      if (!clip.wrap?.isConnected || isPaused()) return;
      if (clip.raf || clip.videoFrameCallback != null) return;
      if (typeof video.requestVideoFrameCallback === 'function') {
        clip.videoFrameCallback = video.requestVideoFrameCallback(blit);
      } else {
        clip.raf = requestAnimationFrame(blit);
      }
    };
    const blit = () => {
      clip.raf = null;
      clip.videoFrameCallback = null;
      if (!clip.wrap?.isConnected) return;
      if (this._refLock && clip.video) {
        try {
          if (!clip.video.paused) clip.video.pause();
        } catch {

        }
      }
      this._blitClip(clip);
      clip.wrap.style.visibility = clip.visible && (!clip._timelineInactive || clip._pendingRetire) ? 'visible' : 'hidden';
      if (
        !this._refLock &&
        !clip._timelineInactive &&
        video.paused &&
        !video.ended &&
        !clip._syncPaused &&
        !clip._userPaused &&
        !clip._abPaused
      ) {
        try {
          video.playbackRate = this._playbackRate;
          void video.play();
        } catch {

        }
      }
      scheduleBlit();
    };
    clip._scheduleBlit = scheduleBlit;
    clip._cancelBlit = cancelBlit;

    this.clips.push(clip);
    this.log(
      `Movie play ${key}` +
        (contentId ? ` id=${contentId}` : '') +
        ` z=${zIndex}` +
        ` · ${this._mediaDiag(video)}`,
    );
    return clip;
  }

  _blitClip(clip) {
    const { video, canvas, ctx, chroma } = clip;
    if (!video) return;
    const ready = video.readyState >= 2 && video.videoWidth > 0;
    if (ready) {
      try {
        const vw = video.videoWidth || 852;
        const vh = video.videoHeight || 1536;
        const scale = Math.min(canvas.width / vw, canvas.height / vh);
        const dw = vw * scale;
        const dh = vh * scale;
        const dx = (canvas.width - dw) / 2;
        const dy = (canvas.height - dh) / 2;
        if (chroma) {
          renderChromaFrame(chroma, video, canvas, dx, dy, dw, dh);
        } else if (ctx) {
          ctx.clearRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(video, dx, dy, dw, dh);
          removeGreenMatte2d(ctx, dx, dy, dw, dh);
        }
        clip._lastOk = true;
      } catch {

      }
    } else if (!clip._lastOk) {
      if (chroma?.gl) chroma.gl.clear(chroma.gl.COLOR_BUFFER_BIT);
      else ctx?.clearRect(0, 0, canvas.width, canvas.height);
    }
  }

  async prepareTimelineClip(rel, options) {
    const clip = await this.playFromAssetRel(rel, { ...options, retainPrevious: true });
    clip.timelineStart = options.timelineStart;
    clip.timelineEnd = options.timelineEnd;
    clip.preparedAtFrame = options.firstFrame;
    await this.resetPreparedTimelineClip(clip);
    return clip;
  }

  async resetPreparedTimelineClip(clip) {
    clip._timelineActivated = false;
    clip.visible = false;
    clip._pendingRetire = false;
    clip._timelineInactive = true;
    clip._abPaused = true;
    clip._syncPaused = true;
    clip.video.pause();
    clip.masterTime = Math.max(0, (clip.preparedAtFrame - clip.startAbFrame) / 60);
    await this._waitSeeked(clip.video, clip.masterTime);
    this._blitClip(clip);
    if (clip.wrap) clip.wrap.style.visibility = 'hidden';
  }

  syncMasterTimer(dtSec = 1 / 30) {
    const dt = Number(dtSec);
    if (!(dt > 0)) return;
    const rate = Math.max(0.25, Number(this._playbackRate) || 1);
    for (const c of this.clips) {
      if (!c?.video) continue;
      if (c._timelineInactive || c._syncPaused || c._userPaused || c._abPaused) {
        this._applyClipPlayState(c);
        continue;
      }
      if (c.video.ended) continue;
      c.masterTime += dt * rate;
      const dur = Number(c.video.duration);
      if (Number.isFinite(dur) && dur > 0 && c.masterTime > dur) {
        c.masterTime = dur;
      }
      this._applyClipPlayState(c);
      this._correctDrift(c);
    }
  }

  _correctDrift(c) {
    const v = c.video;
    if (!v || c._timelineInactive || c._syncPaused || c._userPaused || c._abPaused) return;
    if (c._seekInFlight) return;
    if (v.readyState < 2) return;
    const now = Number(v.currentTime) || 0;
    const drift = now - c.masterTime;

    if (drift <= DRIFT_SEEK_SEC) return;
    c._seekInFlight = true;
    const onSeeked = () => {
      c._seekInFlight = false;
      v.removeEventListener('seeked', onSeeked);
    };
    v.addEventListener('seeked', onSeeked, { once: true });
    setTimeout(onSeeked, 500);
    try {
      v.currentTime = Math.max(0, c.masterTime);
    } catch {
      c._seekInFlight = false;
    }
  }

  isDecoderBehind(slackSec = 0.08) {
    const now = performance.now();
    for (const c of this.clips) {
      if (!c?.video || c._timelineInactive || c.video.ended) continue;

      if (c._syncPaused || c._userPaused || c._abPaused || c.video.paused) continue;
      const vt = Number(c.video.currentTime);
      if (!Number.isFinite(vt)) continue;
      try {
        if (c.video.readyState < 2) {
          if (c._lastOk) return true;
          const age = now - (c._attachedAt || now);
          if (age < 2500) return true;
          continue;
        }
        const buf = c.video.buffered;
        if (buf && buf.length) {
          const end = buf.end(buf.length - 1);
          if (end < vt + slackSec && !c.video.ended) return true;
        }
      } catch {

      }
    }
    return false;
  }

  hasActiveClips() {
    return this.clips.some((c) => {
      if (!c?.video || c._timelineInactive) return false;
      if (c.video.ended) return false;
      const dur = Number(c.video.duration);
      if (Number.isFinite(dur) && dur > 0 && c.masterTime >= dur - 1e-3) return false;
      return true;
    });
  }

  getPlayingFrame() {
    const c = this._primaryClip();
    if (!c) return null;
    const fps = Math.max(1, Number(c.fps) || 30);
    const t = Number.isFinite(c.masterTime)
      ? c.masterTime
      : c.video && Number.isFinite(c.video.currentTime)
        ? c.video.currentTime
        : 0;
    return 1 + Math.floor(t * fps + 1e-6);
  }

  getStartAbFrame() {
    const c = this._primaryClip();
    return c ? Number(c.startAbFrame) || 0 : null;
  }

  _primaryClip() {
    for (let i = this.clips.length - 1; i >= 0; i--) {
      const c = this.clips[i];
      if (!c?.video || c._timelineInactive) continue;
      const dur = Number(c.video.duration);
      if (Number.isFinite(dur) && dur > 0 && c.masterTime >= dur - 1e-3) continue;
      if (c.video.ended) continue;
      return c;
    }
    return this.clips.findLast(c => !c._timelineInactive) || null;
  }

  setSyncPause(paused) {
    if (this._refLock && !paused) return;
    for (const c of this.clips) {
      c._syncPaused = !!paused;
      this._applyClipPlayState(c);
    }
  }

  pauseAll(paused = true) {
    if (this._refLock && !paused) return;
    for (const c of this.clips) {
      c._userPaused = !!paused;
      this._applyClipPlayState(c);
    }
  }

  isIntentionallyPaused() {
    return this._refLock || this.clips.some((c) => c && !c._timelineInactive && (c._userPaused || c._abPaused));
  }

  setAbPause(paused = true) {
    if (this._refLock && !paused) return;
    for (const c of this.clips) {
      c._abPaused = !!paused;
      this._applyClipPlayState(c);
    }
  }

  setPlaybackRate(rate = 1) {
    this._playbackRate = Math.max(0.25, Number(rate) || 1);
    for (const c of this.clips) {
      try {
        if (c.video) c.video.playbackRate = this._playbackRate;
      } catch {

      }
    }
  }

  resetMasterTimer() {
    if (this._refLock) return;
    for (const c of this.clips) {
      if (!c) continue;
      c.masterTime = 0;
      c._seekInFlight = false;
      try {
        if (c.video && c.video.readyState >= 1 && Number.isFinite(c.video.duration)) {
          c.video.currentTime = 0;
        }
      } catch {

      }
      this._applyClipPlayState(c);
      try {
        this._blitClip(c);
      } catch {

      }
    }
  }

  isRefLocked() {
    return !!this._refLock;
  }

  lockAtCurrent() {
    this._refLock = true;
    for (const c of this.clips) {
      if (!c?.video) continue;
      c._seekInFlight = false;
      c._syncPaused = true;
      c._abPaused = true;
      c._userPaused = true;
      try {
        if (!c.video.paused) c.video.pause();
      } catch {

      }
      try {
        this._blitClip(c);
      } catch {

      }
    }
  }

  unlockRef() {
    this._refLock = false;
  }

  freezeAtCurrent() {
    this.lockAtCurrent();
  }

  _waitVideoReady(video) {
    if (video.readyState >= 2) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const cleanup = () => {
        clearTimeout(timer);
        video.removeEventListener('loadeddata', ready);
        video.removeEventListener('error', failed);
      };
      const ready = () => { cleanup(); resolve(); };
      const failed = () => { cleanup(); reject(new Error('Movie could not decode its first frame')); };
      const timer = setTimeout(() => { cleanup(); reject(new Error('Movie frame readiness timeout')); }, 15000);
      video.addEventListener('loadeddata', ready, { once: true });
      video.addEventListener('error', failed, { once: true });
    });
  }

  _waitSeeked(video, time) {
    return new Promise((resolve) => {
      if (!video) {
        resolve();
        return;
      }
      const t = Math.max(0, Number(time) || 0);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        try {
          video.removeEventListener('seeked', onSeeked);
        } catch {

        }
        clearTimeout(safety);
        resolve();
      };
      const onSeeked = () => finish();
      const safety = setTimeout(finish, 800);
      video.addEventListener('seeked', onSeeked, { once: true });
      try {
        if (Math.abs((Number(video.currentTime) || 0) - t) < 1e-4) {
          finish();
          return;
        }
        video.currentTime = t;
      } catch {
        finish();
      }
    });
  }

  _advanceClipFrames(c, frameCount) {
    const v = c.video;
    const n = Math.max(1, Math.round(Number(frameCount) || 1));
    if (!v) return Promise.resolve();
    if (typeof v.requestVideoFrameCallback !== 'function') {
      const fps = Math.max(1, Number(c.fps) || 30);
      const cur = Number(v.currentTime) || 0;
      return this._seekClipAccurate(c, cur + n / fps);
    }
    return new Promise((resolve) => {
      let left = n;
      const prevRate = v.playbackRate;
      const prev = {
        sync: c._syncPaused,
        user: c._userPaused,
        ab: c._abPaused,
      };
      c._syncPaused = false;
      c._userPaused = false;
      c._abPaused = false;
      v.playbackRate = 1;
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        try {
          v.pause();
        } catch {

        }
        v.playbackRate = prevRate;
        c._syncPaused = prev.sync;
        c._userPaused = prev.user;
        c._abPaused = prev.ab;
        const now = Number(v.currentTime);
        if (Number.isFinite(now)) c.masterTime = now;
        try {
          this._blitClip(c);
        } catch {

        }
        resolve();
      };
      const safety = setTimeout(finish, Math.min(4000, 250 + n * 80));
      const onFrame = () => {
        left -= 1;
        if (left <= 0 || v.ended) {
          finish();
          return;
        }
        try {
          v.requestVideoFrameCallback(onFrame);
        } catch {
          finish();
        }
      };
      void v.play().then(() => {
        try {
          v.requestVideoFrameCallback(onFrame);
        } catch {
          finish();
        }
      }).catch(finish);
    });
  }

  async _seekClipAccurate(c, targetSec) {
    const v = c.video;
    if (!v) return;
    let target = Math.max(0, Number(targetSec) || 0);
    const dur = Number(v.duration);
    if (Number.isFinite(dur) && dur > 0) {
      target = Math.min(target, Math.max(0, dur - 1e-3));
    }
    const fps = Math.max(1, Number(c.fps) || 30);
    const frameDur = 1 / fps;
    const cur = Number.isFinite(v.currentTime) ? v.currentTime : Number(c.masterTime) || 0;
    const delta = target - cur;

    try {
      if (!v.paused) v.pause();
    } catch {

    }

    if (Math.abs(delta) < frameDur * 0.35) {
      c.masterTime = target;
      this._blitClip(c);
      return;
    }

    if (delta > 0 && delta <= frameDur * 2.75) {
      const steps = Math.max(1, Math.round(delta / frameDur));
      await this._advanceClipFrames(c, steps);
      c.masterTime = target;
      return;
    }

    const preroll = Math.min(1.25, Math.max(0.25, Math.abs(delta)));
    let startAt = Math.max(0, target - preroll);
    if (delta > 0 && cur >= startAt - 0.02 && cur < target) {
      startAt = cur;
    } else {
      await this._waitSeeked(v, startAt);
    }

    if (typeof v.requestVideoFrameCallback !== 'function') {
      await this._waitSeeked(v, target);
      c.masterTime = target;
      this._blitClip(c);
      return;
    }

    const prevRate = v.playbackRate;
    const prev = {
      sync: c._syncPaused,
      user: c._userPaused,
      ab: c._abPaused,
    };
    c._syncPaused = false;
    c._userPaused = false;
    c._abPaused = false;
    v.playbackRate = 1;
    const half = frameDur * 0.45;
    await new Promise((resolve) => {
      let settled = false;
      const finish = () => {
        if (settled) return;
        settled = true;
        clearTimeout(safety);
        try {
          v.pause();
        } catch {

        }
        v.playbackRate = prevRate;
        c._syncPaused = prev.sync;
        c._userPaused = prev.user;
        c._abPaused = prev.ab;
        resolve();
      };
      const safety = setTimeout(finish, 4000);
      const onFrame = () => {
        const now = Number(v.currentTime) || 0;
        if (now >= target - half || v.ended) {
          finish();
          return;
        }
        try {
          v.requestVideoFrameCallback(onFrame);
        } catch {
          finish();
        }
      };
      void v.play().then(() => {
        try {
          v.requestVideoFrameCallback(onFrame);
        } catch {
          finish();
        }
      }).catch(finish);
    });
    c.masterTime = target;
    try {
      this._blitClip(c);
    } catch {

    }
  }

  async stepByFrames(frameDelta, fps = 30) {
    const delta = Math.round(Number(frameDelta) || 0);
    if (!delta || !this.clips.length) return;
    const wasLocked = this._refLock;
    if (wasLocked) this._refLock = false;
    const rate = Math.max(1, Number(fps) || 30);
    for (const c of this.clips) {
      if (!c?.video) continue;
      const start = Number(c.startAbFrame) || 0;
      const curAb = start + (Number(c.masterTime) || 0) * rate;
      const nextAb = curAb + delta;
      let t = (nextAb - start) / rate;
      if (!(t > 0)) t = 0;
      const dur = Number(c.video.duration);
      if (Number.isFinite(dur) && dur > 0) {
        t = Math.min(t, Math.max(0, dur - 1e-3));
      }
      c.masterTime = t;
      c._seekInFlight = true;
      try {
        await this._waitSeeked(c.video, t);
      } catch {
        try {
          c.video.currentTime = t;
        } catch {

        }
      }
      c._seekInFlight = false;
      try {
        if (!c.video.paused) c.video.pause();
      } catch {

      }
      try {
        this._blitClip(c);
      } catch {

      }
      this._applyClipPlayState(c);
    }
    if (wasLocked) this._refLock = true;
  }

  async seekToAbFrame(abFrame, fps = 30, opts = {}) {
    if (this._refLock && !opts?.force) return;
    const f = Number(abFrame);
    if (!Number.isFinite(f)) return;
    this.updateTimelineFrame(f);
    const rate = Math.max(1, Number(fps) || 30);
    for (const c of this.clips) {
      if (!c?.video) continue;
      if (c._timelineInactive) continue;
      const start = Number(c.startAbFrame) || 0;
      let t = (f - start) / rate;
      if (!(t > 0)) t = 0;
      const dur = Number(c.video.duration);
      if (Number.isFinite(dur) && dur > 0) {
        t = Math.min(t, Math.max(0, dur - 1e-3));
      }
      c.masterTime = t;
      c._seekInFlight = true;
      try {
        await this._waitSeeked(c.video, t);
      } catch {
        try {
          if (c.video.readyState >= 1) c.video.currentTime = t;
        } catch {

        }
      }
      c._seekInFlight = false;
      try {
        if (!c.video.paused) c.video.pause();
      } catch {

      }
      try {
        this._blitClip(c);
      } catch {

      }
      this._applyClipPlayState(c);
    }
    if (opts?.relock) {
      this.lockAtCurrent();
    }
  }

  _applyClipPlayState(c) {
    if (!c?.video) return;
    if (this._refLock) {
      try {
        if (!c.video.paused) c.video.pause();
      } catch {

      }
      return;
    }
    const wantPause = !!(c._timelineInactive || c._syncPaused || c._userPaused || c._abPaused || c.video.ended);
    const pauseChanged = c._effectivePaused !== wantPause;
    c._effectivePaused = wantPause;
    try {
      if (wantPause) {
        if (!c.video.paused) c.video.pause();
        c._cancelBlit?.();
        if (pauseChanged) this._blitClip(c);
      } else if (c.video.paused) {
        c.video.playbackRate = this._playbackRate;
        void c.video.play();
      }
    } catch {

    }
    if (!wantPause) c._scheduleBlit?.();
  }

  setVisible(on) {
    for (const c of this.clips) {
      c.visible = !!on && (!Number.isFinite(c.timelineStart) || c._timelineActivated);
      if (c.wrap) c.wrap.style.visibility = c.visible && (!c._timelineInactive || c._pendingRetire) ? 'visible' : 'hidden';
    }
  }

  updateTimelineFrame(frame) {
    for (const c of this.clips) {
      c._timelineInactive = Number.isFinite(c.timelineStart) &&
        (!c._timelineActivated || frame < c.timelineStart || frame >= c.timelineEnd);
      c._pendingRetire = Number.isFinite(c.timelineEnd) && frame >= c.timelineEnd;
      if (c.wrap) c.wrap.style.visibility = c.visible && (!c._timelineInactive || c._pendingRetire) ? 'visible' : 'hidden';
      this._applyClipPlayState(c);
    }
  }

  retireTimelineClip(start) {
    for (const c of this.clips.filter(c => c.timelineStart === start)) {
      c._pendingRetire = true;
      c._timelineInactive = true;
      this._applyClipPlayState(c);
    }
  }

  commitTimelineClip(clip) {
    if (!clip?._lastOk) throw new Error('Movie IN frame has not been rendered');
    clip.visible = true;
    clip._timelineActivated = true;
    clip._pendingRetire = false;
    clip._timelineInactive = false;
    if (clip.wrap) clip.wrap.style.visibility = 'visible';
    for (const old of [...this.clips]) {
      if (old === clip || !old._pendingRetire) continue;
      if (Number.isFinite(old.preparedAtFrame)) {
        old.visible = false;
        old._timelineActivated = false;
        old._pendingRetire = false;
        old._timelineInactive = true;
        if (old.wrap) old.wrap.style.visibility = 'hidden';
        this._applyClipPlayState(old);
        continue;
      }
      old.destroy();
      this.clips.splice(this.clips.indexOf(old), 1);
    }
  }

  stopAll() {
    this.clearClips();
  }
}
