
export const DESIGN_W = 852;
export const DESIGN_H = 1536;
export const PHONE_H = 1136;

export const PHONE_CROP = (DESIGN_H - PHONE_H) / 2;

export function designSize() {
  return { w: DESIGN_W, h: DESIGN_H };
}

export function setStageHeight(stageEl, _height) {
  return initStage(stageEl);
}

export function initStage(stageEl) {
  stageEl.dataset.h = String(DESIGN_H);
  stageEl.style.width = `${DESIGN_W}px`;
  stageEl.style.height = `${DESIGN_H}px`;

  const fit = stageEl.parentElement;
  if (fit?.classList?.contains('stage-fit')) {
    fit.dataset.h = String(DESIGN_H);
  }

  const overlay = stageEl.querySelector('#overlayCanvas');
  if (overlay) {
    overlay.width = DESIGN_W;
    overlay.height = DESIGN_H;
  }

  applyStageFit(stageEl);
  return { w: DESIGN_W, h: DESIGN_H };
}

export function setPhoneCrop(stageEl, enabled) {
  const fit = stageEl?.parentElement;
  if (fit?.classList?.contains('stage-fit')) {
    fit.dataset.phone = enabled ? '1' : '0';
  }
  stageEl.dataset.phone = enabled ? '1' : '0';
  applyStageFit(stageEl);
  return !!enabled;
}

export function isPhoneCrop(stageEl) {
  return stageEl?.dataset?.phone === '1';
}

export function applyStageFit(stageEl) {
  const fit = stageEl?.parentElement;
  if (!fit?.classList?.contains('stage-fit')) return 1;

  if (fit.classList.contains('recording-1to1')) {
    stageEl.style.transform = 'none';
    return 1;
  }
  const phone = fit.dataset.phone === '1';
  const viewH = phone ? PHONE_H : DESIGN_H;
  const wrap =
    fit.closest('#modeLua') ||
    fit.closest('.stage-wrap') ||
    fit.parentElement;
  const isCompact = document.body.classList.contains('compact-mode');
  const padX = isCompact ? 0 : 16;
  const padY = isCompact ? 0 : 28;
  const availW = Math.max(120, (wrap?.clientWidth || window.innerWidth) - padX);
  const availH = Math.max(120, (wrap?.clientHeight || window.innerHeight) - padY);
  const scale = Math.min(availW / DESIGN_W, availH / viewH);
  const fitW = DESIGN_W * scale;
  const fitH = viewH * scale;
  fit.style.aspectRatio = 'auto';
  fit.style.width = `${fitW}px`;
  fit.style.height = `${fitH}px`;

  const y = phone ? -PHONE_CROP * scale : 0;
  stageEl.style.transform = `translate(0px, ${y}px) scale(${scale})`;
  stageEl.style.transformOrigin = 'top left';
  return scale;
}

export function watchStageFit(stageEl) {
  const fit = stageEl?.parentElement;
  if (!fit?.classList?.contains('stage-fit')) return () => {};
  const wrap =
    fit.closest('#modeLua') ||
    fit.closest('.stage-wrap') ||
    fit.parentElement;
  const onResize = () => applyStageFit(stageEl);
  const ro = new ResizeObserver(onResize);
  if (wrap) ro.observe(wrap);
  window.addEventListener('resize', onResize);
  applyStageFit(stageEl);
  return () => {
    ro.disconnect();
    window.removeEventListener('resize', onResize);
  };
}

export function clearLayer(el) {
  while (el.firstChild) el.removeChild(el.firstChild);
}
