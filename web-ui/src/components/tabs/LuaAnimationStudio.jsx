import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../../api'
import { Clapperboard, FileCode2, FolderPlus, Play, Pause, Scissors, Save, Trash2, Clock3, Radio, Search, Download, MonitorPlay } from 'lucide-react'
import { AnimationChoice } from '../common/AnimationChoice'
import { CustomLuaTransfer } from '../common/CustomLuaTransfer'
import { AnimationSearchFilter, AnimationRarityFilter, AnimationPagination } from '../common/AnimationBrowserControls'

import { inspectScript, joinClips, updateTimelineClip, removeTimelineClip, CUSTOM_LUA_FORMATS, customLuaFilename, canPlaceCustomDamage, prepareCustomLua } from './luaTimeline'

function FrameInput({ value, min = 0, max, onCommit }) {
  const [draft, setDraft] = useState(String(value))
  useEffect(() => { setDraft(String(value)) }, [value])
  return <input type="number" min={min} max={max} step="1" value={draft}
    onChange={event => setDraft(event.target.value)}
    onKeyDown={event => { if (event.key === 'Enter') event.currentTarget.blur() }}
    onBlur={() => {
      const parsed = draft.trim() ? Number(draft) : NaN
      const frame = Number.isFinite(parsed) ? Math.max(min, Math.min(max ?? Infinity, Math.round(parsed))) : value
      setDraft(String(frame))
      if (frame !== value) onCommit(frame)
    }} />
}

