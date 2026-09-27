
import { demuxUsm } from './usm-demux.js';
import { extractIvfFrames, getFramerate, isIvf } from './ivf.js';
import { muxVp9ToMp4 } from './mp4-muxer.js';
import { decodeAdx, DEFAULT_ADX_KEY_ID } from './adx-decoder.js';
import { probeVideoPayload } from './probe.js';

async function convertViaServer(
  file,
  { reencode = true, adxKey = DEFAULT_ADX_KEY_ID, forceAdx = false, log = () => {} } = {},
) {
  const health = await fetch('/api/health').then((r) => (r.ok ? r.json() : null)).catch(() => null);
  if (!health?.ok) {
    throw new Error(
      'Convert server not running',
    );
  }
  if (health.source === 'website-uncompressed' && !health.ffmpegReady) {
    throw new Error(
      'Website host cannot convert MPEG-2 USM yet — deploy server with /api/convert, or run local usm-player (tools/usm-player)',
    );
  }

  log(
    `Server convert ready — converting like usm_toolkit convert${reencode ? ' -r' : ''} (ADX key ${adxKey})…`,
  );
  const body = new FormData();
  body.append('file', file, file.name || 'video.usm');

  const qs = new URLSearchParams({
    reencode: reencode ? '1' : '0',
    adxKey: String(adxKey),
    forceAdx: forceAdx ? '1' : '0',
  });
  const res = await fetch(`/api/convert?${qs}`, {
    method: 'POST',
    body,
  });

  const ctype = res.headers.get('content-type') || '';
  if (!res.ok) {
    if (ctype.includes('application/json')) {
      const err = await res.json();
      if (Array.isArray(err.logs)) err.logs.forEach((l) => log(l));
      throw new Error(err.error || `Convert failed (${res.status})`);
    }
    throw new Error(await res.text());
  }

  const logHdr = res.headers.get('X-USM-Log');
  if (logHdr) {
    try {
      const padded = logHdr.replace(/-/g, '+').replace(/_/g, '/');
      const pad = padded.length % 4 === 0 ? '' : '='.repeat(4 - (padded.length % 4));
      atob(padded + pad)
        .split('\n')
        .filter(Boolean)
        .forEach((l) => log(l));
    } catch {

    }
  }

  const mp4 = new Uint8Array(await res.arrayBuffer());
  const probeKind = res.headers.get('X-USM-Probe') || 'ffmpeg';
  return { mp4, probeKind };
}

export async function openUsm(file, log = () => {}, opts = {}) {
  const preferServer = opts.preferServer !== false;
  const reencode = opts.reencode !== false;
  const adxKey = opts.adxKey ?? DEFAULT_ADX_KEY_ID;
  const forceAdx = Boolean(opts.forceAdx);
  const buffer = await file.arrayBuffer();

  log('Demuxing USM…');
  const demuxed = demuxUsm(buffer);
  log(`Streams: ${JSON.stringify(demuxed.streams)}`);

  if (!demuxed.video) {
    throw new Error('No video stream (@SFV) found in USM');
  }

  const probe = probeVideoPayload(demuxed.video);
  log(`Video probe: ${probe.kind}`);
  log(`Video header: ${probe.hex}`);

  const useVp9Native = isIvf(demuxed.video) && probe.kind === 'vp9-ivf' && !opts.forceFfmpeg;

  if (!useVp9Native) {
    log(`Not IVF/VP9 (${probe.kind}) — using FFmpeg convert path`);
    if (!preferServer) {
      throw new Error('Video stream is not IVF/VP9 and server convert is disabled');
    }
    const { mp4, probeKind } = await convertViaServer(file, {
      reencode,
      adxKey,
      forceAdx,
      log,
    });
    return {
      mp4,
      audio: null,
      meta: {
        width: 0,
        height: 0,
        fps: 0,
        frames: 0,
        audioKind: demuxed.audioKind,
        durationSec: 0,
        path: 'ffmpeg',
        probe: probeKind || probe.kind,
        adxKey,
      },
    };
  }

  log('Parsing IVF / VP9 frames…');
  const { header, frames } = extractIvfFrames(demuxed.video);
  const fps = getFramerate(header) || 30;
  log(`VP9 ${header.width}x${header.height} @ ${fps.toFixed(3)} fps, ${frames.length} frames`);

  const key0 = frames[0];
  log('Remuxing VP9 → MP4 (in memory)…');
  const mp4 = muxVp9ToMp4({
    width: header.width,
    height: header.height,
    framerateN: header.framerateN || Math.round(fps),
    framerateD: header.framerateD || 1,
    profile: key0?.profile ?? 0,
    level: 10,
    bitDepth: key0?.bitDepth ?? 8,
    frames,
  });

  let audio = null;
  if (demuxed.audio && demuxed.audioKind === 'adx') {
    try {
      log(`Decoding ADX audio (key ${adxKey})…`);
      const decoded = decodeAdx(demuxed.audio, { keyId: adxKey, forceDecrypt: forceAdx });
      audio = {
        kind: 'adx',
        pcm: decoded.pcm,
        sampleRate: decoded.sampleRate,
        channels: decoded.channels,
      };
      if (decoded.decrypt?.changed) {
        log(`ADX decrypted [key ${decoded.decrypt.keyId}: ${decoded.decrypt.keyName}]`);
      } else {
        log(`ADX decrypt: ${decoded.decrypt?.reason || 'skipped'}`);
      }
      log(`Audio: ADX ${decoded.sampleRate} Hz, ${decoded.channels} ch`);
    } catch (err) {
      log(`Audio decode failed (${err.message}); continuing video-only`);
    }
  } else if (demuxed.audio) {
    log(`Audio present (${demuxed.audioKind}) — remux path is video-only; use FFmpeg mode for A/V`);
  }

  return {
    mp4,
    audio,
    meta: {
      width: header.width,
      height: header.height,
      fps,
      frames: frames.length,
      audioKind: demuxed.audioKind,
      durationSec: frames.length / fps,
      path: 'vp9-native',
      probe: probe.kind,
      adxKey,
    },
  };
}
