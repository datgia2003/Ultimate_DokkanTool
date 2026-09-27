
import { DESIGN_W, DESIGN_H, PHONE_H, PHONE_CROP } from './stage.js';
import { isPhoneCrop, applyStageFit } from './stage.js';

function pickAudioMime() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
  ];
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported?.(t)) {
      return t;
    }
  }
  return '';
}

function isDesktopApp() {
  if (typeof window === 'undefined') return false;
  if (window.abDesktop?.isDesktop) return true;
  if (window.__AB_DESKTOP__) return true;

  return /Electron/i.test(navigator.userAgent || '');
}

function capturePort() {
  const n = Number(window.__AB_CAPTURE_PORT__ || 8788);
  return Number.isFinite(n) && n > 0 ? n : 8788;
}

async function desktopCaptureJpeg(rect) {
  if (window.abDesktop?.captureRect) {
    const data = await window.abDesktop.captureRect(rect);
    return normalizeBytes(data);
  }
  const q = new URLSearchParams({
    x: String(Math.round(rect.x)),
    y: String(Math.round(rect.y)),
    w: String(Math.round(rect.width)),
    h: String(Math.round(rect.height)),
  });
  const res = await fetch(`http://127.0.0.1:${capturePort()}/capture/jpeg?${q}`);
  if (!res.ok) {
    const j = await res.json().catch(() => ({}));
    throw new Error(j.error || `capture HTTP ${res.status}`);
  }
  return new Uint8Array(await res.arrayBuffer());
}

async function desktopPrepareRecord(encW, encH) {
  if (window.abDesktop?.prepareRecord) {
    return window.abDesktop.prepareRecord({ width: encW, height: encH });
  }
  try {
    const q = new URLSearchParams({ w: String(encW), h: String(encH) });
    const res = await fetch(`http://127.0.0.1:${capturePort()}/capture/prepare?${q}`);
    if (res.ok) return res.json();
  } catch {

  }
  return null;
}

async function desktopRestoreRecord() {
  if (window.abDesktop?.restoreRecord) {
    return window.abDesktop.restoreRecord();
  }
  try {
    await fetch(`http://127.0.0.1:${capturePort()}/capture/restore`);
  } catch {

  }
  return null;
}

async function probeDesktopCapture() {

  if (window.abDesktop?.captureRect) return { ok: true, via: 'preload' };

  try {
    const res = await fetch(`http://127.0.0.1:${capturePort()}/capture/health`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const j = await res.json();
      if (j.ok) return { ok: true, via: 'http', ...j };
    }
  } catch {

  }
  if (isDesktopApp()) {
    return {
      ok: false,
      via: 'ua-only',
      error: 'Electron detected but capture HTTP is down — fully quit and re-run serve-app.bat',
    };
  }
  return { ok: false, via: 'none', error: 'not desktop' };
}

function normalizeBytes(data) {
  if (!data) return null;
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (data.type === 'Buffer' && Array.isArray(data.data)) return new Uint8Array(data.data);
  if (ArrayBuffer.isView(data)) {
    return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  }
  try {
    return new Uint8Array(data);
  } catch {
    return null;
  }
}

