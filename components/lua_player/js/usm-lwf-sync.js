
export const USM_LWF_SYNC_THRESHOLD = 2;

export function syncPauseFlags(usmFrame, lwfFrame, threshold = USM_LWF_SYNC_THRESHOLD) {
  if (!Number.isFinite(usmFrame) || !Number.isFinite(lwfFrame)) return null;
  const thr = Math.max(1, Number(threshold) || USM_LWF_SYNC_THRESHOLD);
  const diff = usmFrame - lwfFrame;
  return {
    diff,
    pauseUsm: diff >= thr,
    pauseLwf: false,
  };
}

export function syncUsmAndLwf(usm, lwf, chara = null, threshold = USM_LWF_SYNC_THRESHOLD) {
  if (!usm?.hasActiveClips?.()) {
    usm?.setSyncPause?.(false);
    lwf?.setSyncPause?.(false);
    chara?.setSyncPause?.(false);
    return null;
  }

  if (usm?.isIntentionallyPaused?.()) {
    usm?.setSyncPause?.(false);
    lwf?.setSyncPause?.(false);
    chara?.setSyncPause?.(false);
    return null;
  }

  const usmLocal = usm.getPlayingFrame?.();
  const startAb = Number(usm.getStartAbFrame?.());
  const partner =
    (Number.isFinite(startAb)
      ? lwf?.getSyncPartner?.({ startAbFrame: startAb })
      : null) ||
    lwf?.getSyncPartner?.() ||
    null;
  const lwfLocal =
    partner != null
      ? lwf.getRootMovieFrame?.(partner)
      : lwf?.getRootMovieFrame?.();

  let usmFrame = usmLocal;
  let lwfFrame = lwfLocal;
  if (Number.isFinite(startAb) && Number.isFinite(usmLocal)) {
    usmFrame = startAb + (usmLocal - 1);
    const partnerStart = Number(partner?.startFrame);
    if (Number.isFinite(partnerStart) && Number.isFinite(lwfLocal)) {
      lwfFrame = partnerStart + (lwfLocal - 1);
    } else {
      lwfFrame = null;
    }
  }

  const flags = syncPauseFlags(usmFrame, lwfFrame, threshold);
  if (!flags) {
    usm?.setSyncPause?.(false);
    lwf?.setSyncPause?.(false);
    chara?.setSyncPause?.(false);
    return null;
  }

  usm.setSyncPause?.(flags.pauseUsm);
  lwf?.setSyncPause?.(false);
  chara?.setSyncPause?.(false);

  return { ...flags, usmFrame, lwfFrame, partner, usmLocal, lwfLocal };
}
