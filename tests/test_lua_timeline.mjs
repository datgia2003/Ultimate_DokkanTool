import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { inspectScript, joinClips, updateTimelineClip, removeTimelineClip, prepareCustomLua, CUSTOM_LUA_FORMATS, canPlaceCustomDamage } from '../web-ui/src/components/tabs/luaTimeline.js'
import { createLuaHost } from '../components/lua_player/js/lua-host.js'
import { installBinders } from '../components/lua_player/js/binders.js'
import { ActionBankRunner } from '../components/lua_player/js/runner.js'
import { LwfLayer } from '../components/lua_player/js/lwf-player.js'
import { AudioBus } from '../components/lua_player/js/audio-bus.js'
import { UsmLayer } from '../components/lua_player/js/usm-player.js'

const require = createRequire(import.meta.url)
globalThis.window = {}
globalThis.fengari = require('../components/lua_player/vendor/fengari-web.min.js')
globalThis.document = { hidden: false, addEventListener() {}, removeEventListener() {} }
const fixture = name => readFileSync(new URL(`./fixtures/lua_timeline/${name}.lua`, import.meta.url), 'utf8')
const fusion = fixture('fusion')
const golden = fixture('golden_power')
const nullifyGoku = fixture('nullify_goku')
const activeGoku = fixture('active_goku')

test('waiting and retired movie clocks stay fixed while only the active clip advances', () => {
  const layer = Object.create(UsmLayer.prototype)
  layer._playbackRate = 1
  layer._applyClipPlayState = () => {}
  layer._correctDrift = () => {}
  const waiting = { video: { duration: 11 }, masterTime: 6.2, _timelineInactive: true }
  const active = { video: { duration: 8 }, masterTime: 0 }
  layer.clips = [active, waiting]
  for (let i = 0; i < 353; i++) layer.syncMasterTimer(1 / 60)
  assert.equal(waiting.masterTime, 6.2)
  assert.ok(Math.abs(active.masterTime - 353 / 60) < 1e-9)
  active._timelineInactive = true
  waiting._timelineInactive = false
  for (let i = 0; i < 60; i++) layer.syncMasterTimer(1 / 60)
  assert.ok(Math.abs(waiting.masterTime - 7.2) < 1e-9)
  assert.ok(Math.abs(active.masterTime - 353 / 60) < 1e-9)
  active._abPaused = true
  assert.equal(layer.isIntentionallyPaused(), false)
  waiting._timelineInactive = true
  assert.equal(layer.hasActiveClips(), false)
})

test('the reported Goku merge offsets the USM image and voice to the same source IN', () => {
  const bank = run(joinClips([
    { name: 'Nullify', content: nullifyGoku, startFrame: 0, inFrame: 0, outFrame: 352 },
    { name: 'Active', content: activeGoku, startFrame: 353, inFrame: 372, outFrame: 656 }
  ]))
  const runner = new ActionBankRunner({ log() {} })
  runner.commands = bank.commands
  runner.prepare()
  const movie = runner.commands.find(c => c.type === 'setupMovie' && c.contentId === 3315)
  assert.deepEqual([movie.frame, movie.movieFrame, movie.timelineEnd], [353, 372, 638])
  const effect = runner.commands.find(c => c.type === 'entryEffect' && c.effectId === 3315)
  assert.deepEqual([effect.frame, effect.sourceStart], [353, -19])
  assert.equal(runner.commands.find(c => c.type === 'playVoice' && c.cueId === 1238).frame, 419)
  assert.ok(runner.commands.some(c => c.type === 'stopTimelineMovie' && c.frame === 353))
})

test('each occurrence of the same USM starts with its own source offset', async () => {
  const runner = new ActionBankRunner({ log() {} })
  runner.commands = [
    { type: 'setupMovie', contentId: 3315, frame: 0, movieFrame: 100, timelineStart: 0, timelineEnd: 101 },
    { type: 'setupMovie', contentId: 3315, frame: 101, movieFrame: 372, timelineStart: 101, timelineEnd: 202 }
  ]
  const starts = []
  runner._setupMovie = async cmd => { starts.push([cmd.frame, cmd.movieFrame]) }
  runner._maybeStartMovieForEffect(3315, 0)
  await Promise.resolve()
  runner._maybeStartMovieForEffect(3315, 101)
  await Promise.resolve()
  assert.deepEqual(starts, [[0, 100], [101, 372]])
})

