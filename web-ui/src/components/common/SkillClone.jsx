import React, { useState } from 'react'
import { api } from '../../api'
import { AnimationLookup } from './AnimationLookup'

export function SkillClone({ kind, card, draft, onChange, onCloned }) {
  const [sourceId, setSourceId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const clone = async () => {
    setBusy(true)
    setError('')
    try {
      const result = await api.cloneSkill(kind, sourceId, card.id)
      const link = draft[`${kind}_link`]
      if (link?.id) result[`${kind}_link`].id = link.id
      const extras = { ...(draft._cloned_skill_rows || {}) }
      for (const [table, rows] of Object.entries(result._cloned_skill_rows || {})) {
        const skillType = kind === 'active' ? 'ActiveSkill' : 'StandbySkill'
        extras[table] = table === 'transformation_descriptions'
          ? [...(extras[table] || []).filter(row => row.skill_type !== skillType), ...rows]
          : rows
      }
      result._cloned_skill_rows = extras
      for (const [key, value] of Object.entries(result)) onChange(key, value)
      onCloned?.()
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  return <div className="form-card skill-clone-panel">
    <strong>Clone {kind === 'active' ? 'Active Skill' : 'Standby'} từ thẻ khác</strong>
    <div className="form-field"><label>ID thẻ nguồn</label><input type="number" min="1" value={sourceId} onChange={event => setSourceId(event.target.value)} /></div>
    <AnimationLookup slot={kind} label="Tìm thẻ nguồn theo tên / ID / tên chiêu" onSelect={(_, item) => setSourceId(String(item.card_id))} />
    <button type="button" className="btn secondary-btn" disabled={busy || !card?.id || !(Number(sourceId) > 0)} onClick={clone}>{busy ? 'Đang clone…' : 'Clone với ID mới'}</button>
    <p className="hint-text">Thay skill trên bản nháp của form này. Set và các dòng effect được cấp ID mới trong SQL live; giữ tham chiếu anim và form đích của thẻ nguồn để bạn chỉnh tiếp.</p>
    {error && <p className="passive-compiler-error">{error}</p>}
  </div>
}
