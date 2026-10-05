import { AnimationLookup } from '../common/AnimationLookup'
import React, { useState, useEffect, useRef } from 'react'
import { Shield, Clock, Film, Sparkles, Plus, Trash2, Volume2, HelpCircle, AlertCircle, Play, Pause, AlertTriangle } from 'lucide-react'
import { DokkanDescriptionEditor } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'
import { newDraftId } from '../../draftIds'
import { SkillClone } from '../common/SkillClone'
import { makeBattleParamDraft, updateBattleParamDrafts } from './battleParamDrafts'
import { BgmCardLookup } from '../common/BgmCardLookup'

export function TabStandby({ standby, draft, onChange, meta, card, onPlayAnim, transformationDescriptions = [], onAllocateBattleParam }) {
  const currentSet = draft.standby_set !== undefined ? draft.standby_set : standby?.set
  const currentSkills = draft.standby_skills !== undefined ? draft.standby_skills : (standby?.skills || [])
  const [proposal, setProposal] = useState(null)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState('')
  const [playingBgm, setPlayingBgm] = useState(false)
  const audioRef = useRef(null)
  const cloneControl = <SkillClone kind="standby" card={card} draft={draft} onChange={onChange} onCloned={() => setProposal(null)} />
  useEffect(() => () => {
    const audio = audioRef.current
    if (audio) {
      audio.pause()
      audio.onended = null
      audio.removeAttribute('src')
      audio.load()
      audioRef.current = null
    }
  }, [])

  const handleInitStandby = () => {
    if (!card) return
    const stId = newDraftId()
    
    const newSet = {
      id: stId,
      name: 'Standby Phase',
      effect_description: 'Enters standby mode and charges energy',
      condition_description: 'Can be activated after turns or under specific HP',
      dialog_order: 0,
      dialog_images: '{}',
      exec_timing_type: 1,
      exec_limit: 1,
      causality_conditions: '',
      special_view_id: 0,
      costume_special_view_id: 0,
      bgm_id: 0,
      is_dialog_view_visible: 1
    }

    const newLink = {
      id: standby?.link?.id || newDraftId(),
      card_id: card.id,
      standby_skill_set_id: stId
    }

    onChange('standby_set', newSet)
    onChange('standby_link', newLink)
    onChange('standby_skills', [])
  }
  const handleDeleteStandby = () => {
    const deleted = [...(draft.deleted_rows || [])]
    const link = draft.standby_link || standby?.link
    if (link?.id > 0) deleted.push({ table: 'card_standby_skill_set_relations', id: link.id })
    if (currentSet?.id > 0) deleted.push({ table: 'standby_skill_sets', id: currentSet.id })
    for (const skill of currentSkills) if (skill?.id > 0) deleted.push({ table: 'standby_skills', id: skill.id })
    const descriptions = draft.transformation_descriptions !== undefined ? draft.transformation_descriptions : transformationDescriptions
    const removedDescriptions = descriptions.filter(item => item.skill_type === 'StandbySkill' && currentSkills.some(skill => Number(skill.id) === Number(item.skill_id)))
    for (const item of removedDescriptions) if (item.id > 0) deleted.push({ table: 'transformation_descriptions', id: item.id })
    onChange('deleted_rows', deleted)
    if (removedDescriptions.length) onChange('transformation_descriptions', descriptions.filter(item => !removedDescriptions.includes(item)))
    onChange('standby_link', null)
    onChange('standby_set', null)
    onChange('standby_skills', [])
  }

  if (!currentSet) {
    return (
      <div className="tab-pane empty-tab">
        <Shield size={44} />
        <h3>No Standby Skill found for this character</h3>
        <p>This card does not have a <code>standby_skill_set</code> configured in the database.</p>
        <button
          type="button"
          className="btn-primary"
          style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px' }}
          onClick={handleInitStandby}
        >
          <Plus size={16} />
          <span>Initialize Standby Skill</span>
        </button>
        {cloneControl}
      </div>
    )
  }

  const updateSet = (key, val) => {
    onChange('standby_set', { ...currentSet, [key]: val })
  }

  const compile = async () => {
    setCompiling(true)
    setError('')
    setProposal(null)
    const desc = currentSet.effect_description || ''
    try {
      const result = await api.compileStandby(desc, currentSet.id)
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
    const newBattleParamDrafts = []
    const generated = proposal.skills.map((sk, index) => {
      const draftKey = `compiled-standby-${Date.now()}-${index}`
      const next = {
        ...sk,
        id: replace ? currentSkills[index]?.id : undefined,
        _draftKey: draftKey,
        standby_skill_set_id: currentSet.id
      }
      if (Number(sk.efficacy_type) === 103 && onAllocateBattleParam) {
        const battleDraftKey = `standby-transform-${draftKey}`
        const paramNo = onAllocateBattleParam()
        let values = []
        try { values = Array.isArray(sk.efficacy_values) ? [...sk.efficacy_values] : JSON.parse(sk.efficacy_values || '[]') } catch { values = [] }
        if (!Array.isArray(values)) values = []
        while (values.length < 3) values.push(0)
        values[2] = paramNo
        next.efficacy_values = JSON.stringify(values)
        next._battle_param_draft_key = battleDraftKey
        newBattleParamDrafts.push(makeBattleParamDraft(paramNo, battleDraftKey))
      }
      return next
    })
    onChange('standby_set', currentSet)
    onChange('standby_skills', replace ? generated : [...currentSkills, ...generated])
    if (newBattleParamDrafts.length) onChange('battle_params_draft', updateBattleParamDrafts(draft.battle_params_draft, newBattleParamDrafts))
    if (replace) onChange('deleted_rows', [...(draft.deleted_rows || []),
      ...currentSkills.slice(generated.length).filter(sk => sk.id).map(sk => ({ table: 'standby_skills', id: sk.id }))])
    setProposal(null)
  }

  const updateSkill = (index, key, val) => {
    let addBattleParamDraft = null
    let removeBattleParamKey = ''
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        const value = val === '' ? null : (isNaN(Number(val)) ? val : Number(val))
        if (key === 'efficacy_type' && Number(value) === 103 && Number(sk.efficacy_type) !== 103) {
          const draftKey = `standby-transform-${card?.id || 0}-${sk._draftKey || sk.id || idx}-${Date.now()}`
          const paramNo = onAllocateBattleParam?.()
          if (paramNo) {
            let values = []
            try {
              values = Array.isArray(sk.efficacy_values) ? [...sk.efficacy_values] : JSON.parse(sk.efficacy_values || '[]')
            } catch { values = [] }
            if (!Array.isArray(values)) values = []
            while (values.length < 3) values.push(0)
            values[2] = paramNo
            addBattleParamDraft = makeBattleParamDraft(paramNo, draftKey)
            return { ...sk, [key]: value, efficacy_values: JSON.stringify(values), _battle_param_draft_key: draftKey }
          }
        }
        if (key === 'efficacy_type' && Number(value) !== 103 && Number(sk.efficacy_type) === 103 && sk._battle_param_draft_key) {
          removeBattleParamKey = sk._battle_param_draft_key
          let values = []
          try {
            values = Array.isArray(sk.efficacy_values) ? [...sk.efficacy_values] : JSON.parse(sk.efficacy_values || '[]')
          } catch { values = [] }
          if (Array.isArray(values) && values.length > 2) values[2] = 0
          return { ...sk, [key]: value, efficacy_values: JSON.stringify(values), _battle_param_draft_key: undefined }
        }
        return {
          ...sk,
          [key]: value
        }
      }
      return sk
    })
    onChange('standby_skills', updated)
    if (addBattleParamDraft || removeBattleParamKey) {
      onChange('battle_params_draft', updateBattleParamDrafts(draft.battle_params_draft,
        addBattleParamDraft ? [addBattleParamDraft] : [], removeBattleParamKey || ''))
    }
  }

  const updateSkillRaw = (index, key, val) => {
    const updated = currentSkills.map((sk, idx) => {
      if (idx === index) {
        return { ...sk, [key]: val }
      }
      return sk
    })
    onChange('standby_skills', updated)
  }

  const handleAddEffect = () => {
    const baseSetId = Number(currentSet.id) || 1
    const newId = newDraftId()

    const newEffect = {
      id: newId,
      standby_skill_set_id: baseSetId,
      target_type: 1,
      target_type_values: '{}',
      sub_target_type_set_id: '',
      turn: 1,
      efficacy_type: 115,
      calc_option: 0,
      efficacy_values: '{}',
      thumb_effect_id: '',
      effect_se_id: ''
    }
    onChange('standby_skills', [...currentSkills, newEffect])
  }

  const handleDeleteEffect = (index, skillId) => {
    const updated = currentSkills.filter((_, idx) => idx !== index)
    onChange('standby_skills', updated)
    if (skillId) {
      const deletedRows = draft.deleted_rows || []
      onChange('deleted_rows', [...deletedRows, { table: 'standby_skills', id: skillId }])
    }
  }

  const togglePlayBgm = (bgmId) => {
    if (!bgmId || bgmId <= 0) return
    if (playingBgm && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
      setPlayingBgm(false)
    } else {
      const audio = new Audio(`http://127.0.0.1:8585/bgm/${bgmId}`)
      audioRef.current = audio
      audio.play().then(() => {
        if (audioRef.current !== audio) { audio.pause(); return }
        setPlayingBgm(true)
        audio.onended = () => {
          setPlayingBgm(false)
          audioRef.current = null
        }
      }).catch(err => {
        console.warn('Audio playback failed:', err)
        if (audioRef.current === audio) audioRef.current = null
      })
    }
  }

  const targetTypes = meta?.target_types || {}
  const efficacyTypes = meta?.efficacy_types || {}
  const calcOptions = meta?.calc_options || {}
  const effDetails = meta?.efficacy_details || {}
  const causalities = meta?.causality || {}

  return (
    <div className="tab-pane standby-pane">
      {cloneControl}
      {/* Standby Skill Set Configuration */}
      <div className="skill-hero-card standby-theme editable">
        <div className="hero-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="hero-badge">STANDBY SKILL SET {currentSet.id < 0 ? 'MỚI · ID tự cấp trong SQL' : `#${currentSet.id}`}</div>
          <button type="button" className="btn ghost-btn" onClick={handleDeleteStandby}><Trash2 size={14} /> Xóa Standby Skill</button>
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
          <label>Standby Skill Name (name)</label>
          <input
            type="text"
            className="hero-input"
            value={currentSet.name || ''}
            onChange={(e) => updateSet('name', e.target.value)}
            placeholder="Enter Standby Skill name..."
          />
        </div>

        <div className="fields-grid-2">
          <DokkanDescriptionEditor
            label="Effect Description"
            fieldKey="effect_description"
            skillName={currentSet.name}
            skillType="STANDBY EFFECT"
            value={currentSet.effect_description || ''}
            onChange={(val) => updateSet('effect_description', val)}
            placeholder="Enter Standby Effect description..."
            defaultMode="edit"
          />

          <DokkanDescriptionEditor
            label="Condition Description"
            fieldKey="condition_description"
            skillName={currentSet.name}
            skillType="STANDBY CONDITION"
            value={currentSet.condition_description || ''}
            onChange={(val) => updateSet('condition_description', val)}
            placeholder="Enter Condition description..."
            defaultMode="edit"
          />
        </div>

        <div className="passive-compiler-actions">
          <button className="btn primary-btn" onClick={compile} disabled={compiling || !currentSet.effect_description?.trim()}>
            <Sparkles size={15} /> {compiling ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
          </button>
          <span className="hint-text">Dùng cấu hình Standby hiện tại làm mẫu và cập nhật thông số theo mô tả.</span>
        </div>

        {error && <p className="passive-compiler-error">{error}</p>}

        {proposal && (
          <div className="passive-compiler-preview">
            <strong>{proposal.skills.length} dòng đề xuất · {proposal.source === 'database' ? 'khớp mô tả trong DB' : proposal.source === 'database-template' ? 'mẫu gần trong DB' : 'nhận diện theo quy tắc'}</strong>
            <div className="passive-compiler-preview-list">
              {proposal.skills.map((sk, index) => (
                <div key={index}>
                  <span>#{index + 1} · {meta?.efficacy_types?.[sk.efficacy_type] || `Efficacy ${sk.efficacy_type}`}</span>
                  <span>values: {typeof sk.efficacy_values === 'string' ? sk.efficacy_values : JSON.stringify(sk.efficacy_values)} · {sk.turn} turns</span>
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

        <div className="fields-grid-3">
          <div className="form-field">
            <label><Clock size={13} /> Execution Limit (exec_limit)</label>
            <input
              type="number"
              value={currentSet.exec_limit ?? 1}
              onChange={(e) => updateSet('exec_limit', Number(e.target.value))}
            />
          </div>

          <div className="form-field">
            <label><Film size={13} /> Special View ID (special_view_id)</label>
            <input
              type="number"
              value={currentSet.special_view_id ?? 0}
              onChange={(e) => updateSet('special_view_id', Number(e.target.value))}
            />
                  <AnimationLookup slot="standby" onSelect={id => updateSet('special_view_id', id)} />
          </div>

          <div className="form-field">
            <label><Volume2 size={13} /> BGM ID (bgm_id)</label>
            <div style={{ display: 'flex', gap: 6 }}>
              <input
                type="number"
                value={currentSet.bgm_id ?? 0}
                onChange={(e) => updateSet('bgm_id', Number(e.target.value))}
                style={{ flex: 1 }}
              />
              {currentSet.bgm_id > 0 && (
                <button
                  type="button"
                  className={`bgm-btn ${playingBgm ? 'playing' : ''}`}
                  style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0 }}
                  onClick={() => togglePlayBgm(currentSet.bgm_id)}
                  title={playingBgm ? "Stop BGM" : "Listen to Standby BGM"}
                >
                  {playingBgm ? <Pause size={14} /> : <Play size={14} />}
                </button>
              )}
            </div>
            <BgmCardLookup onSelect={id => updateSet('bgm_id', id)} />
          </div>
        </div>

        <div style={{ marginTop: 10 }}>
          <CausalityExpressionEditor
            value={currentSet.causality_conditions}
            onChange={(val) => updateSet('causality_conditions', val)}
            label="Standby Causality Conditions (Biểu thức điều kiện kích hoạt)"
            placeholder="Ví dụ: 930 | (296 & 3537) hoặc ID điều kiện"
            meta={meta}
          />
        </div>
      </div>

      {/* Standby Skill Effects List */}
      <div className="section-bar space-between" style={{ marginTop: 24, marginBottom: 12 }}>
        <div className="bar-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Sparkles size={16} />
          <strong>Standby Skill Effects ({currentSkills.length})</strong>
        </div>
        <button
          type="button"
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
          onClick={handleAddEffect}
        >
          <Plus size={15} />
          <span>Add Standby Effect</span>
        </button>
      </div>

      <div className="effects-list">
        {currentSkills.length === 0 ? (
          <div className="empty-moves" style={{ padding: '24px 16px', textAlign: 'center', background: 'rgba(20, 24, 38, 0.4)', borderRadius: 10 }}>
            No standby effects configured. Click "Add Standby Effect" above to create one.
          </div>
        ) : (
          currentSkills.map((sk, idx) => {
            const effType = sk.efficacy_type ?? 115
            const effName = efficacyTypes[effType] || `Efficacy ${effType}`
            const details = effDetails[effType] || {}

            return (
              <div key={sk.id || idx} className="effect-card edit-card" style={{ marginBottom: 14, background: 'linear-gradient(135deg, rgba(22, 25, 38, 0.95), rgba(16, 18, 28, 0.98))', border: '1px solid #2a2e46', borderRadius: 10, padding: 14 }}>
                <div className="effect-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <div className="effect-badge" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span style={{ color: '#ffca28', fontWeight: 800, fontSize: 14 }}>
                      ⏳ Standby Effect #{idx + 1}
                    </span>
                    <span style={{ color: '#90a4ae', fontSize: 12 }}>
                      (ID: {sk.id})
                    </span>
                    <span style={{ background: 'rgba(128, 216, 255, 0.15)', color: '#80d8ff', padding: '2px 8px', borderRadius: 6, fontSize: 11, fontWeight: 700, border: '1px solid rgba(128, 216, 255, 0.3)' }}>
                      {effName}
                    </span>
                  </div>

                  <button
                    type="button"
                    className="btn-danger"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => handleDeleteEffect(idx, sk.id)}
                    title="Delete this standby effect"
                  >
                    <Trash2 size={13} />
                    <span>Delete</span>
                  </button>
                </div>

                <div className="fields-grid-3" style={{ marginBottom: 10 }}>
                  <div className="form-field">
                    <label>Target Type</label>
                    <select
                      value={sk.target_type ?? 1}
                      onChange={(e) => updateSkill(idx, 'target_type', e.target.value)}
                    >
                      {Object.entries(targetTypes).map(([tid, label]) => (
                        <option key={tid} value={tid}>
                          {label} ({tid})
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Efficacy Type</label>
                    <select
                      value={effType}
                      onChange={(e) => updateSkill(idx, 'efficacy_type', e.target.value)}
                    >
                      {Object.entries(efficacyTypes).map(([eid, label]) => (
                        <option key={eid} value={eid}>
                          {label} ({eid})
                        </option>
                      ))}
                    </select>
                    {details.desc && (
                      <small style={{ color: '#80d8ff', fontSize: 11, marginTop: 4, display: 'block' }}>
                        ℹ️ {details.desc}
                      </small>
                    )}
                  </div>

                  <div className="form-field">
                    <label>Calculation Option</label>
                    <select
                      value={sk.calc_option ?? 0}
                      onChange={(e) => updateSkill(idx, 'calc_option', e.target.value)}
                    >
                      {Object.entries(calcOptions).map(([cid, label]) => (
                        <option key={cid} value={cid}>
                          {label} ({cid})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <EfficacyHintCard effType={effType} meta={meta} />

                <div className="fields-grid-3">
                  <div className="form-field">
                    <label>Turn Constraint (turn)</label>
                    <input
                      type="number"
                      value={sk.turn ?? 1}
                      onChange={(e) => updateSkill(idx, 'turn', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Sub Target Type Set ID</label>
                    <input
                      type="text"
                      value={sk.sub_target_type_set_id ?? ''}
                      onChange={(e) => updateSkillRaw(idx, 'sub_target_type_set_id', e.target.value)}
                      placeholder="Optional sub target id"
                    />
                  </div>

                  <div className="form-field">
                    <label>Efficacy Values (JSON)</label>
                    <input
                      type="text"
                      value={typeof sk.efficacy_values === 'object' ? JSON.stringify(sk.efficacy_values) : (sk.efficacy_values || '{}')}
                      onChange={(e) => updateSkillRaw(idx, 'efficacy_values', e.target.value)}
                      placeholder="{}"
                    />
                    {(details.v1 || details.v2 || details.v3) && (
                      <small style={{ color: '#a0aec0', fontSize: 10.5, marginTop: 4, display: 'block' }}>
                        {[details.v1 && `v1: ${details.v1}`, details.v2 && `v2: ${details.v2}`, details.v3 && `v3: ${details.v3}`].filter(Boolean).join(' | ')}
                      </small>
                    )}
                  </div>
                </div>
              </div>
            )
          })
        )}
      </div>
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={handleAddEffect}><Plus size={15} /> Add Standby Effect</button></div>
    </div>
  )
}