test('a prepared movie switches at the boundary without opening or seeking a decoder', async () => {
  const clip = { video: {}, preparedAtFrame: 353 }
  const committed = []
  const runner = new ActionBankRunner({ log() {}, usm: {
    updateTimelineFrame() {}, commitTimelineClip(c) { committed.push(c) }, setAbPause() {}, setSyncPause() {},
    playFromAssetRel() { assert.fail('decoder opened during the cut') },
    seekToAbFrame() { assert.fail('decoder sought during the cut') }
  } })
  runner._timelineMoviesPrepared.set('3315@353', clip)
  await runner._setupMovie({ contentId: 3315, frame: 353, timelineStart: 353, movieFrame: 372 })
  assert.deepEqual(committed, [clip])
})

test('an outgoing video stays visible until the incoming IN frame is painted', () => {
  const layer = Object.create(UsmLayer.prototype)
  const old = { timelineStart: 4, timelineEnd: 353, preparedAtFrame: 4, visible: true, video: { paused: true, pause() {} }, wrap: { style: { visibility: 'visible' } } }
  const next = { timelineStart: 353, timelineEnd: 638, preparedAtFrame: 353, visible: false, video: { paused: true, pause() {} }, wrap: { style: { visibility: 'hidden' } }, _lastOk: false }
  layer.clips = [old, next]
  layer.updateTimelineFrame(353)
  assert.equal(old.wrap.style.visibility, 'visible')
  assert.throws(() => layer.commitTimelineClip(next), /not been rendered/)
  assert.equal(old.wrap.style.visibility, 'visible')
  next._lastOk = true
  layer.commitTimelineClip(next)
  assert.equal(next.wrap.style.visibility, 'visible')
  assert.equal(old.wrap.style.visibility, 'hidden')
  assert.equal(layer.clips.length, 2)
})

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

test('editing IN and OUT shifts all following clips, and removing a clip closes the gap', () => {
  const original = Array.from({ length: 4 }, (_, i) => ({ id: String(i), startFrame: i * 101, inFrame: 0, outFrame: 100 }))
  const first = updateTimelineClip(original, '0', { outFrame: 49 })
  assert.deepEqual(first.map(c => c.startFrame), [0, 50, 151, 252])
  const second = updateTimelineClip(first, '1', { inFrame: 60 })
  assert.deepEqual(second.map(c => c.startFrame), [0, 50, 91, 192])
  assert.deepEqual(removeTimelineClip(second, '1').map(c => c.startFrame), [0, 50, 151])
})

test('four cuts of the same source preserve separate work IDs and bounded effects and fades', () => {
  const content = `fx = entryEffect(0, 164063, 0x80, -1, 0, 0, 0)
setEffAlphaKey(0, fx, 255)
entryFadeBg(0, 0, 800, 0, 0, 0, 0, 255)
playVoice(170, 1063)
removeAllEffect(50)
endPhase(800)`
  const cuts = Array.from({ length: 4 }, (_, i) => ({ name: `cut-${i}`, content, startFrame: i * 101, inFrame: i * 100, outFrame: i * 100 + 100 }))
  const bank = run(joinClips(cuts))
  const runner = new ActionBankRunner({ log() {} })
  runner.commands = bank.commands
  runner.prepare()
  const effects = runner.commands.filter(c => c.type === 'entryEffect')
  assert.deepEqual(effects.map(c => c.frame), [0, 101, 202, 303])
  assert.deepEqual(effects.map(c => c.sourceStart), [0, 1, 2, 3])
  assert.equal(new Set(effects.map(c => c.workId)).size, 4)
  assert.deepEqual(runner.commands.filter(c => c.type === 'endPhase').map(c => c.frame), [403])
  assert.deepEqual(runner.commands.filter(c => c.type === 'entryFadeBg').map(c => [c.frame, c.hold]), [[0, 101], [101, 101], [202, 101], [303, 101]])
  assert.equal(runner.commands.some(c => c.type === 'removeAllEffect'), false)
  assert.deepEqual(runner.commands.filter(c => c.type === 'setEffAlphaKey' && c.frame === 50 && c.a === 0).map(c => c.workId), [effects[0].workId])
  assert.deepEqual(runner.commands.filter(c => c.type === 'removeAllFadeBg').map(c => c.frame), [101, 202, 303])
})

