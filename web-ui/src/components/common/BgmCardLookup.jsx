import React, { useEffect, useRef, useState } from 'react'
import { Disc3, Search, X } from 'lucide-react'
import { api } from '../../api'

export function BgmCardLookup({ onSelect }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [cards, setCards] = useState([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState('')
  const [selectedCard, setSelectedCard] = useState(null)
  const [tracks, setTracks] = useState([])
  const [loadingTracks, setLoadingTracks] = useState(false)
  const trackRequest = useRef(0)

  useEffect(() => {
    const term = query.trim()
    if (!open || !term) { setCards([]); setSearching(false); return undefined }
    const controller = new AbortController()
    setSearching(true)
    setError('')
    const timer = setTimeout(() => {
      api.getCards({ q: term, rarities: '5,4,3,2,1,0', limit: 24 }, controller.signal)
        .then(data => { if (!controller.signal.aborted) setCards(data.items || []) })
        .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
        .finally(() => { if (!controller.signal.aborted) setSearching(false) })
    }, 240)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, query])

  const loadCardOst = async card => {
    const requestId = ++trackRequest.current
    setSelectedCard(card)
    setTracks([])
    setLoadingTracks(true)
    setError('')
    try {
      const result = await api.getCharacterOst(card.id)
      if (requestId === trackRequest.current) setTracks(result.items || [])
    } catch (err) { if (requestId === trackRequest.current) setError(`Không tải được OST của thẻ: ${err.message}`) }
    finally { if (requestId === trackRequest.current) setLoadingTracks(false) }
  }

  return <div className="bgm-card-lookup">
    <button type="button" className="btn ghost-btn bgm-card-lookup-trigger" onClick={() => { setOpen(value => !value); trackRequest.current++; setLoadingTracks(false); setError('') }}>
      <Search size={13} /> Tìm BGM theo thẻ
    </button>
    {open && <div className="bgm-card-lookup-panel">
      <div className="bgm-card-lookup-head"><strong><Disc3 size={14} /> Tìm thẻ để xem OST</strong>
        <button type="button" className="btn ghost-btn" onClick={() => setOpen(false)} aria-label="Đóng"><X size={14} /></button>
      </div>
      <div className="form-field bgm-card-lookup-search"><Search size={14} />
        <input type="search" value={query} placeholder="Nhập tên hoặc ID thẻ…" aria-label="Tìm thẻ có OST"
          onChange={event => { trackRequest.current++; setLoadingTracks(false); setQuery(event.target.value); setSelectedCard(null); setTracks([]) }} />
      </div>
      {searching && <p className="hint-text">Đang tìm thẻ…</p>}
      {error && <p className="membership-error">{error}</p>}
      {query.trim() && !searching && !cards.length && !error && <p className="hint-text">Không tìm thấy thẻ.</p>}
      {!!cards.length && <div className="bgm-card-lookup-results">{cards.map(card => <button type="button" key={card.id}
        className={`bgm-card-lookup-card ${Number(selectedCard?.id) === Number(card.id) ? 'selected' : ''}`}
        onClick={() => loadCardOst(card)}>
        <img src={api.getThumbUrl(card.id, { element: card.element, rarity: card.rarity })} alt="" loading="lazy"
          onError={event => { event.currentTarget.style.visibility = 'hidden' }} />
        <span className="bgm-card-lookup-card-name">{card.name}<small>#{card.id}</small></span>
      </button>)}</div>}
      {loadingTracks && <p className="hint-text">Đang tải OST và các form trong chain…</p>}
      {selectedCard && !loadingTracks && <div className="bgm-card-lookup-track-list">
        <strong>{selectedCard.name} · OST trong transformation chain</strong>
        {!tracks.length && <p className="hint-text">Thẻ này chưa có BGM ID được khai báo.</p>}
        {tracks.map((track, index) => <button type="button" key={`${track.card_id}-${track.id}-${track.source}-${index}`}
          className="bgm-card-lookup-track" onClick={() => { onSelect(Number(track.id)); setOpen(false) }}>
          <span>{track.card_name || selectedCard.name}<small>{track.source || 'BGM'}</small></span>
          <strong>#{track.id}</strong>
        </button>)}
      </div>}
    </div>}
  </div>
}
