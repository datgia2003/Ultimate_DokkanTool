import React, { useMemo, useState } from 'react'
import { GitBranch, ArrowRight, Sparkles, UserCheck, Trash2, Plus } from 'lucide-react'
import { RarityBadge, ElementBadge } from '../common/CardBadge'
import { api } from '../../api'

export function TabTransform({ card, chain = [], data = {}, draft = {}, onChange, onSelectCard }) {
  const [newSkillKey, setNewSkillKey] = useState('')
  const descriptions = draft.transformation_descriptions !== undefined ? draft.transformation_descriptions : (data.transformation_descriptions || [])
  const activeSkills = draft.active_skills !== undefined ? draft.active_skills : (data.active_skills || [])
  const passiveSkills = draft.passive_skills !== undefined ? draft.passive_skills : (data.passive_skills || [])
  const standbySkills = draft.standby_skills !== undefined ? draft.standby_skills : (data.standby_skills || [])
  const finishSkills = draft.finish_skill_sets !== undefined
    ? draft.finish_skill_sets.flatMap(item => item.skills || []) : (data.finish_skills || [])
  const skillOptions = useMemo(() => [
    ['ActiveSkill', activeSkills], ['PassiveSkill', passiveSkills],
    ['StandbySkill', standbySkills], ['FinishSkill', finishSkills]
  ].flatMap(([type, skills]) => skills.filter(skill => [79, 103, 131].includes(Number(skill.efficacy_type)) &&
    !descriptions.some(item => item.skill_type === type && Number(item.skill_id) === Number(skill.id)))
    .map(skill => ({ type, id: skill.id, label: `${type} #${skill.id}` }))), [activeSkills, passiveSkills, standbySkills, finishSkills, descriptions])

  const updateDescription = (idx, value) => onChange('transformation_descriptions', descriptions.map((item, i) => i === idx ? { ...item, description: value } : item))
  const removeDescription = (idx) => {
    const target = descriptions[idx]
    onChange('transformation_descriptions', descriptions.filter((_, i) => i !== idx))
    if (target?.id > 0) onChange('deleted_rows', [...(draft.deleted_rows || []), { table: 'transformation_descriptions', id: target.id }])
  }
  const addDescription = () => {
    const [type, idText] = newSkillKey.split(':')
    const skillId = Number(idText)
    if (!type || !skillId) return
    onChange('transformation_descriptions', [...descriptions, { id: skillId, skill_type: type, skill_id: skillId, description: '' }])
    setNewSkillKey('')
  }

  return (
    <div className="tab-pane transform-pane">
      {chain?.length > 1 ? <><div className="section-intro">
        <GitBranch size={20} />
        <div>
          <h3>Transformation Forms & Evolution Tree ({chain.length} Forms)</h3>
          <p>Click on any form below to instantly switch the editor workspace to that character form.</p>
        </div>
      </div>

      <div className="timeline-container">
        {chain.map((form, idx) => {
          const isCurrent = form.id === card.id
          return (
            <React.Fragment key={form.id}>
              <div className={`form-timeline-node ${isCurrent ? 'active' : ''}`}>
                <div className="node-stage-badge">
                  {idx === 0 ? 'BASE FORM' : `TRANSFORMATION #${idx}`}
                </div>

                <div className="form-card-body">
                  <div className="form-avatar">
                    <img
                      src={api.getThumbUrl(form.id)}
                      alt={form.name}
                      onError={(e) => { e.currentTarget.style.display = 'none' }}
                    />
                    <RarityBadge rarity={form.rarity} />
                  </div>

                  <div className="form-info">
                    <strong className="form-name">{form.name}</strong>
                    <div className="form-meta-tags">
                      <span className="cid">Card #{form.id}</span>
                      <ElementBadge element={form.element} />
                    </div>
                  </div>

                  <div className="form-action">
                    {isCurrent ? (
                      <span className="current-indicator">
                        <UserCheck size={14} /> Currently Editing
                      </span>
                    ) : (
                      <button 
                        className="btn select-form-btn"
                        onClick={() => onSelectCard(form.id)}
                      >
                        Switch to Form
                      </button>
                    )}
                  </div>
                </div>
              </div>

              {idx < chain.length - 1 && (
                <div className="timeline-connector">
                  <ArrowRight size={24} />
                  <span>Transforms</span>
                </div>
              )}
            </React.Fragment>
          )
        })}
      </div></> : <div className="section-intro"><GitBranch size={20} /><div><h3>No transformation chain detected</h3><p>You can still edit the in-game transformation descriptions below.</p></div></div>}

      <section className="skill-section" style={{ marginTop: 24 }}>
        <div className="section-bar space-between"><strong>In-game Transformation Descriptions ({descriptions.length})</strong></div>
        <p className="hint-text">These descriptions are shown with transformation effects in-game.</p>
        {descriptions.map((item, idx) => <div className="form-field full-row" key={`${item.id}-${idx}`} style={{ marginBottom: 14 }}>
          <label>{item.skill_type} #{item.skill_id}</label>
          <textarea rows={3} value={item.description || ''} onChange={e => updateDescription(idx, e.target.value)} placeholder="Transformation description shown in-game..." />
          <button type="button" className="btn ghost-btn" onClick={() => removeDescription(idx)}><Trash2 size={14} /> Xóa mô tả</button>
        </div>)}
        <div className="form-row" style={{ display: 'flex', gap: 10, alignItems: 'end' }}>
          <div className="form-field" style={{ flex: 1 }}><label>Skill cần thêm mô tả</label><select value={newSkillKey} onChange={e => setNewSkillKey(e.target.value)}><option value="">Chọn skill biến hình...</option>{skillOptions.map((item, idx) => <option key={`${item.type}-${item.id}-${idx}`} value={`${item.type}:${item.id}`}>{item.label}</option>)}</select></div>
          <button type="button" className="btn secondary-btn" disabled={!newSkillKey} onClick={addDescription}><Plus size={15} /> Thêm mô tả</button>
        </div>
      </section>
    </div>
  )
}
