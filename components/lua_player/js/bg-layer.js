
import { LwfLayer } from './lwf-player.js';
import { withPatchQuery } from './patch-context.js';

function stageSize() {
  return { w: 852, h: 1536 };
}

export class BattleBgLayer {
  constructor(hostEl, log) {
    this.host = hostEl;
    this.log = log || (() => {});
    this.wrap = null;
    this.layers = [];
    this.lwf = null;
    this.lwfHost = null;
    this.meta = null;
    this.scroll = 0;
    this.scrolling = false;
    this.scrollSpeed = 0;
    this.x = 0;
    this.y = 0;
    this.rot = 0;
    this.sx = 1;
    this.sy = 1;
    this.alpha = 1;
    this.quake = 0;
    this._quakeT = 0;
    this._shakeRemain = 0;
    this._shakeAmt = 0;
    this.fadeEl = null;
    this._fade = null;
  }

  clear() {
    this.lwf?.clear?.();
    this.lwf = null;
    this.lwfHost = null;
    this.layers = [];
    this.meta = null;
    this.scroll = 0;
    this.scrolling = false;
    this.scrollSpeed = 0;
    this.x = 0;
    this.y = 0;
    this.rot = 0;
    this.sx = 1;
    this.sy = 1;
    this.alpha = 1;
    this.quake = 0;
    this._shakeRemain = 0;
    this._shakeAmt = 0;
    this._fade = null;
    this.fadeEl = null;
    this.host.innerHTML = '';
    this.wrap = null;
  }

  async loadLevelBg(bgId) {
    this.clear();
    const id = Number(bgId) || 0;
    if (!id) return;
    const res = await fetch(withPatchQuery(`/api/level-bg/${id}`), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.found) {
      this.log(`BG ${id}: not found`);
      return;
    }
    this.meta = data;
    this._ensureWrap();
    const { w, h } = stageSize();

    for (const layer of data.layers || []) {
      if (!layer.enabled || !layer.url) continue;
      const img = document.createElement('img');
      img.className = 'battle-bg-layer';
      img.src = layer.url;
      img.draggable = false;
      img.style.cssText =
        `position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);` +
        `width:${w}px;height:${h}px;object-fit:cover;pointer-events:none;`;
      this.wrap.appendChild(img);
      this.layers.push({
        el: img,
        coef: Number(layer.coef) || 0,
        flipDisable: !!layer.flip_disable,
      });
    }

    if (data.lwf?.url) {
      this.lwfHost = document.createElement('div');
      this.lwfHost.className = 'battle-bg-lwf';
      this.lwfHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;';
      this.wrap.appendChild(this.lwfHost);
      this.lwf = new LwfLayer(this.lwfHost, this.log);
      const url = data.lwf.url;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      try {
        await this.lwf.addEffect({
          lwfUrl: url,
          baseUrl: base,
          sceneName: '',
          zIndex: 1,
          instanceKey: `bg_${id}`,
          dormant: false,
        });

        for (const L of this.layers) L.el.style.display = 'none';
      } catch (e) {
        this.log(`BG LWF: ${e.message || e}`);
      }
    }

    this.log(
      `BG ${id} ${data.name || ''} · layers=${this.layers.filter((l) => l.el.style.display !== 'none').length}` +
        (data.lwf?.url ? ' · lwf' : ''),
    );
    this._applyTransform();
  }

  async loadDokkanField(fieldId) {
    const id = Number(fieldId) || 0;
    if (!id) return;
    const res = await fetch(withPatchQuery(`/api/dokkan-field/${id}`), { cache: 'no-store' });
    const data = await res.json();
    if (!res.ok || !data.found) {
      this.log(`Field ${id}: not found`);
      return;
    }

    this._ensureWrap();
    if (this.lwfHost) this.lwfHost.remove();
    this.lwf?.clear?.();
    this.lwfHost = document.createElement('div');
    this.lwfHost.className = 'battle-bg-lwf battle-bg-field';
    this.lwfHost.style.cssText = 'position:absolute;inset:0;pointer-events:none;z-index:2;';
    this.wrap.appendChild(this.lwfHost);
    this.lwf = new LwfLayer(this.lwfHost, this.log);
    if (data.lwf?.url) {
      const url = data.lwf.url;
      const base = url.slice(0, url.lastIndexOf('/') + 1);
      try {
        await this.lwf.addEffect({
          lwfUrl: url,
          baseUrl: base,
          sceneName: data.scene_name || '',
          zIndex: 2,
          instanceKey: `field_${id}`,
          dormant: false,
        });
        this.log(`Field ${id} ${data.name || ''} → ${data.lwf.rel}`);
      } catch (e) {
        this.log(`Field LWF: ${e.message || e}`);
      }
    }
  }

  _ensureWrap() {
    if (this.wrap) return;
    this.wrap = document.createElement('div');
    this.wrap.className = 'battle-bg-root';
    this.wrap.style.cssText =
      'position:absolute;inset:0;overflow:hidden;pointer-events:none;transform-origin:center center;';
    this.host.appendChild(this.wrap);
  }

  setScroll(speed) {
    this.scrollSpeed = Number(speed) || 0;
  }
  startScroll(speed) {
    if (speed != null) this.scrollSpeed = Number(speed) || 0;
    this.scrolling = true;
  }
  stopScroll() {
    this.scrolling = false;
  }
  setMove(x, y) {
    this.x = Number(x) || 0;
    this.y = Number(y) || 0;
    this._applyTransform();
  }
  setScale(sx, sy) {
    this.sx = Number(sx) || 1;
    this.sy = sy != null ? Number(sy) : this.sx;
    this._applyTransform();
  }
  setRotate(deg) {
    this.rot = Number(deg) || 0;
    this._applyTransform();
  }
  setQuake(amount, durationFrames = 10) {
    this.quake = Math.max(this.quake, Number(amount) || 0);
    this._shakeRemain = Math.max(this._shakeRemain, Number(durationFrames) || 0);
    this._shakeAmt = Math.max(this._shakeAmt, Number(amount) || 0);
  }
  setShake(amount, durationFrames = 10) {
    this.setQuake(amount, durationFrames);
  }

