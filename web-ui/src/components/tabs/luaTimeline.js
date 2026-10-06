import luaparse from 'luaparse'

// Only APIs whose first argument is a frame. Texture and sound metadata APIs
// use work IDs instead; changing those IDs breaks the effect/audio association.
const TIMED_CALLS = new Set([
  'setDisp', 'changeAnime', 'changeAnimeAndStop', 'changeAnimeBySide', 'setAnimeLoop',
  'setMoveKey', 'setScaleKey', 'setRotateKey', 'setAlphaKey', 'setBlendColor', 'setDrawFront',
  'setEnableAura', 'setBgGaussBlurKey', 'setBgScroll', 'setEffAlphaKey', 'setEffColorKey',
  'setEffMoveKey', 'setEffRotateKey', 'setEffScaleKey', 'setEffShake', 'setLastPosKey',
  'setEffBlendColor', 'setEnableAutoXFlip', 'removeAllEffect', 'entryEffectAwaken', 'entryEffectTraining',
  'setQuake', 'setShake', 'setShakeChara', 'setSeVolume', 'setSeVolumeByWorkId', 'setVoiceVolume',
  'setZanzou', 'setZanzouColor', 'setZanzouSpeed', 'setDamage', 'entryCharaView', 'setGaussBlurKey',
  'endPhase', 'entryFade', 'entryFadeBg', 'entryEffect', 'entryEffectLife', 'entryEffectUnpausable',
  'playSe', 'playSeLife', 'playSeVer2', 'stopSe', 'stopSeQueueId', 'stopSeIfDoubleSpeed',
  'playVoice', 'stopVoice', 'pauseMovie', 'stopMovie', 'setupMovie', 'gotoPhase', 'pauseAll',
  'delayAll', 'pauseChara', 'delayChara', 'dealDamage', 'recover', 'setVisibleUI',
  'adjustAttackerLabel', 'adjustEnemyLabel', 'fadeKoLabel', 'entryKakimoji', 'entryFlash',
  'entryFlashBg', 'removeAllFade', 'removeAllFadeBg', 'wipeIn', 'wipeOut', 'wipeInOut',
  'changeBgm', 'setEnvZoomEnable', 'setBgMoveKey', 'setBgScaleKey', 'setBgRotateKey',
  'setBgBlendColor', 'setScreenOffset', 'setShakeXY', 'setShakeKey', 'startBgScroll',
  'stopBgScroll', 'visibleMovie', 'scaleMovie', 'setBandpassFilter'
])
const EFFECT_ENTRIES = new Set(['entryEffect', 'entryEffectLife', 'entryEffectUnpausable', 'entryEffectAwaken', 'entryEffectTraining'])
const SOUND_ENTRIES = new Set(['playSe', 'playSeLife', 'playSeVer2'])
const AUDIO_CALLS = new Set([...SOUND_ENTRIES, 'playVoice', 'stopVoice', 'stopSe', 'stopSeQueueId',
  'stopSeIfDoubleSpeed', 'setSeVolume', 'setSeVolumeByWorkId', 'setVoiceVolume', 'setPitch', 'setBandpassFilter'])
const WORK_METADATA = new Set(['setStartTimeMs', 'setTimeStretch', 'setEffReplaceTexture',
  'setEffReplaceTextureByCardId', 'setEffReplaceTextureByFilename'])
const SHARED_GLOBALS = new Set(['fcolor_r', 'fcolor_g', 'fcolor_b', 'multi_frm', 'OFFSET_X', 'OFFSET_Y'])

function parse(content) {
  return luaparse.parse(content, { ranges: true, locations: true, scope: true, luaVersion: '5.3' })
}

function walk(node, visit, parent = null) {
  if (!node || typeof node !== 'object') return
  if (node.type) visit(node, parent)
  for (const [key, value] of Object.entries(node)) {
    if (key === 'globals' || key === 'comments' || key === 'loc' || key === 'range') continue
    if (Array.isArray(value)) value.forEach(child => walk(child, visit, node))
    else if (value?.type) walk(value, visit, node)
  }
}

