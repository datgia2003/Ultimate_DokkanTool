import test from 'node:test';
import assert from 'node:assert/strict';
import { createMusicSource } from '../web-ui/src/audio/musicSpectrum.js';

test('music sources share one analyser and release it over repeated card lifetimes', async () => {
  const originalWindow = globalThis.window;
  const originalDocument = globalThis.document;
  let opened = 0, closed = 0, analysers = 0, connections = 0;
  const transitionNodes = [];
  const filters = [];
  const node = () => ({
    connect(other) { return other; }, disconnect() {},
    frequency: { value: 0 }, Q: { value: 0 }, gain: { value: 0, setTargetAtTime(value) { this.value = value; } },
  });
  class FakeContext {
    constructor() { opened++; this.destination = {}; this.currentTime = 0; }
    createAnalyser() {
      analysers++;
      return { ...node(), frequencyBinCount: 256, getByteFrequencyData(data) { data.fill(100); } };
    }
    createMediaElementSource() { connections++; return node(); }
    createBiquadFilter() { const filter = node(); filters.push(filter); return filter; }
    createDynamicsCompressor() { return {
      ...node(), threshold: {}, knee: {}, ratio: {}, attack: {}, release: {},
    }; }
    createGain() { const gain = node(); transitionNodes.push(gain); return gain; }
    resume() { return Promise.resolve(); }
    close() { closed++; return Promise.resolve(); }
  }
  globalThis.window = Object.assign(new EventTarget(), { AudioContext: FakeContext, setTimeout });
  globalThis.document = Object.assign(new EventTarget(), { hidden: false });
  const audio = () => ({ paused: false, pause() { this.paused = true; }, removeAttribute() {}, load() {} });
  try {
    for (let i = 0; i < 50; i++) {
      const bgm = createMusicSource(audio());
      const ost = createMusicSource(audio());
      bgm.start(); bgm.stop(); ost.start(); ost.start();
      assert.equal(opened - closed, 1);
      assert.equal(filters[filters.length - 3].gain.value, 2.2);
      assert.equal(filters[filters.length - 2].gain.value, -1.3);
      assert.equal(filters[filters.length - 1].gain.value, 1.4);
      ost.setPunch(true);
      assert.equal(filters[filters.length - 3].gain.value, 4.2);
      assert.equal(await ost.fadeTo(0, 0), true);
      assert.equal(transitionNodes.at(-1).gain.value, 0);
      assert.equal(await ost.fadeTo(1, 0), true);
      bgm.dispose(); ost.dispose();
      assert.equal(opened - closed, 0);
    }
    assert.equal(analysers, 50);
    assert.equal(connections, 100); // Restarting an OST does not reconnect its element.
  } finally {
    globalThis.window = originalWindow;
    globalThis.document = originalDocument;
  }
});
