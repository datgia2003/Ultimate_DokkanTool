import { fetchLwfBytes, lwfBytesToObjectUrl, parseLwfTextures, prepareAtlasFitOverrides, wrapImageMapWithAtlasFit } from './atlas-fit.js';
import { loadLwfWithRetry } from './lwf-load.js';
import { syncTextureMetricsToImages } from './texture-sync.js';
import { ensureLwfCanvasBlendModes } from './lwf-blend.js';
import { withPatchQuery } from './patch-context.js';

// Resolve a visible domain scene, then keep it running in the preview.
const resource = Number(new URLSearchParams(location.search).get('resource'));
let instance, objectUrl, atlas, animationFrame, resizeObserver;
let paused = false;
const cleanup = () => {
  cancelAnimationFrame(animationFrame);
  resizeObserver?.disconnect();
  instance?.destroy?.();
  instance = null;
  if (objectUrl) URL.revokeObjectURL(objectUrl);
  atlas?.revoke?.();
};
window.addEventListener('pagehide', cleanup, { once: true });
window.addEventListener('message', event => {
  if (event.origin === location.origin && event.source === parent && event.data?.type === 'domain-control') paused = !!event.data.paused;
});
try {
  if (!Number.isSafeInteger(resource) || resource <= 0) throw new Error('Resource ID không hợp lệ');
  const base = `/assets/dokkan_field/lwf_bg/${resource}/`;
  const asset = withPatchQuery(`${base}lwf_bg_${resource}.lwf`);
  const bytes = await fetchLwfBytes(asset);
  const imageMap = name => withPatchQuery(base + String(name).replace(/\\/g, '/').split('/').pop());
  // Fetch every texture as a blob before rendering. Direct cross-origin image
  // loads can render successfully but taint the canvas used for the PNG.
  atlas = await prepareAtlasFitOverrides(asset, imageMap, { bytes, prefetchBlobs: true, sheetTimeoutMs: 45000 });
  if (atlas.overrides.size < parseLwfTextures(bytes).length) {
    throw new Error('Chưa tải đủ texture của domain. Hãy tải lại ảnh.');
  }
  objectUrl = lwfBytesToObjectUrl(bytes);
  const canvas = document.createElement('canvas');
  document.getElementById('stage').appendChild(canvas);
  ensureLwfCanvasBlendModes();
  const cache = new window.LWF.ResourceCache();
  instance = await loadLwfWithRetry(cache, {
    lwf: objectUrl, prefix: '', stage: canvas, worker: false,
    useBackgroundColor: false, setBackgroundColor: 0,
    imageMap: wrapImageMapWithAtlasFit(imageMap, atlas.overrides),
    onload(inst) {
      syncTextureMetricsToImages(inst);
      canvas.width = inst.width || 852;
      canvas.height = inst.height || 1136;
      canvas.style.width = `${canvas.width}px`;
      canvas.style.height = `${canvas.height}px`;
      inst.active = true;
      if (inst.rootMovie) { inst.rootMovie.active = true; inst.rootMovie.playing = true; }
    },
  }, { retries: 0, timeoutMs: 45000 });
  // Keep a visible frame, even when frame 90 is an empty transition/end frame.
  const sample = document.createElement('canvas');
  sample.width = 48;
  sample.height = 64;
  const ctx = sample.getContext('2d', { willReadFrequently: true });
  let data = false, bestScore = 0;
  let playbackMovie = instance.rootMovie;
  const captureTimeline = () => {
    for (let frame = 0; frame < 120; frame++) {
      instance.exec(1 / 30);
      if (frame % 15 !== 0) continue;
      instance.render();
      ctx.clearRect(0, 0, 48, 64);
      ctx.drawImage(canvas, 0, 0, 48, 64);
      const pixels = ctx.getImageData(0, 0, 48, 64).data;
      let visible = 0, lit = 0, sum = 0, squares = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i + 3] <= 16) continue;
        const light = (pixels[i] + pixels[i + 1] + pixels[i + 2]) / 3;
        visible++;
        if (light > 12) lit++;
        sum += light;
        squares += light * light;
      }
      const variance = visible ? squares / visible - (sum / visible) ** 2 : 0;
      // Opaque black (and uniform fade/flash frames) is not a domain preview.
      if (lit < 48 * 64 * .02 || variance < 8) continue;
      const score = lit * Math.sqrt(variance);
      if (score > bestScore) {
        bestScore = score;
        data = true;
      }
    }
  };
  captureTimeline();
  // Some game assets expose their background only as a linked movie; their
  // root timeline is intentionally empty until the game attaches that movie.
  if (!data) {
    const names = (instance.data.movieLinkages || [])
      .map(link => instance.data.strings[link.stringId])
      .filter(name => /^ef_\d+$/.test(name) || name === `lwf_bg_${resource}`)
      .sort((a, b) => (a === `lwf_bg_${resource}` ? -1 : b === `lwf_bg_${resource}` ? 1 : a.localeCompare(b)));
    for (const name of names) {
      const movie = instance.rootMovie.attachMovie(name, 'domain_snapshot');
      if (!movie) continue;
      movie.x = canvas.width / 2;
      movie.y = canvas.height / 2;
      movie.active = true;
      movie.gotoAndPlay(1);
      captureTimeline();
      if (data) {
        playbackMovie = movie;
        break;
      }
      instance.rootMovie.detachMovie('domain_snapshot');
    }
  }
  if (!data) throw new Error('Chưa tìm được cảnh nền trong asset domain (các khung hình đều đen hoặc trống).');
  playbackMovie.gotoAndPlay(1);
  instance.exec(1 / 30);
  instance.render();
  const viewport = document.getElementById('viewport');
  const stage = document.getElementById('stage');
  const fit = () => {
    const scale = Math.min(viewport.clientWidth / canvas.width, viewport.clientHeight / canvas.height);
    stage.style.width = `${canvas.width}px`;
    stage.style.height = `${canvas.height}px`;
    stage.style.left = `${(viewport.clientWidth - canvas.width * scale) / 2}px`;
    stage.style.top = `${(viewport.clientHeight - canvas.height * scale) / 2}px`;
    stage.style.transform = `scale(${scale})`;
  };
  resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(viewport);
  fit();
  parent.postMessage({ type: 'domain-ready', resource, width: canvas.width, height: canvas.height }, location.origin);
  let previous = 0;
  const tick = now => {
    if (!instance) return;
    const delta = previous ? Math.min((now - previous) / 1000, .1) : 0;
    previous = now;
    if (!paused && !document.hidden) {
      instance.exec(delta);
      instance.render();
    }
    animationFrame = requestAnimationFrame(tick);
  };
  animationFrame = requestAnimationFrame(tick);
} catch (error) {
  parent.postMessage({ type: 'domain-error', resource, error: String(error.message || error) }, location.origin);
  cleanup();
}