function numberValue(node, values) {
  if (!node) return null
  if (node.type === 'NumericLiteral') return node.value
  if (node.type === 'Identifier') return values.get(node.name, node.isLocal) ?? null
  if (node.type === 'UnaryExpression' && node.operator === '-') {
    const value = numberValue(node.argument, values)
    return value == null ? null : -value
  }
  if (node.type === 'BinaryExpression') {
    const left = numberValue(node.left, values)
    const right = numberValue(node.right, values)
    if (left == null || right == null) return null
    const operators = {
      '+': () => left + right, '-': () => left - right, '*': () => left * right,
      '/': () => left / right, '//': () => Math.floor(left / right),
      '%': () => left - Math.floor(left / right) * right, '^': () => left ** right
    }
    const result = operators[node.operator]?.()
    return Number.isFinite(result) ? result : null
  }
  return null
}

function callName(node) {
  // Host APIs are globals. A same-named local function or table method is not
  // a Dokkan command and must retain its original arguments.
  return node?.type === 'CallExpression' && node.base.type === 'Identifier' && !node.base.isLocal
    ? node.base.name : null
}

function frameValues(globals = new Map(), scopes = [new Map()]) {
  return {
    globals, scopes,
    get(name, local) {
      if (!local) return globals.get(name)
      return scopes.findLast(scope => scope.has(name))?.get(name)
    },
    assign(variable, value, declaration = false) {
      const scope = declaration ? scopes.at(-1)
        : variable.isLocal ? scopes.findLast(scope => scope.has(variable.name)) : globals
      scope?.set(variable.name, value)
    }
  }
}

function forkValues(values, scope = false) {
  const scopes = values.scopes.map(item => new Map(item))
  if (scope) scopes.push(new Map())
  return frameValues(new Map(values.globals), scopes)
}

function analyze(content) {
  const ast = parse(content)
  const calls = []
  const expression = (node, values) => {
    if (!node) return
    if (node.type === 'FunctionDeclaration') {
      const nested = forkValues(values, true)
      // A function runs later; globals at its declaration are not necessarily
      // the globals at its invocation. Literal/local constants remain usable.
      nested.globals.clear()
      node.parameters.forEach(parameter => { if (parameter.name) nested.assign(parameter, null, true) })
      block(node.body, nested)
      return
    }
    if (node.type === 'CallExpression') {
      node.arguments.forEach(argument => expression(argument, values))
      const name = callName(node)
      if (name) calls.push({ node, name, frame: numberValue(node.arguments[0], values), values: forkValues(values) })
      return
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) value.forEach(child => { if (child?.type) expression(child, values) })
      else if (value?.type) expression(value, values)
    }
  }
  const block = (body, values) => {
    for (const statement of body) {
      if (statement.type === 'AssignmentStatement' || statement.type === 'LocalStatement') {
        statement.init.forEach(node => expression(node, values))
        const assigned = statement.init.map(node => numberValue(node, values))
        statement.variables.forEach((variable, index) => {
          if (variable.type === 'Identifier') values.assign(variable, assigned[index] ?? null, statement.type === 'LocalStatement')
        })
      } else if (statement.type === 'IfStatement') {
        const branches = statement.clauses.map(clause => {
          expression(clause.condition, values)
          const branch = forkValues(values, true)
          block(clause.body, branch)
          return branch
        })
        if (!statement.clauses.some(clause => clause.type === 'ElseClause')) branches.push(forkValues(values, true))
        const merge = (target, alternatives) => {
          const names = new Set(alternatives.flatMap(item => [...item.keys()]))
          for (const name of names) {
            const first = alternatives[0].get(name)
            target.set(name, alternatives.every(item => item.get(name) === first) ? first ?? null : null)
          }
        }
        merge(values.globals, branches.map(branch => branch.globals))
        values.scopes.forEach((scope, index) => merge(scope, branches.map(branch => branch.scopes[index])))
      } else if (statement.type === 'DoStatement') {
        // A do block introduces locals; assignments to an outer local/global
        // still update that binding, as they do in the Lua interpreter.
        block(statement.body, frameValues(values.globals, [...values.scopes, new Map()]))
      } else if (statement.type === 'FunctionDeclaration') {
        expression(statement, values)
      } else if (statement.body) {
        const nested = forkValues(values, true)
        if (statement.variable) nested.assign(statement.variable, null, true)
        statement.variables?.forEach(variable => nested.assign(variable, null, true))
        const firstCall = calls.length
        block(statement.body, nested)
        // Repeated bodies cannot be flattened to one evaluated set of frames.
        // Keep them explicitly unresolved rather than producing wrong timing.
        calls.slice(firstCall).forEach(call => { if (isTimed(call)) call.frame = null })
        walk(statement, node => {
          if (node.type === 'AssignmentStatement') node.variables.forEach(variable => {
            if (variable.type === 'Identifier') values.assign(variable, null)
          })
        })
      } else {
        expression(statement.expression, values)
        statement.arguments?.forEach(node => expression(node, values))
      }
    }
  }
  block(ast.body, frameValues())
  return { ast, calls }
}

