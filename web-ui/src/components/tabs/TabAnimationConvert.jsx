import React, { useEffect, useState } from 'react'
import { Film, Search, ArrowRightLeft, Copy } from 'lucide-react'
import { api } from '../../api'
import { AnimationChoice } from '../common/AnimationChoice'
import { AnimationRarityFilter, AnimationPagination, AnimationSearchFilter } from '../common/AnimationBrowserControls'

const SLOTS = [
  ['entrance', 'Entrance'], ['active', 'Active Skill'],
  ['super', 'Super Attack'], ['finish', 'Finish Skill']
]

const TARGET_FIELDS = {
  entrance: ['Passive Skill', 'passive_skill_effect_id'],
  active: ['Active Skill', 'special_view_id'],
  super: ['Super Attack', 'view_id'],
  finish: ['Finish Skill', 'special_view_id']
}

export function TabAnimationConvert({ card, latestResult, results = [], onDone, language = 'vi' }) {
  const vi = language !== 'en'
  const [query, setQuery] = useState('')
  const [sources, setSources] = useState([])
  const [rarity, setRarity] = useState('')
  const [searchBy, setSearchBy] = useState('card_name')
  const [page, setPage] = useState(1)
  const [paging, setPaging] = useState({ total: 0, totalPages: 1 })
  const [loadingSources, setLoadingSources] = useState(false)
  const [sourceId, setSourceId] = useState('')
  const [selectedSource, setSelectedSource] = useState(null)
  const [animations, setAnimations] = useState([])
  const [animationIndex, setAnimationIndex] = useState('')
  const [targetSlot, setTargetSlot] = useState('active')
  const [customName, setCustomName] = useState('')
  const [copyBgm, setCopyBgm] = useState(true)
  const [stripDamage, setStripDamage] = useState(true)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(null)

  useEffect(() => {
    if (!query.trim()) { setSources([]); setLoadingSources(false); return }
    setSources([])
    setLoadingSources(true)
    const controller = new AbortController()
    const timer = setTimeout(() => {
      api.searchAnimationSources(query.trim(), controller.signal, { rarity, page, search_by: searchBy })
        .then((data) => { if (!controller.signal.aborted) { setSources(data.items || []); setPaging(data); setPage(data.page) } })
        .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
        .finally(() => { if (!controller.signal.aborted) setLoadingSources(false) })
    }, 250)
    return () => { clearTimeout(timer); controller.abort() }
  }, [query, rarity, page, searchBy])

  useEffect(() => {
    setAnimations([])
    setAnimationIndex('')
    if (!sourceId) return
    const controller = new AbortController()
    api.getSourceAnimations(sourceId, controller.signal)
      .then((data) => setAnimations(data.items || []))
      .catch((err) => { if (err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  }, [sourceId])

  const selected = animationIndex === '' ? null : animations[Number(animationIndex)]
  const convert = async () => {
    if (!selected || busy) return
    setBusy(true)
    setError('')
    setMessage('')
    setCopied(null)
    try {
      const response = await api.transmuteAnimation({
        source_card_id: Number(sourceId), target_card_id: Number(card.id),
        animation_index: Number(animationIndex), target_slot: targetSlot,
        source_script_name: selected.script_name || '',
        source_type_key: selected.type_key || '',
        custom_script_name: customName.trim() || null,
        copy_bgm: copyBgm, strip_damage: stripDamage
      })
      onDone?.({ ...response.result, source_name: selected.name, source_card_id: Number(sourceId) })
      setMessage(vi ? `Đã tạo Lua và SQL nháp cho ${response.result?.script_name || 'animation'}.` : `Created Lua and draft SQL for ${response.result?.script_name || 'the animation'}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  const history = results.length ? [...results].reverse() : latestResult ? [latestResult] : []
  const copyId = async (id, key) => {
    try {
      await navigator.clipboard.writeText(String(id))
      setCopied(key)
    } catch (err) { setError(err.message) }
  }

  return <div className="tab-pane">
    <div className="section-intro"><ArrowRightLeft size={20} /><div>
      <h3>{vi ? 'Chuyển đổi animation' : 'Transfer animation'}</h3>
      <p>{vi ? `Lấy animation từ một thẻ và tạo Lua cùng SQL nháp cho Entrance, Active, Super hoặc Finish của thẻ #${card.id}. Sau khi chuyển, tự điền ID vào dòng muốn dùng. Không cần lưu database trước.` : `Copy an animation and create draft Lua and SQL for this card's Entrance, Active, Super, or Finish slot (#${card.id}). After transfer, enter the generated ID in the desired skill field. No database save is needed.`}</p>
    </div></div>
    <div className="form-card">
      <div className="form-header"><Search size={17} /><strong>{vi ? 'Animation nguồn' : 'Source animation'}</strong></div>
      <div className="form-field full-row"><label>{vi ? 'Tìm thẻ nguồn theo tên hoặc ID' : 'Search source card by name or ID'}</label>
        <div className="animation-search-controls">
          <input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1) }} placeholder={vi ? 'Nhập từ khóa theo kiểu tìm đã chọn' : 'Enter a search term for the selected search type'} />
          <AnimationSearchFilter source language={language} value={searchBy} onChange={value => { setSearchBy(value); setPage(1) }} />
        <AnimationRarityFilter language={language} value={rarity} onChange={value => { setRarity(value); setPage(1) }} />
        </div>
      </div>
      <div className="form-field full-row"><label>{vi ? 'Thẻ nguồn' : 'Source card'}</label>
        {selectedSource && <small>{vi ? 'Đang chọn:' : 'Selected:'} {selectedSource.name} · #{selectedSource.id}</small>}
        <div className="animation-choice-list">
          {sources.map(source => <AnimationChoice key={source.id} cardId={source.id} cardName={source.name}
            title={source.name} rarity={source.rarity} detail={vi ? 'Chọn thẻ để xem các chiêu thức' : 'Select a card to view its attacks'} selected={Number(sourceId) === source.id} disabled={busy}
            onClick={() => { setSelectedSource(source); setSourceId(String(source.id)); setAnimationIndex('') }} />)}
        </div>
        {!query.trim() ? <small>{vi ? 'Nhập tên hoặc ID để tìm thẻ nguồn.' : 'Enter a name or ID to search for a source card.'}</small> : loadingSources ? <small>{vi ? 'Đang tải thẻ…' : 'Loading cards…'}</small> : !sources.length && <small>{vi ? 'Không tìm thấy thẻ.' : 'No cards found.'}</small>}
        {!!query.trim() && <AnimationPagination {...paging} page={page} loading={loadingSources} onChange={setPage} language={language} />}
      </div>
      <div className="form-field full-row"><label>{vi ? 'Animation cần chuyển' : 'Animation to transfer'}</label>
        <div className="animation-choice-list">
          {animations.map((anim, index) => <AnimationChoice key={index} cardId={sourceId} cardName={selectedSource?.name}
            title={anim.name || anim.type} tag={anim.move_tag || anim.type} rarity={selectedSource?.rarity} detail={`${anim.type} · ID ${anim.special_view_id || anim.effect_id || '—'} · ${anim.script_name || anim.pack_name || 'Effect Pack'}`}
            selected={animationIndex === String(index)} disabled={busy} onClick={() => setAnimationIndex(String(index))} />)}
        </div>
        {!animations.length && <small>{vi ? 'Chọn thẻ nguồn để xem animation.' : 'Select a source card to view its animations.'}</small>}
      </div>
    </div>
    <div className="form-card">
      <div className="form-header"><Film size={17} /><strong>{vi ? 'Đích trên thẻ' : 'Target on card'} #{card.id}</strong></div>
      <div className="fields-grid-2">
        <div className="form-field"><label>{vi ? 'Slot đích' : 'Target slot'}</label>
          <select value={targetSlot} onChange={(e) => setTargetSlot(e.target.value)}>
            {SLOTS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </div>
        <div className="form-field"><label>{vi ? 'Tên Lua mới (tùy chọn)' : 'New Lua name (optional)'}</label>
          <input value={customName} onChange={(e) => setCustomName(e.target.value)} placeholder={vi ? 'Để trống để tự tạo tên' : 'Leave blank to generate a name'} />
        </div>
      </div>
      <label><input type="checkbox" checked={copyBgm} onChange={(e) => setCopyBgm(e.target.checked)} /> {vi ? 'Lấy BGM của animation nguồn' : 'Copy the source animation BGM'}</label>
      {targetSlot === 'entrance' && <label style={{ display: 'block', marginTop: 8 }}>
        <input type="checkbox" checked={stripDamage} onChange={(e) => setStripDamage(e.target.checked)} /> {vi ? 'Bỏ lệnh gây damage/rung lắc khi chuyển thành Entrance' : 'Remove damage and screen shake commands when transferring as Entrance'}
      </label>}
      {error && <p className="passive-compiler-error">{error}</p>}
      {message && <p className="hint-text">{message}</p>}
      <button className="btn primary-btn" onClick={convert} disabled={!selected || busy} style={{ marginTop: 12 }}>
        <ArrowRightLeft size={15} /> {busy ? (vi ? 'Đang chuyển...' : 'Transferring…') : (vi ? 'Chuyển animation vào thẻ này' : 'Transfer animation to this card')}
      </button>
    </div>
    {!!history.length && <div className="form-card">
      <div className="form-header"><Film size={17} /><strong>{vi ? 'Animation đã chuyển cho thẻ' : 'Transferred animations for card'} #{card.id} · {history.length}</strong></div>
      {history.map((result, index) => {
        const resultId = result.target_slot === 'entrance' ? result.target_pse_id : result.special_view_id
        const targetField = TARGET_FIELDS[result.target_slot]
        const key = `${result.target_slot}-${resultId}-${index}`
        if (!resultId || !targetField) return null
        return <div key={key} className="form-card" style={{ marginTop: 12 }}>
        <strong>{SLOTS.find(([slot]) => slot === result.target_slot)?.[1]} · {result.source_name || result.script_name}</strong>
        <p className="hint-text"><code>{result.script_name}</code>{result.source_card_id ? ` · #${result.source_card_id}` : ''}</p>
        <strong>{vi ? 'ID vừa tạo:' : 'Generated ID:'} {resultId}</strong>
        <button type="button" className="btn" onClick={() => copyId(resultId, key)} style={{ marginLeft: 10 }}><Copy size={14} /> {copied === key ? (vi ? 'Đã sao chép' : 'Copied') : (vi ? 'Sao chép ID' : 'Copy ID')}</button>
        <p className="hint-text">{vi ? <>Điền ID này vào trường <code>{targetField[1]}</code> của dòng bạn chọn trong tab {targetField[0]}. SQL nháp chỉ tạo bản ghi animation; chưa gán ID vào kỹ năng.</> : <>Enter this ID in <code>{targetField[1]}</code> for the chosen row in the {targetField[0]} tab. Draft SQL creates the animation record but does not assign its ID to a skill.</>}</p>
        {Boolean(result.bgm_id) && result.target_slot !== 'entrance' &&
          <p className="hint-text">{vi ? <>BGM nguồn: <code>{result.bgm_id}</code>. Nếu muốn dùng, tự điền vào trường BGM ID của kỹ năng tương ứng.</> : <>Source BGM: <code>{result.bgm_id}</code>. Enter this in the matching skill's BGM ID field if you want to use it.</>}</p>}
      </div>})}
    </div>}
  </div>
}
