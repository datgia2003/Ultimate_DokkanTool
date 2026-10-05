import React, { useState } from 'react'
import { CardMembershipEditor } from '../common/CardMembershipEditor'
import { Heart, Swords, Shield, Activity, Sparkles, Award, Zap } from 'lucide-react'

const ELEMENTAL_POTENTIAL_BOARD_RANGES = [10, 20, 30, 120]

function potentialBoardForElement(element, currentBoardId) {
  const value = Number(element)
  if (!Number.isInteger(value) || !((value >= 10 && value <= 14) || (value >= 20 && value <= 24))) return null
  const typeIndex = value % 10
  const boardId = Number(currentBoardId)
  const currentRange = ELEMENTAL_POTENTIAL_BOARD_RANGES.find(start => Number.isInteger(boardId) && boardId >= start && boardId <= start + 4)
  // Card data mostly uses A-rank boards by default; preserve a known board
  // family when changing only the element's type.
  return (currentRange ?? 20) + typeIndex
}

export function TabStats({ card, draft, onChange, onNavigateToExport, categories, links, meta, chain = [], onSyncChainMaxStats }) {
  const [referenceId, setReferenceId] = useState('')
  const [syncBusy, setSyncBusy] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')
  if (!card) return null
  const selectedReference = chain.some(form => String(form.id) === referenceId) ? referenceId : String(card.id)
  const syncStats = async () => {
    setSyncBusy(true); setSyncMessage('')
    try {
      const count = await onSyncChainMaxStats(Number(selectedReference))
      setSyncMessage(`Đã cập nhật Max HP / ATK / DEF cho ${count} thẻ trong bản nháp.`)
    } catch (error) { setSyncMessage(error.message) }
    finally { setSyncBusy(false) }
  }

  const get = (key) => key === 'potential_board_id' && Object.prototype.hasOwnProperty.call(draft, key)
    ? (draft[key] ?? '') : (draft[key] ?? card[key] ?? '')
  const set = (key, val, isNum = true) => {
    onChange(key, isNum ? (val === '' ? null : Number(val)) : val)
  }

  const hpMax = Number(get('hp_max') || 0)
  const atkMax = Number(get('atk_max') || 0)
  const defMax = Number(get('def_max') || 0)

  return (
    <div className="tab-pane stats-pane">
      {/* Overview Combat Stat Badges */}
      <div className="stat-cards-grid horizontal">
        <div className="stat-card hp">
          <div className="stat-card-icon"><Heart size={20} /></div>
          <div className="stat-card-data">
            <span className="label">MAX HP</span>
            <strong className="value">{hpMax.toLocaleString()}</strong>
            <span className="init-val">Base: {Number(get('hp_init') || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="stat-card atk">
          <div className="stat-card-icon"><Swords size={20} /></div>
          <div className="stat-card-data">
            <span className="label">MAX ATK</span>
            <strong className="value">{atkMax.toLocaleString()}</strong>
            <span className="init-val">Base: {Number(get('atk_init') || 0).toLocaleString()}</span>
          </div>
        </div>

        <div className="stat-card def">
          <div className="stat-card-icon"><Shield size={20} /></div>
          <div className="stat-card-data">
            <span className="label">MAX DEF</span>
            <strong className="value">{defMax.toLocaleString()}</strong>
            <span className="init-val">Base: {Number(get('def_init') || 0).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {/* Main Stats Form */}
      <div className="form-card">
        <div className="form-header"><Activity size={18} /><strong>Đồng bộ Max HP / ATK / DEF trong form chain</strong></div>
        <div className="form-field"><label>Thẻ làm mốc · dùng thông số bản nháp đang chỉnh</label>
          <select value={selectedReference} onChange={event => { setReferenceId(event.target.value); setSyncMessage('') }}>
            {chain.map(form => <option key={form.id} value={form.id}>#{form.id} · {form.name}</option>)}
          </select>
        </div>
        <button type="button" className="btn" disabled={syncBusy || !chain.length || !onSyncChainMaxStats} onClick={syncStats}>{syncBusy ? 'Đang cập nhật…' : 'Cập nhật tất cả thẻ trong chain'}</button>
        {syncMessage && <p role="status">{syncMessage}</p>}
      </div>
      <div className="form-card">
        <div className="form-header">
          <Activity size={18} />
          <strong>Combat Attributes (HP / ATK / DEF)</strong>
        </div>

        <div className="fields-grid-3">
          <div className="form-field">
            <label>Initial HP (hp_init)</label>
            <input
              type="number"
              value={get('hp_init')}
              onChange={(e) => set('hp_init', e.target.value)}
            />
          </div>
          <div className="form-field highlight">
            <label>Max HP (hp_max)</label>
            <input
              type="number"
              value={get('hp_max')}
              onChange={(e) => set('hp_max', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Team Cost (cost)</label>
            <input
              type="number"
              value={get('cost')}
              onChange={(e) => set('cost', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Initial ATK (atk_init)</label>
            <input
              type="number"
              value={get('atk_init')}
              onChange={(e) => set('atk_init', e.target.value)}
            />
          </div>
          <div className="form-field highlight">
            <label>Max ATK (atk_max)</label>
            <input
              type="number"
              value={get('atk_max')}
              onChange={(e) => set('atk_max', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Max Level (lv_max)</label>
            <input
              type="number"
              value={get('lv_max')}
              onChange={(e) => set('lv_max', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Initial DEF (def_init)</label>
            <input
              type="number"
              value={get('def_init')}
              onChange={(e) => set('def_init', e.target.value)}
            />
          </div>
          <div className="form-field highlight">
            <label>Max DEF (def_max)</label>
            <input
              type="number"
              value={get('def_max')}
              onChange={(e) => set('def_max', e.target.value)}
            />
          </div>
          <div className="form-field">
            <label>Max Super Attack Level (skill_lv_max)</label>
            <input
              type="number"
              value={get('skill_lv_max')}
              onChange={(e) => set('skill_lv_max', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Basic Attributes Form */}
      <div className="form-card">
        <div className="form-header">
          <Sparkles size={18} />
          <strong>Card Identity & Specifications</strong>
        </div>

        <div className="fields-grid-3">
          <div className="form-field full-row">
            <label>Character Display Name (name)</label>
            <input
              type="text"
              value={get('name')}
              onChange={(e) => set('name', e.target.value, false)}
            />
          </div>

          <div className="form-field">
            <label>Character ID (character_id)</label>
            <input
              type="number"
              value={get('character_id')}
              onChange={(e) => set('character_id', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Rarity (rarity: 5=LR, 4=UR, 3=SSR)</label>
            <input
              type="number"
              value={get('rarity')}
              onChange={(e) => set('rarity', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Element / Class (element: 10-14=Super, 20-24=Extreme)</label>
            <input
              type="number"
              value={get('element')}
              onChange={(e) => {
                const nextElement = e.target.value
                set('element', nextElement)
                const nextBoard = potentialBoardForElement(nextElement, get('potential_board_id'))
                if (nextBoard != null) set('potential_board_id', nextBoard)
              }}
              onBlur={(e) => {
                const nextBoard = potentialBoardForElement(e.target.value, get('potential_board_id'))
                set('potential_board_id', nextBoard)
              }}
            />
          </div>

          <div className="form-field">
            <label>Hidden Potential Board (potential_board_id)</label>
            <input
              type="number"
              value={get('potential_board_id')}
              onChange={(e) => set('potential_board_id', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Growth Type (grow_type)</label>
            <input
              type="number"
              value={get('grow_type')}
              onChange={(e) => set('grow_type', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Training EXP Yield (training_exp)</label>
            <input
              type="number"
              value={get('training_exp')}
              onChange={(e) => set('training_exp', e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Quick SQL-Only Export Callout */}
      <div style={{
        marginTop: '16px',
        padding: '14px 18px',
        borderRadius: '10px',
        background: 'rgba(56, 189, 248, 0.08)',
        border: '1px solid rgba(56, 189, 248, 0.25)',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '12px'
      }}>
        <div>
          <strong style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#38bdf8', fontSize: '13.5px' }}>
            <Zap size={16} />
            <span>Chỉ sửa đổi chỉ số nhân vật?</span>
          </strong>
          <span style={{ fontSize: '12px', color: 'var(--muted)', display: 'block', marginTop: '2px' }}>
            Bạn có thể xuất ngay file patch siêu nhẹ chỉ chứa SQL thay đổi chỉ số mà không cần đóng gói asset game.
          </span>
        </div>
        {onNavigateToExport && (
          <button
            type="button"
            className="btn primary-btn"
            style={{ fontSize: '12.5px', padding: '7px 14px', whiteSpace: 'nowrap' }}
            onClick={onNavigateToExport}
          >
            <Zap size={14} />
            <span>⚡ Xuất Patch Chỉ SQL (Siêu nhẹ)</span>
          </button>
        )}
      </div>
      <CardMembershipEditor key={card.id} card={card} draft={draft} onChange={onChange} categories={categories} links={links} meta={meta} />
    </div>
  )
}
