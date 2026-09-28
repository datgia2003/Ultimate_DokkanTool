import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { Disc, Play, Pause, Shuffle, Repeat, SkipForward, Volume2, VolumeX, Volume1, Music2, SlidersHorizontal, ChevronDown, Search, Check, Upload, Copy, CheckCircle2, AlertCircle, X } from 'lucide-react'
import { api } from '../../api'
import { createMusicSource } from '../../audio/musicSpectrum'
import { encodeLoopingWav } from '../../audio/wav'

export function BgmPlayer({ accent = '#06d6a0', language = 'vi', onImportCustomBgm, immersive = false }) {
  const [tracks, setTracks] = useState([])
  const [trackCatalogReady, setTrackCatalogReady] = useState(false)
  const [currentTrack, setCurrentTrack] = useState(null)
  const [isPlaying, setIsPlaying] = useState(false)
  const [volume, setVolume] = useState(0.30)
  const [isMuted, setIsMuted] = useState(false)
  const [isShuffle, setIsShuffle] = useState(true) // Default to auto-shuffle playlist like Streamlit
  const [trackFilter, setTrackFilter] = useState('all')
  const [isLoopOne, setIsLoopOne] = useState(false) // Single track repeat
  const [eqEnabled, setEqEnabled] = useState(true)
  const [trackNotice, setTrackNotice] = useState(null)
  const [trackMenuOpen, setTrackMenuOpen] = useState(false)
  const [trackQuery, setTrackQuery] = useState('')
  const [importBusy, setImportBusy] = useState(false)
  const [importToast, setImportToast] = useState(null)
  const audioRef = useRef(null)
  const importInputRef = useRef(null)
  const playerRef = useRef(null)
  const trackTriggerRef = useRef(null)
  const trackMenuRef = useRef(null)
  const [trackMenuPosition, setTrackMenuPosition] = useState({ left: 16, top: 56, width: 360 })
  const spectrumRef = useRef(null)
  const switchGeneration = useRef(0)
  const noticeTimer = useRef(0)
  const importToastTimer = useRef(0)
  const trackRetryTimer = useRef(0)
  const availableTracks = useMemo(() => tracks.filter(track =>
    trackFilter === 'all' || (trackFilter === 'custom' ? track.custom : !track.custom)), [tracks, trackFilter])
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

  useEffect(() => {
    let active = true
    let attempt = 0
    const scheduleRetry = () => {
      if (!active) return
      window.clearTimeout(trackRetryTimer.current)
      const delay = Math.min(5000, 350 * (2 ** Math.min(attempt, 4)))
      attempt++
      trackRetryTimer.current = window.setTimeout(() => { void loadTracks() }, delay)
    }
    const loadTracks = async () => {
      try {
        const res = await api.getBgmTracks()
        if (!active || !Array.isArray(res.tracks)) return
        setTracks(res.tracks)
        if (res.tracks.length > 0) {
          setTrackCatalogReady(true)
          setCurrentTrack(previous => res.tracks.find(track => track.id === previous?.id) || previous || res.tracks[0])
          attempt = 0
          window.clearTimeout(trackRetryTimer.current)
        } else {
          scheduleRetry()
        }
      } catch (err) {
        if (!active) return
        console.warn('Failed to load BGM tracklist; retrying:', err)
        scheduleRetry()
      }
    }
    const onCustomBgmAdded = () => { attempt = 0; void loadTracks() }
    void loadTracks()
    window.addEventListener('dokkan:custom-bgm-added', onCustomBgmAdded)
    return () => {
      active = false
      window.clearTimeout(trackRetryTimer.current)
      window.removeEventListener('dokkan:custom-bgm-added', onCustomBgmAdded)
    }
  }, [])

  useEffect(() => {
    if (audioRef.current) {
      audioRef.current.volume = isMuted ? 0 : volume
    }
  }, [volume, isMuted])

  useEffect(() => {
    spectrumRef.current?.setEqEnabled(eqEnabled)
  }, [eqEnabled])

  useEffect(() => () => { window.clearTimeout(noticeTimer.current); window.clearTimeout(importToastTimer.current) }, [])

  useEffect(() => {
    if (!trackMenuOpen) return
    const updatePosition = () => {
      const rect = trackTriggerRef.current?.getBoundingClientRect()
      if (!rect) return
      const width = Math.min(360, window.innerWidth - 32)
      const left = Math.max(16, Math.min(rect.left, window.innerWidth - width - 16))
      const below = rect.bottom + 8
      const top = below + 330 <= window.innerHeight - 12 ? below : Math.max(12, rect.top - 338)
      setTrackMenuPosition({ left, top, width })
    }
    updatePosition()
    const onPointerDown = (event) => {
      if (!playerRef.current?.contains(event.target) && !trackMenuRef.current?.contains(event.target)) setTrackMenuOpen(false)
    }
    const onKeyDown = (event) => {
      if (event.key === 'Escape') setTrackMenuOpen(false)
    }
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
    const pauseForCharacterOst = async () => {
      const generation = ++switchGeneration.current
      const audio = audioRef.current
      if (!audio || audio.paused) return
      await spectrumRef.current?.fadeTo(0, 260)
      if (generation !== switchGeneration.current) return
      audio.pause()
      spectrumRef.current?.setTransitionGain(1)
    }
    window.addEventListener('dokkan:character-ost-play', pauseForCharacterOst)
    return () => window.removeEventListener('dokkan:character-ost-play', pauseForCharacterOst)
  }, [])

  const handleTrackChange = (e) => {
    const bid = Number(e.target.value)
    const found = tracks.find(t => t.id === bid)
    if (found) {
      playSpecificTrack(found)
    }
  }

  const showTrackNotice = (track) => {
    window.clearTimeout(noticeTimer.current)
    setTrackNotice({ title: track.title, id: track.id })
    noticeTimer.current = window.setTimeout(() => setTrackNotice(null), 3000)
  }

  const playSpecificTrack = async (track) => {
    const audio = audioRef.current
    if (!audio || !track) return
    if (track.id === currentTrack?.id && !audio.paused) return
    const generation = ++switchGeneration.current
    const spectrum = spectrumRef.current
    if (!audio.paused) {
      if (spectrum) {
        const completed = await spectrum.fadeTo(0, 800)
        if (!completed || generation !== switchGeneration.current) return
      }
    }
    audio.pause()
    setCurrentTrack(track)
    audio.src = track.url
    audio.load()
    spectrum?.setTransitionGain(0)
    try {
      await audio.play()
      if (generation === switchGeneration.current) {
        setIsPlaying(true)
        showTrackNotice(track)
        void spectrum?.fadeTo(1, 650)
      }
    } catch (err) {
      if (generation === switchGeneration.current) {
        spectrum?.setTransitionGain(1)
        console.warn('Playback gesture error:', err)
      }
    }
  }

  useEffect(() => {
    if (currentTrack && availableTracks.some(track => track.id === currentTrack.id)) return
    const next = availableTracks[0] || null
    if (isPlaying && next) {
      void playSpecificTrack(next)
    } else {
      if (!next) audioRef.current?.pause()
      setCurrentTrack(next)
    }
  }, [availableTracks, currentTrack, isPlaying])

  const togglePlay = () => {
    if (!audioRef.current || !currentTrack) return
    switchGeneration.current++
    spectrumRef.current?.cancelFade()
    spectrumRef.current?.setTransitionGain(1)
    if (isPlaying) {
      audioRef.current.pause()
      setIsPlaying(false)
    } else {
      if (!audioRef.current.src || audioRef.current.src === window.location.href) {
        audioRef.current.src = currentTrack.url
      }
      audioRef.current.play()
        .then(() => setIsPlaying(true))
        .catch((err) => {
          console.warn('Playback error:', err)
        })
    }
  }

  const playRandomTrack = () => {
    if (!availableTracks.length) return
    const others = availableTracks.filter(t => t.id !== currentTrack?.id)
    const nextTrack = others.length > 0 ? others[Math.floor(Math.random() * others.length)] : availableTracks[0]
    if (nextTrack) {
      playSpecificTrack(nextTrack)
    }
  }

  const playNextTrack = () => {
    if (!availableTracks.length) return
    const curIdx = availableTracks.findIndex(t => t.id === currentTrack?.id)
    const nextIdx = (curIdx + 1) % availableTracks.length
    playSpecificTrack(availableTracks[nextIdx])
  }

  const changeTrackFilter = event => {
    setTrackFilter(event.target.value)
  }

  const handleTrackEnded = () => {
    spectrumRef.current?.stop()
    if (isLoopOne) {
      if (audioRef.current) {
        audioRef.current.currentTime = 0
        audioRef.current.play().catch(() => {})
      }
    } else if (isShuffle) {
      playRandomTrack()
    } else {
      playNextTrack()
    }
  }

  const toggleShuffle = () => {
    setIsShuffle(prev => {
      const nextVal = !prev
      if (nextVal) setIsLoopOne(false)
      return nextVal
    })
  }

  const toggleLoop = () => {
    setIsLoopOne(prev => {
      const nextVal = !prev
      if (nextVal) setIsShuffle(false)
      return nextVal
    })
  }

  const toggleMute = () => {
    setIsMuted(prev => !prev)
  }

  const toggleEq = () => setEqEnabled(value => !value)

  const showImportToast = (toast) => {
    window.clearTimeout(importToastTimer.current)
    setImportToast(toast)
    importToastTimer.current = window.setTimeout(() => setImportToast(null), toast.type === 'error' ? 8500 : 6500)
  }

  const importAudio = async (file) => {
    if (!file || importBusy) return
    setImportBusy(true)
    let context
    try {
      if (file.size > 120 * 1024 * 1024) throw new Error(vi ? 'Chọn file nhỏ hơn 120 MB.' : 'Choose a file smaller than 120 MB.')
      const AudioContextClass = window.AudioContext || window.webkitAudioContext
      if (!AudioContextClass || !window.OfflineAudioContext) throw new Error(vi ? 'Trình duyệt này chưa hỗ trợ giải mã audio.' : 'This browser cannot decode audio files.')
      context = new AudioContextClass()
      const decoded = await context.decodeAudioData(await file.arrayBuffer())
      if (decoded.duration > 600) throw new Error(vi ? 'Audio tối đa 10 phút.' : 'Audio must be 10 minutes or shorter.')
      const frameCount = Math.ceil(decoded.duration * 44100)
      if (frameCount * 4 > 110 * 1024 * 1024) throw new Error(vi ? 'WAV sau giải mã vượt 110 MB; hãy chọn audio ngắn hơn.' : 'Decoded WAV exceeds 110 MB; choose a shorter track.')
      const offline = new OfflineAudioContext(2, frameCount, 44100)
      const source = offline.createBufferSource()
      source.buffer = decoded
      source.connect(offline.destination)
      source.start(0)
      const wav = encodeLoopingWav(await offline.startRendering())
      const title = file.name.replace(/\.[^.]+$/, '').slice(0, 100) || 'Custom OST'
      const result = await api.importCustomBgm(new Blob([wav], { type: 'audio/wav' }), title)
      const asset = { id: result.id, title: result.title || title, path: result.path }
      onImportCustomBgm?.(asset)
      showImportToast({ type: 'success', title: vi ? 'Đã thêm OST tùy chỉnh' : 'Custom OST added', message: `${asset.title} · BGM #${result.id}`, id: result.id })
      window.dispatchEvent(new CustomEvent('dokkan:custom-bgm-added', { detail: { id: result.id } }))
    } catch (err) {
      showImportToast({ type: 'error', title: vi ? 'Không thể nhập OST' : 'OST import failed', message: err.message || (vi ? 'Không tạo được custom OST.' : 'Could not create the custom OST.') })
    } finally {
      await context?.close().catch(() => {})
      setImportBusy(false)
      if (importInputRef.current) importInputRef.current.value = ''
    }
  }

  const effectiveVolume = isMuted ? 0 : volume
  const vi = language !== 'en'
  const accentStyle = { '--ost-accent': accent, '--ost-accent-soft': `${accent}24`, '--ost-accent-line': `${accent}85` }

  return (
    <section className={`top-bgm-player ${immersive ? 'immersive' : ''}`} ref={playerRef} aria-label={vi ? 'Trình phát nhạc nền chung' : 'Global game music player'} style={accentStyle}>
      <audio
        ref={bindAudio}
        crossOrigin="anonymous" preload="none"
        loop={isLoopOne}
        onPlay={() => { setIsPlaying(true); window.dispatchEvent(new Event('dokkan:jukebox-play')); spectrumRef.current?.start() }}
        onPause={() => { setIsPlaying(false); spectrumRef.current?.stop() }}
        onEnded={handleTrackEnded}
        onError={() => { setIsPlaying(false); spectrumRef.current?.stop() }}
      />

      {/* Mini Spinning Vinyl Disc */}
      <div className={`bgm-disc-icon ${isPlaying ? 'spinning' : ''}`} aria-hidden="true">
        <Disc size={16} />
      </div>

      <div className="bgm-select-wrap">
        <span className="bgm-caption"><Music2 size={12} /> GAME OST <i /> {tracks.length === 0 && !trackCatalogReady ? (vi ? 'Đang kết nối…' : 'Connecting…') : `${availableTracks.length} ${vi ? 'bài' : 'tracks'}`}</span>
        <button ref={trackTriggerRef} type="button" className="bgm-track-trigger" aria-haspopup="dialog" aria-expanded={trackMenuOpen}
          onClick={() => { setTrackMenuOpen(value => !value); setTrackQuery('') }} title={vi ? 'Chọn nhạc nền' : 'Choose background music'}>
          <span>{currentTrack?.title || (vi ? 'Chọn nhạc nền' : 'Choose background music')}</span><ChevronDown size={12} />
        </button>
        {trackMenuOpen && createPortal(<div ref={trackMenuRef} className="bgm-track-menu" role="dialog" aria-label={vi ? 'Chọn nhạc nền' : 'Choose background music'} style={{ ...accentStyle,
          position: 'fixed', left: trackMenuPosition.left, top: trackMenuPosition.top, width: trackMenuPosition.width }}>
          <label className="bgm-track-search"><Search size={13} /><input autoFocus value={trackQuery}
            onChange={event => setTrackQuery(event.target.value)} placeholder={vi ? 'Tìm tên OST hoặc mã BGM…' : 'Search OST title or BGM ID…'} /></label>
          <div className="bgm-track-options">
            {availableTracks.filter(track => !trackQuery || track.title.toLowerCase().includes(trackQuery.toLowerCase()) || String(track.id).includes(trackQuery)).length === 0
              ? <p className="bgm-track-empty">{vi ? 'Không tìm thấy OST phù hợp' : 'No matching OST found'}</p>
              : availableTracks.filter(track => !trackQuery || track.title.toLowerCase().includes(trackQuery.toLowerCase()) || String(track.id).includes(trackQuery))
              .map(track => <button type="button" role="option" aria-selected={track.id === currentTrack?.id}
                className={`bgm-track-option ${track.id === currentTrack?.id ? 'selected' : ''}`} key={track.id}
                onClick={() => { handleTrackChange({ target: { value: track.id } }); setTrackMenuOpen(false) }}>
                <span className="bgm-track-option-title">{track.title}</span>{!track.title.includes(`(BGM #${track.id})`) && <small>BGM #{track.id}</small>}
                {track.id === currentTrack?.id && <Check size={13} />}
              </button>)}
          </div>
        </div>, document.body)}
      </div>

      <div className="bgm-controls">
        <label className="bgm-filter-wrap" title={vi ? 'Lọc danh sách OST' : 'Filter OST library'}>
          <SlidersHorizontal size={12} aria-hidden="true" />
          <select aria-label={vi ? 'Lọc OST: Tất cả, gốc hoặc tùy chỉnh' : 'Filter OST: All, Original, or Custom'} value={trackFilter} onChange={changeTrackFilter}>
            <option value="all">{vi ? 'Tất cả' : 'All'}</option>
            <option value="original">{vi ? 'Gốc' : 'Original'}</option>
            <option value="custom">Custom OST</option>
          </select>
        </label>
        <input ref={importInputRef} className="custom-bgm-file-input" type="file" accept=".mp3,.wav,audio/mpeg,audio/wav"
          onChange={event => void importAudio(event.target.files?.[0])} />
        <button type="button" className="bgm-btn custom-bgm-import" onClick={() => importInputRef.current?.click()} disabled={importBusy}
          aria-label={vi ? 'Nhập OST tùy chỉnh' : 'Import custom OST'}
          title={vi ? 'Nhập MP3/WAV vào thư viện OST chung' : 'Import MP3/WAV into the global OST library'}>
          <Upload size={12} />
        </button>
        <button
          type="button"
          className={`bgm-btn primary-play ${isPlaying ? 'playing' : ''}`}
          onClick={togglePlay}
          disabled={!currentTrack}
          title={isPlaying ? "Pause BGM" : "Play BGM"}
        >
          {isPlaying ? <Pause size={14} fill="currentColor" /> : <Play size={14} fill="currentColor" />}
        </button>

        <button
          type="button"
          className="bgm-btn next"
          onClick={isShuffle ? playRandomTrack : playNextTrack}
          disabled={availableTracks.length <= 1}
          title="Next Track"
        >
          <SkipForward size={12} />
        </button>

        <button
          type="button"
          className={`bgm-btn eq ${eqEnabled ? 'active' : ''}`}
          onClick={toggleEq}
          aria-pressed={eqEnabled}
          title={eqEnabled ? 'EQ đang bật · nhấn để tắt' : 'EQ đang tắt · nhấn để bật'}
        >
          <SlidersHorizontal size={12} />
        </button>

        <button
          type="button"
          className={`bgm-btn shuffle ${isShuffle ? 'active' : ''}`}
          onClick={toggleShuffle}
          title={isShuffle ? "Shuffle Auto-Play: ON" : "Shuffle Auto-Play: OFF"}
        >
          <Shuffle size={12} />
        </button>

        <button
          type="button"
          className={`bgm-btn loop ${isLoopOne ? 'active' : ''}`}
          onClick={toggleLoop}
          title={isLoopOne ? "Repeat Single Track: ON" : "Repeat Single Track: OFF"}
        >
          <Repeat size={12} />
        </button>

        {/* Inline Draggable Volume Slider */}
        <div className="bgm-vol-inline">
          <button
            type="button"
            className="bgm-btn vol"
            onClick={toggleMute}
            title={isMuted ? "Unmute BGM" : "Mute BGM"}
          >
            {effectiveVolume === 0 ? <VolumeX size={12} /> : effectiveVolume < 0.5 ? <Volume1 size={12} /> : <Volume2 size={12} />}
          </button>

          <input
            type="range"
            min="0"
            max="1"
            step="0.01"
            value={effectiveVolume}
            onChange={(e) => {
              setVolume(Number(e.target.value))
              if (isMuted) setIsMuted(false)
            }}
            className="bgm-vol-slider-inline"
            title={`Volume: ${Math.round(effectiveVolume * 100)}%`}
          />
        </div>
      </div>
      {trackNotice && <div className="bgm-track-notice" role="status" aria-live="polite" style={accentStyle}>
        <span className="bgm-notice-icon"><Music2 size={17} /></span>
        <span className="bgm-notice-copy"><small>{vi ? 'ĐANG PHÁT' : 'NOW PLAYING'}</small><strong>{trackNotice.title}</strong></span>
        {!trackNotice.title.includes(`(BGM #${trackNotice.id})`) && <span className="bgm-notice-id">BGM #{trackNotice.id}</span>}
      </div>}
      {importToast && createPortal(<div className={`custom-bgm-toast ${importToast.type}`} role="status" aria-live="polite" style={accentStyle}>
        <span className="custom-bgm-toast-icon">{importToast.type === 'success' ? <CheckCircle2 size={19} /> : <AlertCircle size={19} />}</span>
        <span className="custom-bgm-toast-copy"><strong>{importToast.title}</strong><small>{importToast.message}</small>
          {importToast.type === 'success' && <small className="custom-bgm-toast-hint">{vi ? 'Đã lưu trong game res/bgm ost/custom ost và có trong OST chung.' : 'Saved under game res/bgm ost/custom ost and added to the global OST list.'}</small>}
        </span>
        {importToast.id && <button type="button" className="custom-bgm-toast-copy-id" onClick={() => void navigator.clipboard?.writeText(String(importToast.id))} title={vi ? 'Sao chép BGM ID' : 'Copy BGM ID'}><Copy size={13} /> #{importToast.id}</button>}
        <button type="button" className="custom-bgm-toast-close" onClick={() => setImportToast(null)} aria-label={vi ? 'Đóng thông báo' : 'Dismiss notification'}><X size={15} /></button>
      </div>, document.body)}
    </section>
  )
}