function isTimed(call) {
  return TIMED_CALLS.has(call.name) || (call.name === 'setPitch' && call.node.arguments.length >= 3)
}

export function inspectScript(content) {
  const source = String(content || '')
  const lines = source.split(/\r?\n/)
  const cues = []
  const unmapped = []
  try {
    const analysis = analyze(source)
    for (const call of analysis.calls.filter(isTimed)) {
      const cue = { ...call, lineIndex: call.node.loc.start.line - 1, text: source.slice(...call.node.range) }
      if (call.frame == null) unmapped.push(cue)
      else cues.push(cue)
    }
    return { lines, cues, unmapped, analysis, maxFrame: Math.max(1, ...cues.map(cue => cue.frame)) }
  } catch (error) {
    return { lines, cues, unmapped, maxFrame: 1, error: error.message }
  }
}

function replaceRanges(source, edits) {
  let result = source
  for (const edit of edits.sort((a, b) => b.start - a.start)) {
    result = result.slice(0, edit.start) + edit.text + result.slice(edit.end)
  }
  return result
}

function namespaceGlobals(source, clipIndex) {
  const ast = parse(source)
  const globals = new Set()
  const add = node => {
    if (node?.type === 'Identifier' && node.isLocal === false && !SHARED_GLOBALS.has(node.name) && !node.name.startsWith('_IS_')) globals.add(node.name)
  }
  walk(ast, node => {
    if (node.type === 'AssignmentStatement') node.variables.forEach(add)
    if (node.type === 'FunctionDeclaration' && !node.isLocal) add(node.identifier)
  })
  const edits = []
  walk(ast, node => {
    if (node.type === 'Identifier' && node.isLocal === false && globals.has(node.name)) {
      edits.push({ start: node.range[0], end: node.range[1], text: `__lua_clip_${clipIndex}_${node.name}` })
    }
  })
  return replaceRanges(source, edits)
}

export function updateTimelineClip(clips, id, changes) {
  const old = clips.find(clip => clip.id === id)
  if (!old) return clips
  const updated = { ...old, ...changes }
  const oldEnd = old.startFrame + old.outFrame - old.inFrame + 1
  const newEnd = updated.startFrame + updated.outFrame - updated.inFrame + 1
  const shift = newEnd - oldEnd
  return clips.map(clip => clip.id === id ? updated
    : clip.startFrame >= oldEnd ? { ...clip, startFrame: clip.startFrame + shift } : clip)
}

export function removeTimelineClip(clips, id) {
  const removed = clips.find(clip => clip.id === id)
  if (!removed) return clips
  const duration = removed.outFrame - removed.inFrame + 1
  const end = removed.startFrame + duration
  return clips.filter(clip => clip.id !== id).map(clip => clip.startFrame >= end
    ? { ...clip, startFrame: clip.startFrame - duration } : clip)
}

