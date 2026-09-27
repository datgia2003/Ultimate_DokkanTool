import React, { useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { Clapperboard, FileCode2, FolderPlus, Play, Pause, Scissors, Save, Trash2, Clock3, Radio, Search, Download, MonitorPlay } from 'lucide-react'
import { AnimationChoice } from '../common/AnimationChoice'
import { AnimationSearchFilter, AnimationRarityFilter, AnimationPagination } from '../common/AnimationBrowserControls'

const TIMED_CALLS = new Set([
  'setDisp', 'changeAnime', 'changeAnimeAndStop', 'changeAnimeBySide', 'setAnimeLoop', 'setMoveKey', 'setScaleKey', 'setRotateKey', 'setAlphaKey', 'setBlendColor', 'setDrawFront', 'setEnableAura', 'setBgGaussBlurKey', 'setBgScroll',
  'setEffAlphaKey', 'setEffColorKey', 'setEffMoveKey', 'setEffRotateKey', 'setEffScaleKey', 'setEffReplaceTexture', 'setEffShake', 'setLastPosKey',
  'setEffBlendColor', 'setEffReplaceTextureByCardId', 'setEffReplaceTextureByFilename', 'setEnableAutoXFlip', 'removeAllEffect', 'entryEffectAwaken', 'entryEffectTraining',
  'setQuake', 'setShake', 'setShakeChara', 'setSeVolume', 'setSeVolumeByWorkId', 'setVoiceVolume', 'setZanzou', 'setZanzouColor', 'setZanzouSpeed', 'setDamage', 'entryCharaView',
  'setGaussBlurKey', 'endPhase', 'entryFade', 'entryFadeBg',
  'entryEffect', 'entryEffectLife', 'entryEffectUnpausable', 'playSe', 'playSeLife', 'playSeVer2', 'stopSe', 'stopSeQueueId', 'stopSeIfDoubleSpeed', 'playVoice', 'pauseMovie', 'setupMovie',
  'gotoPhase', 'pauseAll', 'delayAll', 'pauseChara', 'delayChara',
  'setVisibleUI', 'adjustAttackerLabel', 'adjustEnemyLabel', 'fadeKoLabel', 'entryKakimoji', 'entryFlash', 'entryFlashBg', 'removeAllFade', 'removeAllFadeBg', 'wipeIn', 'wipeOut', 'wipeInOut', 'changeBgm', 'setEnvZoomEnable',
  'setBgMoveKey', 'setBgScaleKey', 'setBgRotateKey', 'setBgBlendColor', 'setScreenOffset', 'setShakeXY', 'setShakeKey', 'startBgScroll', 'stopBgScroll', 'visibleMovie', 'scaleMovie', 'setBandpassFilter'
])
const SHARED_LUA_GLOBALS = new Set(['fcolor_r', 'fcolor_g', 'fcolor_b', 'multi_frm', 'OFFSET_X', 'OFFSET_Y', '_IS_PLAYER_SIDE_', '_IS_DEAD_', '_IS_DEAD_LAST_'])
const TARGETS = [
  ['active_skill', 'Active Skill', 'Kỹ năng chủ động'], ['attack_sp', 'Super Attack', 'Siêu tấn công'],
  ['passive_skill_effect', 'Passive / Transform', 'Passive / Biến hình'], ['standby_skill', 'Standby', 'Standby'],
  ['finish_skill', 'Finish', 'Đòn kết liễu'], ['revival', 'Revival', 'Hồi sinh'], ['preview_fx', 'Preview FX', 'Preview FX']
]

function evaluateFrameExpression(expression, variables) {
  const tokens = []
  const source = String(expression || '').trim()
  const tokenPattern = /\s*(\d+(?:\.\d+)?|[A-Za-z_]\w*|[()+*/-])/gy
  let position = 0
  while (position < source.length) {
    tokenPattern.lastIndex = position
    const match = tokenPattern.exec(source)
    if (!match) return null
    tokens.push(match[1])
    position = tokenPattern.lastIndex
  }
  let cursor = 0
  const primary = () => {
    const token = tokens[cursor++]
    if (token === '(') {
      const value = sum()
      if (tokens[cursor++] !== ')') throw new Error('unclosed expression')
      return value
    }
    if (token === '+' || token === '-') {
      const value = primary()
      return token === '-' ? -value : value
    }
    if (/^\d/.test(token || '')) return Number(token)
    if (token && Object.hasOwn(variables, token)) return variables[token]
    throw new Error('unknown frame value')
  }
  const product = () => {
    let value = primary()
    while (tokens[cursor] === '*' || tokens[cursor] === '/') {
      const operator = tokens[cursor++]
      const right = primary()
      value = operator === '*' ? value * right : value / right
    }
    return value
  }
  const sum = () => {
    let value = product()
    while (tokens[cursor] === '+' || tokens[cursor] === '-') {
      const operator = tokens[cursor++]
      const right = product()
      value = operator === '+' ? value + right : value - right
    }
    return value
  }
  try {
    const value = sum()
    return cursor === tokens.length && Number.isFinite(value) ? value : null
  } catch { return null }
}

function luaCallArguments(line) {
  const open = line.indexOf('(')
  if (open < 0) return []
  const args = []
  let depth = 0
  let start = open + 1
  let quote = ''
  let escaped = false
  for (let index = open + 1; index < line.length; index += 1) {
    const char = line[index]
    if (quote) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === quote) quote = ''
      continue
    }
    if (char === '"' || char === "'") { quote = char; continue }
    if (char === '(') depth += 1
    else if (char === ')') {
      if (depth === 0) {
        const last = line.slice(start, index).trim()
        if (last || args.length) args.push(last)
        return args
      }
      depth -= 1
    } else if (char === ',' && depth === 0) {
      args.push(line.slice(start, index).trim())
      start = index + 1
    }
  }
  return []
}

