import { AnimationLookup } from '../common/AnimationLookup'
import React, { useState } from 'react'
import { Flame, Clock, Heart, Volume2, Film, Shield, Zap, Sparkles, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { DokkanDescriptionEditor } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'
import { newDraftId } from '../../draftIds'
import { SkillClone } from '../common/SkillClone'

export function TabActive({ active, draft, onChange, meta, card, onPlayAnim, transformationDescriptions = [] }) {
  const [proposal, setProposal] = useState(null)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState('')
  const currentSet = draft.active_set !== undefined ? draft.active_set : active?.set
  const currentSkills = draft.active_skills || active?.skills || []
  const cloneControl = <SkillClone kind="active" card={card} draft={draft} onChange={onChange} onCloned={() => setProposal(null)} />
  const createActive = () => {
    const id = newDraftId()
    onChange('active_set', { id, name: 'Active Skill', effect_description: '', condition_description: '', turn: 1,
      exec_limit: 1, causality_conditions: '', ultimate_special_id: 0, special_view_id: 0, costume_special_view_id: 0, bgm_id: 0 })
    onChange('active_link', { id: active?.link?.id || newDraftId(), card_id: card.id, active_skill_set_id: id })
    onChange('active_skills', [])
  }
  const deleteActive = () => {
    const deleted = [...(draft.deleted_rows || [])]
    const link = draft.active_link || active?.link
    if (link?.id > 0) deleted.push({ table: 'card_active_skills', id: link.id })
    if (currentSet?.id > 0) deleted.push({ table: 'active_skill_sets', id: currentSet.id })
    for (const skill of currentSkills) if (skill?.id > 0) deleted.push({ table: 'active_skills', id: skill.id })
    const descriptions = draft.transformation_descriptions !== undefined ? draft.transformation_descriptions : transformationDescriptions
    const removedDescriptions = descriptions.filter(item => item.skill_type === 'ActiveSkill' && currentSkills.some(skill => Number(skill.id) === Number(item.skill_id)))
    for (const item of removedDescriptions) if (item.id > 0) deleted.push({ table: 'transformation_descriptions', id: item.id })
    onChange('deleted_rows', deleted)
    if (removedDescriptions.length) onChange('transformation_descriptions', descriptions.filter(item => !removedDescriptions.includes(item)))
    onChange('active_link', null)
    onChange('active_set', null)
    onChange('active_skills', [])
  }

  if (!currentSet) {
    return (
      <div className="tab-pane empty-tab">
        <Flame size={36} />
        <h3>No Active Skill found for this character</h3>
        <p>This card is not bound to any <code>active_skill_set</code>.</p>
        <button type="button" className="btn primary-btn" disabled={!card?.id} onClick={createActive}><Plus size={16} /> Tạo Active Skill</button>
        {cloneControl}
      </div>
    )
  }

  const updateSet = (key, val) => {
    onChange('active_set', { ...currentSet, [key]: val })
  }

  const compile = async () => {
    setCompiling(true)
    setError('')
    setProposal(null)
    const desc = currentSet.effect_description || currentSet.description || ''
    try {
      const result = await api.compileActive(desc, currentSet.id, card?.id)
      if (result.source === 'unsupported') throw new Error(result.warnings?.[0] || 'Không thể sinh efficacy cho mô tả này')
      setProposal({ ...result, description: desc })
    } catch (err) {
      setError(err.message)
    } finally {
      setCompiling(false)
    }
  }

  const applyProposal = (replace) => {
    if (!proposal?.skills?.length) return
    const generated = proposal.skills.map((sk, index) => ({
      ...sk,
      id: replace ? currentSkills[index]?.id : undefined,
      _draftKey: `compiled-active-${Date.now()}-${index}`,
      active_skill_set_id: currentSet.id
    }))
    onChange('active_set', currentSet)
    onChange('active_skills', replace ? generated : [...currentSkills, ...generated])
    if (replace) onChange('deleted_rows', [...(draft.deleted_rows || []),
      ...currentSkills.slice(generated.length).filter(sk => sk.id).map(sk => ({ table: 'active_skills', id: sk.id }))])
    setProposal(null)
  }

  const updateSkill = (index, key, val) => {
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        return { ...sk, [key]: val === '' ? null : (isNaN(Number(val)) ? val : Number(val)) }
      }
      return sk
    })
    onChange('active_skills', updated)
  }

  const updateSkillRaw = (index, key, val) => {
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        return { ...sk, [key]: val }
      }
      return sk
    })
    onChange('active_skills', updated)
  }

  const handleAddEffect = () => {
    const baseSetId = Number(currentSet.id) || 1
    const newEffect = {
      _draftKey: `active-${Date.now()}-${currentSkills.length}`,
      active_skill_set_id: baseSetId,
      target_type: 1,
      sub_target_type_set_id: '',
      calc_option: 0,
      efficacy_type: 1,
      eff_val1: 100,
      eff_val2: 0,
      eff_val3: 0,
      efficacy_values: '{}',
      turn: 1
    }
    onChange('active_skills', [...currentSkills, newEffect])
  }

  const handleDeleteEffect = (index, skillId) => {
    const updated = currentSkills.filter((_, idx) => idx !== index)
    onChange('active_skills', updated)
    if (skillId) {
      const deletedRows = draft.deleted_rows || []
      onChange('deleted_rows', [...deletedRows, { table: 'active_skills', id: skillId }])
    }
  }

  return (
    <div className="tab-pane active-pane">
      {cloneControl}
      {/* Set Header Editor Card */}
      <div className="skill-hero-card active-theme editable">
        <div className="hero-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="hero-badge">ACTIVE SKILL SET {currentSet.id < 0 ? 'MỚI · ID tự cấp trong SQL' : `#${currentSet.id}`}</div>
          <button type="button" className="btn ghost-btn" onClick={deleteActive}><Trash2 size={14} /> Xóa Active Skill</button>
          {onPlayAnim && currentSet.special_view_id > 0 && (
            <button
              type="button"
              className="btn-secondary"
              style={{ fontSize: 12, padding: '4px 10px', display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={onPlayAnim}
            >
              <Film size={13} />
              <span>Preview Cutscene</span>
            </button>
          )}
        </div>

        <div className="form-field full-row">
          <label>Active Skill Name (name)</label>
          <input
            type="text"
            className="hero-input"
            value={currentSet.name || ''}
            onChange={(e) => updateSet('name', e.target.value)}
            placeholder="Enter Active Skill name..."
          />
        </div>

        <div className="fields-grid-2">
          <DokkanDescriptionEditor
            label="Effect Description"
            fieldKey="effect_description"
            skillName={currentSet.name}
            skillType="ACTIVE EFFECT"
            value={currentSet.effect_description || currentSet.description || ''}
            onChange={(val) => {
              updateSet('effect_description', val)
            }}
            placeholder="Enter Active Skill effect description..."
            defaultMode="edit"
          />

          <DokkanDescriptionEditor
            label="Condition Description"
            fieldKey="condition_description"
            skillName={currentSet.name}
            skillType="ACTIVE CONDITION"
            value={currentSet.condition_description || ''}
            onChange={(val) => updateSet('condition_description', val)}
            placeholder="Enter Active Skill trigger conditions..."
            defaultMode="edit"
          />
        </div>

        <div className="passive-compiler-actions">
          <button className="btn primary-btn" onClick={compile} disabled={compiling || !(currentSet.effect_description || currentSet.description)?.trim()}>
            <Sparkles size={15} /> {compiling ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
          </button>
          <span className="hint-text">Dùng hiệu ứng hiện tại làm mẫu và cập nhật thông số theo mô tả.</span>
        </div>

        {error && <p className="passive-compiler-error">{error}</p>}

        {proposal && (
          <div className="passive-compiler-preview">
            <strong>{proposal.skills.length} dòng đề xuất · {proposal.source === 'database' ? 'khớp mô tả trong DB' : proposal.source === 'database-template' ? 'mẫu gần trong DB' : 'nhận diện theo quy tắc'}</strong>
            <div className="passive-compiler-preview-list">
              {proposal.skills.map((sk, index) => (
                <div key={index}>
                  <span>#{index + 1} · {meta?.efficacy_types?.[sk.efficacy_type] || `Efficacy ${sk.efficacy_type}`}</span>
                  <span>vals: {[sk.eff_val1, sk.eff_val2, sk.eff_val3].filter(v => v !== undefined).join(' / ')}</span>
                </div>
              ))}
            </div>
            <div className="passive-compiler-actions" style={{ marginTop: 10 }}>
              <button className="btn primary-btn" onClick={() => applyProposal(true)}>
                Áp dụng (Thay thế toàn bộ)
              </button>
              <button className="btn secondary-btn" onClick={() => applyProposal(false)}>
                Áp dụng (Nối thêm)
              </button>
              <button className="btn ghost-btn" onClick={() => setProposal(null)}>
                Hủy
              </button>
            </div>
          </div>
        )}

        {/* Trigger Condition Fields */}
        <div className="fields-grid-4">
          <div className="form-field">
            <label><Clock size={13} /> Starting Turn (turn)</label>
            <input
              type="number"
              value={currentSet.turn ?? 1}
              onChange={(e) => updateSet('turn', Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label><Clock size={13} /> Execution Limit (exec_limit)</label>
            <input
              type="number"
              value={currentSet.exec_limit ?? 1}
              onChange={(e) => updateSet('exec_limit', Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label><Heart size={13} /> HP Below % (hp_rate_under)</label>
            <input
              type="number"
              value={currentSet.hp_rate_under ?? ''}
              onChange={(e) => updateSet('hp_rate_under', e.target.value ? Number(e.target.value) : null)}
              placeholder="0 = Any HP"
            />
          </div>

          <div className="form-field">
            <label><Volume2 size={13} /> Sound / Voice ID</label>
            <input
              type="number"
              value={currentSet.sound_id ?? ''}
              onChange={(e) => updateSet('sound_id', e.target.value ? Number(e.target.value) : null)}
            />
          </div>
        </div>

        <div className="fields-grid-3" style={{ marginTop: 8 }}>
          <div className="form-field">
            <label><Film size={13} /> Special View ID (special_view_id)</label>
            <input
              type="number"
              value={currentSet.special_view_id ?? ''}
              onChange={(e) => updateSet('special_view_id', e.target.value ? Number(e.target.value) : null)}
            />
                  <AnimationLookup slot="active" onSelect={id => updateSet('special_view_id', id)} />
          </div>

          <div className="form-field">
            <label><Zap size={13} /> Ultimate Special ID</label>
            <input
              type="text"
              value={currentSet.ultimate_special_id ?? ''}
              onChange={(e) => updateSet('ultimate_special_id', e.target.value)}
              placeholder="e.g. 12"
            />
          </div>

          <div className="form-field">
            <label><Volume2 size={13} /> BGM ID</label>
            <input
              type="number"
              value={currentSet.bgm_id ?? 0}
              onChange={(e) => updateSet('bgm_id', Number(e.target.value))}
            />
          </div>
        </div>

        {/* Causality Condition Expression */}
        <div style={{ marginTop: 12 }}>
          <CausalityExpressionEditor
            value={currentSet.causality_conditions}
            onChange={(val) => updateSet('causality_conditions', val)}
            label="Active Skill Causality Conditions (Biểu thức điều kiện kích hoạt)"
            placeholder="e.g. 930 | (296 & 3537) hoặc ID điều kiện"
            meta={meta}
          />
        </div>
      </div>

      {/* Active Sub-Skills */}
      <div className="sub-skills-section">
        <div className="section-bar space-between">
          <div className="bar-left">
            <Flame size={17} />
            <strong>Active Skill Efficacies ({currentSkills.length} effects)</strong>
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5 }}
            onClick={handleAddEffect}
          >
            <Plus size={14} />
            <span>Thêm effect mới</span>
          </button>
        </div>

        <div className="sub-skills-grid editable-grid">
          {currentSkills.map((sk, idx) => {
            const effType = Number(sk.efficacy_type) || 0
            const effDetails = meta?.efficacy_details?.[effType]
            const v1Label = effDetails?.v1 ? `Value 1 (${effDetails.v1})` : 'Value 1 (eff_val1)'
            const v2Label = effDetails?.v2 ? `Value 2 (${effDetails.v2})` : 'Value 2 (eff_val2)'
            const v3Label = effDetails?.v3 ? `Value 3 (${effDetails.v3})` : 'Value 3 (eff_val3)'

            return (
              <div key={sk.id || idx} className="sub-skill-card edit-card">
                <div className="sub-skill-head">
                  <span className="idx-tag">Active Effect #{idx + 1}</span>
                  <span className="id-tag">ID: {sk.id || 'Mới'}</span>
                  <button
                    type="button"
                    className="delete-effect-btn"
                    onClick={() => handleDeleteEffect(idx, sk.id)}
                    title="Xóa effect này"
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#ff5252', cursor: 'pointer', padding: 4 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>Loại hiệu ứng (efficacy_type)</label>
                    <select
                      value={sk.efficacy_type ?? 0}
                      onChange={(e) => updateSkill(idx, 'efficacy_type', e.target.value)}
                    >
                      {meta?.efficacy_types && Object.entries(meta.efficacy_types).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Mục tiêu (target_type)</label>
                    <select
                      value={sk.target_type ?? 1}
                      onChange={(e) => updateSkill(idx, 'target_type', e.target.value)}
                    >
                      {meta?.target_types && Object.entries(meta.target_types).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Efficacy Guidance Card */}
                <EfficacyHintCard effType={effType} meta={meta} />

                <div className="fields-grid-3">
                  <div className="form-field">
                    <label>Cách tính (calc_option)</label>
                    <select
                      value={sk.calc_option ?? 0}
                      onChange={(e) => updateSkill(idx, 'calc_option', e.target.value)}
                    >
                      {meta?.calc_options && Object.entries(meta.calc_options).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Số lượt hiệu lực (turn)</label>
                    <input
                      type="number"
                      value={sk.turn ?? 1}
                      onChange={(e) => updateSkill(idx, 'turn', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Sub-target Category Set ID</label>
                    <input
                      type="text"
                      value={sk.sub_target_type_set_id ?? ''}
                      onChange={(e) => updateSkillRaw(idx, 'sub_target_type_set_id', e.target.value)}
                      placeholder="Category ID..."
                    />
                  </div>
                </div>

                <div className="fields-grid-3">
                  <div className="form-field">
                    <label title={effDetails?.v1 || 'Value 1'}>{v1Label}</label>
                    <input
                      type="number"
                      value={sk.eff_val1 ?? 0}
                      onChange={(e) => updateSkill(idx, 'eff_val1', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label title={effDetails?.v2 || 'Value 2'}>{v2Label}</label>
                    <input
                      type="number"
                      value={sk.eff_val2 ?? 0}
                      onChange={(e) => updateSkill(idx, 'eff_val2', e.target.value)}
                    />
                  </div>
                  <div className="form-field">
                    <label title={effDetails?.v3 || 'Value 3'}>{v3Label}</label>
                    <input
                      type="number"
                      value={sk.eff_val3 ?? 0}
                      onChange={(e) => updateSkill(idx, 'eff_val3', e.target.value)}
                    />
                  </div>
                </div>

                <div className="form-field full-row">
                  <label>Efficacy Values (JSON/mảng tuỳ chọn)</label>
                  <input
                    type="text"
                    value={typeof sk.efficacy_values === 'object' ? JSON.stringify(sk.efficacy_values) : (sk.efficacy_values || '')}
                    onChange={(e) => updateSkillRaw(idx, 'efficacy_values', e.target.value)}
                    placeholder="{}"
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={handleAddEffect}><Plus size={15} /> Thêm effect mới</button></div>
    </div>
  )
}