export function joinClips(clips) {
  const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame)
  if (!ordered.length) return ''
  const sections = ordered.map((clip, index) => {
    const info = inspectScript(clip.content)
    if (info.error) throw new Error(`${clip.name}: ${info.error}`)
    if (info.unmapped.length) {
      const cue = info.unmapped[0]
      throw new Error(`${clip.name}:${cue.lineIndex + 1}: không xác định được frame của ${cue.name}.`)
    }
    const offset = clip.startFrame - clip.inFrame
    const last = clip.startFrame + clip.outFrame - clip.inFrame
    const boundary = last + 1
    const edits = []
    const source = String(clip.content)
    for (const call of info.analysis.calls) {
      const { node, name, frame, values } = call
      const args = node.arguments.map(argument => source.slice(...argument.range))
      let replacement = null
      if (name === 'setPhase' || name === 'gotoPhase') {
        // Each source queues commands in its own battle phase (Nullify uses
        // phase 9). A merged animation must queue every clip in one phase.
        replacement = '__tl_drop()'
      } else if (isTimed(call)) {
        // Discard calls, not whole lines: calls may return a work ID in an
        // assignment, span lines, or share a line with another statement.
        if (name === 'endPhase' || frame > clip.outFrame || (frame < clip.inFrame && AUDIO_CALLS.has(name))) {
          replacement = '__tl_drop()'
        } else {
          args[0] = String(Math.max(clip.startFrame, Math.round(frame + offset)))
          if (name === 'playSeVer2') {
            const stop = numberValue(node.arguments[3], values)
            if (stop == null) throw new Error(`${clip.name}:${node.loc.start.line}: không xác định được end frame của playSeVer2.`)
            args[3] = String(stop > 0 ? Math.min(boundary, Math.round(stop + offset)) : boundary)
          }
          if (name === 'setupMovie') {
            const movieFrame = numberValue(node.arguments[2], values) ?? 0
            args[2] = String(movieFrame + Math.max(0, clip.inFrame - frame))
            replacement = `__tl_movie(${name}, ${args.join(', ')})`
          }
          if (name === 'entryEffectLife' || name === 'playSeLife') {
            const life = numberValue(node.arguments[2], values)
            if (life == null) throw new Error(`${clip.name}:${node.loc.start.line}: không xác định được life của ${name}.`)
            if (life > 0) args[2] = String(Math.min(life, clip.outFrame - frame + 1))
            if (life > 0 && frame + life <= clip.inFrame) replacement = '__tl_drop()'
          }
          if (name === 'entryFade' || name === 'entryFadeBg') {
            let skipped = Math.max(0, clip.inFrame - frame)
            let remaining = boundary - Number(args[0])
            for (let part = 1; part <= 3; part++) {
              const length = numberValue(node.arguments[part], values)
              if (length == null) throw new Error(`${clip.name}:${node.loc.start.line}: không xác định được thời lượng fade.`)
              const consumed = Math.min(skipped, Math.max(0, length))
              skipped -= consumed
              const trimmed = Math.min(remaining, Math.max(0, length - consumed))
              args[part] = String(trimmed)
              remaining -= trimmed
            }
            if (frame < clip.inFrame && args.slice(1, 4).every(value => Number(value) === 0)) replacement = '__tl_drop()'
          }
          if (!replacement && EFFECT_ENTRIES.has(name)) {
            // Preserve the effect's original start so the LWF can advance to
            // IN. Its alpha is gated until this clip actually becomes visible.
            args[0] = String(Math.round(frame + offset))
            replacement = `__tl_effect(${name}, ${args.join(', ')})`
          } else if (!replacement && name === 'removeAllEffect') {
            replacement = `__tl_remove_effects(${args[0]})`
          } else if (!replacement && SOUND_ENTRIES.has(name)) {
            replacement = `__tl_sound(${name}, ${args.join(', ')})`
          } else if (!replacement && name === 'playVoice') {
            replacement = `__tl_voice(${name}, ${args.join(', ')})`
          } else if (!replacement && (name.startsWith('setEff') || ['setSeVolume', 'setSeVolumeByWorkId', 'setPitch', 'setBandpassFilter'].includes(name))) {
            replacement = `__tl_timed_work(${name}, ${args.join(', ')})`
          }
          if (!replacement) replacement = `${name}(${args.join(', ')})`
        }
      } else if (WORK_METADATA.has(name) || (name === 'setPitch' && args.length === 2)) {
        replacement = `__tl_work(${name}, ${args.join(', ')})`
      } else if (name === 'skipFrame') {
        const target = numberValue(node.arguments[1], values)
        if (target == null) throw new Error(`${clip.name}:${node.loc.start.line}: không xác định được skipFrame.`)
        replacement = target < clip.inFrame || target > clip.outFrame
          ? '__tl_drop()' : `skipFrame(0, ${Math.round(target + offset)})`
      }
      if (replacement) edits.push({ start: node.range[0], end: node.range[1], text: replacement })
    }
    const body = namespaceGlobals(replaceRanges(source, edits), index + 1)
    const name = String(clip.name).replace(/[\r\n]/g, ' ')
    return `-- ===== ${name} · timeline start ${clip.startFrame}f · source frames ${clip.inFrame}-${clip.outFrame} =====
do
  local __tl_effects, __tl_sounds, __tl_voices = {}, {}, {}
  local __tl_alphas = {}
  local function __tl_drop() return nil end
  local function __tl_effect(fn, frame, ...)
    local id = fn(frame, ...)
    __tl_effects[#__tl_effects + 1] = id
    if setTimelineEffectWindow then setTimelineEffectWindow(id, ${clip.startFrame}, ${boundary}, frame) end
    if frame < ${clip.startFrame} then
      setEffAlphaKey(frame, id, 0)
      setEffAlphaKey(${clip.startFrame}, id, 255)
    end
    return id
  end
  local function __tl_sound(fn, ...)
    local id = fn(...)
    __tl_sounds[#__tl_sounds + 1] = id
    return id
  end
  local __tl_has_movie = false
  local function __tl_movie(fn, frame, content, movieFrame, ...)
    __tl_has_movie = true
    local result = fn(frame, content, movieFrame, ...)
    if setTimelineMovieWindow then setTimelineMovieWindow(content, frame, ${boundary}) end
    return result
  end
  local function __tl_voice(fn, frame, cue, ...)
    __tl_voices[cue] = true
    return fn(frame, cue, ...)
  end
  local function __tl_work(fn, id, ...)
    if id ~= nil then return fn(id, ...) end
    return 0
  end
  local function __tl_timed_work(fn, frame, id, ...)
    if id ~= nil then
      if fn == setEffAlphaKey then
        local alpha = ...
        if __tl_alphas[id] == nil or frame >= __tl_alphas[id].frame then
          __tl_alphas[id] = { frame = frame, value = alpha }
        end
      end
      return fn(frame, id, ...)
    end
    return 0
  end
  local function __tl_hide_effect(frame, id)
    local alpha = __tl_alphas[id]
    -- Alpha keys interpolate. Hold the last value until OUT, otherwise the
    -- cleanup key at the boundary makes the entire clip fade towards black.
    if frame > ${clip.startFrame} and (alpha == nil or alpha.frame < frame) then
      setEffAlphaKey(frame - 1, id, alpha and alpha.value or 255)
    end
    setEffAlphaKey(frame, id, 0)
    __tl_alphas[id] = { frame = frame, value = 0 }
  end
  local function __tl_remove_effects(frame)
    for _, id in ipairs(__tl_effects) do __tl_hide_effect(frame, id) end
  end
  if ENABLE_AUTO_TIME_STRETCH then ENABLE_AUTO_TIME_STRETCH(1) end
  local function __tl_run()
${body}
  end
  __tl_run()
  for _, id in ipairs(__tl_effects) do __tl_hide_effect(${boundary}, id) end
  for _, id in ipairs(__tl_sounds) do stopSe(${boundary}, id) end
  for cue in pairs(__tl_voices) do stopVoice(${boundary}, cue) end
  if __tl_has_movie then
    if stopTimelineMovie then stopTimelineMovie(${boundary}, ${clip.startFrame}) else stopMovie(${boundary}) end
  end
  removeAllFade(${boundary})
  removeAllFadeBg(${boundary})
end`
  })
  const endFrame = Math.max(...ordered.map(clip => clip.startFrame + clip.outFrame - clip.inFrame))
  return `-- All clips share one native battle phase.\nsetPhase(0);\n${sections.join('\n\n')}\n\n-- End the combined timeline once, after all clips.\nendPhase(${endFrame});\n`
}

