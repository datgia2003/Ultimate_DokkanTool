import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { inspectScript, joinClips, prepareCustomLua, CUSTOM_LUA_FORMATS, canPlaceCustomDamage } from '../web-ui/src/components/tabs/luaTimeline.js'
import { createLuaHost } from '../components/lua_player/js/lua-host.js'
import { installBinders } from '../components/lua_player/js/binders.js'
import { ActionBankRunner } from '../components/lua_player/js/runner.js'
import { LwfLayer } from '../components/lua_player/js/lwf-player.js'
import { AudioBus } from '../components/lua_player/js/audio-bus.js'

const require = createRequire(import.meta.url)
globalThis.window = {}
globalThis.fengari = require('../components/lua_player/vendor/fengari-web.min.js')
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
const fixture = name => readFileSync(new URL(`./fixtures/lua_timeline/${name}.lua`, import.meta.url), 'utf8')
const fusion = fixture('fusion')
const golden = fixture('golden_power')

function run(source, globals = {}) {
  const host = createLuaHost()
  const bank = { commands: [] }
  installBinders(host, bank)
  for (const [name, value] of Object.entries({ _IS_PLAYER_SIDE_: 1, _IS_SKIP_: 0, _IS_DODGE_: 0, ...globals })) host.setGlobalNumber(name, value)
  try { host.run(source, 'timeline-test'); return bank }
  finally { globalThis.fengari.lua.lua_close(host.L) }
}

const clips = [
  { name: 'Fusion', content: fusion, startFrame: 0, inFrame: 0, outFrame: 448 },
  { name: 'Golden Power', content: golden, startFrame: 449, inFrame: 0, outFrame: 782 }
]

test('parser maps assignment calls, one-argument endPhase and multiline calls', () => {
  for (const source of [fusion, golden]) {
    const info = inspectScript(source)
    assert.equal(info.error, undefined)
    assert.equal(info.unmapped.length, 0)
    assert.ok(info.cues.some(cue => cue.name === 'entryEffect'))
    assert.ok(info.cues.some(cue => cue.name === 'playSeVer2'))
    assert.ok(info.cues.some(cue => cue.name === 'endPhase'))
  }
  assert.equal(inspectScript(fusion).maxFrame, 1326)
  assert.equal(inspectScript(golden).maxFrame, 782)
  const info = inspectScript('local frame = 0x10; local fx = entryEffect(\nframe, 1, 0x100, -1, 0, 0, 0); endPhase(frame + 10)')
  assert.deepEqual(info.cues.map(cue => cue.frame), [16, 26])
})

test('actual player queue puts Golden visuals and sounds at 449, not zero', () => {
  const bank = run(joinClips(clips))
  const commands = bank.commands
  assert.deepEqual(commands.filter(cmd => cmd.type === 'entryEffect').map(cmd => [cmd.effectId, cmd.frame]), [[158990, 0], [158991, 370], [164063, 449]])
  assert.deepEqual(commands.filter(cmd => cmd.type === 'endPhase').map(cmd => cmd.frame), [1231])
  assert.equal(commands.find(cmd => cmd.type === 'playSeVer2' && cmd.cueId === 1499).frame, 579)
  assert.equal(commands.find(cmd => cmd.type === 'playVoice' && cmd.cueId === 1063).frame, 649)
  assert.equal(commands.find(cmd => cmd.type === 'playVoice' && cmd.cueId === 1065).frame, 975)
  assert.ok(!commands.some(cmd => cmd.type === 'dealDamage'))
  for (const sound of commands.filter(cmd => cmd.type === 'playSeVer2')) {
    assert.ok(sound.frame <= (sound.frame < 449 ? 448 : 1231))
    assert.ok(sound.endFrame <= (sound.frame < 449 ? 449 : 1232))
    assert.equal(sound.autoTimeScale, sound.frame < 449 ? 0.8 : 0.9)
  }
  const effects = commands.filter(cmd => cmd.type === 'entryEffect' && cmd.frame < 449)
  for (const effect of effects) assert.ok(commands.some(cmd => cmd.type === 'setEffAlphaKey' && cmd.workId === effect.workId && cmd.frame === 449 && cmd.a === 0))
  const handles = new Set(commands.filter(cmd => ['playSe', 'playSeVer2', 'playSeLife'].includes(cmd.type)).map(cmd => cmd.workId))
  for (const cmd of commands.filter(cmd => ['setSeVolumeByWorkId', 'setTimeStretch', 'setStartTimeMs', 'setPitch'].includes(cmd.type))) assert.ok(handles.has(cmd.workId), `${cmd.type} targets missing work ID ${cmd.workId}`)
})

