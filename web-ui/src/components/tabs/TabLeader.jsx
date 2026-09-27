import React, { useState } from 'react'
import { Crown, Sparkles, Layers, Plus, Trash2, AlertTriangle } from 'lucide-react'
import { DokkanDescriptionEditor } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'

export function TabLeader({ leader, draft, onChange, meta }) {
  const [proposal, setProposal] = useState(null)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState('')
  const currentSet = draft.leader_set || leader?.set
  const currentSkills = draft.leader_skills || leader?.skills || []

  if (!currentSet) {
    return (
      <div className="tab-pane empty-tab">
        <Crown size={36} />
        <h3>No Leader Skill Set found for this character</h3>
        <p>Check the <code>leader_skill_set_id</code> field in card profile.</p>
      </div>
    )
  }

  const updateSet = (key, val) => {
    onChange('leader_set', { ...currentSet, [key]: val })
  }

  const compile = async () => {
    setCompiling(true)
    setError('')
    setProposal(null)
    try {
      const result = await api.compileLeader(currentSet.description, currentSet.id)
      if (result.source === 'unsupported') throw new Error(result.warnings?.[0] || 'Không thể sinh efficacy cho mô tả này')
      setProposal({ ...result, description: currentSet.description })
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
      _draftKey: `compiled-leader-${Date.now()}-${index}`,
      leader_skill_set_id: currentSet.id
    }))
    onChange('leader_set', currentSet)
    onChange('leader_skills', replace ? generated : [...currentSkills, ...generated])
    if (replace) onChange('deleted_rows', [...(draft.deleted_rows || []),
      ...currentSkills.slice(generated.length).filter(sk => sk.id).map(sk => ({ table: 'leader_skills', id: sk.id }))])
    setProposal(null)
  }

  const updateSkill = (index, key, val) => {
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        return { ...sk, [key]: val === '' ? null : (isNaN(Number(val)) ? val : Number(val)) }
      }
      return sk
    })
    onChange('leader_skills', updated)
  }

  const updateSkillRaw = (index, key, val) => {
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        return { ...sk, [key]: val }
      }
      return sk
    })
    onChange('leader_skills', updated)
  }

  const handleAddLine = () => {
    const baseSetId = Number(currentSet.id) || 1
    const existingIds = currentSkills.map(s => Number(s.id) || 0)
    let newId = baseSetId * 10 + currentSkills.length + 1
    while (existingIds.includes(newId)) {
      newId++
    }

    const newLine = {
      id: newId,
      leader_skill_set_id: baseSetId,
      exec_timing_type: 1,
      target_type: 2,
      sub_target_type_set_id: '',
      causality_conditions: '',
      efficacy_type: 5,
      calc_option: 0,
      efficacy_values: '[3, 0, 0]'
    }
    onChange('leader_skills', [...currentSkills, newLine])
  }

  const handleDeleteLine = (index, skillId) => {
    const updated = currentSkills.filter((_, idx) => idx !== index)
    onChange('leader_skills', updated)
    if (skillId) {
      const deletedRows = draft.deleted_rows || []
      onChange('deleted_rows', [...deletedRows, { table: 'leader_skills', id: skillId }])
    }
  }

  return (
    <div className="tab-pane leader-pane">
      {/* Set Header Editor Card */}
      <div className="skill-hero-card editable">
        <div className="hero-top">
          <div className="hero-badge">LEADER SKILL SET #{currentSet.id}</div>
        </div>

        <div className="form-field full-row">
          <label>Leader Skill Name (name)</label>
          <input
            type="text"
            className="hero-input"
            value={currentSet.name || ''}
            onChange={(e) => updateSet('name', e.target.value)}
            placeholder="Enter Leader Skill name..."
          />
        </div>

        <DokkanDescriptionEditor
          label="Leader Skill Description"
          fieldKey="description"
          skillName={currentSet.name}
          skillType="LEADER SKILL"
          value={currentSet.description || ''}
          onChange={(val) => updateSet('description', val)}
          placeholder="Enter Leader Skill description..."
          defaultMode="split"
        />

        <div className="passive-compiler-actions">
          <button className="btn primary-btn" onClick={compile} disabled={compiling || !currentSet.description?.trim()}>
            <Sparkles size={15} /> {compiling ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
          </button>
          <span className="hint-text">Tìm mẫu gần trong database và suy ra category, Ki, HP, ATK, DEF từ mô tả.</span>
        </div>

        {error && <p className="passive-compiler-error">{error}</p>}

        {proposal && (
          <div className="passive-compiler-preview">
            <strong>{proposal.skills.length} dòng đề xuất · {proposal.source === 'database' ? 'khớp mô tả trong DB' : proposal.source === 'database-template' ? 'mẫu gần trong DB' : 'nhận diện theo quy tắc'}</strong>
            <div className="passive-compiler-preview-list">
              {proposal.skills.map((sk, index) => (
                <div key={index}>
                  <span>#{index + 1} · {meta?.efficacy_types?.[sk.efficacy_type] || `Efficacy ${sk.efficacy_type}`}</span>
                  <span>values: {typeof sk.efficacy_values === 'string' ? sk.efficacy_values : JSON.stringify(sk.efficacy_values)} · timing {sk.exec_timing_type ?? 1}</span>
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
      </div>

      {/* Sub-Skills Editor List */}
      <div className="sub-skills-section">
        <div className="section-bar space-between">
          <div className="bar-left">
            <Layers size={17} />
            <strong>Leader Skill Efficacies & Buff Branches ({currentSkills.length} lines)</strong>
          </div>
          <button
            type="button"
            className="btn-primary"
            style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', fontSize: 12.5 }}
            onClick={handleAddLine}
          >
            <Plus size={14} />
            <span>Thêm dòng buff</span>
          </button>
        </div>

        <div className="sub-skills-grid editable-grid">
          {currentSkills.map((sk, idx) => {
            const effType = Number(sk.efficacy_type) || 5
            const effDetails = meta?.efficacy_details?.[effType]

            return (
              <div key={sk.id || idx} className="sub-skill-card edit-card">
                <div className="sub-skill-head">
                  <span className="idx-tag">Buff Line #{idx + 1}</span>
                  <span className="id-tag">ID: {sk.id || 'Mới'}</span>
                  <button
                    type="button"
                    className="delete-effect-btn"
                    onClick={() => handleDeleteLine(idx, sk.id)}
                    title="Xóa dòng buff này"
                    style={{ marginLeft: 'auto', background: 'transparent', border: 'none', color: '#ff5252', cursor: 'pointer', padding: 4 }}
                  >
                    <Trash2 size={15} />
                  </button>
                </div>

                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>Thời điểm thực thi (exec_timing_type)</label>
                    <select
                      value={sk.exec_timing_type ?? 1}
                      onChange={(e) => updateSkill(idx, 'exec_timing_type', e.target.value)}
                    >
                      {meta?.exec_timings && Object.entries(meta.exec_timings).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Mục tiêu buff (target_type)</label>
                    <select
                      value={sk.target_type ?? 2}
                      onChange={(e) => updateSkill(idx, 'target_type', e.target.value)}
                    >
                      {meta?.target_types && Object.entries(meta.target_types).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>
                </div>

                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>Loại hiệu ứng (efficacy_type)</label>
                    <select
                      value={sk.efficacy_type ?? 5}
                      onChange={(e) => updateSkill(idx, 'efficacy_type', e.target.value)}
                    >
                      {meta?.efficacy_types && Object.entries(meta.efficacy_types).map(([id, label]) => (
                        <option key={id} value={id}>{label}</option>
                      ))}
                    </select>
                  </div>

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
                </div>

                {/* Efficacy Guidance Card */}
                <EfficacyHintCard effType={effType} meta={meta} />

                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>Sub Target Set ID (Category ID)</label>
                    <input
                      type="text"
                      value={sk.sub_target_type_set_id ?? ''}
                      onChange={(e) => updateSkillRaw(idx, 'sub_target_type_set_id', e.target.value)}
                      placeholder="Ví dụ: 101, 102..."
                      title="ID của nhóm Category áp dụng buff Leader"
                    />
                  </div>

                  <div className="form-field">
                    <label>
                      Giá trị hiệu ứng (efficacy_values)
                      {effDetails?.vals && <small style={{ color: '#ffca28', marginLeft: 6 }}>Format: {effDetails.vals}</small>}
                    </label>
                    <input
                      type="text"
                      value={typeof sk.efficacy_values === 'object' ? JSON.stringify(sk.efficacy_values) : (sk.efficacy_values || '')}
                      onChange={(e) => updateSkillRaw(idx, 'efficacy_values', e.target.value)}
                      placeholder="Ví dụ: [3, 0, 0] hoặc [0, 150, 150]"
                    />
                  </div>
                </div>

                {/* Causality Condition Expression */}
                <CausalityExpressionEditor
                  value={sk.causality_conditions}
                  onChange={(val) => updateSkillRaw(idx, 'causality_conditions', val)}
                  label="Điều kiện kích hoạt (Causality Expression)"
                  placeholder="Ví dụ: 930 | (296 & 3537) hoặc ID điều kiện"
                  meta={meta}
                />
              </div>
            )
          })}
        </div>
      </div>
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={handleAddLine}><Plus size={15} /> Thêm dòng buff</button></div>
    </div>
  )
}