test('four trimmed Fusion clips compile and queue each cut at its own IN boundary', () => {
  const cuts = Array.from({ length: 4 }, (_, i) => ({ name: `Fusion-${i}`, content: fusion, startFrame: i * 150, inFrame: i * 150, outFrame: i * 150 + 149 }))
  const bank = run(joinClips(cuts))
  const runner = new ActionBankRunner({ log() {} })
  runner.commands = bank.commands
  runner.prepare()
  for (const start of [0, 150, 300, 450]) {
    assert.ok(runner.commands.some(c => c.type === 'entryEffect' && c.frame === start && c.timelineStart === start))
  }
  assert.equal(runner.maxFrame, 599)
})

test('cropped nested LWF movies execute to IN even when the outer movie has one frame', () => {
  const layer = Object.create(LwfLayer.prototype)
  let nestedFrame = 0
  const movie = { totalFrames: 1, currentFrame: 1, gotoAndStop() {}, gotoAndPlay() { nestedFrame = 0 } }
  const player = { timelineStart: 101, startFrame: 1, movie, lwf: {
    frameRate: 30, rootMovie: movie, forceExecWithoutProgress() {}, exec() { nestedFrame++ }, render() {}
  } }
  layer.seekPlayerToAbFrame(player, 101, 60)
  assert.equal(nestedFrame, 50)
  assert.equal(player._holdingEnd, false)
})

test('scrubbing shows only the clip containing the selected frame and uses native LWF FPS', () => {
  const layer = Object.create(LwfLayer.prototype)
  const positions = []
  layer._seekPlayerToElapsed = (p, frame) => positions.push([p.timelineStart, frame])
  layer.activatePlayer = p => { p.dormant = false }
  layer._softRetire = p => { p.dormant = true }
  layer.players = [0, 101, 202].map(start => ({ timelineStart: start, timelineEnd: start + 101, startFrame: start - 100, dormant: true, lwf: { frameRate: 30 } }))
  layer.seekToAbFrame(151, { frameStepsPerAb: 2 })
  assert.deepEqual(positions, [[101, 75]])
})

test('a later clip seeks its effect to source IN and retires exactly after OUT', () => {
  let seek
  const layer = Object.create(LwfLayer.prototype)
  layer.activatePlayer = () => {}
  layer.seekPlayerToAbFrame = (p, frame) => { seek = [p.startFrame, frame] }
  const runner = new ActionBankRunner({ log() {}, lwf: layer })
  runner._maybeStartMovieForEffect = () => {}
  runner.frame = 101
  const player = { lwf: {}, timelineStart: 101, timelineEnd: 202 }
  runner._activatePreparedEffect({ workId: 1, effectId: 164063, frame: 101, sourceStart: 1, life: -1 }, { player })
  assert.deepEqual(seek, [1, 101])
  seek = null
  player.timelinePrimedFrame = 101
  let preserved = false
  layer.activatePlayer = (p, options) => { preserved = options.preserveFrame }
  runner._activatePreparedEffect({ workId: 1, effectId: 164063, frame: 101, sourceStart: 1, life: -1 }, { player })
  assert.equal(preserved, true)
  assert.equal(seek, null)
  layer.players = [player]
  let retired = false
  layer._softRetire = () => { retired = true }
  layer.tickEffects(0, 202, 1 / 60)
  assert.equal(retired, true)
})

test('a fade ending before IN is dropped rather than replayed over the joined clip', () => {
  const source = 'entryFade(10, 2, 5, 2, 255, 255, 255, 255); endPhase(200)'
  const bank = run(joinClips([{ name: 'cut', content: source, startFrame: 101, inFrame: 100, outFrame: 200 }]))
  assert.equal(bank.commands.some(c => c.type === 'entryFade'), false)
})

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