export function LuaAnimationStudio({ card, language = 'vi', onStageSaved, onAnimationTransferred, transferredAnimations = [], onNavigateBack, editorMode = false, onToggleEditorMode, onPreviewChange, onTimelinePlay, previewAnimation }) {
  const vi = language !== 'en'
  const [clips, setClips] = useState([])
  const [composedDraft, setComposedDraft] = useState('')
  const [selectedId, setSelectedId] = useState(null)
  const [playhead, setPlayhead] = useState(0)
  const [followPlayer, setFollowPlayer] = useState(true)
  const [syncedFrame, setSyncedFrame] = useState(null)
  const [playerMaxFrame, setPlayerMaxFrame] = useState(0)
  const [playerIsPlaying, setPlayerIsPlaying] = useState(true)
  const [pausedPlayerFrame, setPausedPlayerFrame] = useState(null)
  const [filename, setFilename] = useState('custom_animation')
  const [savedLuaRevision, setSavedLuaRevision] = useState(0)
  const [target, setTarget] = useState('attack_sp')
  const [damageEnabled, setDamageEnabled] = useState(false)
  const [removeDamageEnabled, setRemoveDamageEnabled] = useState(false)
  const [damageFrame, setDamageFrame] = useState(0)
  const [mergeError, setMergeError] = useState('')
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
  const firstSourceAnimation = clips.find(clip => clip.sourceAnimation?.card_id)?.sourceAnimation
  const previewCardId = card?.id || selectedSourceCard?.id || previewAnimation?.card_id || firstSourceAnimation?.card_id || null
  const previewCardName = card?.name || selectedSourceCard?.name || previewAnimation?.card_name || firstSourceAnimation?.card_name || 'Lua Timeline'
  const previewElement = card?.element ?? selectedSourceCard?.element ?? previewAnimation?.element ?? firstSourceAnimation?.element ?? 0
  const fileRef = useRef(null)
  const timelineRef = useRef(null)
  const liveScriptScrollerRef = useRef(null)
  const previewRevisionRef = useRef(0)
  const clipAnalysisCache = useRef(new Map())
  const lastFrameUpdateRef = useRef(0)
  const clipInfos = useMemo(() => {
    const next = new Map()
    for (const clip of clips) {
      const cached = clipAnalysisCache.current.get(clip.id)
      next.set(clip.id, cached?.content === clip.content ? cached : { content: clip.content, info: inspectScript(clip.content) })
    }
    clipAnalysisCache.current = next
    return next
  }, [clips])

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
    api.getSourceAnimations(selectedSourceCard.id, controller.signal)
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
  const selectedInfo = selected ? clipInfos.get(selected.id).info : { lines: [], cues: [], maxFrame: 1 }
  const totalFrames = Math.max(1, ...clips.map(clip => clip.startFrame + Math.max(1, clip.outFrame - clip.inFrame + 1)))
  const timelineWidth = Math.max(760, Math.min(5000, totalFrames * 1.4))
  const visibleFrame = Math.max(0, Math.min(totalFrames, syncedFrame == null ? playhead : syncedFrame))
  const damageAvailable = canPlaceCustomDamage(target, filename)
  const preparedExport = useMemo(() => {
    try {
      return prepareCustomLua(composedDraft, { target, filename, damageEnabled, damageFrame, removeDamageEnabled })
    } catch (error) {
      return { content: '', error: error.message }
    }
  }, [composedDraft, target, filename, damageEnabled, damageFrame, removeDamageEnabled])
  const exportFolder = CUSTOM_LUA_FORMATS.find(format => format.id === target)?.folder || target
  const exportError = mergeError || preparedExport.error
  useEffect(() => {
    if (!damageAvailable) setDamageEnabled(false)
  }, [damageAvailable])
  const composedInfo = useMemo(() => inspectScript(composedDraft), [composedDraft])
  const damageMaxFrame = Math.max(0, ...composedInfo.cues.filter(cue => cue.name === 'endPhase').map(cue => cue.frame)) || composedInfo.maxFrame
  useEffect(() => {
    try {
      setComposedDraft(joinClips(clips))
      setMergeError('')
    } catch (error) {
      setComposedDraft('')
      setMergeError(error.message)
    }
  }, [clips])

  useEffect(() => {
    const content = preparedExport.content
    const revision = ++previewRevisionRef.current
    setAutoPreviewError(exportError || '')
    if (exportError) { setAutoPreviewing(false); return }
    if (!clips.length || !editorMode || !previewCardId || !content.trim()) {
      setAutoPreviewing(false)
      return
    }
    setAutoPreviewing(true)
    const timer = setTimeout(async () => {
      try {
        if (revision !== previewRevisionRef.current) return
        const saved = await api.previewCustomLua(`timeline_${previewCardId}_draft`, content)
        if (revision !== previewRevisionRef.current) return
        onTimelinePlay?.({ id: Date.now(), sequence: [] })
        onPreviewChange?.({
          title: `${preparedExport.filename} · Preview`, name: saved.filename,
          type: vi ? 'Lua Timeline Draft' : 'Lua Timeline Draft', card_id: previewCardId,
          card_name: previewCardName, element: previewElement,
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
  }, [preparedExport.content, preparedExport.filename, exportError, editorMode, previewCardId, previewCardName, previewElement])
  const timelineCues = useMemo(() => clips.flatMap(clip => {
    const { cues } = clipInfos.get(clip.id).info
    return cues.filter(cue => cue.frame >= clip.inFrame && cue.frame <= clip.outFrame)
      .map(cue => ({ ...cue, clipName: clip.name, timelineFrame: clip.startFrame + cue.frame - clip.inFrame }))
  }).sort((a, b) => b.timelineFrame - a.timelineFrame), [clips, clipInfos])
  const currentCues = useMemo(() => {
    let low = 0, high = timelineCues.length
    while (low < high) {
      const middle = (low + high) >>> 1
      if (timelineCues[middle].timelineFrame > visibleFrame) low = middle + 1
      else high = middle
    }
    return timelineCues.slice(low, low + 8)
  }, [timelineCues, visibleFrame])

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
    setPausedPlayerFrame(null)
  }, [card?.id])

  useEffect(() => {
    const onFrame = event => {
      const detail = event.detail || {}
      const expectedCardId = editorMode ? (previewAnimation?.card_id || card?.id) : card?.id
      if (Number(detail.cardId) !== Number(expectedCardId)) return
      const now = performance.now()
      if (detail.playing && now - lastFrameUpdateRef.current < 50) return
      lastFrameUpdateRef.current = now
      setPlayerIsPlaying(Boolean(detail.playing))
      setPausedPlayerFrame(detail.playing ? null : Math.max(0, Math.round(Number(detail.frame) || 0)))
      if (Number(detail.maxFrame) > 0) setPlayerMaxFrame(Number(detail.maxFrame))
      if (editorMode && !followPlayer) return
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

  const patchSelected = changes => setClips(previous => updateTimelineClip(previous, selected?.id, changes))
  const removeSelected = () => {
    if (!selected) return
    const next = removeTimelineClip(clips, selected.id)
    setClips(next)
    setSelectedId(next[0]?.id || null)
  }
  const splitSelected = () => {
    if (!selected || visibleFrame < selected.startFrame || visibleFrame >= selected.startFrame + selected.outFrame - selected.inFrame) return
    const localFrame = Math.round(selected.inFrame + Math.max(0, Math.min(selected.outFrame - selected.inFrame, visibleFrame - selected.startFrame)))
    if (localFrame >= selected.outFrame) return
    const left = { ...selected, outFrame: localFrame }
    const right = { ...selected, id: `${selected.id}-split-${Date.now()}`, name: `${selected.name} · 2`, inFrame: localFrame + 1, startFrame: selected.startFrame + localFrame + 1 - selected.inFrame }
    setClips(previous => previous.flatMap(clip => clip.id === selected.id ? [left, right] : [clip]))
    setSelectedId(right.id)
  }
  const syncTimelineScroll = useCallback(event => {
    const left = event.currentTarget.scrollLeft
    timelineRef.current?.querySelectorAll('.lua-ruler-scroll, .lua-track-viewport').forEach(element => {
      if (element !== event.currentTarget) element.scrollLeft = left
    })
  }, [])

  const saveScript = async () => {
    if (!clips.length || !preparedExport.content?.trim() || exportError || busy) return
    setBusy(true); setMessage('')
    try {
      const saved = await api.saveCustomLua(preparedExport.filename, preparedExport.content)
      setSavedLuaRevision(value => value + 1)
      const archivePath = `lua/ab_script/${preparedExport.folder}/${saved.filename}`
      if (card?.id) onStageSaved?.({ source_path: saved.source_path, archive_path: archivePath, filename: saved.filename, target: preparedExport.folder, format: target })
      setMessage(card?.id
        ? (vi ? `Đã lưu ${saved.filename} vào game res/ab_script/custom_lua và thêm vào patch của thẻ #${card.id}.` : `Saved ${saved.filename} under game res/ab_script/custom_lua and staged it in card #${card.id}'s patch.`)
        : (vi ? `Đã lưu ${saved.filename} vào game res/ab_script/custom_lua. Chọn thẻ để thêm script vào patch.` : `Saved ${saved.filename} under game res/ab_script/custom_lua. Choose a card to stage it in a patch.`))
    } catch (error) {
      setMessage(error.message || (vi ? 'Không thể lưu Lua.' : 'Could not save Lua.'))
    } finally { setBusy(false) }
  }

  const previewScript = async () => {
    if (!clips.length || !preparedExport.content?.trim() || exportError || !previewCardId || busy) return
    previewRevisionRef.current += 1
    setAutoPreviewing(false)
    setBusy(true); setMessage('')
    try {
      const saved = await api.previewCustomLua(`timeline_${previewCardId}_draft`, preparedExport.content)
      onTimelinePlay?.({ id: Date.now(), sequence: [] })
      onPreviewChange?.({
        title: `${preparedExport.filename} · Preview`,
        name: saved.filename,
        type: vi ? 'Lua Timeline Draft' : 'Lua Timeline Draft',
        card_id: previewCardId,
        card_name: previewCardName,
        element: previewElement,
        preview_revision: Date.now(),
        script_path: `ab_script/custom_lua/${saved.filename}`
      })
      setMessage(vi ? `Đã nạp script ghép ${saved.filename} vào player.` : `Loaded the combined script ${saved.filename} in the player.`)
    } catch (error) {
      setMessage(error.message || (vi ? 'Không thể tạo preview.' : 'Could not create preview.'))
    } finally { setBusy(false) }
  }

  const changeFormat = nextTarget => {
    const nextFilename = nextTarget === 'active_ultimate' ? customLuaFilename(nextTarget, filename) : filename
    setTarget(nextTarget)
    setFilename(nextFilename)
    if (!canPlaceCustomDamage(nextTarget, nextFilename)) setDamageEnabled(false)
  }

  const captureDamageFrame = () => {
    if (!damageAvailable || !damageEnabled || removeDamageEnabled || playerIsPlaying || pausedPlayerFrame == null) return
    setDamageFrame(pausedPlayerFrame)
  }

  const timelineTracks = useMemo(() => clips.map((clip, index) => {
          const info = clipInfos.get(clip.id).info
          const duration = Math.max(1, clip.outFrame - clip.inFrame + 1)
          return <div className={`lua-track-row ${selected?.id === clip.id ? 'selected' : ''}`} key={clip.id} onClick={() => setSelectedId(clip.id)}>
            <div className="lua-track-label"><small>TRACK {index + 1}</small><strong title={clip.name}>{clip.name}</strong><span>{info.cues.length} {vi ? 'lệnh' : 'calls'}</span></div>
            <div className="lua-track-viewport" onScroll={syncTimelineScroll}><div className="lua-track-canvas" style={{ width: timelineWidth }}>
              <div className="lua-track-grid">{Array.from({ length: Math.ceil(totalFrames / 60) + 1 }, (_, i) => <i key={i} style={{ left: `${(i * 60 / totalFrames) * 100}%` }} />)}</div>
              <div className="lua-clip-block" style={{ left: `${(clip.startFrame / totalFrames) * 100}%`, width: `${Math.max(2, (duration / totalFrames) * 100)}%` }}>
                {info.cues.filter(cue => cue.frame >= clip.inFrame && cue.frame <= clip.outFrame).map(cue => <button type="button" key={`${cue.node.range[0]}-${cue.frame}`} className="lua-cue-marker" style={{ left: `${((cue.frame - clip.inFrame) / duration) * 100}%` }} title={`${cue.frame}f · ${cue.name}`} onClick={event => { event.stopPropagation(); setSelectedId(clip.id); setPlayhead(clip.startFrame + cue.frame - clip.inFrame); setSyncedFrame(null) }} />)}
              </div>
              <i className="lua-playhead" style={{ left: "var(--lua-playhead-position)" }} />
            </div></div>
          </div>
        }), [clips, clipInfos, selected?.id, totalFrames, timelineWidth, vi, syncTimelineScroll])

  return <section className="lua-studio-page">
    <header className="lua-studio-header">
      <div className="lua-studio-title"><span><Clapperboard size={20} /></span><div><h2>{vi ? 'Lua Animation Timeline' : 'Lua Animation Timeline'}</h2><p>{editorMode ? (vi ? 'Tìm animation, tải Lua, cắt ghép và xem thử script đã chỉnh.' : 'Search animations, fetch Lua, edit the timeline and preview your script.') : (vi ? 'Theo dõi script Lua theo animation đang phát ở player.' : 'Follow the Lua script for the animation playing in the player.')}</p></div></div>
      <div className="lua-studio-actions">
        <button type="button" className={`lua-action ${editorMode ? 'primary' : 'secondary'} lua-editor-mode-toggle`} onClick={onToggleEditorMode} aria-pressed={editorMode} title={vi ? 'Đổi player bên phải giữa animation thẻ và preview Lua' : 'Switch the right player between card animations and Lua preview'}><MonitorPlay size={15} />{editorMode ? (vi ? 'Player: Editor' : 'Player: Editor') : (vi ? 'Bật Editor Mode' : 'Enable Editor Mode')}</button>
        {editorMode && <>
          <input ref={fileRef} type="file" accept=".lua,text/plain" multiple hidden onChange={event => { void importFiles(event.target.files || []); event.target.value = '' }} />
          <button type="button" className="lua-action secondary" onClick={() => fileRef.current?.click()}><FolderPlus size={15} />{vi ? 'Thêm Lua' : 'Import Lua'}</button>
          <button type="button" className="lua-action primary" onClick={() => void saveScript()} disabled={!clips.length || !preparedExport.content?.trim() || Boolean(exportError) || busy}><Save size={15} />{busy ? (vi ? 'Đang lưu…' : 'Saving…') : (vi ? 'Lưu anim custom' : 'Save custom animation')}</button>
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
        <AnimationSearchFilter source language={language} value={searchBy} onChange={value => { setSearchBy(value); setSearchPage(1); setSelectedSourceCard(null); setSourceAnimations([]); setLoadingSourceAnimations(false) }} />
        <AnimationRarityFilter language={language} value={rarity} onChange={value => { setRarity(value); setSearchPage(1); setSelectedSourceCard(null); setSourceAnimations([]); setLoadingSourceAnimations(false) }} />
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
          {selectedSourceCard && visibleSourceAnimations.map((animation, index) => {
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
      <button type="button" className="lua-action secondary" disabled={!selected || visibleFrame < selected.startFrame || visibleFrame >= selected.startFrame + selected.outFrame - selected.inFrame} onClick={splitSelected}><Scissors size={14} />{vi ? 'Cắt tại playhead' : 'Split at playhead'}</button>
      <button type="button" className="lua-action secondary" disabled={!clips.length || !preparedExport.content?.trim() || Boolean(exportError) || busy || !previewCardId} onClick={() => void previewScript()}><MonitorPlay size={14} />{busy ? (vi ? 'Đang nạp script…' : 'Loading script…') : (vi ? 'Nạp script ghép vào player' : 'Load merged script in player')}</button>
      <span className="lua-frame-readout"><Clock3 size={14} />{Math.round(visibleFrame)} / {totalFrames}f</span>
      <div className="lua-damage-controls lua-damage-toolbar">
        <label className="lua-damage-check"><input type="checkbox" checked={removeDamageEnabled} onChange={event => { setRemoveDamageEnabled(event.target.checked); if (event.target.checked) setDamageEnabled(false) }} /><span>{vi ? 'Bỏ dealDamage' : 'Remove dealDamage'}</span></label>
        <label className="lua-damage-check"><input type="checkbox" checked={damageEnabled && damageAvailable} disabled={!damageAvailable || removeDamageEnabled} onChange={event => {
          setDamageEnabled(event.target.checked)
          if (event.target.checked) setDamageFrame(!playerIsPlaying && pausedPlayerFrame != null ? pausedPlayerFrame : Math.round(visibleFrame))
        }} /><span>{vi ? 'Đặt damage' : 'Set damage'}</span></label>
        <div className="lua-damage-frame">
          <label><span>{vi ? 'Frame' : 'Frame'}</span><input type="number" min="0" max={damageMaxFrame} step="1" value={damageFrame} disabled={!damageAvailable || !damageEnabled || removeDamageEnabled} onChange={event => setDamageFrame(event.target.value === '' ? '' : Number(event.target.value))} /></label>
          <button type="button" className="lua-action secondary" disabled={!damageAvailable || !damageEnabled || removeDamageEnabled || playerIsPlaying || pausedPlayerFrame == null} onClick={captureDamageFrame}><Pause size={14} />{vi ? `Lấy frame${pausedPlayerFrame == null ? '' : ` (${pausedPlayerFrame}f)`}` : `Use paused${pausedPlayerFrame == null ? '' : ` (${pausedPlayerFrame}f)`}`}</button>
        </div>
      </div>
    </div>}

    {editorMode && (!clips.length ? <div className="lua-studio-empty"><FileCode2 size={31} /><strong>{vi ? 'Nhập một hoặc nhiều file Lua để bắt đầu' : 'Import one or more Lua files to begin'}</strong><span>{vi ? 'Các lệnh theo frame sẽ hiện thành điểm đánh dấu trên timeline.' : 'Frame calls will appear as markers on the timeline.'}</span></div> : <>
      <div className="lua-timeline-shell" ref={timelineRef} style={{ "--lua-playhead-position": `${(visibleFrame / totalFrames) * 100}%` }}>
        <div className="lua-timeline-ruler"><div className="lua-timeline-label">{vi ? 'Track / file' : 'Track / file'}</div><div className="lua-ruler-scroll" onScroll={syncTimelineScroll}><div className="lua-ruler" style={{ width: timelineWidth }}>{Array.from({ length: Math.ceil(totalFrames / 60) + 1 }, (_, index) => <span key={index} style={{ left: `${(index * 60 / totalFrames) * 100}%` }}>{index * 60}f</span>)}</div></div></div>
        {timelineTracks}
      </div>
      <label className="lua-scrub-control"><span>{vi ? 'Vị trí player' : 'Player frame'}</span><input type="range" min="0" max={playerMaxFrame || totalFrames} step="1" value={Math.min(playerMaxFrame || totalFrames, visibleFrame)} onChange={event => { const value = Number(event.target.value); setPlayhead(value); setSyncedFrame(value); window.dispatchEvent(new CustomEvent('dokkan:anim-player-control', { detail: { action: 'seek', frame: value } })) }} /><strong>{Math.round(visibleFrame)}f</strong></label>

      <div className="lua-editor-grid">
        <section className="lua-panel lua-clip-panel"><header><FileCode2 size={15} /><strong>{vi ? 'Các đoạn script' : 'Script clips'}</strong><span>{clips.length}</span></header>
          <div className="lua-clip-list">{clips.map((clip, index) => <button type="button" key={clip.id} className={clip.id === selected?.id ? 'active' : ''} onClick={() => setSelectedId(clip.id)}><span>{index + 1}</span><strong>{clip.name}</strong><small>{clip.startFrame}f · {Math.max(0, clip.outFrame - clip.inFrame)}f</small></button>)}</div>
          <div className="lua-clip-tools"><button type="button" disabled={!selected} onClick={removeSelected}><Trash2 size={14} />{vi ? 'Xóa đoạn' : 'Remove clip'}</button></div>
        </section>
        <section className="lua-panel lua-code-panel"><header><FileCode2 size={15} /><strong>{selected?.name || (vi ? 'Mã nguồn' : 'Source')}</strong><span>{selectedInfo.lines.length} {vi ? 'dòng' : 'lines'}</span></header>
          {selectedInfo.error && <p className="lua-warning">{selectedInfo.error}</p>}
          {selectedInfo.unmapped?.length > 0 && <p className="lua-warning">{vi ? `${selectedInfo.unmapped.length} lệnh chưa xác định được frame. Cần sửa các biểu thức này trước khi ghép.` : `${selectedInfo.unmapped.length} calls have unresolved frames. Resolve these expressions before merging.`}</p>}
          {selected ? <><div className="lua-clip-fields">
            <label><span>{vi ? 'Tên đoạn' : 'Clip name'}</span><input value={selected.name} onChange={event => patchSelected({ name: event.target.value })} /></label>
            <label><span>{vi ? 'Vị trí trên timeline' : 'Timeline start'}</span><FrameInput key={`${selected.id}-start`} value={selected.startFrame} onCommit={startFrame => patchSelected({ startFrame })} /></label>
            <label><span>IN frame</span><FrameInput key={`${selected.id}-in`} max={selected.outFrame} value={selected.inFrame} onCommit={inFrame => patchSelected({ inFrame })} /></label>
            <label><span>OUT frame</span><FrameInput key={`${selected.id}-out`} min={selected.inFrame} value={selected.outFrame} onCommit={outFrame => patchSelected({ outFrame })} /></label>
          </div><p className="lua-browser-hint">{vi ? 'IN/OUT là frame của Lua nguồn. Nhấn Enter hoặc rời ô để áp dụng; các clip phía sau tự dời theo thời lượng mới.' : 'IN/OUT use source Lua frames. Press Enter or leave the field to apply; later clips shift with the new duration.'}</p><textarea className="lua-source-editor" spellCheck="false" value={selected.content} onChange={event => patchSelected({ content: event.target.value })} /></> : null}
        </section>
      </div>

      <section className="lua-panel lua-composed-panel"><header><FileCode2 size={15} /><strong>{vi ? 'Script ghép · bản nháp thứ ba' : 'Combined script · third draft'}</strong><span>{autoPreviewError || (autoPreviewing ? (vi ? 'Đang nạp vào player…' : 'Updating player…') : `${composedDraft.split(/\r?\n/).length} ${vi ? 'dòng' : 'lines'}`)}</span></header>
        <p className="lua-browser-hint">{vi ? 'Đổi thứ tự, IN/OUT hoặc mã nguồn sẽ tự ghép lại. Bạn có thể sửa trực tiếp bản ghép; preview và lưu sẽ áp dụng định dạng cùng frame damage ở mục Xuất script custom.' : 'Changing clip order, IN/OUT, or source rebuilds the draft. Edit it here; preview and save apply the format and damage frame selected below.'}</p>
        <textarea className="lua-source-editor" spellCheck="false" value={composedDraft} onChange={event => setComposedDraft(event.target.value)} placeholder={vi ? 'Script ghép sẽ xuất hiện ở đây…' : 'The merged script will appear here…'} />
      </section>

      <section className="lua-panel lua-live-panel"><header><Radio size={15} /><strong>{vi ? 'Lệnh được xếp lịch đến frame này' : 'Scheduled calls up to this frame'}</strong><span>{currentCues.length}</span></header>
        {currentCues.length ? <div className="lua-live-calls">{currentCues.map((cue, index) => <button type="button" key={`${cue.clipName}-${cue.lineIndex}-${index}`} onClick={() => { const clip = clips.find(item => item.name === cue.clipName); if (clip) setSelectedId(clip.id) }}><b>{cue.timelineFrame}f</b><span>{cue.clipName}</span><code>{cue.text.trim()}</code></button>)}</div> : <p className="lua-no-calls">{vi ? 'Chưa có lệnh nào trước playhead.' : 'No scheduled call before the playhead yet.'}</p>}
      </section>

      <section className="lua-panel lua-save-panel"><header><Save size={15} /><strong>{vi ? 'Xuất script custom' : 'Save custom script'}</strong></header>
        <div className="lua-save-fields"><label><span>{vi ? 'Tên file' : 'File name'}</span><input value={filename} onChange={event => setFilename(event.target.value)} /></label><label><span>{vi ? 'Định dạng animation' : 'Animation format'}</span><select value={target} onChange={event => changeFormat(event.target.value)}>{CUSTOM_LUA_FORMATS.map(format => <option key={format.id} value={format.id}>{vi ? format.vi : format.en}</option>)}</select></label></div>
        <div className="lua-export-guidance">
          <p>{target === 'entrance'
            ? (vi ? 'Entrance tự comment toàn bộ dealDamage và setDamage. Không thêm damage vào animation xuất trận.' : 'Entrance comments out all dealDamage and setDamage calls.')
              : damageAvailable
              ? (vi ? 'Bật tùy chọn để thay mọi dealDamage cũ bằng một lệnh tại frame này. Tạm dừng player rồi bấm Dùng frame đang pause, hoặc nhập frame.' : 'Enable to replace existing dealDamage calls with one call at this frame. Pause the player and capture its frame, or enter a frame.')
              : (vi ? 'Chỉ Super Attack, đòn Active Skill ut*.lua và Finish Skill cho phép đặt frame damage.' : 'A custom damage frame is available only for Super Attack, Active Skill ut*.lua, and Finish Skill.')}</p>
        </div>
        {exportError && <p className="lua-export-error" role="alert">{exportError}</p>}
        <p>{vi ? `File lưu: ${preparedExport.filename || filename}.lua → lua/ab_script/${exportFolder}/. Bản nguồn được lưu riêng tại game res/ab_script/custom_lua.` : `Saved file: ${preparedExport.filename || filename}.lua → lua/ab_script/${exportFolder}/. The source is stored under game res/ab_script/custom_lua.`}</p>
        {preparedExport.content && <details><summary>{vi ? 'Xem Lua sẽ preview và lưu' : 'View the Lua used for preview and save'}</summary><pre>{preparedExport.content}</pre></details>}
      </section>
      {message && <p className="lua-studio-message" role="status">{message}</p>}
    </>)}
    {editorMode && <CustomLuaTransfer card={card} onDone={onAnimationTransferred} results={transferredAnimations} refreshKey={savedLuaRevision}
      canPreview={Boolean(previewCardId && onPreviewChange)} onPreview={savedFilename => {
        previewRevisionRef.current += 1
        onTimelinePlay?.({ id: Date.now(), sequence: [] })
        onPreviewChange?.({ title: `${savedFilename} · Preview`, name: savedFilename, type: 'Lua Custom',
          card_id: previewCardId, card_name: previewCardName, element: previewElement,
          preview_revision: Date.now(), script_path: `ab_script/custom_lua/${savedFilename}` })
        setMessage(`Đã nạp ${savedFilename} vào player.`)
      }} />}
  </section>
}
