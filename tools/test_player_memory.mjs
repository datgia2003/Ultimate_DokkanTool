import test from 'node:test';
import assert from 'node:assert/strict';
import { UsmLayer } from '../components/lua_player/js/usm-player.js';
import { AudioBus } from '../components/lua_player/js/audio-bus.js';

const originalFetch = globalThis.fetch;
const originalWindow = globalThis.window;
const movieKey = 'movie/sample.usm';

function mp4RangeResponse() {
  const bytes = new Uint8Array(32);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4);
  return new Response(bytes, {
    status: 206,
    headers: { 'Content-Range': 'bytes 0-31/12582912', 'Content-Type': 'video/mp4' },
  });
}

function setupBrowser() {
  globalThis.window = {
    __ECLIPSE_TOOL__: 'lua-player',
    __SERVER_PORT__: 8585,
    location: { hostname: '127.0.0.1', protocol: 'http:' },
  };
}

test.afterEach(() => {
  globalThis.fetch = originalFetch;
  globalThis.window = originalWindow;
});

test('USM preload retains a streaming URL, not a full MP4 Blob', async () => {
  setupBrowser();
  globalThis.fetch = async (_url, options) => {
    assert.equal(options.headers.Range, 'bytes=0-31');
    return mp4RangeResponse();
  };
  const layer = new UsmLayer({ children: [] });
  const entry = await layer.preloadFromAssetRel(movieKey);
  assert.equal(entry.bytes, 12582912);
  assert.equal(entry.blob, undefined);
  assert.match(entry.url, /\/api\/usm\?/);
  layer.clearPreload();
  assert.equal(layer._preload.size, 0);
});

test('a cancelled old USM preload cannot remove a newer entry', async () => {
  setupBrowser();
  let resolveOld;
  let calls = 0;
  globalThis.fetch = () => {
    calls += 1;
    return calls === 1 ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve(mp4RangeResponse());
  };
  const layer = new UsmLayer({ children: [] });
  const oldLoad = layer.preloadFromAssetRel(movieKey);
  layer.clearPreload();
  const freshEntry = await layer.preloadFromAssetRel(movieKey);
  resolveOld(mp4RangeResponse());
  await assert.rejects(oldLoad, /cancelled/);
  assert.equal(layer._preload.get(movieKey), freshEntry);
});

test('decoded audio cache evicts by bytes, not only entry count', () => {
  const audio = new AudioBus();
  const largeBuffer = { length: 4_000_000, numberOfChannels: 2 };
  const secondBuffer = { length: 4_000_000, numberOfChannels: 2 };
  audio.cache.set('one', largeBuffer);
  audio._trackCacheKey('one');
  audio.cache.set('two', secondBuffer);
  audio._trackCacheKey('two');
  assert.equal(audio.cache.has('one'), false);
  assert.equal(audio.cache.has('two'), true);
});

test('concurrent requests decode a cue only once', async () => {
  setupBrowser();
  let release;
  let requests = 0;
  globalThis.fetch = async () => {
    requests++;
    await new Promise(resolve => { release = resolve; });
    return new Response(new Uint8Array([1, 2, 3]));
  };
  const bus = new AudioBus();
  const buffer = { length: 100, numberOfChannels: 1 };
  bus._decodeAudioData = async () => buffer;
  const first = bus._load('/api/se?cue=1', 'se:1');
  const second = bus._load('/api/se?cue=1', 'se:1');
  release();
  assert.equal(await first, buffer);
  assert.equal(await second, buffer);
  assert.equal(requests, 1);
  assert.equal(bus._pending.size, 0);
});

test('clear during decoding cannot repopulate the old audio cache', async () => {
  setupBrowser();
  let releaseDecode, enteredDecode;
  const decoding = new Promise(resolve => { enteredDecode = resolve; });
  globalThis.fetch = async () => new Response(new Uint8Array([1]));
  const bus = new AudioBus();
  bus._decodeAudioData = async () => {
    enteredDecode();
    return new Promise(resolve => { releaseDecode = resolve; });
  };
  const old = bus.preloadVoice(419);
  await decoding;
  bus.clear();
  releaseDecode({ length: 100, numberOfChannels: 1 });
  assert.equal(await old, null);
  assert.equal(bus.cache.size, 0);
  assert.equal(bus._pending.size, 0);
});

test('dispose aborts in-flight downloads without retries', async () => {
  setupBrowser();
  let requests = 0;
  globalThis.fetch = (_url, { signal }) => {
    requests++;
    return new Promise((_resolve, reject) => signal.addEventListener('abort', () => reject(new Error('aborted'))));
  };
  const bus = new AudioBus();
  const pending = bus._load('/api/se?cue=1', 'se:1');
  bus.dispose();
  assert.equal(await pending, null);
  assert.equal(requests, 1);
  assert.equal(bus._controllers.size, 0);
  assert.equal(await bus._load('/api/se?cue=2', 'se:2'), null);
});