function jpegDimensions(u8) {
  if (!u8 || u8.length < 10 || u8[0] !== 0xff || u8[1] !== 0xd8) return null;
  let i = 2;
  while (i < u8.length - 8) {
    if (u8[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = u8[i + 1];
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const height = (u8[i + 5] << 8) | u8[i + 6];
      const width = (u8[i + 7] << 8) | u8[i + 8];
      return { width, height };
    }
    const len = (u8[i + 2] << 8) | u8[i + 3];
    if (len < 2) break;
    i += 2 + len;
  }
  return null;
}

export class StageRecorder {
  constructor(stageEl, log) {
    this.stage = stageEl;
    this.log = log || (() => {});
    this.recording = false;
    this.blob = null;
    this._mime = 'video/mp4';
    this._ext = 'mp4';
    this._fps = 30;
    this.sources = null;
  }

  setSources(sources) {
    this.sources = sources || null;
  }

  defaultExt() {
    return 'mp4';
  }

  async start({ audioStream = null, fps = 30, audioBus = null } = {}) {
    this.blob = null;
    this._fps = fps || 30;
    this._frameIndex = 0;
    this._peakLuma = 0;
    this._pending = [];
    this._error = null;
    this._session = null;
    this._audioChunks = [];
    this._audioRec = null;
    this._audioMime = '';
    this._audioBus = audioBus || null;
    this._usedMix = false;
    this._uploadInFlight = 0;
    this._maxUploadConc = 3;
    this._lastJpeg = null;
    this._dropped = 0;
    this._mode = 'none';
    this._captureBusy = false;
    this._startedAt = 0;
    this._sizeOk = false;

    this._phone = isPhoneCrop(this.stage);
    this._encW = DESIGN_W;
    this._encH = this._phone ? PHONE_H : DESIGN_H;

    const probe = await probeDesktopCapture();
    if (!probe.ok) {
      throw new Error(
        probe.error ||
          'Record needs the desktop app (serve-app.bat). Fully quit Electron and relaunch — preload/capture bridge missing.',
      );
    }

    const startRes = await fetch('/api/record/start', { method: 'POST' });
    const startJson = await startRes.json().catch(() => ({}));
    if (!startRes.ok || !startJson.session) {
      throw new Error(startJson.error || `record/start failed (${startRes.status})`);
    }
    this._session = startJson.session;
    this._captureVia = probe.via;

    await desktopPrepareRecord(this._encW, this._encH);
    this._fit = this.stage?.parentElement;
    this._fit?.classList?.add('recording-1to1');
    applyStageFit(this.stage);
    this.stage?.scrollIntoView?.({ block: 'start', inline: 'nearest' });

    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    await new Promise((r) => setTimeout(r, 100));

    const probeRect = this._stageCaptureRect();
    if (
      Math.abs(probeRect.width - this._encW) > 2 ||
      Math.abs(probeRect.height - this._encH) > 2
    ) {
      this.log(
        `WARN: stage rect ${probeRect.width}×${probeRect.height} (want ${this._encW}×${this._encH}) — resizing again`,
      );
      await desktopPrepareRecord(this._encW, this._encH);
      await new Promise((r) => setTimeout(r, 120));
    }

    this._mode = 'desktop-capture';

    if (this._audioBus?.beginMixCapture) {
      this._audioBus.beginMixCapture();
      this.log('Audio · AB-timeline mix (no atempo stretch)');
    } else if (audioStream?.getAudioTracks?.().length && typeof MediaRecorder !== 'undefined') {
      const mime = pickAudioMime();
      try {
        this._audioRec = mime
          ? new MediaRecorder(audioStream, { mimeType: mime, audioBitsPerSecond: 192000 })
          : new MediaRecorder(audioStream);
        this._audioMime = this._audioRec.mimeType || mime || 'audio/webm';
        this._audioChunks = [];
        this._audioRec.ondataavailable = (e) => {
          if (e.data && e.data.size > 0) this._audioChunks.push(e.data);
        };
        this._audioRec.onerror = (e) => {
          this.log(`Audio MediaRecorder error: ${e.error?.message || e.type || e}`);
        };
        this._audioRec.start(100);
        this.log(`Audio tap · ${this._audioMime} · tracks=${audioStream.getAudioTracks().length}`);
      } catch (e) {
        this._audioRec = null;
        this.log(`Audio record unavailable: ${e.message || e}`);
      }
    } else {
      this.log('Audio: no mix bus / capture stream — video-only MP4');
    }

    this.recording = true;
    this._startedAt = performance.now();
    this.log(
      `Recording… desktop capture ${this._encW}×${this._encH}` +
        (this._phone ? ' (phone crop)' : '') +
        ` · via ${this._captureVia || '?'}` +
        (this._audioRec ? ' + audio' : '') +
        ' · capture-locked (fresh frame every step) → ffmpeg',
    );
  }

  async captureFrame(_steps = 1) {
    if (!this.recording || !this._session) return;

    while (this._captureBusy) {
      await new Promise((r) => setTimeout(r, 4));
    }
    this._captureBusy = true;
    const startIdx = this._frameIndex;
    this._frameIndex += 1;
    try {
      const blob = await this._grabJpegBlob(startIdx);
      this._lastJpeg = blob;

      const up = this._uploadFrame(startIdx, blob);
      this._pending.push(up);
      void up.catch((e) => {
        this._error = e;
        this.log(`record upload f${startIdx}: ${e.message || e}`);
      });
    } catch (e) {
      this._error = e;
      this.log(`record frame: ${e.message || e}`);

      if (this._lastJpeg) {
        const up = this._uploadFrame(startIdx, this._lastJpeg);
        this._pending.push(up);
      }
    } finally {
      this._captureBusy = false;
    }
  }

  async _grabJpegBlob(startIdx) {
    const rect = this._stageCaptureRect();
    const jpegU8 = await desktopCaptureJpeg(rect);
    const raw = normalizeBytes(jpegU8);
    if (!raw || !raw.byteLength) throw new Error('capture returned empty');

    const body = await this._normalizeJpegSize(raw, rect);
    const blob = new Blob([body], { type: 'image/jpeg' });

    if (startIdx === 0 || startIdx === 12 || startIdx === 60) {
      this.log(
        `Record f${startIdx} · jpeg ${(blob.size / 1024).toFixed(0)}KB · ` +
          `cap ${rect.width}×${rect.height} → ${this._encW}×${this._encH}`,
      );
      if (blob.size < 800 && startIdx >= 12) {
        this.log('WARN: JPEG very small — capture may be black');
      }
      if (blob.size > 2000) this._peakLuma = Math.max(this._peakLuma, 50);
    }
    return blob;
  }

  _stageCaptureRect() {
    const r = this.stage.getBoundingClientRect();
    const fit = this._fit;

    if (fit?.classList?.contains('recording-1to1')) {
      const fr = fit.getBoundingClientRect();
      return {
        x: Math.round(fr.left),
        y: Math.round(fr.top),
        width: Math.max(1, Math.round(fr.width)),
        height: Math.max(1, Math.round(fr.height)),
      };
    }
    let y = r.top;
    let h = r.height;
    if (this._phone && h >= DESIGN_H - 2) {
      const scale = h / DESIGN_H;
      y = r.top + PHONE_CROP * scale;
      h = PHONE_H * scale;
    }
    return {
      x: Math.round(r.left),
      y: Math.round(y),
      width: Math.max(1, Math.round(r.width)),
      height: Math.max(1, Math.round(h)),
    };
  }

  async _normalizeJpegSize(jpegBytes, rect) {
    const wantW = this._encW;
    const wantH = this._encH;
    const u8 = jpegBytes instanceof Uint8Array ? jpegBytes : new Uint8Array(jpegBytes);
    const hdr = jpegDimensions(u8);
    if (hdr && hdr.width === wantW && hdr.height === wantH) {
      this._sizeOk = true;
      return u8;
    }
    if (this._sizeOk && hdr) {

    }
    const blob = new Blob([u8], { type: 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    try {
      if (bmp.width === wantW && bmp.height === wantH) {
        this._sizeOk = true;
        return u8;
      }
      this.log(
        `Record resample ${bmp.width}×${bmp.height} → ${wantW}×${wantH}` +
          (rect ? ` (rect ${rect.width}×${rect.height})` : ''),
      );
      const c = document.createElement('canvas');
      c.width = wantW;
      c.height = wantH;
      const ctx = c.getContext('2d', { alpha: false });
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.fillStyle = '#000';
      ctx.fillRect(0, 0, wantW, wantH);
      const scale = Math.min(wantW / bmp.width, wantH / bmp.height);
      const dw = bmp.width * scale;
      const dh = bmp.height * scale;
      ctx.drawImage(bmp, (wantW - dw) / 2, (wantH - dh) / 2, dw, dh);
      const out = await new Promise((resolve) => {
        c.toBlob((b) => resolve(b), 'image/jpeg', 0.85);
      });
      this._sizeOk = true;
      return new Uint8Array(await out.arrayBuffer());
    } finally {
      bmp.close?.();
    }
  }

  async _cropJpegToPhone(jpegBytes) {

    const blob = new Blob([jpegBytes], { type: 'image/jpeg' });
    const bmp = await createImageBitmap(blob);
    try {
      if (bmp.height <= PHONE_H + 2) {
        return jpegBytes;
      }
      const c = document.createElement('canvas');
      c.width = DESIGN_W;
      c.height = PHONE_H;
      const ctx = c.getContext('2d', { alpha: false });
      const scale = bmp.width / DESIGN_W;
      ctx.drawImage(
        bmp,
        0,
        PHONE_CROP * scale,
        bmp.width,
        PHONE_H * scale,
        0,
        0,
        DESIGN_W,
        PHONE_H,
      );
      const out = await new Promise((resolve) => {
        c.toBlob((b) => resolve(b), 'image/jpeg', 0.92);
      });
      return new Uint8Array(await out.arrayBuffer());
    } finally {
      bmp.close?.();
    }
  }

  async _uploadDupes(blob, startIdx, n) {
    await Promise.all(
      Array.from({ length: n }, (_, i) => this._uploadFrame(startIdx + i, blob)),
    );
  }

  async _uploadFrame(index, blob) {
    while (this._uploadInFlight >= this._maxUploadConc) {
      await new Promise((r) => setTimeout(r, 4));
    }
    this._uploadInFlight += 1;
    try {
      const res = await fetch(
        `/api/record/frame?session=${encodeURIComponent(this._session)}&i=${index}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'image/jpeg' },
          body: blob,
        },
      );
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error || `frame upload ${res.status}`);
      }
    } finally {
      this._uploadInFlight -= 1;
    }
  }

  _endOneToOne() {
    this._fit?.classList?.remove('recording-1to1');
    try {
      applyStageFit(this.stage);
    } catch {

    }
    void desktopRestoreRecord();
  }

  async stop() {
    if (!this.recording && this.blob) return this.blob;
    this.recording = false;
    const session = this._session;

    try {
      await Promise.all(this._pending);
    } catch {

    }
    this._pending = [];

    let audioBlob = null;
    let audioExt = 'webm';
    let audioMime = this._audioMime || 'audio/webm';

    const muxFps = this._fps || 30;
    const videoSec = Math.max(0.05, this._frameIndex / muxFps);

    if (this._audioBus?.renderMixWav) {
      try {
        const mix = await this._audioBus.renderMixWav(videoSec);
        this._audioBus.endMixCapture?.();
        if (mix && mix.size > 0) {
          audioBlob = mix;
          audioExt = 'wav';
          audioMime = 'audio/wav';
          this._usedMix = true;
          this.log(
            `Audio mix · ${(mix.size / 1024).toFixed(0)} KB · ${videoSec.toFixed(2)}s AB timeline`,
          );
        } else {
          this.log('Audio mix empty — falling back to MediaRecorder if any');
        }
      } catch (e) {
        this.log(`Audio mix failed: ${e.message || e}`);
        this._audioBus.endMixCapture?.();
      }
    }

    if (!audioBlob && this._audioRec && this._audioRec.state !== 'inactive') {
      try {
        this._audioRec.requestData?.();
      } catch {

      }
      audioBlob = await new Promise((resolve) => {
        const rec = this._audioRec;
        const t = setTimeout(() => {
          resolve(
            this._audioChunks.length
              ? new Blob(this._audioChunks, { type: this._audioMime || 'audio/webm' })
              : null,
          );
        }, 2000);
        rec.onstop = () => {
          clearTimeout(t);
          resolve(
            this._audioChunks.length
              ? new Blob(this._audioChunks, { type: this._audioMime || 'audio/webm' })
              : null,
          );
        };
        try {
          rec.stop();
        } catch {
          clearTimeout(t);
          resolve(null);
        }
      });
      audioExt = (this._audioMime || '').includes('ogg') ? 'ogg' : 'webm';
      audioMime = this._audioMime || 'audio/webm';
    }
    this._audioRec = null;
    this._endOneToOne();

    if (!session) {
      this.log('Record: no session');
      return null;
    }

    try {
      if (audioBlob && audioBlob.size > 0) {
        const res = await fetch(
          `/api/record/audio?session=${encodeURIComponent(session)}&ext=${audioExt}`,
          {
            method: 'POST',
            headers: { 'Content-Type': audioMime },
            body: audioBlob,
          },
        );
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          this.log(`Audio upload failed: ${j.error || res.status}`);
        } else {
          this.log(`Uploaded audio ${(audioBlob.size / 1024).toFixed(0)} KB (${audioExt})`);
        }
      } else {
        this.log('No audio blob — video-only');
      }

      const wallSec = Math.max(
        0.05,
        (performance.now() - (this._startedAt || performance.now())) / 1000,
      );

      try {
        const h = await fetch('/api/health', { cache: 'no-store' }).then((r) => r.json());
        const ver = Number(h.recordMuxVersion) || 0;
        if (ver < 4) {
          throw new Error(
            `Record server is stale (mux v${ver || '?'}). Kill the old python on port 8787, then re-run serve-app.bat`,
          );
        }
      } catch (e) {
        if (String(e.message || e).includes('stale')) throw e;
        this.log(`Health check before mux: ${e.message || e}`);
      }

      this.log(
        `Assembling ${this._encW}×${this._encH} MP4 (${this._frameIndex} frames @ ${muxFps}fps · ` +
          `${wallSec.toFixed(1)}s wall / ${videoSec.toFixed(1)}s video` +
          (this._usedMix ? ' · AB mix' : '') +
          ')…',
      );
      const fin = await fetch(
        `/api/record/finish?session=${encodeURIComponent(session)}&fps=${muxFps}` +
          `&w=${this._encW}&h=${this._encH}` +
          `&wallSec=${wallSec.toFixed(3)}&stretch=1` +
          (this._usedMix ? '&audioMode=mix' : ''),
        { method: 'POST' },
      );
      if (!fin.ok) {
        const j = await fin.json().catch(() => ({}));
        throw new Error(j.error || `finish failed (${fin.status})`);
      }
      const muxVer = fin.headers.get('X-Record-Mux-Version');
      const audioMode = fin.headers.get('X-Record-Audio-Mode') || (this._usedMix ? 'mix' : 'wall');
      this.log(`Mux ok · server v${muxVer || '?'} · audio ${audioMode}`);
      this.blob = await fin.blob();
      this._session = null;
    } catch (e) {
      this._error = e;
      try {
        await fetch(`/api/record/abort?session=${encodeURIComponent(session)}`, {
          method: 'POST',
        });
      } catch {

      }
      this._session = null;
      throw e;
    }
    if (this.blob) {
      this.log(
        `Recorded ${(this.blob.size / 1024 / 1024).toFixed(2)} MB MP4 · ` +
          `${this._frameIndex} frames · ${this._encW}×${this._encH} · ${this._mode}`,
      );
    } else {
      this.log('Record produced empty MP4');
    }
    return this.blob;
  }

  async saveWithPrompt(defaultName = 'actionbank-preview.mp4') {
    const blob = this.blob || (await this.stop());
    if (!blob) {
      this.log('Nothing to save — record a take first');
      return false;
    }
    const name = defaultName.endsWith('.mp4')
      ? defaultName
      : defaultName.replace(/\.(webm|mp4)$/i, '') + '.mp4';

    if (typeof window.showSaveFilePicker === 'function') {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: name,
          types: [
            {
              description: 'MP4 video',
              accept: { 'video/mp4': ['.mp4'] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        this.log(`Saved ${name}`);
        return true;
      } catch (e) {
        if (e && e.name === 'AbortError') {
          this.log('Save cancelled');
          return false;
        }
        this.log(`Save dialog failed (${e.message || e}) — using download fallback`);
      }
    }
    this.exportDownload(name);
    return true;
  }

  exportDownload(filename = 'actionbank-preview.mp4') {
    if (!this.blob) {
      this.log('Nothing to export — record a take first');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(this.blob);
    a.download = filename.endsWith('.mp4') ? filename : `${filename}.mp4`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
}
