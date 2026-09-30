import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Play, Pause, Volume2, VolumeX, Gauge, RotateCcw, RefreshCw, Film, AlertCircle, Swords, Zap, Sparkles, HeartPulse, Flame, Target, ChevronRight, ChevronLeft
} from 'lucide-react'
import { api, getModWorkspace } from '../../api'
import { getElementMeta } from '../../types'
import { draftAnimationReferences } from './draftAnimations'
const EMPTY_DRAFT = {}
const EMPTY_CONVERTED = []

const CATEGORIES = [
  { id: 'all', label: 'All' },
  { id: 'entrance', label: 'Intro', icon: Sparkles },
  { id: 'super_attack', label: 'Super', icon: Zap },
  { id: 'active', label: 'Active', icon: Flame },
  { id: 'revival', label: 'Revival', icon: HeartPulse },
  { id: 'transform', label: 'Form', icon: RotateCcw },
  { id: 'counter', label: 'Counter / Nullify', icon: Swords },
  { id: 'standby_finish', label: 'Standby', icon: Target },
]

function categorizeAnim(item) {
  const cat = (item.category || '').toLowerCase()
  const typ = (item.type || '').toLowerCase()
  const key = (item.type_key || '').toLowerCase()
  const path = (item.script_path || '').toLowerCase()
  const title = (item.title || item.name || '').toLowerCase()
  const explicitCategory = { entrance: 'entrance', active: 'active', super: 'super_attack', standby: 'standby_finish', finish: 'standby_finish', transform: 'transform', revival: 'revival', counter: 'counter', nullify: 'counter' }[key]
  if (explicitCategory) return explicitCategory

  if (key === 'counter' || key === 'nullify' || typ.includes('counter') || typ.includes('nullif')) {
    return 'counter'
  }
  if (key === 'transform' || typ.includes('transformation') || cat.includes('transform') || path.includes('/tf') || title.includes('transform') || title.includes('awaken')) {
    return 'transform'
  }
  if (key === 'entrance' || typ === 'entrance' || cat.includes('entrance') || cat.includes('intro') || path.includes('/ps_') || path.includes('in0')) {
    return 'entrance'
  }
  if (typ === 'revival' || cat.includes('revival') || path.includes('/revival/')) {
    return 'revival'
  }
  if (key === 'active' || typ === 'active_skill' || typ === 'ultimate_special' || cat.includes('active') || path.includes('/active/') || path.includes('bs0') || path.includes('ut0')) {
    return 'active'
  }
  if (key === 'super' || typ === 'super_attack' || cat.includes('super') || path.includes('/attack_sp/') || path.includes('sp0')) {
    return 'super_attack'
  }
  if (key === 'standby' || key === 'finish' || typ === 'standby' || typ === 'finish' || cat.includes('standby') || cat.includes('finish') || path.includes('stb0') || path.includes('fi0')) {
    return 'standby_finish'
  }
  return 'other'
}

function animationTag(item) {
  if (item.move_tag) return item.move_tag
  const tags = { entrance: 'Entrance', active: 'Active', super: 'SA', standby: 'Standby', finish: 'Finish', transform: 'Transform', revival: 'Revival', counter: 'Counter', nullify: 'Nullify' }
  return tags[item.type_key] || { entrance: 'Entrance', active: 'Active', super_attack: 'SA', standby_finish: 'Standby / Finish', transform: 'Transform', revival: 'Revival', counter: 'Counter / Nullify' }[categorizeAnim(item)] || item.type || 'Animation'
}

function isExtremeAnimation(item) {
  return [item?.name, item?.title, item?.animation_name, item?.move_name]
    .some(value => String(value || '').toLowerCase().includes('(extreme)'))
}

function animationKey(item) {
  return [item?.type_key || item?.type, item?.passive_skill_id || item?.special_view_id || item?.effect_id || '', item?.script_path].join(':')
}