test('IN cuts omit earlier sound, preserve hidden visual preroll and still play the next clip', () => {
  const bank = run(joinClips([
    { ...clips[0], inFrame: 100, outFrame: 200 },
    { ...clips[1], startFrame: 101, inFrame: 130, outFrame: 400 }
  ]))
  const commands = bank.commands
  assert.deepEqual(commands.filter(cmd => cmd.type === 'entryEffect').map(cmd => [cmd.effectId, cmd.frame]), [[158990, -100], [164063, -29]])
  assert.equal(commands.find(cmd => cmd.type === 'playSeVer2' && cmd.cueId === 1499).frame, 101)
  assert.ok(!commands.some(cmd => cmd.type === 'playSeVer2' && cmd.cueId === 1269))
  assert.deepEqual(commands.filter(cmd => cmd.type === 'endPhase').map(cmd => cmd.frame), [371])
  assert.ok(commands.some(cmd => cmd.type === 'setEffAlphaKey' && cmd.frame === -29 && cmd.a === 0))
})

test('a source return only exits its clip and cannot prevent the following animation', () => {
  const commands = run(joinClips([
    { ...clips[0], outFrame: 1316 },
    { ...clips[1], startFrame: 1317 }
  ]), { _IS_DODGE_: 1 }).commands
  assert.ok(commands.some(cmd => cmd.type === 'entryEffect' && cmd.effectId === 164063 && cmd.frame === 1317))
  assert.deepEqual(commands.filter(cmd => cmd.type === 'endPhase').map(cmd => cmd.frame), [2099])
})

test('work-ID texture calls, comments, strings, table keys and local names are preserved', () => {
  const source = `frame = 0; fx = entryEffect(frame, 1, 0x100, -1, 0, 0, 0)
setEffReplaceTexture(fx, 3, 6)
data = { fx = 'fx', text = [[endPhase(99)]] }
local fx = 7; assert(data.fx == 'fx' and fx == 7)
-- entryEffect(999, 42)
endPhase(10)`
  const commands = run(joinClips([{ name: 'scope', content: source, startFrame: 20, inFrame: 0, outFrame: 10 }]))
  assert.deepEqual(commands.effectTexRules.get(1), [{ slot: 3, kind: 6 }])
})

test('unknown frames fail clearly instead of silently leaving an unshifted call', () => {
  assert.throws(() => joinClips([{ name: 'unknown', content: 'fx = entryEffect(random_frame, 1)', startFrame: 30, inFrame: 0, outFrame: 100 }]), /unknown:1/)
})

test('numeric frames follow Lua scope and assignment order instead of flattening branches', () => {
  const source = `frame = 10
do frame = 20; local frame = 100; playVoice(frame, 1) end
if flag then local frame = 500; playVoice(frame, 2) else playVoice(frame, 3) end
playVoice(frame, 4)
frame = frame + 5
endPhase(frame)`
  assert.deepEqual(inspectScript(source).cues.map(cue => cue.frame), [100, 500, 20, 20, 25])
  assert.equal(inspectScript('for i=1,3 do playVoice(i * 10, 1) end').unmapped.length, 1)
})

test('runner reaches the second clip, applies separate audio scales and ends at 1231', () => {
  const bank = run(joinClips(clips))
  const sounds = []
  const voices = []
  const effects = []
  const stoppedVoices = []
  const runner = new ActionBankRunner({
    log() {},
    audio: {
      playCueNow(cue, options) { sounds.push({ cue, ...options }); return true },
      playVoiceNow(cue, options) { voices.push({ cue, ...options }); return true },
      setSeVolume() {}, setVoiceVolume() {}, stopWork() {}, silence() {},
      stopVoice(cue) { stoppedVoices.push(cue) }
    }
  })
  runner.commands = bank.commands
  runner.autoTimeScales = bank.autoTimeScales
  runner.prepare()
  runner.highSpeed = true
  runner.playing = true
  runner._entryEffect = cmd => effects.push([cmd.effectId, cmd.frame])
  for (const frame of [0, 448, 449, 1230]) {
    runner.frame = frame
    runner._fireAt(frame)
    assert.equal(runner.playing, true)
  }
  assert.deepEqual(effects, [[158990, 0], [158991, 370], [164063, 449]])
  assert.equal(sounds.find(sound => sound.cue === 1018 && sound.frame === 0).playbackRate, 0.8)
  assert.equal(sounds.find(sound => sound.cue === 1269 && sound.frame === 449).playbackRate, 0.9)
  assert.equal(voices.find(voice => voice.cue === 1063).frame, 649)
  assert.ok(stoppedVoices.includes(282))
  runner.frame = 1231
  runner._fireAt(1231)
  assert.equal(runner.playing, false)
  assert.equal(runner.maxFrame, 1231)
})

test('negative visual preroll seeks one LWF to the correct source position at 30/60 FPS', () => {
  const layer = Object.create(LwfLayer.prototype)
  let seek
  layer._seekPlayerToElapsed = (player, elapsed) => { seek = { player, elapsed } }
  const player = { startFrame: -100, lwf: { frameRate: 30 } }
  layer.seekPlayerToAbFrame(player, 0, 60)
  assert.equal(seek.player, player)
  assert.equal(seek.elapsed, 50)
})

test('voice cleanup stops the cue without stopping another active voice', () => {
  const audio = new AudioBus()
  let stopped = false
  const src = { stop() { stopped = true }, disconnect() {} }
  audio.voices.set('v:282', { src })
  audio.voices.set('v:1063', { src: {} })
  audio._sources.add(src)
  audio.stopVoice(282)
  assert.equal(stopped, true)
  assert.equal(audio.voices.has('v:282'), false)
  assert.equal(audio.voices.has('v:1063'), true)
  assert.equal(audio._sources.has(src), false)
})