export const CUSTOM_LUA_FORMATS = [
  { id: 'attack_sp', folder: 'attack_sp', en: 'Super Attack', vi: 'Siêu tấn công' },
  { id: 'active_skill', folder: 'active_skill', en: 'Active Skill / Transform', vi: 'Active Skill / Biến hình' },
  { id: 'active_ultimate', folder: 'active_skill', en: 'Active Skill Attack (ut.lua)', vi: 'Đòn Active Skill (ut.lua)' },
  { id: 'finish_skill', folder: 'finish_skill', en: 'Finish Skill', vi: 'Đòn kết liễu' },
  { id: 'entrance', folder: 'passive_skill_effect', en: 'Entrance', vi: 'Xuất trận (Entrance)' },
  { id: 'attack_counter', folder: 'attack_counter', en: 'Counter', vi: 'Phản đòn (Counter)' },
  { id: 'ab_sys', folder: 'ab_sys', en: 'Nullify / Absorb', vi: 'Vô hiệu / Hấp thụ (Nullify)' },
  { id: 'passive_skill_effect', folder: 'passive_skill_effect', en: 'Passive / Transform', vi: 'Passive / Biến hình' },
  { id: 'standby_skill', folder: 'standby_skill', en: 'Standby', vi: 'Standby' },
  { id: 'revival', folder: 'revival', en: 'Revival', vi: 'Hồi sinh' },
  { id: 'preview_fx', folder: 'preview_fx', en: 'Preview FX', vi: 'Preview FX' }
]

