import { DESIGN_W, DESIGN_H, applyStageFit } from './stage.js';

const FPS = 30;

function $(id) {
  return document.getElementById(id);
}

function round1(n) {
  return Math.round(Number(n) * 10) / 10;
}

export class ReferenceMode {
  constructor({ stageEl, overlayEl, chara, runner, usm, lwf, log, onChange } = {}) {
    this.stageEl = stageEl;
    this.overlay = overlayEl;
    this.chara = chara;
    this.runner = runner;
    this.usm = usm;
    this.lwf = lwf;
    this.log = log || (() => {});
    this.onChange = onChange || (() => {});
    this.active = false;
    this.selected = 0;
    this.dragging = null;
    this.luaFrame = 0;
    this._raf = null;
    this._bound = false;
    this._syncingXform = false;
    this._suppressSlider = false;
    this._entrySnapshot = null;
    this._entryLuaFrame = 0;
    this._lastSeekLuaFrame = 0;
    this._seekSerial = Promise.resolve();
  }

  bindUi() {
    if (this._bound) return;
    this._bound = true;
    this.btn = $('btnRefMode');
    this.panel = $('refPanel');
    this.selChara = $('refChara');
    this.selPose = $('refPose');
    this.outCoords = $('refCoords');
    this.outXform = $('refXform');
    this.outPose = $('refPoseReadout');
    this.outLua = $('refLuaFrame');
    this.luaSlider = $('refLuaScrub');
    this.xInput = $('refX');
    this.yInput = $('refY');
    this.zInput = $('refZ');
    this.sxInput = $('refSx');
    this.syInput = $('refSy');
    this.rotInput = $('refRot');
    this.btnCopy = $('refCopy');
    this.btnResetPos = $('refResetPos');
    this.btnLuaPrev = $('refLuaPrev');
    this.btnLuaNext = $('refLuaNext');
    this.chkKeys = $('refUseKeys');
    this.chkVisible = $('refVisible');

    this.btn?.addEventListener('click', () => this.setActive(!this.active));
    this.selChara?.addEventListener('change', () => {
      this.selected = Number(this.selChara.value) || 0;
      this._fillPoses();
      this._syncXformInputs();
      this._syncVisible();
      this._paint();
    });
    this.selPose?.addEventListener('change', () => {
      const anime = Number(this.selPose.value);
      if (!Number.isFinite(anime)) return;
      this.chara?.changeAnime?.(this.selected, anime, { stopAtEnd: false });
      const c = this.chara?.chars?.get?.(this.selected);
      if (c) c.refOverride = true;
      this._paint();
    });
    this.luaSlider?.addEventListener('input', () => {
      if (this._suppressSlider) return;
      void this._seekLuaFrame(Number(this.luaSlider.value) || 0);
    });
    const onXform = () => {
      if (this._syncingXform) return;
      this._applyXformFromInputs();
    };
    this.xInput?.addEventListener('input', onXform);
    this.yInput?.addEventListener('input', onXform);
    this.zInput?.addEventListener('input', onXform);
    this.sxInput?.addEventListener('input', onXform);
    this.syInput?.addEventListener('input', onXform);
    this.rotInput?.addEventListener('input', onXform);
    this.btnLuaPrev?.addEventListener('click', () => {
      void this._seekLuaFrame(this.luaFrame - 1);
    });
    this.btnLuaNext?.addEventListener('click', () => {
      void this._seekLuaFrame(this.luaFrame + 1);
    });
    this.btnCopy?.addEventListener('click', () => this.copyExport());
    this.btnResetPos?.addEventListener('click', () => this.resetSpritePosition());
    this.chkKeys?.addEventListener('change', () => {
      if (this._suppressSlider) return;
      const useKeys = !!this.chkKeys.checked;
      for (const c of this.chara?.chars?.values?.() || []) {
        c.refOverride = this.active && !useKeys;
      }
      if (useKeys) {
        // Keys only — do not scrub USM when toggling the checkbox
        for (const c of this.chara?.chars?.values?.() || []) c.refOverride = false;
        this.runner?.snapCharaToScriptFrame?.(this.luaFrame);
        this._syncXformInputs();
        this._syncVisible();
      }
      this._paint();
    });
    this.chkVisible?.addEventListener('change', () => {
      const on = !!this.chkVisible.checked;
      this.chara?.setRefVisible?.(this.selected, on);
      if (this.chkKeys) this.chkKeys.checked = false;
      for (const c of this.chara?.chars?.values?.() || []) c.refOverride = true;
      this._syncXformInputs();
      this._paint();
    });

    this.overlay?.addEventListener('pointerdown', (ev) => this._onPointerDown(ev));
    window.addEventListener('pointermove', (ev) => this._onPointerMove(ev));
    window.addEventListener('pointerup', () => this._onPointerUp());
    window.addEventListener('pointercancel', () => this._onPointerUp());
  }

