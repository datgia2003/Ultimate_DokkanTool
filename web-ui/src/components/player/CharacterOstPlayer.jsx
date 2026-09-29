import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Disc3, Pause, Play, SlidersHorizontal, Volume2, ChevronDown, Search, Check } from 'lucide-react'
import { api } from '../../api'
import { createMusicSource } from '../../audio/musicSpectrum'
import { draftAnimationReferences } from './draftAnimations'

function collectTracks(cardData, draft, chainTracks, draftPassiveAnimations = []) {
  const tracks = new Map()
  const passiveDraftChanged = Object.prototype.hasOwnProperty.call(draft, 'passive_skills') ||
    (draft.deleted_rows || []).some(row => ['passive_skills', 'passive_skill_set_relations'].includes(row.table))
  const currentCardId = cardData?.card?.id
    const currentCard = {
    id: currentCardId,
    name: draft.name ?? cardData?.card?.name ?? `Card #${currentCardId}`,
    rarity: draft.rarity ?? cardData?.card?.rarity,
    element: draft.element ?? cardData?.card?.element,
  }
  const add = (id, source, card = currentCard) => {
    const bid = Number(id)
    if (Number.isInteger(bid) && bid > 0) {
      const shortSource = ({
        'Active Theme': 'Active Skill Theme',
        'Finish Theme': 'Finish Skill Theme',
        'Standby Skill Theme': 'Standby Theme'
      })[source] || source
      const formId = card.id || currentCardId || 'unknown'
      const key = `${formId}:${bid}`
      const entry = tracks.get(key) || { key, id: bid, card_id: formId, sources: [] }
      if (!entry.sources.includes(shortSource)) entry.sources.push(shortSource)
      tracks.set(key, entry)
    }
  }
  for (const track of chainTracks) {
    const draftOverridesCurrentEx = Number(track.card_id) === Number(currentCardId) && track.source_type === 'ex_super_attack' && draft.card_specials !== undefined
    const draftOverridesCurrentPassiveOst = Number(track.card_id) === Number(currentCardId) && passiveDraftChanged &&
      /^(entrance|revival) theme$/i.test(String(track.source || ''))
    const legacyLabel = track.label || ''
    const legacySeparator = legacyLabel.lastIndexOf(' · ')
    const legacySource = legacySeparator >= 0 ? legacyLabel.slice(legacySeparator + 3) : ''
    const trackCard = Number(track.card_id) === Number(currentCardId) ? { ...track, ...currentCard } : track
    if (!draftOverridesCurrentEx && !draftOverridesCurrentPassiveOst) add(track.id, track.source || legacySource || 'Character Theme', trackCard)
  }
  if (!passiveDraftChanged) {
    for (const effect of cardData?.passive?.effects || []) add(effect.bgm_id, effect.script_name ? `Entrance Theme · ${effect.script_name}` : 'Entrance Theme')
  }
  for (const animation of draftPassiveAnimations) {
    const type = animation.type_key === 'revival' ? 'Revival Theme' : 'Entrance Theme'
    add(animation.bgm_id, `${type}${animation.name ? ` · ${animation.name}` : ''}`)
  }
  add((draft.active_set || cardData?.active?.set)?.bgm_id, 'Active Skill Theme')
  add((draft.standby_set || cardData?.standby?.set)?.bgm_id, 'Standby Theme')
  for (const [index, finish] of (draft.finish_skill_sets || cardData?.finish || []).entries()) {
    add(finish.set?.bgm_id, `Finish Skill Theme ${index + 1}`)
  }
  for (const special of draft.card_specials || cardData?.specials || []) {
    add(special.extra_special_option?.bgm_id, 'EX Super Attack Theme')
  }
  return [...tracks.values()].map(({ key, id, sources }) => ({
    key, id, label: `${sources.join(' / ')} - BGM #${id}`
  }))
}