function customLuaStem(filename) {
  return String(filename || 'custom_animation').split(/[\\/]/).at(-1).replace(/\.lua$/i, '')
    .replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^[_-]+|[_-]+$/g, '').slice(0, 72) || 'custom_animation'
}

export function customLuaFilename(target, filename) {
  const stem = customLuaStem(filename)
  return target === 'active_ultimate' && !/^ut(?:\d|[_-]|$)/i.test(stem) ? `ut_${stem}`.slice(0, 72) : stem
}

export function canPlaceCustomDamage(target, filename) {
  return target === 'attack_sp' || target === 'finish_skill' || target === 'active_ultimate'
    || (target === 'active_skill' && /^ut(?:\d|[_-]|$)/i.test(customLuaStem(filename)))
}

function luaComment(text, reason) {
  let equals = '='
  while (`${reason}\n${text}`.includes(`]${equals}]`)) equals += '='
  return `--[${equals}[${reason}\n${text}\n]${equals}]`
}

function commentDamageCalls(content, names, reason) {
  const ast = parse(content)
  const edits = []
  walk(ast, (node, parent) => {
    let name = callName(node)
    if (node.type === 'CallExpression' && node.base.type === 'MemberExpression'
        && node.base.base.type === 'Identifier' && node.base.base.name === '_G' && !node.base.base.isLocal) {
      name = node.base.identifier.name
    }
    if (!names.has(name)) return
    const comment = luaComment(content.slice(...node.range), reason)
    // A call returning a value may occur in an assignment/return/expression.
    // Keep valid Lua by replacing that value with zero, retaining the comment.
    const text = parent?.type === 'CallStatement' ? comment : `0 ${comment}`
    if (!edits.some(edit => edit.start <= node.range[0] && edit.end >= node.range[1])) {
      edits.push({ start: node.range[0], end: node.range[1], text })
    }
  })
  return replaceRanges(content, edits)
}

