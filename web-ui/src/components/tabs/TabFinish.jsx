import { AnimationLookup } from '../common/AnimationLookup'
import React, { useState, useEffect, useRef } from 'react'
import { Target, Plus, Trash2, Shield, Zap, Sparkles, Film, Clock, Heart, Volume2, ChevronDown, ChevronRight, Layers, Play, Pause, AlertTriangle } from 'lucide-react'
import { DokkanDescriptionEditor } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'

export function TabFinish({ finish = [], transformationDescriptions = [], draft, onChange, meta, card, onPlayAnim }) {
  const currentSets = draft.finish_skill_sets !== undefined ? draft.finish_skill_sets : finish
  const [playingBgmId, setPlayingBgmId] = useState(null)
  const [proposals, setProposals] = useState({})
  const [compilingIdx, setCompilingIdx] = useState(null)
  const [errors, setErrors] = useState({})
  const audioRef = useRef(null)
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

  const compileFinish = async (setIdx) => {
    const item = currentSets[setIdx]
    if (!item) return
    const desc = item.set?.effect_description || ''
    setCompilingIdx(setIdx)
    setErrors((prev) => ({ ...prev, [setIdx]: '' }))
    try {
      const res = await api.compileFinish(desc, item.set?.id)
      if (res.source === 'unsupported') throw new Error(res.warnings?.[0] || 'Không thể sinh efficacy cho mô tả này')
      setProposals((prev) => ({ ...prev, [setIdx]: { ...res, description: desc } }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [setIdx]: err.message }))
    } finally {
      setCompilingIdx(null)
    }
  }

  const applyFinishProposal = (setIdx, replace) => {
    const proposal = proposals[setIdx]
    if (!proposal?.skills?.length && !proposal?.special) return
    const item = currentSets[setIdx]
    const baseSetId = Number(item.set?.id) || setIdx + 1
    const generated = (proposal.skills || []).map((sk, sIdx) => ({
      ...sk,
      id: replace ? item.skills?.[sIdx]?.id : undefined,
      _draftKey: `compiled-finish-${Date.now()}-${sIdx}`,
      finish_skill_set_id: baseSetId
    }))
    const updated = currentSets.map((fn, i) => {
      if (i === setIdx) {
        return {
          ...fn,
          special: proposal.special ? {
            ...fn.special,
            increase_rate: proposal.special.increase_rate ?? fn.special?.increase_rate,
            aim_target: proposal.special.aim_target ?? fn.special?.aim_target
          } : fn.special,
          skills: replace ? generated : [...(fn.skills || []), ...generated]
        }
      }
      return fn
    })
    updateFinishList(updated)
    if (replace) onChange('deleted_rows', [...(draft.deleted_rows || []),
      ...(item.skills || []).slice(generated.length).filter(sk => sk.id).map(sk => ({ table: 'finish_skills', id: sk.id }))])
    setProposals((prev) => {
      const copy = { ...prev }
      delete copy[setIdx]
      return copy
    })
  }

  const updateFinishList = (newList) => {
    onChange('finish_skill_sets', newList)
  }

  const handleAddSet = () => {
    if (!card) return
    const newFnId = -Date.now()
    const newRelId = newFnId

    const newItem = {
      link: {
        id: newRelId,
        card_id: card.id,
        finish_skill_set_id: newFnId
      },
      set: {
        id: newFnId,
        name: `Finish Skill Attack #${currentSets.length + 1}`,
        effect_description: 'Raises ATK and causes damage',
        condition_description: 'Activate when charge is high',
        dialog_order: 0,
        dialog_images: '{}',
        exec_timing_type: 0,
        exec_limit: 1,
        causality_conditions: '',
        finish_special_id: newFnId,
        special_view_id: 0,
        costume_special_view_id: 0,
        bgm_id: 0,
        is_dialog_view_visible: 1
      },
      special: {
        id: newFnId,
        increase_rate: 500,
        aim_target: 0
      },
      skills: []
    }

    updateFinishList([...currentSets, newItem])
  }

  const handleDeleteSet = (setIdx) => {
    const target = currentSets[setIdx]
    if (!target) return

    const deleted = [...(draft.deleted_rows || [])]
    if (target.link?.id) {
      deleted.push({ table: 'card_finish_skill_set_relations', id: target.link.id })
    }
    if (target.set?.id) {
      deleted.push({ table: 'finish_skill_sets', id: target.set.id })
    }
    if (target.special?.id) {
      deleted.push({ table: 'finish_specials', id: target.special.id })
    }
    for (const sk of (target.skills || [])) {
      if (sk?.id) {
        deleted.push({ table: 'finish_skills', id: sk.id })
      }
    }
    const descriptions = draft.transformation_descriptions !== undefined ? draft.transformation_descriptions : transformationDescriptions
    const removedDescriptions = descriptions.filter(item => item.skill_type === 'FinishSkill' && (target.skills || []).some(skill => Number(skill.id) === Number(item.skill_id)))
    for (const item of removedDescriptions) if (item.id > 0) deleted.push({ table: 'transformation_descriptions', id: item.id })
    if (removedDescriptions.length) onChange('transformation_descriptions', descriptions.filter(item => !removedDescriptions.includes(item)))
    onChange('deleted_rows', deleted)

    const updated = currentSets.filter((_, idx) => idx !== setIdx)
    updateFinishList(updated)
  }

  const updateSetField = (setIdx, key, val) => {
    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        return {
          ...item,
          set: { ...item.set, [key]: val }
        }
      }
      return item
    })
    updateFinishList(updated)
  }

  const updateSpecialField = (setIdx, key, val) => {
    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        return {
          ...item,
          special: { ...item.special, [key]: val === '' ? null : Number(val) }
        }
      }
      return item
    })
    updateFinishList(updated)
  }

  const handleAddEffect = (setIdx) => {
    const target = currentSets[setIdx]
    if (!target) return
    const baseId = Number(target.set?.id) || 1
    const skills = target.skills || []
    const newId = -Date.now()

    const newEffect = {
      id: newId,
      finish_skill_set_id: baseId,
      target_type: 1,
      target_type_values: '{}',
      sub_target_type_set_id: '',
      turn: 1,
      efficacy_type: 116,
      calc_option: 0,
      efficacy_values: '{}',
      thumb_effect_id: '',
      effect_se_id: ''
    }

    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        return {
          ...item,
          skills: [...(item.skills || []), newEffect]
        }
      }
      return item
    })
    updateFinishList(updated)
  }

  const handleDeleteEffect = (setIdx, skIdx, skillId) => {
    const target = currentSets[setIdx]
    if (!target) return

    if (skillId) {
      const deleted = [...(draft.deleted_rows || [])]
      deleted.push({ table: 'finish_skills', id: skillId })
      onChange('deleted_rows', deleted)
    }

    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        return {
          ...item,
          skills: (item.skills || []).filter((_, sIdx) => sIdx !== skIdx)
        }
      }
      return item
    })
    updateFinishList(updated)
  }

  const updateSkillField = (setIdx, skIdx, key, val) => {
    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        const skills = (item.skills || []).map((sk, sIdx) => {
          if (sIdx === skIdx) {
            return {
              ...sk,
              [key]: val === '' ? null : (isNaN(Number(val)) ? val : Number(val))
            }
          }
          return sk
        })
        return { ...item, skills }
      }
      return item
    })
    updateFinishList(updated)
  }

  const updateSkillRaw = (setIdx, skIdx, key, val) => {
    const updated = currentSets.map((item, idx) => {
      if (idx === setIdx) {
        const skills = (item.skills || []).map((sk, sIdx) => {
          if (sIdx === skIdx) {
            return { ...sk, [key]: val }
          }
          return sk
        })
        return { ...item, skills }
      }
      return item
    })
    updateFinishList(updated)
  }

  const togglePlayBgm = (bgmId) => {
    if (!bgmId || bgmId <= 0) return
    if (playingBgmId === bgmId && audioRef.current) {
      audioRef.current.pause()
      audioRef.current.removeAttribute('src')
      audioRef.current.load()
      audioRef.current = null
      setPlayingBgmId(null)
    } else {
      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeAttribute('src')
        audioRef.current.load()
      }
      const audio = new Audio(`http://127.0.0.1:8585/bgm/${bgmId}`)
      audioRef.current = audio
      audio.play().then(() => {
        if (audioRef.current !== audio) { audio.pause(); return }
        setPlayingBgmId(bgmId)
        audio.onended = () => {
          setPlayingBgmId(null)
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

  return (
    <div className="tab-pane finish-pane">
      {/* Top Action Bar */}
      <div className="section-bar space-between" style={{ marginBottom: 16 }}>
        <div className="bar-left" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Target size={18} />
          <strong>Finish Skills ({currentSets.length})</strong>
        </div>
        <button
          type="button"
          className="btn-primary"
          style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 14px', fontSize: 13 }}
          onClick={handleAddSet}
        >
          <Plus size={15} />
          <span>Add New Finish Skill</span>
        </button>
      </div>

      {currentSets.length === 0 ? (
        <div className="tab-pane empty-tab" style={{ background: 'rgba(20, 24, 38, 0.4)', borderRadius: 10, padding: 32 }}>
          <Target size={44} />
          <h3>No Finish Attack found for this character</h3>
          <p>This card is not bound to any <code>finish_skill_sets</code>. Click above to initialize a Finish Attack.</p>
          <button
            type="button"
            className="btn-primary"
            style={{ marginTop: 14, display: 'inline-flex', alignItems: 'center', gap: 8, padding: '10px 18px' }}
            onClick={handleAddSet}
          >
            <Plus size={16} />
            <span>Add New Finish Skill</span>
          </button>
        </div>
      ) : (
        currentSets.map((item, fIdx) => {
          const fnSet = item.set || {}
          const fnSpec = item.special || {}
          const fnSkills = item.skills || []
          const setId = fnSet.id || fIdx + 1

          return (
            <div key={setId} className="finish-card edit-card" style={{ marginBottom: 28, background: 'linear-gradient(135deg, rgba(22, 25, 38, 0.96), rgba(14, 16, 26, 0.99))', border: '1.5px solid #2a2c42', borderRadius: 12, padding: 18 }}>
              {/* Finish Set Header */}
              <div className="finish-card-head" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div className="finish-badge" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Target size={15} />
                  <span style={{ fontWeight: 800, fontSize: 14, color: '#ffca28' }}>
                    FINISH SKILL #{fIdx + 1}: <span style={{ color: '#80d8ff' }}>{fnSet.name || 'Finish Attack'}</span>
                  </span>
                  <span style={{ color: '#90a4ae', fontSize: 12 }}>
                    (Set ID: {setId})
                  </span>
                </div>

                <div className="finish-card-actions">
                  {onPlayAnim && fnSet.special_view_id > 0 && (
                    <button
                      type="button"
                      className="finish-action-btn finish-preview-btn"
                      onClick={onPlayAnim}
                    >
                      <Film size={13} />
                      <span>Preview Animation</span>
                    </button>
                  )}
                  <button
                    type="button"
                    className="finish-action-btn finish-delete-btn"
                    onClick={() => handleDeleteSet(fIdx)}
                    title="Delete this entire Finish Skill set"
                  >
                    <Trash2 size={13} />
                    <span>Delete Skill Set</span>
                  </button>
                </div>
              </div>

              {/* Set Details */}
              <div className="form-field full-row">
                <label>Finish Skill Name (name)</label>
                <input
                  type="text"
                  value={fnSet.name || ''}
                  onChange={(e) => updateSetField(fIdx, 'name', e.target.value)}
                  placeholder="Enter Finish Skill name..."
                />
              </div>

              <div className="fields-grid-2">
                <DokkanDescriptionEditor
                  label="Finish Effect Description"
                  fieldKey="effect_description"
                  skillName={fnSet.name}
                  skillType="FINISH EFFECT"
                  value={fnSet.effect_description || ''}
                  onChange={(val) => updateSetField(fIdx, 'effect_description', val)}
                  placeholder="Enter Finish Effect description..."
                  defaultMode="edit"
                />

                <DokkanDescriptionEditor
                  label="Condition Description"
                  fieldKey="condition_description"
                  skillName={fnSet.name}
                  skillType="FINISH CONDITION"
                  value={fnSet.condition_description || ''}
                  onChange={(val) => updateSetField(fIdx, 'condition_description', val)}
                  placeholder="Enter Condition description..."
                  defaultMode="edit"
                />
              </div>

              <div className="passive-compiler-actions" style={{ marginTop: 8, marginBottom: 12 }}>
                <button
                  type="button"
                  className="btn primary-btn"
                  onClick={() => compileFinish(fIdx)}
                  disabled={compilingIdx === fIdx || !fnSet.effect_description?.trim()}
                >
                  <Sparkles size={15} /> {compilingIdx === fIdx ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
                </button>
                <span className="hint-text">Dùng cấu hình Finish hiện tại làm mẫu và cập nhật thông số theo mô tả.</span>
              </div>

              {errors[fIdx] && <p className="passive-compiler-error">{errors[fIdx]}</p>}

              {proposals[fIdx] && (
                <div className="passive-compiler-preview" style={{ marginBottom: 16 }}>
                  <strong>
                    {proposals[fIdx].skills?.length || 0} dòng đề xuất · {
                      proposals[fIdx].source === 'database' ? 'khớp mô tả trong DB' :
                      proposals[fIdx].source === 'database-template' ? 'mẫu gần trong DB' : 'nhận diện theo quy tắc'
                    }
                  </strong>
                  {proposals[fIdx].special && (
                    <div style={{ fontSize: 12, color: '#ffca28', margin: '4px 0' }}>
                      ⚡ Finish Move: increase_rate = {proposals[fIdx].special.increase_rate}%
                    </div>
                  )}
                  <div className="passive-compiler-preview-list">
                    {proposals[fIdx].skills?.map((sk, index) => (
                      <div key={index}>
                        <span>#{index + 1} · {meta?.efficacy_types?.[sk.efficacy_type] || `Efficacy ${sk.efficacy_type}`}</span>
                        <span>values: {typeof sk.efficacy_values === 'string' ? sk.efficacy_values : JSON.stringify(sk.efficacy_values)} · {sk.turn} turns</span>
                      </div>
                    ))}
                  </div>
                  <div className="passive-compiler-actions" style={{ marginTop: 10 }}>
                    <button type="button" className="btn primary-btn" onClick={() => applyFinishProposal(fIdx, true)}>
                      Áp dụng (Thay thế toàn bộ)
                    </button>
                    <button type="button" className="btn secondary-btn" onClick={() => applyFinishProposal(fIdx, false)}>
                      Áp dụng (Nối thêm)
                    </button>
                    <button
                      type="button"
                      className="btn ghost-btn"
                      onClick={() => {
                        setProposals((prev) => {
                          const copy = { ...prev }
                          delete copy[fIdx]
                          return copy
                        })
                      }}
                    >
                      Hủy
                    </button>
                  </div>
                </div>
              )}

              <div className="fields-grid-3">
                <div className="form-field">
                  <label>Execution Limit (exec_limit)</label>
                  <input
                    type="number"
                    value={fnSet.exec_limit ?? 1}
                    onChange={(e) => updateSetField(fIdx, 'exec_limit', Number(e.target.value))}
                  />
                </div>

                <div className="form-field">
                  <label><Film size={13} /> Special View ID (special_view_id)</label>
                  <input
                    type="number"
                    value={fnSet.special_view_id ?? 0}
                    onChange={(e) => updateSetField(fIdx, 'special_view_id', Number(e.target.value))}
                  />
                  <AnimationLookup slot="finish" onSelect={id => updateSetField(fIdx, 'special_view_id', id)} />
                </div>

                <div className="form-field">
                  <label><Volume2 size={13} /> BGM ID (bgm_id)</label>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      type="number"
                      value={fnSet.bgm_id ?? 0}
                      onChange={(e) => updateSetField(fIdx, 'bgm_id', Number(e.target.value))}
                      style={{ flex: 1 }}
                    />
                    {fnSet.bgm_id > 0 && (
                      <button
                        type="button"
                        className={`bgm-btn ${playingBgmId === fnSet.bgm_id ? 'playing' : ''}`}
                        style={{ width: 34, height: 34, borderRadius: 6, flexShrink: 0 }}
                        onClick={() => togglePlayBgm(fnSet.bgm_id)}
                        title={playingBgmId === fnSet.bgm_id ? "Stop BGM" : "Listen to Finish BGM"}
                      >
                        {playingBgmId === fnSet.bgm_id ? <Pause size={14} /> : <Play size={14} />}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div style={{ marginTop: 10 }}>
                <CausalityExpressionEditor
                  value={fnSet.causality_conditions}
                  onChange={(val) => updateSetField(fIdx, 'causality_conditions', val)}
                  label="Finish Skill Causality Conditions (Biểu thức điều kiện kích hoạt)"
                  placeholder="Ví dụ: 930 | (296 & 3537) hoặc ID điều kiện"
                  meta={meta}
                />
              </div>

              {/* Special Configuration (Damage Multipliers) */}
              <div style={{ marginTop: 14, paddingTop: 12, borderTop: '1px solid #2a2e46' }}>
                <div style={{ fontSize: 13, fontWeight: 700, color: '#ffca28', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Zap size={14} />
                  <span>Finish Special Move Configuration (Damage Modifiers)</span>
                </div>
                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>Damage Increase Rate (%) (increase_rate)</label>
                    <input
                      type="number"
                      step="50"
                      value={fnSpec.increase_rate ?? 500}
                      onChange={(e) => updateSpecialField(fIdx, 'increase_rate', e.target.value)}
                    />
                  </div>

                  <div className="form-field">
                    <label>Aim Target Mode (aim_target)</label>
                    <input
                      type="number"
                      value={fnSpec.aim_target ?? 0}
                      onChange={(e) => updateSpecialField(fIdx, 'aim_target', e.target.value)}
                    />
                  </div>
                </div>
              </div>

              {/* Finish Skill Effects */}
              <div style={{ marginTop: 16, paddingTop: 14, borderTop: '1px solid #2a2e46' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
                  <span style={{ fontSize: 13, fontWeight: 700, color: '#80d8ff', display: 'flex', alignItems: 'center', gap: 6 }}>
                    <Sparkles size={14} />
                    <span>Finish Skill Effects ({fnSkills.length})</span>
                  </span>
                  <button
                    type="button"
                    className="btn-secondary"
                    style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 10px', fontSize: 12 }}
                    onClick={() => handleAddEffect(fIdx)}
                  >
                    <Plus size={13} />
                    <span>Add Effect</span>
                  </button>
                </div>

                {fnSkills.length === 0 ? (
                  <div style={{ fontSize: 12, color: '#78909c', padding: '10px 14px', background: 'rgba(0,0,0,0.2)', borderRadius: 8 }}>
                    No extra effects for this Finish Skill. Click "Add Effect" above to append one.
                  </div>
                ) : (
                  fnSkills.map((sk, skIdx) => {
                    const effType = sk.efficacy_type ?? 116
                    const effName = efficacyTypes[effType] || `Efficacy ${effType}`
                    const details = effDetails[effType] || {}

                    return (
                      <div key={sk.id || skIdx} style={{ background: 'rgba(18, 20, 30, 0.7)', border: '1px solid #25283a', borderRadius: 8, padding: 12, marginBottom: 10 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ color: '#ffca28', fontWeight: 700, fontSize: 13 }}>
                              🎯 Effect #{skIdx + 1}
                            </span>
                            <span style={{ color: '#90a4ae', fontSize: 11 }}>
                              (ID: {sk.id})
                            </span>
                            <span style={{ background: 'rgba(128, 216, 255, 0.12)', color: '#80d8ff', padding: '1px 6px', borderRadius: 4, fontSize: 11, fontWeight: 700 }}>
                              {effName}
                            </span>
                          </div>

                          <button
                            type="button"
                            className="finish-action-btn finish-delete-btn compact"
                            onClick={() => handleDeleteEffect(fIdx, skIdx, sk.id)}
                          >
                            <Trash2 size={12} />
                            <span>Delete</span>
                          </button>
                        </div>

                        <div className="fields-grid-3" style={{ marginBottom: 8 }}>
                          <div className="form-field">
                            <label>Target Type</label>
                            <select
                              value={sk.target_type ?? 1}
                              onChange={(e) => updateSkillField(fIdx, skIdx, 'target_type', e.target.value)}
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
                              onChange={(e) => updateSkillField(fIdx, skIdx, 'efficacy_type', e.target.value)}
                            >
                              {Object.entries(efficacyTypes).map(([eid, label]) => (
                                <option key={eid} value={eid}>
                                  {label} ({eid})
                                </option>
                              ))}
                            </select>
                            {details.desc && (
                              <small style={{ color: '#80d8ff', fontSize: 10.5, marginTop: 3, display: 'block' }}>
                                ℹ️ {details.desc}
                              </small>
                            )}
                          </div>

                          <div className="form-field">
                            <label>Calculation Option</label>
                            <select
                              value={sk.calc_option ?? 0}
                              onChange={(e) => updateSkillField(fIdx, skIdx, 'calc_option', e.target.value)}
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
                              onChange={(e) => updateSkillField(fIdx, skIdx, 'turn', e.target.value)}
                            />
                          </div>

                          <div className="form-field">
                            <label>Sub Target Type Set ID</label>
                            <input
                              type="text"
                              value={sk.sub_target_type_set_id ?? ''}
                              onChange={(e) => updateSkillRaw(fIdx, skIdx, 'sub_target_type_set_id', e.target.value)}
                              placeholder="Optional sub target id"
                            />
                          </div>

                          <div className="form-field">
                            <label>Efficacy Values (JSON)</label>
                            <input
                              type="text"
                              value={typeof sk.efficacy_values === 'object' ? JSON.stringify(sk.efficacy_values) : (sk.efficacy_values || '{}')}
                              onChange={(e) => updateSkillRaw(fIdx, skIdx, 'efficacy_values', e.target.value)}
                              placeholder="{}"
                            />
                            {(details.v1 || details.v2 || details.v3) && (
                              <small style={{ color: '#a0aec0', fontSize: 10, marginTop: 3, display: 'block' }}>
                                {[details.v1 && `v1: ${details.v1}`, details.v2 && `v2: ${details.v2}`, details.v3 && `v3: ${details.v3}`].filter(Boolean).join(' | ')}
                              </small>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })
                )}
                <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={() => handleAddEffect(fIdx)}><Plus size={14} /> Add Effect</button></div>
              </div>
            </div>
          )
        })
      )}
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={handleAddSet}><Plus size={15} /> Thêm Finish Skill</button></div>
    </div>
  )
}