  _markManualOverride() {
    if (this.chkKeys) this.chkKeys.checked = false;
    for (const c of this.chara?.chars?.values?.() || []) c.refOverride = true;
  }

  _applyXformFromInputs() {
    const x = Number(this.xInput?.value);
    const y = Number(this.yInput?.value);
    const z = Number(this.zInput?.value) || 0;
    const sx = Number(this.sxInput?.value);
    const sy = Number(this.syInput?.value);
    const rot = Number(this.rotInput?.value) || 0;
    this.chara?.setRefMove?.(
      this.selected,
      Number.isFinite(x) ? x : 0,
      Number.isFinite(y) ? y : 0,
      z,
    );
    this.chara?.setRefScale?.(
      this.selected,
      Number.isFinite(sx) ? sx : 1,
      Number.isFinite(sy) ? sy : sx,
    );
    this.chara?.setRefRotate?.(this.selected, rot);
    this._markManualOverride();
    if (this.chkVisible) this.chkVisible.checked = true;
    this._paint();
  }

  setActive(on) {
    this.active = !!on;
    this.bindUi();
    if (this.btn) {
      this.btn.classList.toggle('active', this.active);
      this.btn.setAttribute('aria-pressed', this.active ? 'true' : 'false');
      this.btn.textContent = this.active ? 'Reference Mode · ON' : 'LUA Reference Mode';
    }
    if (this.panel) this.panel.hidden = !this.active;
    if (this.overlay) {
      this.overlay.style.pointerEvents = this.active ? 'auto' : 'none';
      this.overlay.classList.toggle('ref-active', this.active);
    }
    document.body.classList.toggle('ref-mode', this.active);

    if (this.active) {
      try {
        this.runner?.pause?.();
      } catch {

      }
      this.chara?.setSyncPause?.(true);
      this.lwf?.lockAtCurrent?.();
      this.usm?.lockAtCurrent?.();
      this.chara?.setRefMode?.(true);
      this._entrySnapshot = this.chara?.captureEntryState?.() || null;
      this._entryLuaFrame = Math.max(0, Number(this.runner?.frame) || 0);
      this._lastSeekLuaFrame = this._entryLuaFrame;
      this._suppressSlider = true;
      if (this.chkKeys) this.chkKeys.checked = true;
      for (const c of this.chara?.chars?.values?.() || []) {
        c.refOverride = false;
      }
      this.luaFrame = this._entryLuaFrame;
      if (this.runner) this.runner.frame = this.luaFrame;
      this._fillPoses();
      this._syncLuaSlider();
      this._suppressSlider = false;
      this._syncXformInputs();
      this._syncVisible();
      this._startLoop();
      this.log(`Reference Mode on · frozen @ LUA f${this.luaFrame}`);
    } else {
      this.discardVisualOverrides({ restoreEntry: true });
      this.log('Reference Mode off');
    }
    this.onChange(this.active);
    this._paint();
  }

