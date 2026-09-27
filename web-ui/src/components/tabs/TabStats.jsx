import React from 'react'
import { CardMembershipEditor } from '../common/CardMembershipEditor'
import { Heart, Swords, Shield, Activity, Sparkles, Award, Zap } from 'lucide-react'

export function TabStats({ card, draft, onChange, onNavigateToExport, categories, links, meta }) {
  if (!card) return null

  const get = (key) => draft[key] ?? card[key] ?? ''
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
              onChange={(e) => set('element', e.target.value)}
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