test('custom formats export Entrance, Counter, Nullify and ut attacks to the correct folders', () => {
  const expected = { entrance: 'passive_skill_effect', attack_counter: 'attack_counter', ab_sys: 'ab_sys', active_ultimate: 'active_skill' }
  for (const [target, folder] of Object.entries(expected)) {
    assert.ok(CUSTOM_LUA_FORMATS.some(format => format.id === target))
    const result = prepareCustomLua('endPhase(100)', { target, filename: 'custom_animation' })
    assert.equal(result.folder, folder)
    assert.equal(result.filename, target === 'active_ultimate' ? 'ut_custom_animation' : 'custom_animation')
  }
})

test('Entrance comments all damage calls without breaking branches, assignments or strings', () => {
  const source = `text = 'dealDamage(999)'
if _IS_PLAYER_SIDE_ == 1 then dealDamage(30); setDamage(30, 1); end
result = dealDamage(40)
_G.dealDamage(50)
dealDamage(
  #"]=]"
)
endPhase(100)`
  const result = prepareCustomLua(source, { target: 'entrance', filename: 'entrance', damageEnabled: true, damageFrame: 60 })
  assert.equal(inspectScript(result.content).error, undefined)
  assert.equal(run(result.content).commands.filter(cmd => ['dealDamage', 'setDamage'].includes(cmd.type)).length, 0)
  assert.match(result.content, /Entrance: damage disabled/)
  assert.ok(result.content.includes("text = 'dealDamage(999)'"))
  assert.equal(run(prepareCustomLua(fusion, { target: 'entrance', filename: 'fusion' }).content).commands.some(cmd => cmd.type === 'dealDamage'), false)
})

test('remove dealDamage comments source damage calls for every format without queuing damage', () => {
  const source = 'dealDamage(20); if _IS_PLAYER_SIDE_ == 1 then dealDamage(30) end; setDamage(40, 1); endPhase(100)'
  for (const target of ['attack_sp', 'attack_counter', 'finish_skill']) {
    const result = prepareCustomLua(source, { target, filename: 'custom', removeDamageEnabled: true, damageEnabled: true, damageFrame: 67 })
    assert.equal(run(result.content).commands.some(cmd => cmd.type === 'dealDamage'), false)
    assert.deepEqual(run(result.content).commands.filter(cmd => cmd.type === 'setDamage').map(cmd => cmd.frame), [40])
    assert.match(result.content, /Custom damage: disabled/)
  }
})

test('Super, Finish and Active ut replace old damage with exactly one chosen frame', () => {
  const source = 'dealDamage(20); if _IS_PLAYER_SIDE_ == 1 then dealDamage(30) end; endPhase(100)'
  for (const [target, filename] of [['attack_sp', 'custom'], ['finish_skill', 'custom'], ['active_ultimate', 'custom'], ['active_skill', 'ut0024.lua']]) {
    assert.equal(canPlaceCustomDamage(target, filename), true)
    const result = prepareCustomLua(source, { target, filename, damageEnabled: true, damageFrame: 67 })
    assert.deepEqual(run(result.content).commands.filter(cmd => cmd.type === 'dealDamage').map(cmd => cmd.frame), [67])
  }
})

test('the custom damage checkbox has no effect on Counter, Nullify, non-ut Active or cutscene formats', () => {
  for (const target of ['attack_counter', 'ab_sys', 'active_skill', 'passive_skill_effect', 'standby_skill', 'revival', 'preview_fx']) {
    assert.equal(canPlaceCustomDamage(target, 'bs0001.lua'), false)
    const source = 'dealDamage(20); endPhase(100)'
    const result = prepareCustomLua(source, { target, filename: 'bs0001.lua', damageEnabled: true, damageFrame: 67 })
    assert.equal(result.content, source)
    assert.deepEqual(run(result.content).commands.filter(cmd => cmd.type === 'dealDamage').map(cmd => cmd.frame), [20])
  }
})

test('custom damage validates its frame and fires before endPhase at the same frame', () => {
  const source = 'dealDamage(20); endPhase(100)'
  for (const frame of [-1, 0.5, 101, NaN, '', null]) {
    assert.throws(() => prepareCustomLua(source, { target: 'attack_sp', filename: 'custom', damageEnabled: true, damageFrame: frame }), /Frame damage/)
  }
  const commands = run(prepareCustomLua(source, { target: 'attack_sp', filename: 'custom', damageEnabled: true, damageFrame: 100 }).content).commands
  assert.deepEqual(commands.map(cmd => [cmd.type, cmd.frame]), [['dealDamage', 100], ['endPhase', 100]])
  const merged = prepareCustomLua(joinClips(clips), { target: 'finish_skill', filename: 'custom', damageEnabled: true, damageFrame: 649 })
  assert.deepEqual(run(merged.content).commands.filter(cmd => cmd.type === 'dealDamage').map(cmd => cmd.frame), [649])
})
