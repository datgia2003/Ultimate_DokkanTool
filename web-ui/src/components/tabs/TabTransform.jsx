import React, { useEffect, useMemo, useRef, useState } from 'react'
import { GitBranch, ArrowRight, UserCheck, Trash2, Plus, ChevronDown, Check, FileText } from 'lucide-react'
import { ElementBadge } from '../common/CardBadge'
import { api } from '../../api'
import { newDraftId } from '../../draftIds'

export function TabTransform({ card, chain = [], data = {}, draft = {}, onChange, onSelectCard, language = 'vi' }) {
  const en = language === 'en'
  const [newSkillKey, setNewSkillKey] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef(null)
  const descriptions = useMemo(() => {
    if (draft.transformation_descriptions !== undefined) return draft.transformation_descriptions
    const entries = [...(data.transformation_descriptions || []), ...(draft._cloned_skill_rows?.transformation_descriptions || [])]
    return [...new Map(entries.map(item => [`${item.skill_type}:${item.skill_id}`, item])).values()]
  }, [draft.transformation_descriptions, draft._cloned_skill_rows, data.transformation_descriptions])
  const skillGroups = [
    ['ActiveSkill', draft.active_skills ?? data.active_skills ?? []],
    ['PassiveSkill', draft.passive_skills ?? data.passive_skills ?? []],
    ['StandbySkill', draft.standby_skills ?? data.standby_skills ?? []],
    ['FinishSkill', draft.finish_skill_sets !== undefined ? draft.finish_skill_sets.flatMap(item => item.skills || []) : data.finish_skills || []]
  ]
  const typeNames = { ActiveSkill: 'Active Skill', PassiveSkill: 'Passive Skill', StandbySkill: 'Standby Skill', FinishSkill: 'Finish Skill' }
  const skillLabel = (type, id) => {
    const skills = skillGroups.find(([kind]) => kind === type)?.[1] || []
    const index = skills.findIndex(skill => Number.isFinite(Number(id)) && Number(skill.id) === Number(id))
    const name = skills[index]?.name
    return `${typeNames[type] || type} · ${name || (en ? `Effect ${Math.max(index + 1, 1)}` : `Hiệu ứng ${Math.max(index + 1, 1)}`)}${Number(id) > 0 ? ` · #${id}` : en ? ' · New draft' : ' · Bản nháp mới'}`
  }
  const skillOptions = skillGroups.flatMap(([type, skills]) => skills.filter(skill =>
    [79, 103, 131].includes(Number(skill.efficacy_type)) &&
    !descriptions.some(item => item.skill_type === type && Number(item.skill_id) === Number(skill.id)))
    .map((skill, index) => ({ key: `${type}:${skill.id || skill._draftKey || index}`, type, id: skill.id, skill, label: skillLabel(type, skill.id) })))
  const selected = skillOptions.find(item => item.key === newSkillKey)
  useEffect(() => {
    if (!pickerOpen) return
    const close = event => { if (!pickerRef.current?.contains(event.target)) setPickerOpen(false) }
    const escape = event => { if (event.key === 'Escape') setPickerOpen(false) }
    document.addEventListener('pointerdown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('pointerdown', close); document.removeEventListener('keydown', escape) }
  }, [pickerOpen])
  useEffect(() => { setNewSkillKey(''); setPickerOpen(false) }, [card?.id])
  const removeDescription = idx => {
    const target = descriptions[idx]
    onChange('transformation_descriptions', descriptions.filter((_, i) => i !== idx))
    if (target?.id > 0) onChange('deleted_rows', [...(draft.deleted_rows || []), { table: 'transformation_descriptions', id: target.id }])
  }
  const addDescription = () => {
    if (!selected) return
    let skillId = Number(selected.id)
    if (!Number.isSafeInteger(skillId) || skillId === 0) {
      skillId = newDraftId()
      const fields = { ActiveSkill: 'active_skills', PassiveSkill: 'passive_skills', StandbySkill: 'standby_skills' }
      if (selected.type === 'FinishSkill') {
        onChange('finish_skill_sets', (draft.finish_skill_sets || []).map(item => ({ ...item,
          skills: (item.skills || []).map(skill => skill === selected.skill ? { ...skill, id: skillId } : skill) })))
      } else {
        const skills = skillGroups.find(([type]) => type === selected.type)[1]
        onChange(fields[selected.type], skills.map(skill => skill === selected.skill ? { ...skill, id: skillId } : skill))
      }
    }
    onChange('transformation_descriptions', [...descriptions, { id: newDraftId(), skill_type: selected.type, skill_id: skillId, description: '' }])
    setNewSkillKey('')
    setPickerOpen(false)
  }
  return <div className="tab-pane transform-pane">
    <section className="transform-section">
      <div className="transform-section-heading"><span className="transform-heading-icon"><GitBranch size={20} /></span><div><h3>{en ? 'Transformation forms' : 'Các dạng biến hình'}</h3><p>{en ? 'Select a form to edit its skills.' : 'Chọn một form để chỉnh sửa kỹ năng của form đó.'}</p></div><span className="transform-count">{chain.length} {en ? 'forms' : 'form'}</span></div>
      <div className="transform-form-list">
        {(chain.length ? chain : card ? [card] : []).map((form, idx) => <React.Fragment key={form.id}>
          {idx > 0 && <ArrowRight className="transform-form-arrow" size={18} />}
          <button type="button" className={`transform-form-tile ${Number(form.id) === Number(card?.id) ? 'selected' : ''}`} onClick={() => onSelectCard(form.id)} aria-pressed={Number(form.id) === Number(card?.id)}>
            <img src={api.getThumbUrl(form.id)} alt={form.name} />
            <span className="transform-form-details"><small>{idx === 0 ? en ? 'BASE FORM' : 'FORM GỐC' : `${en ? 'FORM' : 'FORM'} ${idx + 1}`}</small><strong>{form.name}</strong><span className="transform-form-meta"><span>#{form.id}</span><ElementBadge element={form.element} /></span></span>
            <span className="transform-form-action">{Number(form.id) === Number(card?.id) ? <><UserCheck size={14} />{en ? 'Editing' : 'Đang sửa'}</> : <ArrowRight size={16} />}</span>
          </button>
        </React.Fragment>)}
      </div>
    </section>
    <section className="transform-section">
      <div className="transform-section-heading"><span className="transform-heading-icon"><FileText size={20} /></span><div><h3>{en ? 'Transformation descriptions' : 'Mô tả biến hình'}</h3><p>{en ? 'Text displayed with the transformation in game.' : 'Nội dung hiển thị khi nhân vật biến hình trong game.'}</p></div><span className="transform-count">{descriptions.length}</span></div>
      <div className="transform-description-list">
        {descriptions.map((item, idx) => <div className="transform-description-card" key={`${item.skill_type}:${item.id}`}>
          <div className="transform-description-heading"><strong>{skillLabel(item.skill_type, item.skill_id)}</strong><button type="button" className="btn ghost-btn" aria-label={en ? 'Delete description' : 'Xóa mô tả'} onClick={() => removeDescription(idx)}><Trash2 size={15} /></button></div>
          <textarea rows={4} value={item.description || ''} onChange={event => onChange('transformation_descriptions', descriptions.map((row, i) => i === idx ? { ...row, description: event.target.value } : row))} placeholder={en ? 'Enter transformation description…' : 'Nhập mô tả biến hình…'} />
        </div>)}
        {!descriptions.length && <div className="transform-empty"><FileText size={22} /><span>{en ? 'No descriptions yet. Select a transformation skill below to add one.' : 'Chưa có mô tả. Chọn skill biến hình bên dưới để thêm.'}</span></div>}
      </div>
      <div className="transform-add-row">
        <div className="transform-skill-picker" ref={pickerRef}>
          <button type="button" className="transform-picker-trigger" disabled={!skillOptions.length} aria-expanded={pickerOpen} onClick={() => setPickerOpen(value => !value)}><span>{selected?.label || (skillOptions.length ? en ? 'Select a transformation skill…' : 'Chọn skill biến hình…' : en ? 'No more transformation skills' : 'Không còn skill biến hình để thêm')}</span><ChevronDown size={16} /></button>
          {pickerOpen && <div className="transform-picker-options">{skillOptions.map(item => <button type="button" key={item.key} onClick={() => { setNewSkillKey(item.key); setPickerOpen(false) }}><span>{item.label}</span>{item.key === newSkillKey && <Check size={15} />}</button>)}</div>}
        </div>
        <button type="button" className="btn secondary-btn" disabled={!selected} onClick={addDescription}><Plus size={16} />{en ? 'Add description' : 'Thêm mô tả'}</button>
      </div>
    </section>
  </div>
}