export function AnimPlayer({ card, cardData, draft = EMPTY_DRAFT, convertedAnimations = EMPTY_CONVERTED, isCollapsed, onToggleCollapse, editorMode = false, previewAnimation = null, timelinePlayback = null, language = 'vi' }) {
  const [baseAnimations, setBaseAnimations] = useState([])
  const [loadedCardId, setLoadedCardId] = useState(null)
  const previousAnimations = useRef([])
  const draftPayload = JSON.stringify({
    ...draftAnimationReferences(cardData, draft),
    converted: convertedAnimations.map(({ target_slot, target_pse_id, special_view_id, script_name, bgm_id, source_name }) =>
      ({ target_slot, target_pse_id, special_view_id, script_name, bgm_id, source_name }))
  })
  const [animations, setAnimations] = useState([])
  const [selectedAnim, setSelectedAnim] = useState(null)
  const [activeCategory, setActiveCategory] = useState('all')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [refreshingScript, setRefreshingScript] = useState('')
  const [enemyCards, setEnemyCards] = useState([])
  const [enemyPickerOpen, setEnemyPickerOpen] = useState(false)
  const [enemyQuery, setEnemyQuery] = useState('')
  const [enemyCardsLoading, setEnemyCardsLoading] = useState(false)
  const [enemyVisibleLimit, setEnemyVisibleLimit] = useState(100)
  const enemyCardsLoadedRef = useRef(false)
  const enemyPickerRef = useRef(null)

  // Controls moved from sidebar inside iframe to top toolbar
  const [isPlaying, setIsPlaying] = useState(true)
  const [isHighSpeed, setIsHighSpeed] = useState(false)
  const [isSoundOn, setIsSoundOn] = useState(true) // Default sound ON as requested!
  const [enemyId, setEnemyId] = useState(1033701) // Default Saibaiman opponent
  const filteredEnemyCards = useMemo(() => {
    const query = enemyQuery.trim().toLocaleLowerCase()
    return query ? enemyCards.filter(item => String(item.name || '').toLocaleLowerCase().includes(query)) : enemyCards
  }, [enemyCards, enemyQuery])
  const visibleEnemyCards = useMemo(() => filteredEnemyCards.slice(0, enemyVisibleLimit), [filteredEnemyCards, enemyVisibleLimit])
  const [koScreen, setKoScreen] = useState(true)
  const [voiceLang, setVoiceLang] = useState('ja')
  const [timelineSegment, setTimelineSegment] = useState(null)
  const timelineSequenceRef = useRef(null)
  const timelineIndexRef = useRef(0)
  const timelineStartedRef = useRef(false)

  const iframeRef = useRef(null)

  useEffect(() => {
    if (!card?.id) {
      setAnimations([])
      setSelectedAnim(null)
      setLoading(false)
      setError('')
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)
    setError('')
    setBaseAnimations([])
    previousAnimations.current = []
    setAnimations([]) // Immediately clear old animations so cards never share or leak anims
    setSelectedAnim(null)
    setActiveCategory('all')

    api.getAnimations(card.id, controller.signal)
      .then((res) => {
        if (active) {
          const list = (res.items || []).filter(item => !isExtremeAnimation(item))
          setLoadedCardId(card.id)
          setBaseAnimations(list)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        if (active) {
          setError(err.message)
          setLoading(false)
        }
      })

    return () => { active = false; controller.abort() }
  }, [card?.id])

  useEffect(() => {
    if (!enemyPickerOpen) return undefined
    const closeOnOutsideClick = event => {
      if (!enemyPickerRef.current?.contains(event.target)) {
        setEnemyPickerOpen(false)
        setEnemyQuery('')
      }
    }
    const closePicker = () => { setEnemyPickerOpen(false); setEnemyQuery('') }
    document.addEventListener('pointerdown', closeOnOutsideClick, true)
    document.addEventListener('focusin', closeOnOutsideClick, true)
    window.addEventListener('blur', closePicker)
    return () => {
      document.removeEventListener('pointerdown', closeOnOutsideClick, true)
      document.removeEventListener('focusin', closeOnOutsideClick, true)
      window.removeEventListener('blur', closePicker)
    }
  }, [enemyPickerOpen])

  useEffect(() => {
    if (!card?.id || loadedCardId !== card.id) return
    const controller = new AbortController()
    const { references, replaceSlots, converted } = JSON.parse(draftPayload)
    const accept = (draftItems) => {
      const linked = new Set(baseAnimations.filter(item => !replaceSlots.includes(item.type_key))
        .map(item => `${item.type_key === 'entrance' ? 'effect' : 'view'}:${item.effect_id || item.special_view_id}`))
      const list = [
        ...baseAnimations.filter(item => !replaceSlots.includes(item.type_key)),
        ...draftItems.filter(item => !item.draft_key?.startsWith('converted:') ||
          !linked.has(`${item.type_key === 'entrance' ? 'effect' : 'view'}:${item.effect_id || item.special_view_id}`))
      ].filter(item => !isExtremeAnimation(item))
      const previous = previousAnimations.current
      const changed = (previous.length ? [...list].reverse() : list).find(item => item.script_path && !previous.some(old => animationKey(old) === animationKey(item)))
      previousAnimations.current = list
      setAnimations(list)
      setSelectedAnim(current => changed || list.find(item => animationKey(item) === animationKey(current)) || list[0] || null)
      if (changed) setActiveCategory('all')
    }
    if (!replaceSlots.length && !converted.length) {
      accept([])
      return () => controller.abort()
    }
    const timer = setTimeout(() => {
      api.resolveDraftAnimations({ references, converted }, controller.signal)
        .then(data => { if (!controller.signal.aborted) { setError(''); accept(data.items || []) } })
        .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
    }, 180)
    return () => { clearTimeout(timer); controller.abort() }
  }, [card?.id, loadedCardId, baseAnimations, draftPayload])

  const categorizedList = useMemo(() => {
    return animations.map(a => ({
      ...a,
      detectedCat: categorizeAnim(a)
    }))
  }, [animations])

  const filteredAnimations = useMemo(() => {
    if (activeCategory === 'all') return categorizedList
    return categorizedList.filter(a => a.detectedCat === activeCategory)
  }, [categorizedList, activeCategory])

  const categoryCounts = useMemo(() => {
    const counts = { all: animations.length }
    for (const a of categorizedList) {
      counts[a.detectedCat] = (counts[a.detectedCat] || 0) + 1
    }
    return counts
  }, [animations.length, categorizedList])

  useEffect(() => {
    if (!editorMode || !timelinePlayback?.sequence?.length) {
      timelineSequenceRef.current = null
      timelineStartedRef.current = false
      setTimelineSegment(null)
      return
    }
    timelineSequenceRef.current = timelinePlayback.sequence
    timelineIndexRef.current = 0
    timelineStartedRef.current = false
    setTimelineSegment(timelinePlayback.sequence[0])
  }, [editorMode, timelinePlayback?.id])

  const displayedAnim = editorMode ? (timelineSegment || previewAnimation) : selectedAnim
  const script = displayedAnim?.script_path
  const renderCardId = editorMode ? (displayedAnim?.card_id || card?.id) : card?.id
  const isReactionAnim = displayedAnim?.type_key === 'counter' || displayedAnim?.type_key === 'nullify'
  const effectiveKoScreen = koScreen && !isReactionAnim
  const selectedAnimRefreshable = /^ab_script\/(?:passive_skill_effect|active_skill|attack_sp|standby_skill|finish_skill|revival|attack_counter|ab_sys)\/[A-Za-z0-9_.-]+\.lua$/i.test(selectedAnim?.script_path || '')

  const triggerRender = () => {
    if (iframeRef.current?.contentWindow && script) {
      try {
        iframeRef.current.contentWindow.postMessage({
          isStreamlitMessage: true,
          type: "streamlit:render",
          args: {
            card_id: renderCardId,
            script_path: script,
            special_name_no: displayedAnim?.special_name_no ?? 0,
            // The merged Lua draft overwrites a stable preview path. Include
            // its revision so the iframe bridge doesn't deduplicate a fresh
            // render just because the filename stayed the same.
            render_revision: displayedAnim?.preview_revision || 0,
            server_port: 8585,
            enemy_card_id: Number(enemyId) || 1033701,
            ko_preview: effectiveKoScreen,
            compact: true,
            inline: true,
            voice_language: voiceLang,
            muted: !isSoundOn,
            high_speed: isHighSpeed
          }
        }, "*")
      } catch (e) {}
    }
  }

  // Handle Play/Pause
  const handleTogglePlay = () => {
    setIsPlaying(prev => !prev)
    iframeRef.current?.contentWindow?.postMessage({
      type: "dokkan:control",
      action: "togglePlay"
    }, "*")
  }

  // Handle 1x / 2x Speed
  const handleToggleSpeed = () => {
    setIsHighSpeed(prev => !prev)
    iframeRef.current?.contentWindow?.postMessage({
      type: "dokkan:control",
      action: "toggleSpeed"
    }, "*")
  }

  // Handle Sound ON / Mute
  const handleToggleSound = () => {
    setIsSoundOn(prev => !prev)
    iframeRef.current?.contentWindow?.postMessage({
      type: "dokkan:control",
      action: "toggleSound"
    }, "*")
  }

  const handleRefreshAnimation = async item => {
    if (!item?.script_path || refreshingScript) return
    setRefreshingScript(item.script_path)
    setError('')
    try {
      const refreshed = await api.refreshLuaSource(item.script_path)
      if (!String(refreshed.text || '').trim()) throw new Error('Lua tải lại đang trống.')
      setSelectedAnim({ ...item, preview_revision: Date.now() })
    } catch (err) {
      setError(err.message || 'Không tải lại được animation.')
    } finally {
      setRefreshingScript('')
    }
  }

  const openEnemyPicker = async () => {
    setEnemyQuery('')
    setEnemyVisibleLimit(100)
    setEnemyPickerOpen(true)
    if (enemyCardsLoadedRef.current || enemyCardsLoading) return
    setEnemyCardsLoading(true)
    try {
      const result = await api.getEnemyCards()
      setEnemyCards(result.items || [])
      enemyCardsLoadedRef.current = true
    } catch (err) {
      setError(err.message || 'Không tải được danh sách thẻ đối thủ.')
    } finally {
      setEnemyCardsLoading(false)
    }
  }

  const chooseEnemy = item => {
    setEnemyId(Number(item.id))
    setEnemyQuery('')
    setEnemyPickerOpen(false)
  }

  // Handle Voice Language change
  const handleVoiceLangChange = (lang) => {
    setVoiceLang(lang)
    iframeRef.current?.contentWindow?.postMessage({
      type: "dokkan:control",
      action: "setVoiceLang",
      lang
    }, "*")
  }

  // Handle K.O. Cutscene toggle
  const handleToggleKo = () => {
    if (isReactionAnim) return
    const nextVal = !koScreen
    setKoScreen(nextVal)
    iframeRef.current?.contentWindow?.postMessage({
      type: "dokkan:control",
      action: "setKo",
      enabled: nextVal
    }, "*")
  }

  // Notify on stream ready
  useEffect(() => {
    const handleMsg = (event) => {
      if (event?.data?.type === "streamlit:componentReady") {
        triggerRender()
      }
      if (event?.data?.type === "dokkan:lua-frame" && event.source === iframeRef.current?.contentWindow) {
        setIsPlaying(Boolean(event.data.playing))
        const sequence = timelineSequenceRef.current
        const segment = sequence?.[timelineIndexRef.current]
        if (editorMode && segment && Number(event.data.cardId || renderCardId) === Number(segment.card_id || card?.id)) {
          if (!timelineStartedRef.current) {
            timelineStartedRef.current = true
            iframeRef.current?.contentWindow?.postMessage({ type: 'dokkan:control', action: 'seek', frame: segment.inFrame || 0, playAfterSeek: true }, '*')
          } else if (Number(event.data.frame) >= Number(segment.outFrame)) {
            iframeRef.current?.contentWindow?.postMessage({ type: 'dokkan:control', action: 'pause' }, '*')
            const nextIndex = timelineIndexRef.current + 1
            if (nextIndex < sequence.length) {
              timelineIndexRef.current = nextIndex
              timelineStartedRef.current = false
              setTimelineSegment(sequence[nextIndex])
            } else {
              timelineSequenceRef.current = null
              setIsPlaying(false)
            }
          }
        }
        window.dispatchEvent(new CustomEvent('dokkan:anim-frame', { detail: { ...event.data, cardId: renderCardId } }))
      }
    }
    window.addEventListener("message", handleMsg)
    return () => window.removeEventListener("message", handleMsg)
  }, [script, renderCardId, enemyId, effectiveKoScreen, voiceLang])

  useEffect(() => {
    const onTimelineControl = event => {
      const action = event.detail?.action
      if (action === 'seek') {
        setIsPlaying(false)
        iframeRef.current?.contentWindow?.postMessage({ type: 'dokkan:control', action, frame: event.detail?.frame }, '*')
        return
      }
      if (!['play', 'pause'].includes(action)) return
      setIsPlaying(action === 'play')
      iframeRef.current?.contentWindow?.postMessage({ type: 'dokkan:control', action }, '*')
    }
    window.addEventListener('dokkan:anim-player-control', onTimelineControl)
    return () => window.removeEventListener('dokkan:anim-player-control', onTimelineControl)
  }, [])

  // Reload only for a different card/script. K.O. and voice toggles use controls.
  useEffect(() => {
    triggerRender()
    setIsPlaying(true)
  }, [enemyId, script, renderCardId, editorMode, displayedAnim?.preview_revision])

  useEffect(() => {
    const detail = script ? {
      ...displayedAnim,
      title: displayedAnim?.title || displayedAnim?.name || displayedAnim?.type || 'Animation',
      card_id: renderCardId,
      card_name: editorMode ? previewAnimation?.card_name : card?.name,
      player_mode: editorMode ? 'editor' : 'normal',
      script_path: script
    } : null
    window.__DOKKAN_ACTIVE_ANIMATION__ = detail
    window.dispatchEvent(new CustomEvent('dokkan:anim-selection', { detail }))
  }, [script, renderCardId, editorMode, displayedAnim?.name, displayedAnim?.title, displayedAnim?.type, card?.name, previewAnimation?.card_name])

  if (!card) return null

  if (isCollapsed) {
    return (
      <aside className="anim-studio-dock collapsed" onClick={onToggleCollapse} title="Open Animation Studio">
        <button className="expand-dock-btn">
          <ChevronLeft size={16} />
          <Film size={15} />
        </button>
      </aside>
    )
  }

  // The URL does not auto-load the bank: the bridge receives exactly one render
  // message. Recreate the iframe for a new script to release decoded textures.
  const previewElement = editorMode ? (previewAnimation?.element ?? card.element) : card.element
  const iframeSrc = script ? `/player/index.html?compact=1&mod_workspace=${getModWorkspace()}&element_color=${encodeURIComponent(getElementMeta(previewElement).color)}` : ''

  return (
    <aside className={`anim-studio-dock ${editorMode ? 'lua-editor-player-mode' : ''}`}>
      {/* Top Streamlined Toolbar: Sound, Play, Speed, Enemy, K.O, Voice */}
      <div className="dock-toolbar">
        <div className="dock-toolbar-group">
          {/* Sound Toggle - Default ON */}
          <button
            type="button"
            className={`dock-ctrl-btn ${isSoundOn ? 'active' : ''}`}
            onClick={handleToggleSound}
            title={isSoundOn ? "Sound is ON (Click to Mute)" : "Sound is MUTED (Click to Turn ON)"}
          >
            {isSoundOn ? <Volume2 size={13} /> : <VolumeX size={13} />}
            <span>{isSoundOn ? 'Sound' : 'Mute'}</span>
          </button>

          {/* Play / Pause Toggle */}
          <button
            type="button"
            className="dock-ctrl-btn"
            onClick={handleTogglePlay}
            title={isPlaying ? "Pause Animation" : "Play Animation"}
          >
            {isPlaying ? <Pause size={13} /> : <Play size={13} />}
            <span>{isPlaying ? 'Pause' : 'Play'}</span>
          </button>

          {/* Speed Toggle: 1x / 2x */}
          <button
            type="button"
            className={`dock-ctrl-btn ${isHighSpeed ? 'active' : ''}`}
            onClick={handleToggleSpeed}
            title="Toggle Speed 1x / 2x"
          >
            <Gauge size={13} />
            <span>{isHighSpeed ? '2x' : '1x'}</span>
          </button>
        </div>

        <div className="dock-toolbar-group right">
          {/* Enemy Card ID Input */}
          <div className="toolbar-item enemy-picker" title="Enemy card" ref={enemyPickerRef}>
            <span className="tiny-label"><Swords size={11} /></span>
            <input
              type="text"
              className="tiny-input enemy-picker-input"
              value={String(enemyId)}
              onFocus={() => void openEnemyPicker()}
              onChange={event => {
                const value = event.target.value
                if (/^\d*$/.test(value)) setEnemyId(Number(value) || 1033701)
              }}
              title="Select enemy by name or enter card ID"
              autoComplete="off"
              aria-label={language === 'en' ? 'Enemy character name or card ID' : 'Tên nhân vật hoặc ID thẻ đối thủ'}
              aria-expanded={enemyPickerOpen}
            />
            {enemyPickerOpen && <div className="enemy-picker-menu" role="dialog" aria-label={language === 'en' ? 'Choose enemy character' : 'Chọn nhân vật địch'}>
              <input className="enemy-picker-search" type="search" autoFocus value={enemyQuery}
                placeholder={language === 'en' ? 'Search character name…' : 'Tìm tên nhân vật…'}
                aria-label={language === 'en' ? 'Search character names' : 'Tìm tên nhân vật'}
                onChange={event => { setEnemyQuery(event.target.value); setEnemyVisibleLimit(100) }}
                onKeyDown={event => {
                  if (event.key === 'Escape') { setEnemyPickerOpen(false); setEnemyQuery('') }
                  if (event.key === 'Enter' && filteredEnemyCards.length) chooseEnemy(filteredEnemyCards[0])
                }} />
              <div className="enemy-picker-options" role="listbox" onScroll={event => {
                const node = event.currentTarget
                if (node.scrollHeight - node.scrollTop - node.clientHeight < 48 && enemyVisibleLimit < filteredEnemyCards.length) {
                  setEnemyVisibleLimit(limit => Math.min(filteredEnemyCards.length, limit + 100))
                }
              }}>
                {enemyCardsLoading ? <div className="enemy-picker-state">{language === 'en' ? 'Loading characters…' : 'Đang tải danh sách…'}</div>
                  : visibleEnemyCards.length ? visibleEnemyCards.map(item => <button type="button" role="option" key={item.id}
                    aria-selected={Number(item.id) === Number(enemyId)} onMouseDown={event => event.preventDefault()}
                    onClick={() => chooseEnemy(item)}>{item.name}</button>)
                    : <div className="enemy-picker-state">{language === 'en' ? 'No matching characters' : 'Không tìm thấy nhân vật'}</div>}
                {!enemyCardsLoading && !enemyQuery.trim() && enemyVisibleLimit < filteredEnemyCards.length &&
                  <div className="enemy-picker-hint">{language === 'en' ? 'Scroll or search for more names' : 'Cuộn hoặc tìm để xem thêm tên'}</div>}
              </div>
            </div>}
          </div>

          {/* K.O. Cutscene Toggle */}
          <button
            type="button"
            className={`dock-ctrl-btn ${effectiveKoScreen ? 'active' : ''}`}
            onClick={handleToggleKo}
            disabled={isReactionAnim}
            title={isReactionAnim ? 'Counter / Nullify không dùng K.O.' : koScreen ? "K.O. Cutscene: ON (Click to Turn OFF)" : "K.O. Cutscene: OFF (Click to Turn ON)"}
          >
            <Zap size={13} />
            <span>K.O.</span>
          </button>

          {/* Voice Language: JP / EN */}
          <select
            className="tiny-select"
            value={voiceLang}
            onChange={(e) => handleVoiceLangChange(e.target.value)}
            title="Voice Language (JP / EN)"
          >
            <option value="ja">JP</option>
            <option value="en">EN</option>
          </select>
          {onToggleCollapse && <button type="button" className="collapse-btn compact-collapse" onClick={onToggleCollapse} title="Thu gọn player"><ChevronRight size={14} /></button>}
        </div>
      </div>

      {/* Viewport Iframe (Fitting character stage with no side buttons) */}
      <div className="dock-viewport">
        {iframeSrc ? (
          <iframe
            ref={iframeRef}
            key={`${renderCardId || ''}_${script || ''}`}
            src={iframeSrc}
            title={editorMode ? 'Lua Timeline Animation Preview' : 'Dokkan Animation Player'}
            allow="autoplay"
            onLoad={triggerRender}
          />
        ) : (
          <div className="viewport-empty">
            <Film size={28} />
            <span>{editorMode ? (language === 'en' ? 'Search and import a Lua animation in the Timeline tab' : 'Tìm và nhập Lua animation trong tab Timeline') : loading ? 'Loading sequences...' : 'Select a move below'}</span>
          </div>
        )}
      </div>

      {editorMode ? (
        <div className="lua-preview-status">
          <strong>{displayedAnim?.title || displayedAnim?.name || (language === 'en' ? 'Lua editor preview' : 'Preview Lua editor')}</strong>
          <span>{displayedAnim ? `${displayedAnim.card_name || `#${renderCardId}`} · #${renderCardId} · ${displayedAnim.type || 'Animation'}` : (language === 'en' ? 'Import an animation from the Lua Timeline tab.' : 'Nhập animation từ tab Lua Timeline để xem trước.')}</span>
          {displayedAnim?.script_path && <code>{displayedAnim.script_path}</code>}
        </div>
      ) : <>
        {/* Categories Tabs Filter */}
        <div className="dock-categories-bar">
          {CATEGORIES.map((cat) => {
            const count = categoryCounts[cat.id] || 0
            if (cat.id !== 'all' && count === 0) return null
            const active = activeCategory === cat.id
            return (
              <button
                key={cat.id}
                className={`dock-cat-chip ${active ? 'active' : ''}`}
                onClick={() => setActiveCategory(cat.id)}
              >
                <span>{cat.label}</span>
                <small>{count}</small>
              </button>
            )
          })}
          <button type="button" className={`sequence-refresh-btn category-refresh-btn ${refreshingScript ? 'spinning' : ''}`}
            title={language === 'en' ? 'Delete cached Lua and download the selected animation again' : 'Xóa Lua đã tải và tải lại animation đang chọn'}
            aria-label={language === 'en' ? 'Refresh selected animation' : 'Tải lại animation đang chọn'}
            disabled={!selectedAnimRefreshable || Boolean(refreshingScript)} onClick={() => void handleRefreshAnimation(selectedAnim)}>
            <RefreshCw size={13} />
          </button>
        </div>

        {/* Sequence List */}
        <div className="dock-sequence-list">
          {error && (
            <div className="error-alert">
              <AlertCircle size={13} />
              <span>{error}</span>
            </div>
          )}

          {filteredAnimations.length === 0 ? (
            <div className="empty-moves">No animations in this category</div>
          ) : (
            filteredAnimations.map((item, idx) => {
              const isSelected = animationKey(selectedAnim) === animationKey(item)
              const rawTag = animationTag(item)
              const conditional = /\s*[·|]\s*Conditional\b/i.test(rawTag)
              const mainTag = rawTag.replace(/\s*[·|]\s*Conditional\b/i, '').trim()
              return (
                <button
                  type="button"
                  key={`${animationKey(item)}_${idx}`}
                  className={`sequence-item ${isSelected ? 'active' : ''}`}
                  onClick={() => setSelectedAnim(item)}
                  disabled={!item.script_path}
                >
                  <div className="seq-icon">
                    <Play size={11} fill="currentColor" />
                  </div>
                  <span className="seq-badge seq-type">{mainTag}</span>
                  <div className="seq-meta">
                    <div className="seq-top">
                      <strong>{item.title || item.name || `Move #${idx + 1}`}</strong>
                      <span className="seq-labels">
                        {conditional && <span className="seq-badge seq-conditional">Conditional</span>}
                        {item.badge && !/^content\s*script$/i.test(String(item.badge).trim()) && <span className="seq-badge">{item.badge}</span>}
                      </span>
                    </div>
                    <small>{item.script_path ? item.script_path.split('/').pop() : 'No script'}</small>
                  </div>
                </button>
              )
            })
          )}
        </div>
      </>}
    </aside>
  )
}
