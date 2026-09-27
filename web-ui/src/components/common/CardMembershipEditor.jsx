import React, { useEffect, useState } from 'react'
import { Link, Tags, X, Search } from 'lucide-react'
import { api } from '../../api'

function MembershipList({ title, icon, options, selected, onChange, max, loading, error, onRetry, ready }) {
  const [query, setQuery] = useState('')
  const names = new Map(options.map(item => [Number(item.id), item]))
  const term = query.trim().toLocaleLowerCase()
  const matches = options.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(term))
  const toggle = id => {
    if (selected.includes(id)) onChange(selected.filter(value => value !== id))
    else if (!max || selected.length < max) onChange([...selected, id])
  }
  return <section className="form-card membership-card">
    <div className="form-header">{icon}<strong>{title} ({selected.length}{max ? `/${max}` : ''})</strong></div>
    <div className="membership-selected">
      {selected.map(id => <button key={id} type="button" className="category-chip" onClick={() => toggle(id)} title="Bỏ khỏi thẻ">
        {names.get(id)?.name || `#${id}`} <small>#{id}</small><X size={13} />
      </button>)}
      {!selected.length && <span className="hint-text">Chưa chọn mục nào.</span>}
    </div>
    <div className="form-field membership-search">
      <Search size={16} aria-hidden="true" />
      <input type="search" aria-label={`Tìm ${title}`} placeholder="Tìm theo tên hoặc ID…" value={query} onChange={e => setQuery(e.target.value)} />
    </div>
    {loading && <p className="hint-text">Đang tải toàn bộ danh sách…</p>}
    {error && <div className="membership-error"><span>{error}</span><button type="button" className="btn secondary-btn" onClick={onRetry}>Tải lại danh sách</button></div>}
    {ready && <div className="membership-result-count">{matches.length} / {options.length} kết quả · Chọn để thêm, bỏ chọn để gỡ</div>}
    {max && selected.length >= max && <p className="hint-text">Đã đủ {max} link skill. Bỏ một link trước khi chọn link khác.</p>}
    <div className="membership-options">
      {ready && matches.map(item => {
        const id = Number(item.id)
        const checked = selected.includes(id)
        return <label key={id} className="membership-option">
          <input type="checkbox" checked={checked} disabled={Boolean(!checked && max && selected.length >= max)} onChange={() => toggle(id)} />
          <span><strong>{item.name} <small>#{id}</small></strong>{item.description && <small>{item.description}</small>}</span>
        </label>
      })}
      {ready && !matches.length && <p className="hint-text">Không có kết quả.</p>}
    </div>
  </section>
}

export function CardMembershipEditor({ card, draft, onChange, categories = [], links = [], meta }) {
  const [catalog, setCatalog] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    setLoading(true)
    setError('')
    setCatalog(null)
    api.getCardMemberships(controller.signal).then(data => {
      if (!Array.isArray(data.link_skills) || !data.link_skills.length || !Array.isArray(data.categories)) throw new Error('API chưa trả đủ danh sách. Khởi động lại API rồi bấm tải lại.')
      if (!controller.signal.aborted) setCatalog(data)
    }).catch(err => {
      if (!controller.signal.aborted) setError(`Không tải được danh sách: ${err.message}`)
    }).finally(() => { if (!controller.signal.aborted) setLoading(false) })
    return () => controller.abort()
  }, [card.id, reload])
  const status = { loading, error, ready: Boolean(catalog), onRetry: () => setReload(value => value + 1) }
  const linkIds = draft.link_skill_ids ?? Array.from({ length: 7 }, (_, index) => Number(draft[`link_skill${index + 1}_id`] ?? card[`link_skill${index + 1}_id`] ?? 0)).filter(id => id > 0)
  const linkOptions = [...new Map([...links, ...(catalog?.link_skills || meta?.link_skills || [])].map(item => [Number(item.id), item])).values()].sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id))
  const categoryOptions = catalog?.categories || Object.entries(meta?.categories || {}).map(([id, name]) => ({ id: Number(id), name }))
  return <>
    <MembershipList {...status} title="Link Skills" icon={<Link size={18} />} options={linkOptions} selected={[...new Set(linkIds.map(Number))]} max={7} onChange={value => onChange('link_skill_ids', value)} />
    <MembershipList {...status} title="Character Categories" icon={<Tags size={18} />} options={categoryOptions} selected={[...new Set((draft.category_ids ?? categories).map(Number))]} onChange={value => onChange('category_ids', value)} />
  </>
}