export function CharacterOstPlayer({ cardData, draft, accent = '#06d6a0', language = 'vi' }) {
  const [chainOst, setChainOst] = useState({ cardId: null, items: [] })
  const [draftPassiveOst, setDraftPassiveOst] = useState([])
  const chainTracks = chainOst.cardId === cardData?.card?.id ? chainOst.items : []
  const draftPassiveReferences = useMemo(() => draftAnimationReferences(cardData, draft).references
    .filter(reference => reference.slot === 'entrance' || reference.slot === 'revival'), [cardData, draft])
  const tracks = useMemo(() => {
    return collectTracks(cardData, draft, chainTracks, draftPassiveOst)
  }, [cardData, draft, chainTracks, draftPassiveOst])
  const [selectedTrackKey, setSelectedTrackKey] = useState(null)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [trackQuery, setTrackQuery] = useState('')
  const [playing, setPlaying] = useState(false)
  const [volume, setVolume] = useState(0.30)
  const [punch, setPunch] = useState(false)
  const [error, setError] = useState('')
  const audioRef = useRef(null)
  const playerRef = useRef(null)
  const trackTriggerRef = useRef(null)
  const trackMenuRef = useRef(null)
  const [trackMenuPosition, setTrackMenuPosition] = useState({ left: 16, top: 56, width: 440 })
  const spectrumRef = useRef(null)
  const bindAudio = useCallback((element) => {
    audioRef.current = element
    if (element) {
      if (spectrumRef.current?.audio === element) return
      spectrumRef.current?.dispose()
      spectrumRef.current = createMusicSource(element)
    } else {
      // React StrictMode briefly detaches and reattaches the same DOM element.
      // Release only a real unmount; each media element may be connected once.
      const previous = spectrumRef.current
      queueMicrotask(() => {
        if (!audioRef.current && spectrumRef.current === previous) {
          previous?.dispose()
          spectrumRef.current = null
        }
      })
    }
  }, [])
  const switchGeneration = useRef(0)
  const activeTrack = tracks.find(track => track.key === selectedTrackKey) || tracks[0]
  const id = activeTrack?.id
  const vi = language !== 'en'
  const accentStyle = { '--ost-accent': accent, '--ost-accent-soft': `${accent}24`, '--ost-accent-line': `${accent}85` }

  useEffect(() => {
    const cardId = cardData?.card?.id
    setChainOst({ cardId, items: [] })
    if (!cardId) return
    const controller = new AbortController()
    api.getCharacterOst(cardId, controller.signal)
      .then((result) => setChainOst({ cardId, items: result.items || [] }))
      .catch((err) => { if (err.name !== 'AbortError') setChainOst({ cardId, items: [] }) })
    return () => controller.abort()
  }, [cardData?.card?.id])

  useEffect(() => {
    if (!draftPassiveReferences.length) {
      setDraftPassiveOst([])
      return undefined
    }
    const controller = new AbortController()
    api.resolveDraftAnimations({ references: draftPassiveReferences, converted: [] }, controller.signal)
      .then(result => { if (!controller.signal.aborted) setDraftPassiveOst((result.items || []).filter(item => Number(item.bgm_id) > 0)) })
      .catch(error => { if (error.name !== 'AbortError') setDraftPassiveOst([]) })
    return () => controller.abort()
  }, [draftPassiveReferences])

  useEffect(() => {
    if (!trackMenuOpen) return
    const updatePosition = () => {
      const rect = trackTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(440, window.innerWidth - 32)
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
      const below = rect.bottom + 7
      const top = below + 330 <= window.innerHeight - 12 ? below : Math.max(12, rect.top - 338)
      setTrackMenuPosition({ left, top, width })
    }
    updatePosition()
    const onPointerDown = event => {
      if (!playerRef.current?.contains(event.target) && !trackMenuRef.current?.contains(event.target)) setTrackMenuOpen(false)
    }
    const onKeyDown = event => { if (event.key === 'Escape') setTrackMenuOpen(false) }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [trackMenuOpen])

  useEffect(() => {
    switchGeneration.current++
    spectrumRef.current?.cancelFade()
    spectrumRef.current?.setTransitionGain(1)
    audioRef.current?.pause()
    audioRef.current?.removeAttribute('src')
    setPlaying(false)
    window.dispatchEvent(new CustomEvent('dokkan:character-ost-state', { detail: { playing: false } }))
    setSelectedTrackKey(null)
    setError('')
  }, [cardData?.card?.id])

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume
  }, [volume])

  useEffect(() => {
    spectrumRef.current?.setPunch(punch)
  }, [punch, id])

  useEffect(() => {
    const pauseWhenHidden = () => { if (document.hidden) audioRef.current?.pause() }
    const pauseForJukebox = async () => {
      const generation = ++switchGeneration.current
      const audio = audioRef.current
      if (!audio || audio.paused) return
      await spectrumRef.current?.fadeTo(0, 260)
      if (generation !== switchGeneration.current) return
      audio.pause()
      spectrumRef.current?.setTransitionGain(1)
    }
    document.addEventListener('visibilitychange', pauseWhenHidden)
    window.addEventListener('dokkan:jukebox-play', pauseForJukebox)
    return () => {
      document.removeEventListener('visibilitychange', pauseWhenHidden)
      window.removeEventListener('dokkan:jukebox-play', pauseForJukebox)
    }
  }, [])

  const stopSpectrum = () => spectrumRef.current?.stop()
  const startSpectrum = () => spectrumRef.current?.start()

  const selectTrack = async (nextTrack) => {
    if (!nextTrack || nextTrack.key === activeTrack?.key) return
    const nextId = nextTrack.id
    if (nextId === id) {
      setSelectedTrackKey(nextTrack.key)
      return
    }
    const generation = ++switchGeneration.current
    const audio = audioRef.current
    const resume = Boolean(audio && !audio.paused)
    if (resume && spectrumRef.current) {
      const completed = await spectrumRef.current.fadeTo(0, 650)
      if (!completed || generation !== switchGeneration.current) return
    }
    if (generation !== switchGeneration.current) return
    setSelectedTrackKey(nextTrack.key)
    audio?.pause()
    spectrumRef.current?.setTransitionGain(resume ? 0 : 1)
    setError('')
    if (!audio) return
    audio.src = nextTrack.localUrl || `/bgm/${nextId}`
    if (resume) {
      try {
        await audio.play()
        if (generation === switchGeneration.current) void spectrumRef.current?.fadeTo(1, 500)
      } catch {
        if (generation === switchGeneration.current) {
          spectrumRef.current?.setTransitionGain(1)
          setError(vi ? 'Không tải được OST này' : 'Unable to load this OST')
        }
      }
    }
  }

  const play = async () => {
    if (!id || !audioRef.current) return
    try {
      setError('')
      const wanted = activeTrack?.localUrl || new URL(`/bgm/${id}`, window.location.href).href
      if (audioRef.current.src !== wanted) audioRef.current.src = wanted
      setSelectedTrackKey(activeTrack?.key || null)
      await audioRef.current.play()
    } catch {
    setError(vi ? 'Không tải được OST này' : 'Unable to load this OST')
    }
  }

  if (!tracks.length) return <div className="character-ost empty" ref={playerRef} style={accentStyle}><Disc3 size={16} /><span>{vi ? 'Chưa có OST gắn với nhân vật này' : 'No OST is linked to this character'}</span></div>

  return <div className="character-ost" ref={playerRef} style={accentStyle}>
    <audio ref={bindAudio} crossOrigin="anonymous" loop preload="none"
      onPlay={() => {
        setPlaying(true)
        startSpectrum()
        window.dispatchEvent(new Event('dokkan:character-ost-play'))
        window.dispatchEvent(new CustomEvent('dokkan:character-ost-state', { detail: { playing: true } }))
      }} onPlaying={startSpectrum} onPause={() => {
        setPlaying(false)
        stopSpectrum()
        window.dispatchEvent(new CustomEvent('dokkan:character-ost-state', { detail: { playing: false } }))
      }}
      onError={() => {
        setPlaying(false)
        stopSpectrum()
        window.dispatchEvent(new CustomEvent('dokkan:character-ost-state', { detail: { playing: false } }))
        setError(vi ? 'Không tải được OST này' : 'Unable to load this OST')
      }} />
    <span className="character-ost-title"><Disc3 size={16} className={playing ? 'ost-spinning' : ''} /> {vi ? 'OST NHÂN VẬT' : 'CHARACTER OST'}</span>
    <div className="character-ost-picker">
      <button ref={trackTriggerRef} type="button" className="character-ost-track-trigger" aria-haspopup="dialog" aria-expanded={trackMenuOpen}
        onClick={() => { setTrackMenuOpen(value => !value); setTrackQuery('') }} title={vi ? 'Chọn OST của nhân vật' : 'Choose character OST'}>
        <span>{activeTrack?.label}</span><ChevronDown size={12} />
      </button>
      {trackMenuOpen && createPortal(<div ref={trackMenuRef} className="bgm-track-menu character-ost-track-menu"
        role="dialog" aria-label={vi ? 'Chọn OST của nhân vật' : 'Choose character OST'}
        style={{ ...accentStyle, position: 'fixed', left: trackMenuPosition.left, top: trackMenuPosition.top, width: trackMenuPosition.width }}>
        <label className="bgm-track-search"><Search size={13} /><input autoFocus value={trackQuery}
          onChange={event => setTrackQuery(event.target.value)} placeholder={vi ? 'Tìm tên thẻ, chiêu hoặc mã BGM…' : 'Search card, attack or BGM ID…'} /></label>
        <div className="bgm-track-options">
          {tracks.filter(track => !trackQuery || track.label.toLowerCase().includes(trackQuery.toLowerCase()) || String(track.id).includes(trackQuery)).length === 0
            ? <p className="bgm-track-empty">{vi ? 'Không tìm thấy OST phù hợp' : 'No matching OST found'}</p>
            : tracks.filter(track => !trackQuery || track.label.toLowerCase().includes(trackQuery.toLowerCase()) || String(track.id).includes(trackQuery))
            .map(track => <button type="button" role="option" aria-selected={track.key === activeTrack?.key}
              className={`bgm-track-option ${track.key === activeTrack?.key ? 'selected' : ''}`} key={track.key}
              onClick={() => { void selectTrack(track); setTrackMenuOpen(false) }}>
              <span className="bgm-track-option-title">{track.label}</span>
              {track.key === activeTrack?.key && <Check size={13} />}
            </button>)}
        </div>
      </div>, document.body)}
    </div>
    <button type="button" onClick={() => {
      switchGeneration.current++
      spectrumRef.current?.cancelFade()
      spectrumRef.current?.setTransitionGain(1)
      if (playing) audioRef.current?.pause()
      else void play()
    }} title={playing ? (vi ? 'Tạm dừng OST' : 'Pause OST') : (vi ? 'Phát OST' : 'Play OST')}>
      {playing ? <Pause size={15} fill="currentColor" /> : <Play size={15} fill="currentColor" />}
    </button>
    <button type="button" className={`ost-punch-btn ${punch ? 'active' : ''}`}
      aria-label={vi ? 'Tăng độ nổi của OST' : 'Boost OST presence'} aria-pressed={punch}
      title={punch ? (vi ? 'Punch EQ: bật (tăng bass và độ sáng)' : 'Punch EQ: on (boost bass and brightness)') : (vi ? 'Punch EQ: tắt' : 'Punch EQ: off')}
      onClick={() => setPunch(value => !value)}>
      <SlidersHorizontal size={14} />
    </button>
    <Volume2 size={15} className="character-ost-volume-icon" />
    <input aria-label={vi ? 'Âm lượng OST' : 'OST volume'} type="range" min="0" max="1" step="0.05" value={volume}
      onChange={(e) => { const next = Number(e.target.value); setVolume(next); if (audioRef.current) audioRef.current.volume = next }} />
    {error && <span className="character-ost-error">{error}</span>}
  </div>
}
