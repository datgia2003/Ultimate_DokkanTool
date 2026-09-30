import React, { useState, useEffect } from 'react'
import { Search, Flame, ChevronLeft, ChevronRight, Filter, PackageOpen, X, Settings } from 'lucide-react'
import { RarityBadge, ElementBadge } from '../common/CardBadge'
import { ELEMENT_TYPES, RARITY_MAP } from '../../types'
import { api } from '../../api'
import packageInfo from '../../../package.json'

export function Sidebar({ selectedId, onSelectCard, isOpen, onToggle, importedCards, importedMod, onCloseMod, onImportMod, importBusy, importError, performanceMode, onPerformanceModeChange, language, onLanguageChange }) {
  const [query, setQuery] = useState('')
  const [searchTerm, setSearchTerm] = useState('')
  const [rarities, setRarities] = useState([5]) // Start with LR only; other rarities remain available as filters.
  const [element, setElement] = useState('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState({ items: [], total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const isVi = language !== 'en'

  useEffect(() => {
    const timer = setTimeout(() => setSearchTerm(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])

  // Fetch cards whenever filters or page changes
  useEffect(() => {
    if (importedCards) {
      const q = searchTerm.toLowerCase()
      const items = importedCards.filter(card =>
        Number(card.id) % 10 !== 0 &&
        !/volume|title\s*page/i.test(String(card.name || '')) &&
        (!q || String(card.id).includes(q) || String(card.name).toLowerCase().includes(q)) &&
        rarities.includes(Number(card.rarity)) &&
        (element === 'all' || (element === 'super' ? Number(card.element) >= 10 && Number(card.element) < 20
          : element === 'extreme' ? Number(card.element) >= 20 : Number(card.element) % 10 === ['agl', 'teq', 'int', 'str', 'phy'].indexOf(element))))
      setData({ items: items.slice((page - 1) * 30, page * 30), total: items.length, totalPages: Math.max(1, Math.ceil(items.length / 30)) })
      setLoading(false)
      return
    }
    const controller = new AbortController()
    let active = true
    setLoading(true)

    const raritiesStr = rarities.join(',')
    api.getCards({ q: searchTerm, rarities: raritiesStr, element, page, limit: 30 }, controller.signal)
      .then((res) => {
        if (active) {
          setData(res)
          setLoading(false)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        console.error('Failed to load cards:', err)
        if (active) setLoading(false)
      })

    return () => { active = false; controller.abort() }
  }, [searchTerm, rarities, element, page, importedCards])

  const toggleRarity = (r) => {
    setPage(1)
    setRarities((prev) => 
      prev.includes(r) 
        ? (prev.length > 1 ? prev.filter(x => x !== r) : prev) 
        : [...prev, r].sort((a, b) => b - a)
    )
  }

  return (
    <aside className={`sidebar ${isOpen ? '' : 'collapsed'}`}>
      <div className="brand">
        <div className="brand-mark">
          <Flame size={22} />
        </div>
        <div className="brand-text">
          <strong>Dokkan Studio</strong>
          <span>{isVi ? 'Bộ công cụ chỉnh sửa nhân vật' : 'Character modding suite'}</span>
        </div>
        <button type="button" className="sidebar-settings-btn" onClick={() => setSettingsOpen(true)} title={isVi ? 'Cài đặt' : 'Settings'} aria-label={isVi ? 'Cài đặt' : 'Settings'}><Settings size={16} /></button>
        <span className="brand-version">v{packageInfo.version}</span>
      </div>

      {settingsOpen && <div className="settings-backdrop" onPointerDown={event => { if (event.target === event.currentTarget) setSettingsOpen(false) }}>
        <section className="settings-dialog" role="dialog" aria-modal="true" aria-labelledby="settings-title">
          <header><div><Settings size={17} /><h2 id="settings-title">{isVi ? 'Cài đặt' : 'Settings'}</h2></div><button type="button" onClick={() => setSettingsOpen(false)} aria-label={isVi ? 'Đóng' : 'Close'}><X size={17} /></button></header>
          <label className="settings-row"><span><strong>{isVi ? 'Chế độ hiệu năng' : 'Performance mode'}</strong><small>{isVi ? 'Mặc định thu gọn ảnh thẻ và trình phát animation' : 'Collapse card art and animation player by default'}</small></span><input type="checkbox" checked={performanceMode} onChange={event => onPerformanceModeChange(event.target.checked)} /></label>
          <label className="settings-row settings-language"><span><strong>{isVi ? 'Ngôn ngữ' : 'Language'}</strong><small>{isVi ? 'Ngôn ngữ giao diện' : 'Interface language'}</small></span><select value={language} onChange={event => onLanguageChange(event.target.value)}><option value="vi">Tiếng Việt</option><option value="en">English</option></select></label>
        </section>
      </div>}

      <div className={`mod-search-panel ${importedMod ? 'has-mod' : ''}`}>
        {importedMod ? <>
          <div className="mod-search-heading">
            <PackageOpen size={14} />
            <strong title={importedMod.metadata?.patchName || importedMod.metadata?.Name || 'ZIP mod'}>
              {importedMod.metadata?.patchName || importedMod.metadata?.Name || 'ZIP mod'}
            </strong>
            <button type="button" className="mod-close-btn" onClick={onCloseMod} title={isVi ? 'Đóng mod' : 'Close mod'} aria-label={isVi ? 'Đóng mod' : 'Close mod'}>
              <X size={14} />
            </button>
          </div>
          <select
            className="mod-card-select"
            aria-label={isVi ? 'Thẻ trong mod' : 'Cards in mod'}
            value={importedMod.cards.some(c => c.id === selectedId) ? selectedId : ''}
            onChange={e => onSelectCard(Number(e.target.value))}
          >
            <option value="" disabled>{isVi ? 'Chọn thẻ trong mod' : 'Select a mod card'}</option>
            {importedMod.cards.map(c => <option key={c.id} value={c.id}>{c.name} (#{c.id})</option>)}
          </select>
          <small>{isVi ? 'Bản nháp · xuất ZIP để lưu' : 'Draft · export ZIP to save'}</small>
        </> : <label className="mod-import-btn">
          <PackageOpen size={14} />
          <span>{importBusy ? (isVi ? 'Đang nhập…' : 'Importing…') : (isVi ? 'Nhập mod ZIP' : 'Import mod ZIP')}</span>
          <input type="file" accept=".zip,application/zip" disabled={importBusy} onChange={e => { onImportMod(e.target.files?.[0]); e.target.value = '' }} />
        </label>}
        {importError && <small className="mod-import-error">{importError}</small>}
      </div>

      {/* Search Bar */}
      <div className="search-container">
        <div className="search-box">
          <Search size={16} />
          <input
            type="text"
            value={query}
            onChange={(e) => { setQuery(e.target.value); setPage(1); }}
            placeholder={isVi ? 'Tìm theo tên nhân vật hoặc ID…' : 'Search by character name or ID…'}
          />
          {query && (
            <button className="clear-btn" onClick={() => { setQuery(''); setPage(1); }}>✕</button>
          )}
        </div>
      </div>

      {/* Filters: Rarity & Element */}
      <div className="filter-panel">
        <div className="filter-group">
          <span className="filter-label">{isVi ? 'Độ hiếm:' : 'Rarity:'}</span>
          <div className="rarity-chips">
            {[5, 4, 3, 2, 1, 0].map((r) => {
              const active = rarities.includes(r)
              const meta = RARITY_MAP[r]
              return (
                <button
                  key={r}
                  className={`rarity-chip ${active ? 'active' : ''}`}
                  style={{ '--rarity-color': meta.color }}
                  onClick={() => toggleRarity(r)}
                >
                  {meta.label}
                </button>
              )
            })}
          </div>
        </div>

        <div className="filter-group">
          <span className="filter-label">{isVi ? 'Hệ / Loại:' : 'Type / Class:'}</span>
          <select 
            className="element-select"
            value={element} 
            onChange={(e) => { setElement(e.target.value); setPage(1); }}
          >
            {ELEMENT_TYPES.map((el) => (
              <option key={el.id} value={el.id}>{el.label}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Results Header */}
      <div className="result-header">
          <span>{importedCards ? (isVi ? 'Thẻ trong mod (đúng ID)' : 'Cards in mod (exact IDs)') : (isVi ? 'Danh sách nhân vật' : 'Character roster')}</span>
          <small>{data.total.toLocaleString()} {isVi ? 'thẻ' : 'cards'}</small>
      </div>

      {/* Card List */}
      <div className="card-list">
        {loading ? (
          <div className="list-skeleton">
            {[1, 2, 3, 4, 5, 6].map((i) => <div key={i} className="card-skeleton" />)}
          </div>
        ) : data.items.length === 0 ? (
          <div className="no-cards">{isVi ? 'Không tìm thấy nhân vật phù hợp' : 'No matching characters found'}</div>
        ) : (
          data.items.map((card) => {
            const isSelected = selectedId === card.id
            return (
              <button
                key={card.id}
                className={`card-item ${isSelected ? 'active' : ''}`}
                onClick={() => {
                  onSelectCard(card.id)
                  if (onToggle) onToggle()
                }}
              >
                <div className="thumb-wrap">
                  <img
                    src={api.getThumbUrl(card.id)}
                    alt={card.name}
                    loading="lazy"
                    onError={(e) => { e.currentTarget.style.display = 'none' }}
                  />
                  <RarityBadge rarity={card.rarity} />
                </div>
                <div className="card-info">
                  <span className="card-name" title={card.name}>{card.name}</span>
                  <div className="card-tags">
                    <span className="cid">#{card.id}</span>
                    <ElementBadge element={card.element} />
                  </div>
                </div>
              </button>
            )
          })
        )}
      </div>

      {/* Pagination Footer */}
      <div className="pagination-bar">
        <button 
          className="page-btn" 
          disabled={page <= 1 || loading}
          onClick={() => setPage(p => Math.max(1, p - 1))}
        >
          <ChevronLeft size={16} />
        </button>
          <span className="page-indicator">
          {page} / {Math.max(1, data.totalPages)} {isVi ? 'trang' : 'pages'}
        </span>
        <button 
          className="page-btn" 
          disabled={page >= data.totalPages || loading}
          onClick={() => setPage(p => Math.min(data.totalPages, p + 1))}
        >
          <ChevronRight size={16} />
        </button>
      </div>

    </aside>
  )
}