  entryFadeBg(fadeIn, hold, fadeOut, r, g, b, a) {
    this._ensureWrap();
    if (!this.fadeEl) {
      this.fadeEl = document.createElement('div');
      this.fadeEl.className = 'battle-bg-fade';
      this.fadeEl.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:5;opacity:0;';
      this.wrap.appendChild(this.fadeEl);
    }
    const aa = Math.max(0, Math.min(255, Number(a) || 0)) / 255;
    this._fade = {
      r: Number(r) || 0,
      g: Number(g) || 0,
      b: Number(b) || 0,
      a: aa,
      fadeIn: Math.max(0, Number(fadeIn) || 0),
      hold: Math.max(0, Number(hold) || 0),
      fadeOut: Math.max(0, Number(fadeOut) || 0),
      t: 0,
    };
    this.fadeEl.style.background = `rgb(${this._fade.r},${this._fade.g},${this._fade.b})`;
  }
  clearFade() {
    this._fade = null;
    if (this.fadeEl) this.fadeEl.style.opacity = '0';
  }

  tick(dtSec = 1 / 30) {
    if (this.scrolling) {
      this.scroll += (this.scrollSpeed || 8) * dtSec * 30;
    }
    if (this._shakeRemain > 0) {
      this._shakeRemain -= dtSec * 30;
      this.quake = this._shakeAmt;
      if (this._shakeRemain <= 0) {
        this._shakeRemain = 0;
        this.quake = 0;
        this._shakeAmt = 0;
      }
    } else if (this.quake > 0) {
      this.quake = Math.max(0, this.quake - dtSec * 8);
    }
    this._tickFade(dtSec);
    this._applyTransform();
    if (this.lwf?.players?.length) {
      this.lwf.tickEffects?.(0, -1, dtSec);
      this.lwf.renderOnly?.();
    }
  }

  _tickFade(dtSec) {
    if (!this._fade || !this.fadeEl) return;
    const f = this._fade;
    f.t += dtSec * 30;
    const inEnd = f.fadeIn;
    const holdEnd = inEnd + f.hold;
    const outEnd = holdEnd + f.fadeOut;
    let op = 0;
    if (f.t < inEnd) {
      op = inEnd > 0 ? (f.t / inEnd) * f.a : f.a;
    } else if (f.t < holdEnd) {
      op = f.a;
    } else if (f.t < outEnd) {
      const u = f.fadeOut > 0 ? (f.t - holdEnd) / f.fadeOut : 1;
      op = f.a * (1 - u);
    } else {
      op = 0;
      this._fade = null;
    }
    this.fadeEl.style.opacity = String(Math.max(0, Math.min(1, op)));
  }

  _applyTransform() {
    if (!this.wrap) return;
    let qx = 0;
    let qy = 0;
    if (this.quake > 0) {
      qx = (Math.random() * 2 - 1) * this.quake * 4;
      qy = (Math.random() * 2 - 1) * this.quake * 4;
    }
    this.wrap.style.transform =
      `translate(${this.x + qx}px, ${-this.y + qy}px) rotate(${this.rot}deg) scale(${this.sx}, ${this.sy})`;
    this.wrap.style.opacity = String(Math.max(0, Math.min(1, this.alpha)));

    for (const L of this.layers) {
      if (L.el.style.display === 'none') continue;
      const ox = this.scroll * ((L.coef || 0) / 100);
      L.el.style.transform = `translate(calc(-50% + ${ox}px), -50%)`;
    }
  }
}

export class ScreenFade {
  constructor(hostEl) {
    this.host = hostEl;
    this.el = null;
    this._fade = null;
  }
  clear() {
    this._fade = null;
    this.el?.remove?.();
    this.el = null;
  }
  entryFade(fadeIn, hold, fadeOut, r, g, b, a) {
    if (!this.el) {
      this.el = document.createElement('div');
      this.el.className = 'screen-fade';
      this.el.style.cssText =
        'position:absolute;inset:0;pointer-events:none;z-index:450;opacity:0;';
      this.host.appendChild(this.el);
    }
    const aa = Math.max(0, Math.min(255, Number(a) || 0)) / 255;
    this._fade = {
      r: Number(r) || 0,
      g: Number(g) || 0,
      b: Number(b) || 0,
      a: aa,
      fadeIn: Math.max(0, Number(fadeIn) || 0),
      hold: Math.max(0, Number(hold) || 0),
      fadeOut: Math.max(0, Number(fadeOut) || 0),
      t: 0,
    };
    this.el.style.background = `rgb(${this._fade.r},${this._fade.g},${this._fade.b})`;
  }
  tick(dtSec = 1 / 30) {
    if (!this._fade || !this.el) return;
    const f = this._fade;
    f.t += dtSec * 30;
    const inEnd = f.fadeIn;
    const holdEnd = inEnd + f.hold;
    const outEnd = holdEnd + f.fadeOut;
    let op = 0;
    if (f.t < inEnd) op = inEnd > 0 ? (f.t / inEnd) * f.a : f.a;
    else if (f.t < holdEnd) op = f.a;
    else if (f.t < outEnd) {
      const u = f.fadeOut > 0 ? (f.t - holdEnd) / f.fadeOut : 1;
      op = f.a * (1 - u);
    } else {
      op = 0;
      this._fade = null;
    }
    this.el.style.opacity = String(Math.max(0, Math.min(1, op)));
  }
}