  discardVisualOverrides({ snap = true, restoreEntry = false } = {}) {
    this.active = false;
    if (this.btn) {
      this.btn.classList.remove('active');
      this.btn.setAttribute('aria-pressed', 'false');
      this.btn.textContent = 'LUA Reference Mode';
    }
    if (this.panel) this.panel.hidden = true;
    if (this.overlay) {
      this.overlay.style.pointerEvents = 'none';
      this.overlay.classList.remove('ref-active');
    }
    document.body.classList.remove('ref-mode');
    this.dragging = null;
    this._stopLoop();
    this._clearOverlay();

    const freeze = !!this.runner?.userPaused;
    if (restoreEntry && this._entrySnapshot) {
      try {
        this.chara?.restoreEntryState?.(this._entrySnapshot);
      } catch {

      }
      if (this.runner && Number.isFinite(this._entryLuaFrame)) {
        this.runner.frame = this._entryLuaFrame;
        this.luaFrame = this._entryLuaFrame;
      }
    }
    if (typeof this.chara?.clearRefOverrides === 'function') {
      this.chara.clearRefOverrides();
    } else {
      this.chara?.setRefMode?.(false);
    }
    this.chara?.setSyncPause?.(freeze);
    this.usm?.unlockRef?.();
    this.lwf?.unlockRef?.();
    this.usm?.setSyncPause?.(freeze);
    this.lwf?.setSyncPause?.(freeze);
    this.usm?.setAbPause?.(freeze);

    if (!restoreEntry && snap && this.runner?.ready) {
      try {
        this.runner.snapCharaToScriptFrame?.(this.runner.frame || 0);
      } catch {

      }
    }
    this._entrySnapshot = null;
    this.onChange(false);
  }

  resetSpritePosition() {
    if (!this.active) return;
    if (this.chkKeys) this.chkKeys.checked = false;
    if (this._entrySnapshot) {
      try {
        this.chara?.restoreEntryState?.(this._entrySnapshot);
      } catch {

      }
      this.luaFrame = this._entryLuaFrame;
      if (this.runner) this.runner.frame = this._entryLuaFrame;
      this._syncLuaSlider();
    } else if (typeof this.chara?.resetRefPosition === 'function') {
      this.chara.resetRefPosition(this.selected, this.luaFrame);
    } else {
      this.runner?.snapCharaToScriptFrame?.(this.luaFrame);
    }
    for (const c of this.chara?.chars?.values?.() || []) {
      c.refOverride = true;
    }
    this._fillPoses();
    this._syncXformInputs();
    this._syncVisible();
    this._paint();
    this.log(`Reset to open state · LUA f${this.luaFrame}`);
  }

  _startLoop() {
    this._stopLoop();
    const tick = () => {
      if (!this.active) return;
      this._paint();
      this._raf = requestAnimationFrame(tick);
    };
    this._raf = requestAnimationFrame(tick);
  }

  _stopLoop() {
    if (this._raf) cancelAnimationFrame(this._raf);
    this._raf = null;
  }

  _fillPoses() {
    if (!this.selPose) return;
    const opts = this.chara?.listAnimeOptions?.(this.selected) || [];
    const snap = this.chara?.getRefSnapshot?.(this.selected);
    const cur = snap?.anime;
    this.selPose.innerHTML = '';
    for (const o of opts) {
      const el = document.createElement('option');
      el.value = String(o.animeId);
      el.textContent = o.available
        ? o.label
        : `${o.label} · missing`;
      if (!o.available) el.disabled = true;
      if (Number(o.animeId) === Number(cur)) el.selected = true;
      this.selPose.appendChild(el);
    }
    if (cur != null && ![...this.selPose.options].some((o) => Number(o.value) === Number(cur))) {
      const el = document.createElement('option');
      el.value = String(cur);
      el.textContent = `${cur} · current`;
      el.selected = true;
      this.selPose.appendChild(el);
    }
  }

