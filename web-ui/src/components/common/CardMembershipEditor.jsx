import React, { useEffect, useState } from 'react'
import { Link, Tags, X, Search, Copy } from 'lucide-react'
import { api } from '../../api'

function MembershipList({ title, icon, options, selected, onChange, max, loading, error, onRetry, ready, onCopy, onCombine, inlinePanel }) {
  const [query, setQuery] = useState('')
  const names = new Map(options.map(item => [Number(item.id), item]))
  const term = query.trim().toLocaleLowerCase()
  const matches = options.filter(item => `${item.name} ${item.id}`.toLocaleLowerCase().includes(term))
  const toggle = id => {
    if (selected.includes(id)) onChange(selected.filter(value => value !== id))
    else if (!max || selected.length < max) onChange([...selected, id])
  }
  return <section className="form-card membership-card">
    <div className="form-header" style={{ justifyContent: 'space-between' }}>
      <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>{icon}<strong>{title} ({selected.length}{max ? `/${max}` : ''})</strong></span>
      <span style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {onCombine && <button type="button" className="btn secondary-btn" onClick={onCombine}><Copy size={14} /> Kết hợp với thẻ khác</button>}
        <button type="button" className="btn secondary-btn" onClick={onCopy}><Copy size={14} /> Sao chép từ thẻ khác</button>
      </span>
    </div>
    {inlinePanel}
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
  const [copyTarget, setCopyTarget] = useState('')
  const [copyMode, setCopyMode] = useState('replace')
  const [copyQuery, setCopyQuery] = useState('')
  const [copyResults, setCopyResults] = useState([])
  const [copyPaging, setCopyPaging] = useState({ total: 0, totalPages: 1, page: 1 })
  const [copyPage, setCopyPage] = useState(1)
  const [copyLoading, setCopyLoading] = useState(false)
  const [copyError, setCopyError] = useState('')
  const [copySource, setCopySource] = useState(null)
  const [copySourceLoading, setCopySourceLoading] = useState(false)
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
  useEffect(() => {
    const term = copyQuery.trim()
    if (!copyTarget || !term) { setCopyResults([]); setCopyLoading(false); return undefined }
    const controller = new AbortController()
    setCopyLoading(true)
    setCopyError('')
    const timer = setTimeout(() => {
      api.getCards({ q: term, rarities: '5,4,3,2,1,0', page: copyPage, limit: 24, databaseSource: true }, controller.signal)
        .then(data => {
          if (controller.signal.aborted) return
          setCopyResults(data.items || [])
          setCopyPaging(data)
        })
        .catch(err => { if (err.name !== 'AbortError') setCopyError(err.message) })
        .finally(() => { if (!controller.signal.aborted) setCopyLoading(false) })
    }, 220)
    return () => { clearTimeout(timer); controller.abort() }
  }, [copyTarget, copyQuery, copyPage])

  const chooseCopySource = async source => {
    setCopySourceLoading(true)
    setCopyError('')
    try {
      const detail = await api.getSourceCard(source.id)
      setCopySource({ ...source, categories: detail.categories || [], links: detail.links || [] })
    } catch (err) { setCopyError(`Không tải được dữ liệu thẻ nguồn: ${err.message}`) }
    finally { setCopySourceLoading(false) }
  }
  const startCopy = (target, mode = 'replace') => {
    setCopyTarget(current => current === target && copyMode === mode ? '' : target)
    setCopyMode(mode)
    setCopyQuery('')
    setCopyPage(1)
    setCopySource(null)
    setCopyError('')
  }
  const applyCopy = () => {
    if (!copySource) return
    if (copyTarget === 'categories') {
      const sourceIds = copySource.categories.map(Number)
      const currentIds = (draft.category_ids ?? categories).map(Number)
      onChange('category_ids', copyMode === 'combine' ? [...new Set([...currentIds, ...sourceIds])] : [...new Set(sourceIds)])
    }
    if (copyTarget === 'links') onChange('link_skill_ids', [...new Set(copySource.links.map(item => Number(item.id)))].slice(0, 7))
    setCopyTarget('')
  }
  const status = { loading, error, ready: Boolean(catalog), onRetry: () => setReload(value => value + 1) }
  const linkIds = draft.link_skill_ids ?? Array.from({ length: 7 }, (_, index) => Number(draft[`link_skill${index + 1}_id`] ?? card[`link_skill${index + 1}_id`] ?? 0)).filter(id => id > 0)
  const linkOptions = [...new Map([...links, ...(catalog?.link_skills || meta?.link_skills || [])].map(item => [Number(item.id), item])).values()].sort((a, b) => a.name.localeCompare(b.name) || Number(a.id) - Number(b.id))
  const categoryOptions = catalog?.categories || Object.entries(meta?.categories || {}).map(([id, name]) => ({ id: Number(id), name }))
  const copyPicker = copyTarget && <div className="membership-copy-picker">
      <div className="form-header"><Search size={17} /><strong>{copyTarget === 'categories'
        ? (copyMode === 'combine' ? 'Kết hợp Character Categories' : 'Sao chép Character Categories')
        : 'Sao chép Link Skills'}</strong>
        <button type="button" className="btn ghost-btn" onClick={() => setCopyTarget('')}><X size={14} /> Đóng</button></div>
      <div className="form-field membership-search"><Search size={16} aria-hidden="true" />
        <input type="search" aria-label="Tìm thẻ để sao chép" placeholder="Tìm thẻ theo tên hoặc ID…" value={copyQuery}
          onChange={event => { setCopyQuery(event.target.value); setCopyPage(1); setCopySource(null) }} />
      </div>
      {copyError && <div className="membership-error"><span>{copyError}</span></div>}
      {copyLoading && <p className="hint-text">Đang tìm thẻ…</p>}
      {!copyQuery.trim() && <p className="hint-text">Nhập tên hoặc ID để tìm thẻ nguồn.</p>}
      {copyQuery.trim() && !copyLoading && !copyResults.length && !copyError && <p className="hint-text">Không tìm thấy thẻ.</p>}
      <div className="membership-options">{copyResults.map(source => <button type="button" key={source.id}
        className="btn secondary-btn" disabled={copySourceLoading} onClick={() => chooseCopySource(source)}>
        {source.name} <small>#{source.id}</small>
      </button>)}</div>
      {copyQuery.trim() && <div className="membership-result-count">
        {copyPaging.total || 0} kết quả · Trang {copyPage}/{copyPaging.totalPages || 1}
        <button type="button" className="btn ghost-btn" disabled={copyLoading || copyPage <= 1} onClick={() => setCopyPage(page => page - 1)}>Trước</button>
        <button type="button" className="btn ghost-btn" disabled={copyLoading || copyPage >= (copyPaging.totalPages || 1)} onClick={() => setCopyPage(page => page + 1)}>Sau</button>
      </div>}
      {copySource && <div className="membership-selected">
        <strong>{copySource.name} · #{copySource.id}</strong>
        <span className="hint-text">{copyTarget === 'categories'
          ? `${copySource.categories.length} categories: ${copySource.categories.map(id => categoryOptions.find(item => Number(item.id) === Number(id))?.name || `#${id}`).join(', ') || 'không có'}`
          : `${copySource.links.length} link skills: ${copySource.links.map(item => item.name).join(', ') || 'không có'}`}</span>
        <button type="button" className="btn primary-btn" onClick={applyCopy}><Copy size={14} /> {copyMode === 'combine' && copyTarget === 'categories' ? 'Xác nhận kết hợp' : 'Xác nhận sao chép'}</button>
      </div>}
      {copySourceLoading && <p className="hint-text">Đang tải membership của thẻ nguồn…</p>}
    </div>
  return <>
    <MembershipList {...status} title="Link Skills" icon={<Link size={18} />} options={linkOptions} selected={[...new Set(linkIds.map(Number))]} max={7} onChange={value => onChange('link_skill_ids', value)} onCopy={() => startCopy('links')} inlinePanel={copyTarget === 'links' ? copyPicker : null} />
    <MembershipList {...status} title="Character Categories" icon={<Tags size={18} />} options={categoryOptions} selected={[...new Set((draft.category_ids ?? categories).map(Number))]} onChange={value => onChange('category_ids', value)} onCopy={() => startCopy('categories', 'replace')} onCombine={() => startCopy('categories', 'combine')} inlinePanel={copyTarget === 'categories' ? copyPicker : null} />
  </>
}