function getFrameVariables(lines) {
  const expressions = []
  const variables = Object.create(null)
  for (const line of lines) {
    const assignment = /^\s*([A-Za-z_]\w*)\s*=\s*(.*?)\s*;?\s*(?:--.*)?$/.exec(line)
    if (assignment) expressions.push([assignment[1], assignment[2]])
  }
  for (let pass = 0; pass < expressions.length + 1; pass += 1) {
    let changed = false
    for (const [name, expression] of expressions) {
      const value = evaluateFrameExpression(expression, variables)
      if (value == null || variables[name] === value) continue
      variables[name] = value
      changed = true
    }
    if (!changed) break
  }
  return variables
}

function inspectScript(content) {
  const lines = String(content || '').split(/\r?\n/)
  const cues = []
  const unmapped = []
  const variables = getFrameVariables(lines)
  lines.forEach((text, lineIndex) => {
    const trimmed = text.trim()
    if (!trimmed || trimmed.startsWith('--')) return
    const call = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(/.exec(text)
    if (!call) return
    const name = call[1].split('.').pop()
    const args = luaCallArguments(text)
    // These metadata calls are keyed by work ID, not timeline frame.
    const isTimed = TIMED_CALLS.has(name) || (name === 'setPitch' && args.length >= 3)
    if (!isTimed) return
    const match = /^\s*([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\(\s*([^,]+),/.exec(text)
    const frame = match && evaluateFrameExpression(match[2], variables)
    if (match && frame != null) cues.push({ frame, name: match[1], lineIndex, text })
    else unmapped.push({ lineIndex, text })
  })
  return { lines, cues, unmapped, maxFrame: Math.max(1, ...cues.map(cue => cue.frame)) }
}

function rewriteFrame(line, frame) {
  return line.replace(/^(\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\(\s*)[^,]+(,)/, (_match, before, comma) => `${before}${Math.max(0, Math.round(frame))}${comma}`)
}

function scriptGlobals(lines) {
  const names = new Set()
  for (const line of lines) {
    const assignment = /^\s*((?:[A-Za-z_]\w*\s*,\s*)*[A-Za-z_]\w*)\s*=(?!=)/.exec(line)
    if (assignment && !/^\s*local\b/.test(line)) {
      assignment[1].split(',').forEach(name => {
        const normalized = name.trim()
        if (normalized && !SHARED_LUA_GLOBALS.has(normalized)) names.add(normalized)
      })
    }
    const fn = /^\s*function\s+([A-Za-z_]\w*)\s*\(/.exec(line)
    if (fn && !SHARED_LUA_GLOBALS.has(fn[1])) names.add(fn[1])
  }
  return names
}

function namespaceGlobals(lines, clipIndex) {
  const globals = scriptGlobals(lines)
  if (!globals.size) return lines
  const prefix = `__lua_clip_${clipIndex}_`
  const token = /(--[^\r\n]*|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|[A-Za-z_]\w*)/g
  return lines.map(line => line.replace(token, (value, match, offset) => {
    if (!match || match.startsWith('--') || match.startsWith('"') || match.startsWith("'")) return value
    if (offset > 0 && line[offset - 1] === '.') return value
    return globals.has(match) ? `${prefix}${match}` : value
  }))
}

function joinClips(clips) {
  const ordered = [...clips].sort((a, b) => a.startFrame - b.startFrame)
  return ordered.map((clip, clipIndex) => {
    const { lines, cues } = inspectScript(clip.content)
    const variables = getFrameVariables(lines)
    const cueByLine = new Map(cues.map(cue => [cue.lineIndex, cue]))
    const output = []
    lines.forEach((line, lineIndex) => {
      const cue = cueByLine.get(lineIndex)
      if (!cue) {
        const skip = /^(\s*skipFrame\s*\(\s*[^,]+,\s*)([^,)]+)(.*)$/.exec(line)
        if (skip) {
          const localTarget = evaluateFrameExpression(skip[2], variables)
          if (localTarget != null) {
            const offset = clip.startFrame - clip.inFrame
            output.push(`${skip[1]}${Math.max(0, Math.round(localTarget + offset))}${skip[3]}`)
            return
          }
        }
        output.push(line)
        return
      }
      if (cue.frame < clip.inFrame || cue.frame > clip.outFrame) return
      // Each original file ends its own battle phase. Keep only the final
      // endPhase, otherwise the first clip terminates the whole merged preview.
      if (cue.name.split('.').pop() === 'endPhase' && clipIndex < ordered.length - 1) return
      const timelineFrame = clip.startFrame + cue.frame - clip.inFrame
      let rewritten = rewriteFrame(line, timelineFrame)
      // playSeVer2's fourth argument is an absolute stop frame. Keep it on
      // the same timeline as its start or the audio can be cut off early.
      if (cue.name.split('.').pop() === 'playSeVer2') {
        const argsMatch = /^(\s*[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*\()([\s\S]*)(\)\s*;?\s*(?:--.*)?)$/.exec(rewritten)
        if (argsMatch) {
          const args = argsMatch[2].split(',')
          if (args.length >= 4) {
            const localEnd = evaluateFrameExpression(args[3], variables)
            if (localEnd != null && localEnd > 0) {
              args[3] = String(Math.max(0, Math.round(clip.startFrame + localEnd - clip.inFrame)))
              rewritten = `${argsMatch[1]}${args.join(',')}${argsMatch[3]}`
            }
          }
        }
      }
      output.push(rewritten)
    })
    const namespaced = namespaceGlobals(output, clipIndex + 1)
    return `-- ===== ${clip.name} · timeline start ${clip.startFrame}f · source frames ${clip.inFrame}-${clip.outFrame} =====\ndo\n${namespaced.join('\n')}\nend`
  }).join('\n\n')
}

export function LuaAnimationStudio({ card, language = 'vi', onStageSaved, onNavigateBack, editorMode = false, onToggleEditorMode, onPreviewChange, onTimelinePlay, previewAnimation }) {
  const vi = language !== 'en'
  const [clips, setClips] = useState([])
  const [composedDraft, setComposedDraft] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [followPlayer, setFollowPlayer] = useState(true)
  const [syncedFrame, setSyncedFrame] = useState(null)
  const [playerMaxFrame, setPlayerMaxFrame] = useState(0)
  const [playerIsPlaying, setPlayerIsPlaying] = useState(true)
  const [filename, setFilename] = useState('custom_animation')
  const [target, setTarget] = useState('attack_sp')
  const [busy, setBusy] = useState(false)
  const [autoPreviewing, setAutoPreviewing] = useState(false)
  const [autoPreviewError, setAutoPreviewError] = useState('')
  const [message, setMessage] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchBy, setSearchBy] = useState('card_name')
  const [rarity, setRarity] = useState('')
  const [searchPage, setSearchPage] = useState(1)
  const [sourceCards, setSourceCards] = useState([])
  const [sourcePaging, setSourcePaging] = useState({ total: 0, totalPages: 1 })
  const [searchingCards, setSearchingCards] = useState(false)
  const [selectedSourceCard, setSelectedSourceCard] = useState(null)
  const [sourceAnimations, setSourceAnimations] = useState([])
  const [loadingSourceAnimations, setLoadingSourceAnimations] = useState(false)
  const [importingScriptPath, setImportingScriptPath] = useState('')
  const [lookupError, setLookupError] = useState('')
  const [animationSearchOpen, setAnimationSearchOpen] = useState(true)
  const [livePlayerAnimation, setLivePlayerAnimation] = useState(null)
  const [liveScript, setLiveScript] = useState('')
  const [liveScriptLoading, setLiveScriptLoading] = useState(false)
  const [liveScriptError, setLiveScriptError] = useState('')
  const visibleSourceAnimations = useMemo(() => sourceAnimations.filter(animation =>
    ![animation.name, animation.title, animation.animation_name, animation.move_name]
      .some(value => String(value || '').toLowerCase().includes('(extreme)'))),
  [sourceAnimations])
  const fileRef = useRef(null)
  const timelineRef = useRef(null)
  const liveScriptScrollerRef = useRef(null)
  const previewRevisionRef = useRef(0)

  useEffect(() => {
    const acceptSelection = animation => {
      if (editorMode) return
      if (!animation) {
        setLivePlayerAnimation(null)
        setLiveScript('')
        setSyncedFrame(null)
        return
      }
      if (animation.player_mode !== 'normal' || Number(animation.card_id) !== Number(card?.id)) return
      setLivePlayerAnimation(animation)
      setSyncedFrame(null)
      setLiveScript('')
      setLiveScriptError('')
    }
    const onSelection = event => acceptSelection(event.detail)
    window.addEventListener('dokkan:anim-selection', onSelection)
    acceptSelection(window.__DOKKAN_ACTIVE_ANIMATION__)
    return () => window.removeEventListener('dokkan:anim-selection', onSelection)
  }, [editorMode, card?.id])

  useEffect(() => {
    if (editorMode || !livePlayerAnimation?.script_path) { setLiveScriptLoading(false); return }
    const controller = new AbortController()
    setLiveScriptLoading(true)
    setLiveScriptError('')
    api.getLuaSource(livePlayerAnimation.script_path, controller.signal)
      .then(source => { if (!controller.signal.aborted) setLiveScript(source.text || '') })
      .catch(error => { if (error.name !== 'AbortError') setLiveScriptError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLiveScriptLoading(false) })
    return () => controller.abort()
  }, [editorMode, livePlayerAnimation?.script_path])

  useEffect(() => {
    const term = searchQuery.trim()
    if (!term) { setSourceCards([]); setSourcePaging({ total: 0, totalPages: 1 }); setSearchingCards(false); return }
    const controller = new AbortController()
    setSourceCards([])
    setSearchingCards(true)
    setLookupError('')
    const timer = setTimeout(() => {
      api.searchAnimationSources(term, controller.signal, { rarity, page: searchPage, limit: 24, search_by: searchBy })
        .then(data => {
          if (controller.signal.aborted) return
          setSourceCards((data.items || []).filter(item => {
            const id = String(item.id)
            return !id.startsWith('9') && id.length <= 7
          }))
          setSourcePaging(data)
          setSearchPage(data.page || 1)
        })
        .catch(error => { if (error.name !== 'AbortError') setLookupError(error.message) })
        .finally(() => { if (!controller.signal.aborted) setSearchingCards(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [searchQuery, searchBy, rarity, searchPage])

  useEffect(() => {
    setSourceAnimations([])
    setLoadingSourceAnimations(false)
    if (!selectedSourceCard?.id) return
    const controller = new AbortController()
    setLoadingSourceAnimations(true)
    api.getAnimations(selectedSourceCard.id, controller.signal)
      .then(data => { if (!controller.signal.aborted) setSourceAnimations(data.items || []) })
      .catch(error => { if (error.name !== 'AbortError') setLookupError(error.message) })
      .finally(() => { if (!controller.signal.aborted) setLoadingSourceAnimations(false) })
    return () => controller.abort()
  }, [selectedSourceCard?.id])

  const selected = clips.find(clip => clip.id === selectedId) || clips[0] || null
  const liveScriptInfo = useMemo(() => inspectScript(liveScript), [liveScript])
  const liveCue = syncedFrame == null ? null : liveScriptInfo.cues.reduce((best, cue) => {
    if (cue.frame > syncedFrame) return best
    if (!best || cue.frame > best.frame || cue.frame === best.frame && cue.lineIndex > best.lineIndex) return cue
    return best
  }, null)
  const selectedInfo = useMemo(() => selected ? inspectScript(selected.content) : { lines: [], cues: [], maxFrame: 1 }, [selected])
  const totalFrames = Math.max(1, ...clips.map(clip => clip.startFrame + Math.max(1, clip.outFrame - clip.inFrame + 1)))
  const timelineWidth = Math.max(760, Math.min(5000, totalFrames * 1.4))
  const visibleFrame = Math.max(0, Math.min(totalFrames, syncedFrame == null ? playhead : syncedFrame))
  useEffect(() => {
    const content = joinClips(clips)
    setComposedDraft(content)
    setAutoPreviewError('')
    if (!clips.length || !editorMode || !card?.id || !content.trim()) {
      setAutoPreviewing(false)
      return
    }
    const revision = ++previewRevisionRef.current
    setAutoPreviewing(true)
    const timer = setTimeout(async () => {
      try {
        if (revision !== previewRevisionRef.current) return
        const saved = await api.previewCustomLua(`timeline_${card.id}_draft`, content)
        if (revision !== previewRevisionRef.current) return
        onTimelinePlay?.({ id: Date.now(), sequence: [] })
        onPreviewChange?.({
          title: `${filename || 'custom_animation'} · Preview`, name: saved.filename,
          type: vi ? 'Lua Timeline Draft' : 'Lua Timeline Draft', card_id: card.id,
          card_name: card.name, element: card.element,
          preview_revision: revision,
          script_path: `ab_script/custom_lua/${saved.filename}`
        })
        setAutoPreviewing(false)
      } catch (error) {
        if (revision !== previewRevisionRef.current) return
        setAutoPreviewError(error.message || (vi ? 'Không thể cập nhật preview.' : 'Could not refresh the preview.'))
        setAutoPreviewing(false)
      }
    }, 450)
    return () => {
      clearTimeout(timer)
      previewRevisionRef.current += 1
    }
  }, [clips, editorMode, card?.id])
  const currentCues = useMemo(() => clips.flatMap(clip => {
    const { cues } = inspectScript(clip.content)
    return cues.filter(cue => cue.frame >= clip.inFrame && cue.frame <= clip.outFrame)
      .map(cue => ({ ...cue, clipName: clip.name, timelineFrame: clip.startFrame + cue.frame - clip.inFrame }))
  }).filter(cue => cue.timelineFrame <= visibleFrame).sort((a, b) => b.timelineFrame - a.timelineFrame).slice(0, 8), [clips, visibleFrame])

  useEffect(() => {
    if (editorMode || !liveCue) return
    const scroller = liveScriptScrollerRef.current
    const line = scroller?.querySelector(`[data-live-line="${liveCue.lineIndex}"]`)
    if (!scroller || !line) return
    const scrollerRect = scroller.getBoundingClientRect()
    const lineRect = line.getBoundingClientRect()
    const targetTop = scroller.scrollTop + lineRect.top - scrollerRect.top - scroller.clientHeight / 2
    scroller.scrollTo({ top: Math.max(0, targetTop), behavior: 'smooth' })
  }, [editorMode, liveCue?.lineIndex, livePlayerAnimation?.script_path, liveScript])

  useEffect(() => {
    setSyncedFrame(null)
    setPlayhead(0)
  }, [card?.id])

  useEffect(() => {
    const onFrame = event => {
      const detail = event.detail || {}
      const expectedCardId = editorMode ? (previewAnimation?.card_id || card?.id) : card?.id
      if ((editorMode && !followPlayer) || (!editorMode && Number(detail.cardId) !== Number(expectedCardId))) return
      setPlayerIsPlaying(Boolean(detail.playing))
      if (Number(detail.maxFrame) > 0) setPlayerMaxFrame(Number(detail.maxFrame))
      if (!editorMode && detail.playing) {
        setSyncedFrame(previous => previous == null ? previous : null)
        return
      }
      setSyncedFrame(Number(detail.frame) || 0)
    }
    window.addEventListener('dokkan:anim-frame', onFrame)
    return () => window.removeEventListener('dokkan:anim-frame', onFrame)
  }, [followPlayer, card?.id, editorMode, previewAnimation?.card_id])

  const appendLuaClip = ({ name, content, sourceAnimation = null }) => {
    const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`
    const loaded = { id, name, content, sourceAnimation, startFrame: 0, inFrame: 0, outFrame: inspectScript(content).maxFrame }
    setClips(previous => {
      const cursor = previous.length ? Math.max(...previous.map(clip => clip.startFrame + Math.max(1, clip.outFrame - clip.inFrame + 1))) : 0
      return [...previous, { ...loaded, startFrame: cursor }]
    })
    setSelectedId(id)
    setMessage('')
    return id
  }

  const importAnimationLua = async animation => {
    if (!selectedSourceCard || !animation?.script_path) return
    setImportingScriptPath(animation.script_path)
    setLookupError('')
    try {
      const source = await api.getLuaSource(animation.script_path)
      const name = animation.name || animation.title || animation.script_path.split('/').pop().replace(/\.lua$/i, '')
      const preview = {
        ...animation,
        title: name,
        name,
        card_id: selectedSourceCard.id,
        card_name: selectedSourceCard.name,
        rarity: selectedSourceCard.rarity,
        element: selectedSourceCard.element,
        script_path: source.path || animation.script_path
      }
      appendLuaClip({ name, content: source.text || '', sourceAnimation: preview })
      onPreviewChange?.(preview)
      setAnimationSearchOpen(false)
      setMessage(vi ? `Đã nhập ${name} (${animation.type || 'animation'}) vào timeline.` : `Imported ${name} (${animation.type || 'animation'}) into the timeline.`)
    } catch (error) {
      setLookupError(error.message || (vi ? 'Không tải được Lua.' : 'Could not load Lua.'))
    } finally { setImportingScriptPath('') }
  }

  const importFiles = async files => {
    const loaded = await Promise.all([...files].map(async file => {
      const content = await file.text()
      return { id: `${Date.now()}-${Math.random().toString(36).slice(2)}`, name: file.name.replace(/\.lua$/i, ''), content, startFrame: 0, inFrame: 0, outFrame: inspectScript(content).maxFrame }
    }))
    setClips(previous => {
      let cursor = previous.length ? Math.max(...previous.map(clip => clip.startFrame + Math.max(1, clip.outFrame - clip.inFrame + 1))) : 0
      const appended = loaded.map(clip => {
        const next = { ...clip, startFrame: cursor }
        cursor += Math.max(1, clip.outFrame - clip.inFrame + 1)
        return next
      })
      return [...previous, ...appended]
    })
    if (loaded.length) { setSelectedId(loaded[0].id); setMessage('') }
  }

  const patchSelected = changes => setClips(previous => previous.map(clip => clip.id === selected?.id ? { ...clip, ...changes } : clip))
  const removeSelected = () => {
    if (!selected) return
    const next = clips.filter(clip => clip.id !== selected.id)
    setClips(next)
    setSelectedId(next[0]?.id || null)
  }
  const splitSelected = () => {
    if (!selected) return
    const localFrame = Math.round(selected.inFrame + Math.max(0, Math.min(selected.outFrame - selected.inFrame, visibleFrame - selected.startFrame)))
    if (localFrame >= selected.outFrame) return
    const left = { ...selected, outFrame: localFrame }
    const right = { ...selected, id: `${selected.id}-split-${Date.now()}`, name: `${selected.name} · 2`, inFrame: localFrame + 1, startFrame: selected.startFrame + localFrame + 1 - selected.inFrame }
    setClips(previous => previous.flatMap(clip => clip.id === selected.id ? [left, right] : [clip]))
    setSelectedId(right.id)
  }
  const syncTimelineScroll = event => {
    const left = event.currentTarget.scrollLeft
    timelineRef.current?.querySelectorAll('.lua-ruler-scroll, .lua-track-viewport').forEach(element => {
      if (element !== event.currentTarget) element.scrollLeft = left
    })
  }

  const saveScript = async () => {
    if (!clips.length || !composedDraft.trim() || !card?.id) return
    setBusy(true); setMessage('')
    try {
      const saved = await api.saveCustomLua(filename, composedDraft)
      const archivePath = `lua/ab_script/${target}/${saved.filename}`
      onStageSaved?.({ source_path: saved.source_path, archive_path: archivePath, filename: saved.filename, target })
      setMessage(vi ? `Đã lưu ${saved.filename} vào game res/ab_script/custom_lua và thêm vào patch của thẻ #${card.id}.` : `Saved ${saved.filename} under game res/ab_script/custom_lua and staged it in card #${card.id}'s patch.`)
    } catch (error) {
      setMessage(error.message || (vi ? 'Không thể lưu Lua.' : 'Could not save Lua.'))
    } finally { setBusy(false) }
  }

  const previewScript = async () => {
    if (!clips.length || !composedDraft.trim() || !card?.id || busy) return
    previewRevisionRef.current += 1
    setAutoPreviewing(false)
    setBusy(true); setMessage('')
    try {
      const saved = await api.previewCustomLua(`timeline_${card.id}_draft`, composedDraft)
      onTimelinePlay?.({ id: Date.now(), sequence: [] })
      onPreviewChange?.({
        title: `${filename || 'custom_animation'} · Preview`,
        name: saved.filename,
        type: vi ? 'Lua Timeline Draft' : 'Lua Timeline Draft',
        card_id: card.id,
        card_name: card.name,
        element: card.element,
        preview_revision: Date.now(),
        script_path: `ab_script/custom_lua/${saved.filename}`
      })
      setMessage(vi ? `Đã nạp script ghép ${saved.filename} vào player.` : `Loaded the combined script ${saved.filename} in the player.`)
    } catch (error) {
      setMessage(error.message || (vi ? 'Không thể tạo preview.' : 'Could not create preview.'))
    } finally { setBusy(false) }
  }

  return <section className="lua-studio-page">
    <header className="lua-studio-header">
      <div className="lua-studio-title"><span><Clapperboard size={20} /></span><div><h2>{vi ? 'Lua Animation Timeline' : 'Lua Animation Timeline'}</h2><p>{editorMode ? (vi ? 'Tìm animation, tải Lua, cắt ghép và xem thử script đã chỉnh.' : 'Search animations, fetch Lua, edit the timeline and preview your script.') : (vi ? 'Theo dõi script Lua theo animation đang phát ở player.' : 'Follow the Lua script for the animation playing in the player.')}</p></div></div>
      <div className="lua-studio-actions">
        <button type="button" className={`lua-action ${editorMode ? 'primary' : 'secondary'} lua-editor-mode-toggle`} onClick={onToggleEditorMode} aria-pressed={editorMode} title={vi ? 'Đổi player bên phải giữa animation thẻ và preview Lua' : 'Switch the right player between card animations and Lua preview'}><MonitorPlay size={15} />{editorMode ? (vi ? 'Player: Editor' : 'Player: Editor') : (vi ? 'Bật Editor Mode' : 'Enable Editor Mode')}</button>
        {editorMode && <>
          <input ref={fileRef} type="file" accept=".lua,text/plain" multiple hidden onChange={event => { void importFiles(event.target.files || []); event.target.value = '' }} />
          <button type="button" className="lua-action secondary" onClick={() => fileRef.current?.click()}><FolderPlus size={15} />{vi ? 'Thêm Lua' : 'Import Lua'}</button>
          <button type="button" className="lua-action primary" onClick={() => void saveScript()} disabled={!clips.length || !composedDraft.trim() || busy || !card?.id}><Save size={15} />{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu anim custom' : 'Save custom animation')}</button>
        </>}
        {editorMode && onNavigateBack && <button type="button" className="lua-action quiet" onClick={onNavigateBack}>{vi ? 'Quay lại' : 'Back'}</button>}
      </div>
    </header>

    <div className="lua-studio-note"><Radio size={15} />{editorMode ? (vi ? 'Editor Mode cho phép tìm toàn bộ loại animation, tải Lua còn thiếu từ server, rồi chỉnh và xem thử bản ghép.' : 'Editor Mode searches every animation type, fetches missing Lua from the server, and lets you edit and preview a joined script.') : (vi ? 'Normal Mode chỉ định vị và cuộn đến dòng Lua tương ứng khi bạn tạm dừng animation.' : 'Normal Mode locates and scrolls to the matching Lua line when you pause the animation.')}</div>

    {!editorMode && <section className="lua-live-follow-panel lua-panel">
      <header><Radio size={15} /><strong>{vi ? 'Live Lua theo player' : 'Live Lua from player'}</strong><span>{livePlayerAnimation ? (syncedFrame == null ? (vi ? 'Đang phát' : 'Playing') : `${Math.round(syncedFrame)}f`) : (vi ? 'Chưa phát' : 'Idle')}</span></header>
      {livePlayerAnimation ? <div className="lua-live-follow-summary"><strong>{livePlayerAnimation.title || livePlayerAnimation.name}</strong><span>{livePlayerAnimation.card_name || card?.name} · #{livePlayerAnimation.card_id} · {livePlayerAnimation.type || 'Animation'}</span></div>
        : <p className="lua-browser-hint">{vi ? 'Chọn và phát animation ở player bên phải để xem script.' : 'Select and play an animation in the right player to view its script.'}</p>}
      {liveScriptError && <p className="lua-browser-error" role="alert">{liveScriptError}</p>}
      {liveScriptLoading ? <p className="lua-browser-hint">{vi ? 'Đang tải Lua…' : 'Loading Lua…'}</p>
        : liveScript ? <pre className="lua-live-source" ref={liveScriptScrollerRef}>{liveScriptInfo.lines.map((line, index) => <span key={index} data-live-line={index} className={liveCue?.lineIndex === index ? 'active' : ''}><i>{index + 1}</i>{line || ' '}</span>)}</pre>
          : !liveScriptError && <p className="lua-browser-hint">{vi ? 'Script chưa có nội dung để hiển thị.' : 'No Lua source is available to display.'}</p>}
      {!liveScriptLoading && liveScript && syncedFrame == null && <p className="lua-browser-hint">{vi ? 'Tạm dừng animation để định vị dòng Lua tại frame hiện tại.' : 'Pause the animation to locate the Lua line at the current frame.'}</p>}
    </section>}

    {editorMode && animationSearchOpen && <section className="lua-animation-browser lua-panel">
      <header><Search size={15} /><strong>{vi ? 'Tìm Lua từ animation trong database' : 'Find Lua from database animations'}</strong><span>{vi ? 'Mọi loại animation' : 'All animation types'}</span></header>
      <div className="lua-animation-search-controls">
        <input value={searchQuery} onChange={event => { setSearchQuery(event.target.value); setSearchPage(1); setSelectedSourceCard(null); setSourceAnimations([]) }} placeholder={vi ? 'Tìm thẻ theo tên, ID hoặc tên chiêu' : 'Search by card name, card ID, or move name'} />
        <AnimationSearchFilter source language={language} value={searchBy} onChange={value => { setSearchBy(value); setSearchPage(1); setSelectedSourceCard(null) }} />
        <AnimationRarityFilter language={language} value={rarity} onChange={value => { setRarity(value); setSearchPage(1); setSelectedSourceCard(null) }} />
      </div>
      <div className="lua-animation-browser-grid">
        <div className="lua-animation-source-list">
          {!searchQuery.trim() ? <p className="lua-browser-hint">{vi ? 'Nhập từ khóa để tìm thẻ. Danh sách không tải sẵn để tránh chậm.' : 'Enter a query to search cards. Results stay unloaded until then.'}</p>
            : searchingCards ? <p className="lua-browser-hint">{vi ? 'Đang tìm thẻ…' : 'Searching cards…'}</p>
            : sourceCards.length ? sourceCards.map(source => <AnimationChoice key={source.id} cardId={source.id} cardName={source.name} title={source.name}
              rarity={source.rarity}
              selected={Number(selectedSourceCard?.id) === Number(source.id)} disabled={loadingSourceAnimations}
              onClick={() => { setSelectedSourceCard(source); setLookupError('') }} />)
            : <p className="lua-browser-hint">{vi ? 'Không tìm thấy thẻ phù hợp.' : 'No matching cards found.'}</p>}
          {!!searchQuery.trim() && <AnimationPagination {...sourcePaging} page={searchPage} loading={searchingCards} onChange={setSearchPage} language={language} />}
        </div>
        <div className="lua-animation-results">
          <div className="lua-animation-results-heading"><strong>{selectedSourceCard ? `${selectedSourceCard.name} · #${selectedSourceCard.id}` : (vi ? 'Chọn thẻ để xem chiêu thức' : 'Choose a card to see its moves')}</strong>
            {selectedSourceCard && <span>{loadingSourceAnimations ? (vi ? 'Đang tải…' : 'Loading…') : `${visibleSourceAnimations.length} ${vi ? 'animation' : 'animations'}`}</span>}
          </div>
          {selectedSourceCard && !loadingSourceAnimations && visibleSourceAnimations.length === 0 && <p className="lua-browser-hint">{vi ? 'Không có animation phù hợp cho thẻ này.' : 'No matching animations are available for this card.'}</p>}
          {visibleSourceAnimations.map((animation, index) => {
            const path = animation.script_path || (animation.folder && animation.script_name ? `ab_script/${animation.folder}/${animation.script_name.replace(/\.lua$/i, '')}.lua` : '')
            const importing = importingScriptPath === path
            return <div className="lua-animation-result" key={`${path || animation.name}-${index}`}>
              <AnimationChoice cardId={selectedSourceCard.id} cardName={selectedSourceCard.name}
                title={animation.name || animation.type} tag={animation.move_tag || animation.type} rarity={selectedSourceCard.rarity}
                detail={`${animation.type || 'Animation'} · ${path ? path.split('/').pop() : (vi ? 'Lua không khả dụng' : 'Lua unavailable')}`}
                selected={previewAnimation?.script_path === path && Number(previewAnimation?.card_id) === Number(selectedSourceCard.id)}
                disabled={!path || Boolean(importingScriptPath)} onClick={() => void importAnimationLua({ ...animation, script_path: path })} />
              <span className="lua-import-state">{importing ? <><Download size={12} />{vi ? 'Đang tải…' : 'Loading…'}</> : path ? <><Download size={12} />{vi ? 'Nhập Lua' : 'Import Lua'}</> : (vi ? 'Không có Lua' : 'No Lua')}</span>
            </div>
          })}
        </div>
      </div>
      {lookupError && <p className="lua-browser-error" role="alert">{lookupError}</p>}
    </section>}

    {editorMode && <div className="lua-studio-toolbar">
      {!animationSearchOpen && <button type="button" className="lua-action secondary" onClick={() => setAnimationSearchOpen(true)}><Search size={14} />{vi ? 'Tìm animation' : 'Find animations'}</button>}
      <button type="button" className="lua-action secondary" disabled={!previewAnimation?.script_path} onClick={() => window.dispatchEvent(new CustomEvent('dokkan:anim-player-control', { detail: { action: playerIsPlaying ? 'pause' : 'play' } }))}>{playerIsPlaying ? <Pause size={14} /> : <Play size={14} />}{playerIsPlaying ? (vi ? 'Tạm dừng player' : 'Pause player') : (vi ? 'Phát player' : 'Play player')}</button>
      <button type="button" className={`lua-action secondary ${followPlayer ? 'selected' : ''}`} onClick={() => { setFollowPlayer(value => !value); setSyncedFrame(null) }}><Radio size={14} />{vi ? 'Theo player' : 'Follow player'}</button>
      <button type="button" className="lua-action secondary" disabled={!selected} onClick={splitSelected}><Scissors size={14} />{vi ? 'Cắt tại playhead' : 'Split at playhead'}</button>
      <button type="button" className="lua-action secondary" disabled={!clips.length || !composedDraft.trim() || busy || !card?.id} onClick={() => void previewScript()}><MonitorPlay size={14} />{busy ? (vi ? 'Đang nạp script…' : 'Loading script…') : (vi ? 'Nạp script ghép vào player' : 'Load merged script in player')}</button>
      <span className="lua-frame-readout"><Clock3 size={14} />{Math.round(visibleFrame)} / {totalFrames}f</span>
    </div>}

    {editorMode && (!clips.length ? <div className="lua-studio-empty"><FileCode2 size={31} /><strong>{vi ? 'Nhập một hoặc nhiều file Lua để bắt đầu' : 'Import one or more Lua files to begin'}</strong><span>{vi ? 'Các lệnh theo frame sẽ hiện thành điểm đánh dấu trên timeline.' : 'Frame calls will appear as markers on the timeline.'}</span></div> : <>
      <div className="lua-timeline-shell" ref={timelineRef}>
        <div className="lua-timeline-ruler"><div className="lua-timeline-label">{vi ? 'Track / file' : 'Track / file'}</div><div className="lua-ruler-scroll" onScroll={syncTimelineScroll}><div className="lua-ruler" style={{ width: timelineWidth }}>{Array.from({ length: Math.ceil(totalFrames / 60) + 1 }, (_, index) => <span key={index} style={{ left: `${(index * 60 / totalFrames) * 100}%` }}>{index * 60}f</span>)}</div></div></div>
        {clips.map((clip, index) => {
          const info = inspectScript(clip.content)
          const duration = Math.max(1, clip.outFrame - clip.inFrame + 1)
          return <div className={`lua-track-row ${selected?.id === clip.id ? 'selected' : ''}`} key={clip.id} onClick={() => setSelectedId(clip.id)}>
            <div className="lua-track-label"><small>TRACK {index + 1}</small><strong title={clip.name}>{clip.name}</strong><span>{info.cues.length} {vi ? 'lệnh' : 'calls'}</span></div>
            <div className="lua-track-viewport" onScroll={syncTimelineScroll}><div className="lua-track-canvas" style={{ width: timelineWidth }}>
              <div className="lua-track-grid">{Array.from({ length: Math.ceil(totalFrames / 60) + 1 }, (_, i) => <i key={i} style={{ left: `${(i * 60 / totalFrames) * 100}%` }} />)}</div>
              <div className="lua-clip-block" style={{ left: `${(clip.startFrame / totalFrames) * 100}%`, width: `${Math.max(2, (duration / totalFrames) * 100)}%` }}>
                {info.cues.filter(cue => cue.frame >= clip.inFrame && cue.frame <= clip.outFrame).map(cue => <button type="button" key={`${cue.lineIndex}-${cue.frame}`} className="lua-cue-marker" style={{ left: `${((cue.frame - clip.inFrame) / duration) * 100}%` }} title={`${cue.frame}f · ${cue.name}`} onClick={event => { event.stopPropagation(); setSelectedId(clip.id); setPlayhead(clip.startFrame + cue.frame - clip.inFrame); setSyncedFrame(null) }} />)}
              </div>
              {visibleFrame <= totalFrames && <i className="lua-playhead" style={{ left: `${(visibleFrame / totalFrames) * 100}%` }} />}
            </div></div>
          </div>
        })}
      </div>
      <label className="lua-scrub-control"><span>{vi ? 'Vị trí player' : 'Player frame'}</span><input type="range" min="0" max={playerMaxFrame || totalFrames} step="1" value={Math.min(playerMaxFrame || totalFrames, visibleFrame)} onChange={event => { const value = Number(event.target.value); setPlayhead(value); setSyncedFrame(value); window.dispatchEvent(new CustomEvent('dokkan:anim-player-control', { detail: { action: 'seek', frame: value } })) }} /><strong>{Math.round(visibleFrame)}f</strong></label>

      <div className="lua-editor-grid">
        <section className="lua-panel lua-clip-panel"><header><FileCode2 size={15} /><strong>{vi ? 'Các đoạn script' : 'Script clips'}</strong><span>{clips.length}</span></header>
          <div className="lua-clip-list">{clips.map((clip, index) => <button type="button" key={clip.id} className={clip.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(clip.id)}><span>{index + 1}</span><strong>{clip.name}</strong><small>{clip.startFrame}f · {Math.max(0, clip.outFrame - clip.inFrame)}f</small></button>)}</div>
          <div className="lua-clip-tools"><button type="button" disabled={!selected} onClick={removeSelected}><Trash2 size={14} />{vi ? 'Xóa đoạn' : 'Remove clip'}</button></div>
        </section>
        <section className="lua-panel lua-code-panel"><header><FileCode2 size={15} /><strong>{selected?.name || (vi ? 'Mã nguồn' : 'Source')}</strong><span>{selectedInfo.lines.length} {vi ? 'dòng' : 'lines'}</span></header>
          {selectedInfo.unmapped?.length > 0 && <p className="lua-warning">{vi ? `${selectedInfo.unmapped.length} lệnh có frame/count dạng biến hoặc nhiều dòng nên sẽ giữ nguyên khi cắt/dời.` : `${selectedInfo.unmapped.length} calls use an expression or multiline frame/count and will stay unchanged when trimmed or moved.`}</p>}
          {selected ? <><div className="lua-clip-fields">
            <label><span>{vi ? 'Tên đoạn' : 'Clip name'}</span><input value={selected.name} onChange={event => patchSelected({ name: event.target.value })} /></label>
            <label><span>{vi ? 'Vị trí trên timeline' : 'Timeline start'}</span><input type="number" min="0" value={selected.startFrame} onChange={event => patchSelected({ startFrame: Math.max(0, Number(event.target.value) || 0) })} /></label>
            <label><span>IN frame</span><input type="number" min="0" max={selected.outFrame} value={selected.inFrame} onChange={event => patchSelected({ inFrame: Math.max(0, Math.min(selected.outFrame, Number(event.target.value) || 0)) })} /></label>
            <label><span>OUT frame</span><input type="number" min={selected.inFrame} value={selected.outFrame} onChange={event => patchSelected({ outFrame: Math.max(selected.inFrame, Number(event.target.value) || 0) })} /></label>
          </div><textarea className="lua-source-editor" spellCheck="false" value={selected.content} onChange={event => patchSelected({ content: event.target.value })} /></> : null}
        </section>
      </div>

      <section className="lua-panel lua-composed-panel"><header><FileCode2 size={15} /><strong>{vi ? 'Script ghép · bản nháp thứ ba' : 'Combined script · third draft'}</strong><span>{autoPreviewError || (autoPreviewing ? (vi ? 'Đang nạp vào player…' : 'Updating player…') : `${composedDraft.split(/\r?\n/).length} ${vi ? 'dòng' : 'lines'}`)}</span></header>
        <p className="lua-browser-hint">{vi ? 'Đổi thứ tự, IN/OUT hoặc mã nguồn sẽ tự ghép lại và nạp script thứ ba vào player. Bạn có thể sửa trực tiếp bản ghép; nút nạp và nút lưu sẽ dùng đúng nội dung ở đây.' : 'Changing clip order, IN/OUT, or source code rebuilds and loads the third script in the player. Edit the merged draft here; preview and save use this exact text.'}</p>
        <textarea className="lua-source-editor" spellCheck="false" value={composedDraft} onChange={event => setComposedDraft(event.target.value)} placeholder={vi ? 'Script ghép sẽ xuất hiện ở đây…' : 'The merged script will appear here…'} />
      </section>

      <section className="lua-panel lua-live-panel"><header><Radio size={15} /><strong>{vi ? 'Lệnh được xếp lịch đến frame này' : 'Scheduled calls up to this frame'}</strong><span>{currentCues.length}</span></header>
        {currentCues.length ? <div className="lua-live-calls">{currentCues.map((cue, index) => <button type="button" key={`${cue.clipName}-${cue.lineIndex}-${index}`} onClick={() => { const clip = clips.find(item => item.name === cue.clipName); if (clip) setSelectedId(clip.id) }}><b>{cue.timelineFrame}f</b><span>{cue.clipName}</span><code>{cue.text.trim()}</code></button>)}</div> : <p className="lua-no-calls">{vi ? 'Chưa có lệnh nào trước playhead.' : 'No scheduled call before the playhead yet.'}</p>}
      </section>

      <section className="lua-panel lua-save-panel"><header><Save size={15} /><strong>{vi ? 'Xuất script custom' : 'Save custom script'}</strong></header>
        <div className="lua-save-fields"><label><span>{vi ? 'Tên file' : 'File name'}</span><input value={filename} onChange={event => setFilename(event.target.value)} /></label><label><span>{vi ? 'Thư mục đích trong patch' : 'Patch target folder'}</span><select value={target} onChange={event => setTarget(event.target.value)}>{TARGETS.map(([value, labelEn, labelVi]) => <option key={value} value={value}>{vi ? labelVi : labelEn}</option>)}</select></label></div>
        <p>{vi ? `File gốc được lưu riêng ở game res/ab_script/custom_lua. Khi xuất patch, bản này được chép vào lua/ab_script/${target}/ để thẻ có thể tham chiếu theo tên script.` : `The source is saved under game res/ab_script/custom_lua. Patch export copies it to lua/ab_script/${target}/ so a card can reference it by script name.`}</p>
      </section>
      {message && <p className="lua-studio-message" role="status">{message}</p>}
    </>)}
  </section>
}