  _luaFrameFromMedia() {
    const start = this.usm?.getStartAbFrame?.();
    const usmF = this.usm?.getPlayingFrame?.();
    if (
      this.usm?.hasActiveClips?.() &&
      Number.isFinite(start) &&
      Number.isFinite(usmF)
    ) {
      return Math.max(0, Math.round(start + (usmF - 1)));
    }
    return Math.max(0, Number(this.runner?.frame) || 0);
  }

  _syncLuaSlider() {
    if (!this.luaSlider) return;
    const max = Math.max(1, Number(this.runner?.maxFrame) || 300);
    const prev = this._suppressSlider;
    this._suppressSlider = true;
    this.luaSlider.min = '0';
    this.luaSlider.max = String(max);
    this.luaSlider.value = String(this.luaFrame);
    this._suppressSlider = prev;
  }

  _syncXformInputs() {
    const snap = this.chara?.getRefSnapshot?.(this.selected);
    if (!snap) return;
    this._syncingXform = true;
    if (this.xInput) this.xInput.value = String(round1(snap.x || 0));
    if (this.yInput) this.yInput.value = String(round1(snap.y || 0));
    if (this.zInput) this.zInput.value = String(round1(snap.z || 0));
    if (this.sxInput) this.sxInput.value = String(round1(snap.sx ?? 1));
    if (this.syInput) this.syInput.value = String(round1(snap.sy ?? 1));
    if (this.rotInput) this.rotInput.value = String(round1(snap.rot || 0));
    this._syncingXform = false;
  }

  _isXformFocused() {
    const a = document.activeElement;
    return (
      a === this.xInput ||
      a === this.yInput ||
      a === this.zInput ||
      a === this.sxInput ||
      a === this.syInput ||
      a === this.rotInput
    );
  }

  _syncVisible() {
    if (!this.chkVisible) return;
    const snap = this.chara?.getRefSnapshot?.(this.selected);
    const x = Number(snap?.x) || 0;
    const y = Number(snap?.y) || 0;
    const onStage = Math.abs(x) <= 2000 && Math.abs(y) <= 2000;
    this.chkVisible.checked = !!snap?.disp && onStage;
  }

  async _seekMediaToLuaFrame(frame) {
    const f = Number(frame) || 0;
    this.usm?.unlockRef?.();
    this.lwf?.unlockRef?.();
    const stepMul = this.runner?.highSpeed ? 2 : 1;
    try {
      if (this.usm?.hasActiveClips?.()) {
        await this.usm.seekToAbFrame?.(f, FPS, { force: true });
      }
    } catch {

    }
    try {
      this.lwf?.seekToAbFrame?.(f, { frameStepsPerAb: stepMul, force: true });
    } catch {

    }
    this.usm?.setSyncPause?.(true);
    this.lwf?.setSyncPause?.(true);
    this.usm?.setAbPause?.(true);
    this.usm?.lockAtCurrent?.();
    this.lwf?.lockAtCurrent?.();
    try {
      this.usm?.clips?.forEach?.((c) => this.usm._blitClip?.(c));
    } catch {

    }
    try {
      this.lwf?.renderOnly?.();
    } catch {

    }
    try {
      this.chara?.renderOnly?.();
    } catch {

    }
    this._lastSeekLuaFrame = f;
  }

  async _seekLuaFrame(frame, { seekMedia = true } = {}) {
    const run = async () => {
      const max = Math.max(0, Number(this.runner?.maxFrame) || 300);
      this.luaFrame = Math.max(0, Math.min(max, Math.round(Number(frame) || 0)));
      if (this.runner) this.runner.frame = this.luaFrame;
      if (seekMedia) await this._seekMediaToLuaFrame(this.luaFrame);
      for (const c of this.chara?.chars?.values?.() || []) c.refOverride = false;
      this.runner?.snapCharaToScriptFrame?.(this.luaFrame);
      if (!this.chkKeys?.checked) {
        for (const c of this.chara?.chars?.values?.() || []) c.refOverride = true;
      }
      this._syncXformInputs();
      this._syncVisible();
      this._syncLuaSlider();
      this._paint();
    };
    this._seekSerial = this._seekSerial.then(run, run);
    return this._seekSerial;
  }

