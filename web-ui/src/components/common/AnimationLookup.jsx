import React, { useEffect, useState } from 'react'
import { api } from '../../api'
import { AnimationChoice } from './AnimationChoice'
import { AnimationRarityFilter, AnimationPagination, AnimationSearchFilter } from './AnimationBrowserControls'

export function AnimationLookup({ slot, onSelect, label = 'Tra cứu anim cùng loại' }) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [items, setItems] = useState([])
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [rarity, setRarity] = useState('')
  const [searchBy, setSearchBy] = useState('card_name')
  const [page, setPage] = useState(1)
  const [paging, setPaging] = useState({ total: 0, totalPages: 1 })
  useEffect(() => {
    if (!open || !query.trim()) { setItems([]); setLoading(false); setError(''); return }
    setLoading(true)
    setItems([])
    const controller = new AbortController()
    const timer = setTimeout(() => {
      setLoading(true)
      setError('')
      api.lookupAnimations(slot, query.trim(), controller.signal, { rarity, page, search_by: searchBy })
        .then(data => { if (!controller.signal.aborted) { setItems(data.items || []); setPaging(data); setPage(data.page) } })
        .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [open, query, slot, rarity, page, searchBy])
  return <div className="animation-lookup">
    <button className="btn secondary-btn" type="button" onClick={() => setOpen(!open)}>{label}</button>
    {open && <div className="animation-lookup-panel">
      <div className="animation-search-controls">
        <input aria-label="Tìm animation cùng loại" placeholder="Nhập từ khóa theo kiểu tìm đã chọn" value={query} onChange={e => { setQuery(e.target.value); setPage(1) }} />
        <AnimationSearchFilter value={searchBy} onChange={value => { setSearchBy(value); setPage(1) }} />
        <AnimationRarityFilter value={rarity} onChange={value => { setRarity(value); setPage(1) }} />
      </div>
      {error && <p className="passive-compiler-error">{error}</p>}
      {loading && <small>Đang tìm…</small>}
      {!query.trim() && <small>Nhập tên hoặc ID để tra cứu animation.</small>}
      {!!query.trim() && !loading && !error && !items.length && <small>Không tìm thấy animation cùng loại.</small>}
      <div className="animation-lookup-results">{items.map((item, index) => <AnimationChoice
        key={`${item.id}-${item.card_id}-${index}`} cardId={item.card_id} cardName={item.name}
        title={item.move_name} tag={item.move_tag} rarity={item.rarity} detail={`ID ${item.id} · ${item.script_name} · Dùng ID này`}
        onClick={() => { onSelect(Number(item.id), item); setOpen(false) }} />)}</div>
      {!!query.trim() && <AnimationPagination {...paging} page={page} loading={loading} onChange={setPage} />}
    </div>}
  </div>
}
