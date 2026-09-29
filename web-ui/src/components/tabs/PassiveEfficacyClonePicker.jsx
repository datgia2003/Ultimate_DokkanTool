import React, { useEffect, useState } from 'react'
import { Check, Search, X, Users } from 'lucide-react'
import { api } from '../../api'
import { AnimationChoice } from '../common/AnimationChoice'
import { AnimationSearchFilter, AnimationRarityFilter, AnimationPagination } from '../common/AnimationBrowserControls'

export function copyEfficacyFields(source, target, draftKey) {
  const copied = { ...source }
  for (const key of ['id', 'relation_id', 'name', '_draftKey', '_sourceLineIndex', 'manual_desc_idx', 'source_match_confidence']) {
    delete copied[key]
  }
  return {
    ...target,
    ...copied,
    _draftKey: draftKey || target?._draftKey,
    _sourceLineIndex: undefined,
    manual_desc_idx: undefined,
    name: target?.name || 'Passive Skill'
  }
}

export function PassiveEfficacyClonePicker({ onClose, onCopy, meta, language = 'vi' }) {
  const vi = language !== 'en'
  const [query, setQuery] = useState('')
  const [searchBy, setSearchBy] = useState('card_name')
  const [rarity, setRarity] = useState('')
  const [page, setPage] = useState(1)
  const [results, setResults] = useState([])
  const [paging, setPaging] = useState({ total: 0, totalPages: 1 })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [selectedCards, setSelectedCards] = useState([])
  const [loadingCard, setLoadingCard] = useState(null)
  const [selectedRows, setSelectedRows] = useState([])

  useEffect(() => {
    const term = query.trim()
    if (!term) { setResults([]); setPaging({ total: 0, totalPages: 1 }); setLoading(false); return undefined }
    const controller = new AbortController()
    setResults([])
    setLoading(true)
    setError('')
    const timer = setTimeout(() => {
      api.searchAnimationSources(term, controller.signal, { rarity, page, limit: 24, search_by: searchBy })
        .then(result => {
          if (controller.signal.aborted) return
          setResults((result.items || []).filter(item => !String(item.id).startsWith('9') && String(item.id).length <= 7))
          setPaging(result)
          setPage(result.page || 1)
        })
        .catch(err => { if (err.name !== 'AbortError') setError(err.message) })
        .finally(() => { if (!controller.signal.aborted) setLoading(false) })
    }, 220)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, searchBy, rarity, page])

  const toggleCard = async (card) => {
    const existing = selectedCards.find(item => Number(item.id) === Number(card.id))
    if (existing) {
      setSelectedCards(items => items.filter(item => Number(item.id) !== Number(card.id)))
      setSelectedRows(items => items.filter(item => Number(item.cardId) !== Number(card.id)))
      return
    }
    setLoadingCard(card.id)
    setError('')
    try {
      const detail = await api.getCard(card.id)
      const passive = detail.passive || {}
      const skills = passive.skills || []
      setSelectedCards(items => [...items, {
        id: card.id, name: card.name, rarity: card.rarity, skills,
        description: passive.set?.itemized_description || passive.set?.description || ''
      }])
    } catch (err) {
      setError(`Không tải được Passive Skill của ${card.name}: ${err.message}`)
    } finally {
      setLoadingCard(null)
    }
  }

  const toggleRow = (card, skill, index) => {
    const key = `${card.id}:${skill.id ?? index}`
    setSelectedRows(rows => rows.some(row => row.key === key)
      ? rows.filter(row => row.key !== key)
      : [...rows, { key, cardId: card.id, cardName: card.name, skill }])
  }

  const apply = () => {
    if (!selectedRows.length) return
    onCopy(selectedRows.map(row => row.skill))
  }

  return (
    <section className="passive-efficacy-clone lua-animation-browser" aria-label="Tìm efficacy để sao chép">
      <div className="passive-efficacy-clone-head">
        <div><strong><Users size={15} /> {vi ? 'Sao chép Passive Skill Efficacy' : 'Clone Passive Skill Efficacy'}</strong><small>{vi ? 'Tìm thẻ, chọn một hoặc nhiều thẻ, rồi tích efficacy muốn sao chép.' : 'Find one or more cards, then select the efficacies to copy.'}</small></div>
        <button type="button" className="btn ghost-btn" onClick={onClose} aria-label="Đóng"><X size={16} /></button>
      </div>
      <div className="lua-animation-search-controls">
        <label className="passive-efficacy-clone-query"><Search size={15} /><input value={query} onChange={event => { setQuery(event.target.value); setPage(1) }} placeholder={vi ? 'Tìm thẻ theo tên, ID hoặc tên chiêu' : 'Search by card name, ID, or move name'} autoFocus /></label>
        <AnimationSearchFilter source language={language} value={searchBy} onChange={value => { setSearchBy(value); setPage(1) }} />
        <AnimationRarityFilter language={language} value={rarity} onChange={value => { setRarity(value); setPage(1) }} />
      </div>
      {error && <p className="lua-browser-error" role="alert">{error}</p>}
      <div className="lua-animation-browser-grid passive-clone-browser-grid">
        <div className="lua-animation-source-list">
          {!query.trim() ? <p className="lua-browser-hint">{vi ? 'Nhập từ khóa để tìm thẻ. Chọn thẻ để xem Passive Skill.' : 'Enter a query to search cards. Choose a card to view its Passive Skill.'}</p>
            : loading ? <p className="lua-browser-hint">{vi ? 'Đang tìm thẻ…' : 'Searching cards…'}</p>
              : results.length ? results.map(card => {
                const selected = selectedCards.some(item => Number(item.id) === Number(card.id))
                return <div className="passive-clone-result-wrap" key={card.id}>
                  <AnimationChoice cardId={card.id} cardName={card.name} title={card.name} rarity={card.rarity}
                    selected={selected} disabled={loadingCard != null} onClick={() => toggleCard(card)} />
                  <button type="button" className={`passive-clone-select-card ${selected ? 'selected' : ''}`} disabled={loadingCard != null}
                    onClick={() => toggleCard(card)}>{loadingCard === card.id ? (vi ? 'Đang tải…' : 'Loading…') : selected ? (vi ? 'Đã chọn ✓' : 'Selected ✓') : (vi ? 'Chọn thẻ +' : 'Add card +')}</button>
                </div>
              }) : <p className="lua-browser-hint">{vi ? 'Không tìm thấy thẻ phù hợp.' : 'No matching cards found.'}</p>}
          {!!query.trim() && <AnimationPagination {...paging} page={page} loading={loading} onChange={setPage} language={language} />}
        </div>
        <div className="lua-animation-results passive-clone-details">
          <div className="lua-animation-results-heading"><strong>{vi ? 'Passive Skill được chọn' : 'Selected Passive Skills'}</strong><span>{selectedRows.length} {vi ? 'efficacy đã chọn' : 'selected'}</span></div>
          {!selectedCards.length && <p className="lua-browser-hint">{vi ? 'Chọn một hoặc nhiều thẻ để xem mô tả và efficacy.' : 'Select one or more cards to view their descriptions and efficacies.'}</p>}
          {selectedCards.map(card => <div className="passive-clone-source" key={card.id}>
            <div className="passive-clone-source-head"><strong>{card.name} <small>#{card.id}</small></strong>
              <button type="button" className="btn ghost-btn" onClick={() => toggleCard(card)} aria-label={vi ? 'Bỏ thẻ' : 'Remove card'}><X size={14} /></button>
            </div>
            <section className="passive-clone-description"><strong>itemized_description</strong>
              {card.description ? <p>{card.description}</p> : <small>{vi ? 'Không có mô tả Passive Skill.' : 'No Passive Skill description.'}</small>}
            </section>
            {!card.skills.length ? <small>{vi ? 'Thẻ này không có Passive Skill efficacy.' : 'This card has no Passive Skill efficacies.'}</small> : card.skills.map((skill, index) => {
          const key = `${card.id}:${skill.id ?? index}`
          const checked = selectedRows.some(row => row.key === key)
          const type = Number(skill.efficacy_type)
          return <label className="passive-clone-efficacy" key={key}>
            <input type="checkbox" checked={checked} onChange={() => toggleRow(card, skill, index)} />
            <span><strong>{meta?.efficacy_types?.[type] || `Efficacy ${skill.efficacy_type ?? '?'}`}</strong>
              <small>#{skill.id ?? index + 1} · {[skill.eff_value1, skill.eff_value2, skill.eff_value3].map(value => value ?? '—').join(' / ')}</small></span>
          </label>
            })}
          </div>)}
        </div>
      </div>
      <div className="passive-efficacy-clone-actions">
        <small>{selectedRows.length} {vi ? 'efficacy đã chọn' : 'selected efficacies'}</small>
        <button type="button" className="btn primary-btn" disabled={!selectedRows.length} onClick={apply}>{vi ? 'Sao chép vào dòng đang sửa' : 'Copy into current row'}</button>
      </div>
    </section>
  )
}