  _stageScale() {
    return applyStageFit(this.stageEl) || 1;
  }

  _clientToLua(clientX, clientY) {
    const rect = this.stageEl.getBoundingClientRect();
    const scale = rect.width / DESIGN_W || this._stageScale() || 1;
    const sx = (clientX - rect.left) / scale;
    const sy = (clientY - rect.top) / scale;
    return {
      x: round1(sx - DESIGN_W / 2),
      y: round1(DESIGN_H / 2 - sy),
    };
  }

  _luaToStage(x, y) {
    return {
      sx: DESIGN_W / 2 + (Number(x) || 0),
      sy: DESIGN_H / 2 - (Number(y) || 0),
    };
  }

  _pickChara(luaX, luaY) {
    let best = null;
    let bestD = Infinity;
    for (const c of this.chara?.chars?.values?.() || []) {
      if (!c) continue;
      const x = Number(c.x) || 0;
      const y = Number(c.y) || 0;
      if (Math.abs(x) > 2000 || Math.abs(y) > 2000) continue;
      const dx = x - luaX;
      const dy = y - luaY;
      const d = dx * dx + dy * dy;
      if (d < bestD) {
        bestD = d;
        best = c.id;
      }
    }
    return bestD < 180 * 180 ? best : this.selected;
  }

  _onPointerDown(ev) {
    if (!this.active || !this.overlay) return;
    ev.preventDefault();
    const lua = this._clientToLua(ev.clientX, ev.clientY);
    const id = this._pickChara(lua.x, lua.y);
    this.selected = id;
    if (this.selChara) this.selChara.value = String(id);
    this._fillPoses();
    this._syncXformInputs();
    this._syncVisible();
    const snap = this.chara?.getRefSnapshot?.(id);
    this.dragging = {
      id,
      offX: (snap?.x || 0) - lua.x,
      offY: (snap?.y || 0) - lua.y,
    };
    this.overlay.setPointerCapture?.(ev.pointerId);
    this._paint();
  }

  _onPointerMove(ev) {
    if (!this.active || !this.dragging) return;
    const lua = this._clientToLua(ev.clientX, ev.clientY);
    const x = round1(lua.x + this.dragging.offX);
    const y = round1(lua.y + this.dragging.offY);
    const snap = this.chara?.getRefSnapshot?.(this.dragging.id);
    const z = this.zInput != null ? Number(this.zInput.value) || 0 : snap?.z || 0;
    this.chara?.setRefMove?.(this.dragging.id, x, y, z);
    if (this.chkKeys) this.chkKeys.checked = false;
    if (this.chkVisible) this.chkVisible.checked = true;
    for (const c of this.chara?.chars?.values?.() || []) c.refOverride = true;
    this._syncingXform = true;
    if (this.xInput) this.xInput.value = String(x);
    if (this.yInput) this.yInput.value = String(y);
    this._syncingXform = false;
    this._paint();
  }

  _onPointerUp() {
    this.dragging = null;
  }

  _clearOverlay() {
    if (!this.overlay) return;
    const ctx = this.overlay.getContext('2d');
    ctx.clearRect(0, 0, this.overlay.width, this.overlay.height);
  }

