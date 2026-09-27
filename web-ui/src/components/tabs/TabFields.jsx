import React from 'react'
import { Sparkles } from 'lucide-react'
import { DomainPanel } from '../common/DomainPanel'

export function TabFields({ card, draft, onChange, meta, fields, activeRelations, passiveRelations, language = 'vi' }) {
  if (!card) return null

  const get = (key) => draft[key] ?? card[key] ?? ''
  const set = (key, val, isNum = true) => {
    onChange(key, isNum ? (val === '' ? null : Number(val)) : val)
  }


  return (
    <div className="tab-pane fields-pane">
      <DomainPanel key={card.id} fields={fields} activeRelations={activeRelations} passiveRelations={passiveRelations} draft={draft} onChange={onChange} meta={meta} language={language} />
      {/* Visual FX & Aura */}
      <div className="form-card">
        <div className="form-header">
          <Sparkles size={18} />
          <strong>Visual Effects, Background & Aura Properties</strong>
        </div>

        <div className="fields-grid-3">
          <div className="form-field">
            <label>Aura Effect ID (aura_id)</label>
            <input
              type="number"
              value={get('aura_id')}
              onChange={(e) => set('aura_id', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Aura Scale Multiplier (aura_scale)</label>
            <input
              type="number"
              step="0.1"
              value={get('aura_scale')}
              onChange={(e) => set('aura_scale', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Background FX ID (bg_effect_id)</label>
            <input
              type="number"
              value={get('bg_effect_id')}
              onChange={(e) => set('bg_effect_id', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Aura Offset X (aura_offset_x)</label>
            <input
              type="number"
              value={get('aura_offset_x')}
              onChange={(e) => set('aura_offset_x', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Aura Offset Y (aura_offset_y)</label>
            <input
              type="number"
              value={get('aura_offset_y')}
              onChange={(e) => set('aura_offset_y', e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Special Motion Sequence (special_motion)</label>
            <input
              type="number"
              value={get('special_motion')}
              onChange={(e) => set('special_motion', e.target.value)}
            />
          </div>
        </div>
      </div>

    </div>
  )
}