export function prepareCustomLua(content, { target, filename, damageEnabled = false, damageFrame = 0, removeDamageEnabled = false }) {
  const format = CUSTOM_LUA_FORMATS.find(item => item.id === target)
  if (!format) throw new Error('Định dạng Lua không hợp lệ.')
  const outputFilename = customLuaFilename(target, filename)
  let output = String(content || '')
  if (!output.trim()) return { content: '', filename: outputFilename, folder: format.folder }
  // Export phase 9 only for Nullify/Absorb. Transfer into other slots must not
  // retain the source phase; the in-app player doesn't filter queues by phase.
  const phase = target === 'ab_sys' ? 9 : 0
  const phaseEdits = []
  walk(parse(output), node => {
    if (node.type === 'FunctionDeclaration' && node.identifier?.name === '__tl_drop') {
      const value = node.body[0]?.type === 'ReturnStatement' && node.body[0].arguments[0]
      if (value?.type === 'NumericLiteral' && value.value === 0) {
        phaseEdits.push({ start: value.range[0], end: value.range[1], text: 'nil' })
      }
    }
    if (node.type === 'FunctionDeclaration' && ['__tl_work', '__tl_timed_work'].includes(node.identifier?.name)) {
      const condition = node.body[0]?.type === 'IfStatement' && node.body[0].clauses[0]?.condition
      if (condition?.type === 'LogicalExpression' && condition.operator === 'and'
          && condition.right.type === 'BinaryExpression' && condition.right.operator === '~='
          && condition.right.left.name === 'id' && condition.right.right.value === 0) {
        phaseEdits.push({ start: condition.range[0], end: condition.range[1], text: 'id ~= nil' })
      }
    }
    const name = callName(node)
    const argument = name === 'setPhase' || name === 'skipFrame' ? node.arguments[0]
      : name === 'gotoPhase' ? node.arguments[1] : null
    if (argument) phaseEdits.push({ start: argument.range[0], end: argument.range[1], text: String(phase) })
  })
  output = replaceRanges(output, phaseEdits)
  if (target === 'entrance') {
    output = commentDamageCalls(output, new Set(['dealDamage', 'setDamage']), 'Entrance: damage disabled')
  } else if (removeDamageEnabled) {
    output = commentDamageCalls(output, new Set(['dealDamage']), 'Custom damage: disabled')
  } else if (damageEnabled && canPlaceCustomDamage(target, outputFilename)) {
    const frame = Number(damageFrame)
    if (damageFrame === '' || damageFrame == null || !Number.isSafeInteger(frame) || frame < 0) throw new Error('Frame damage phải là số nguyên từ 0 trở lên.')
    const info = inspectScript(output)
    if (info.error) throw new Error(info.error)
    const ends = info.cues.filter(cue => cue.name === 'endPhase').map(cue => cue.frame)
    const endFrame = ends.length ? Math.max(...ends) : info.maxFrame
    if (frame > endFrame) throw new Error(`Frame damage không được vượt quá frame kết thúc ${endFrame}.`)
    output = commentDamageCalls(output, new Set(['dealDamage']), 'Custom damage: original call disabled')
    // Lua builds the command queue before playback. Schedule this first so it
    // runs before an endPhase at the same frame, even if source Lua returns.
    output = `-- Custom damage frame\ndealDamage(${frame});\n\n${output}`
  }
  if (target === 'ab_sys') output = `-- Native phase for ${format.en}\nsetPhase(${phase});\n${output}`
  parse(output)
  return { content: output, filename: outputFilename, folder: format.folder }
}