  _paint() {
    if (!this.active || !this.overlay) return;
    const ctx = this.overlay.getContext('2d');
    const w = this.overlay.width;
    const h = this.overlay.height;
    ctx.clearRect(0, 0, w, h);

    ctx.save();
    ctx.strokeStyle = 'rgba(255,180,60,0.35)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(w / 2, 0);
    ctx.lineTo(w / 2, h);
    ctx.moveTo(0, h / 2);
    ctx.lineTo(w, h / 2);
    ctx.stroke();
    ctx.restore();

    for (const c of this.chara?.chars?.values?.() || []) {
      if (!c) continue;
      const x = Number(c.x) || 0;
      const y = Number(c.y) || 0;
      if (Math.abs(x) > 2000 || Math.abs(y) > 2000) continue;
      const { sx, sy } = this._luaToStage(x, y);
      const selected = c.id === this.selected;
      ctx.beginPath();
      ctx.arc(sx, sy, selected ? 14 : 10, 0, Math.PI * 2);
      ctx.fillStyle = selected ? 'rgba(255,140,0,0.85)' : 'rgba(80,180,255,0.7)';
      ctx.fill();
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.font = 'bold 22px ui-monospace, Consolas, monospace';
      ctx.fillStyle = '#fff';
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.lineWidth = 4;
      const label = c.id === 0 ? 'P' : 'E';
      ctx.strokeText(label, sx + 16, sy - 12);
      ctx.fillText(label, sx + 16, sy - 12);
      const pos = `${round1(x)}, ${round1(y)}`;
      const xform = `s${round1(c.sx)}/${round1(c.sy)} r${round1(c.rot)} z${round1(c.z)}`;
      ctx.font = '18px ui-monospace, Consolas, monospace';
      ctx.strokeText(pos, sx + 16, sy + 14);
      ctx.fillText(pos, sx + 16, sy + 14);
      ctx.strokeText(xform, sx + 16, sy + 34);
      ctx.fillText(xform, sx + 16, sy + 34);
    }

    const snap = this.chara?.getRefSnapshot?.(this.selected);
    if (this.outCoords && snap) {
      this.outCoords.textContent =
        `chara ${snap.id} · setMoveKey x=${round1(snap.x)}  y=${round1(snap.y)}  z=${round1(snap.z)}`;
    }
    if (this.outXform && snap) {
      this.outXform.textContent =
        `setScaleKey sx=${round1(snap.sx)}  sy=${round1(snap.sy)} · setRotateKey rot=${round1(snap.rot)}`;
    }
    if (this.outPose && snap) {
      this.outPose.textContent =
        `changeAnime ${snap.anime}${snap.clip ? ` · ${snap.clip}` : ''}`;
    }
    if (this.outLua) {
      const max = Number(this.runner?.maxFrame) || 0;
      const usmF = this.usm?.getPlayingFrame?.();
      const lwfF = this.lwf?.getRootMovieFrame?.();
      const bits = [`LUA frame ${this.luaFrame}${max ? ` / ${max}` : ''}`];
      if (Number.isFinite(usmF)) bits.push(`USM f${usmF}`);
      if (Number.isFinite(lwfF)) bits.push(`LWF f${lwfF}`);
      this.outLua.textContent = bits.join(' · ');
    }
    if (!this.dragging && !this._syncingXform && snap && !this._isXformFocused()) {
      this._syncXformInputs();
    }
  }

  exportText() {
    const snap = this.chara?.getRefSnapshot?.(this.selected);
    if (!snap) return '';
    const x = round1(snap.x);
    const y = round1(snap.y);
    const z = round1(snap.z);
    const sx = round1(snap.sx);
    const sy = round1(snap.sy);
    const rot = round1(snap.rot);
    const f = this.luaFrame;
    const lines = [
      `-- Coordinates are the Same as What is Used in LUA`,
      `-- ref chara=${snap.id} anime=${snap.anime}`,
      `setMoveKey(${f}, ${snap.id}, ${x}, ${y}, ${z})`,
      `setScaleKey(${f}, ${snap.id}, ${sx}, ${sy})`,
      `setRotateKey(${f}, ${snap.id}, ${rot})`,
      `changeAnime(${f}, ${snap.id}, ${snap.anime})`,
    ];
    return lines.join('\n');
  }

  async copyExport() {
    const text = this.exportText();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      this.log('Reference coords copied');
    } catch {
      try {
        const ta = document.createElement('textarea');
        ta.value = text;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        ta.remove();
        this.log('Reference coords copied');
      } catch (e) {
        this.log(`Copy failed: ${e.message || e}`);
      }
    }
  }
}
