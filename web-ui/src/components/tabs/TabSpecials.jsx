import { AnimationLookup } from '../common/AnimationLookup'
import React, { useState } from 'react'
import { Disc, Sparkles, Layers, ShieldCheck, Film, Zap, Clock, Heart, Trash2, Plus, ChevronDown, ChevronRight, Music, AlertTriangle } from 'lucide-react'
import { DokkanDescriptionEditor } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'
import { newDraftId } from '../../draftIds'
import { BgmCardLookup } from '../common/BgmCardLookup'

export function TabSpecials({ specials = [], draft, onChange, meta, card, onPlayAnim }) {
  const currentSpecials = draft.card_specials || specials || []
  const [expandedSections, setExpandedSections] = useState({})
  const [proposals, setProposals] = useState({})
  const [compilingIdx, setCompilingIdx] = useState(null)
  const [errors, setErrors] = useState({})

  const toggleSection = (key) => {
    setExpandedSections((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const compileSpecial = async (idx) => {
    const cs = currentSpecials[idx]
    if (!cs) return
    const desc = cs.special_set?.description || ''
    setCompilingIdx(idx)
    setErrors((prev) => ({ ...prev, [idx]: '' }))
    try {
      const res = await api.compileSpecial(desc, cs.special_set_id)
      if (res.source === 'unsupported') throw new Error(res.warnings?.[0] || 'Không thể sinh efficacy cho mô tả này')
      setProposals((prev) => ({ ...prev, [idx]: { ...res, description: desc } }))
    } catch (err) {
      setErrors((prev) => ({ ...prev, [idx]: err.message }))
    } finally {
      setCompilingIdx(null)
    }
  }

  const applySpecialProposal = (idx, replace) => {
    const proposal = proposals[idx]
    if (!proposal || (!proposal.specials?.length && !Object.keys(proposal.special_set || {}).length)) return
    const cs = currentSpecials[idx]
    const baseSetId = Number(cs.special_set_id) || Number(cs.id) || 1
    const generated = proposal.specials.map((sp, sIdx) => ({
      ...sp,
      id: replace ? cs.specials?.[sIdx]?.id : undefined,
      _draftKey: `compiled-special-${Date.now()}-${sIdx}`,
      special_set_id: baseSetId
    }))
    const updated = currentSpecials.map((item, i) => {
      if (i === idx) {
        return {
          ...item,
          special_set: {
            ...(item.special_set || {}),
            ...(proposal.special_set || {})
          },
          specials: replace ? generated : [...(item.specials || []), ...generated]
        }
      }
      return item
    })
    onChange('card_specials', updated)
    if (replace) onChange('deleted_rows', [...(draft.deleted_rows || []),
      ...(cs.specials || []).slice(generated.length).filter(sp => sp.id).map(sp => ({ table: 'specials', id: sp.id }))])
    setProposals((prev) => {
      const copy = { ...prev }
      delete copy[idx]
      return copy
    })
  }

  const addSuperAttack = () => {
    if (!card?.id) return
    const id = newDraftId()
    onChange('card_specials', [...currentSpecials, {
      id, card_id: card.id, special_set_id: id, style: 'Normal',
      priority: Math.max(0, ...currentSpecials.map(cs => Number(cs.priority) || 0)) + 1,
      lv_start: Math.max(0, ...currentSpecials.map(cs => Number(cs.lv_start) || 0)),
      eball_num_start: 12, view_id: 0, special_asset_id: null,
      card_costume_condition_id: 0, detail_view_priority: Math.max(-10, ...currentSpecials.map(cs => Number(cs.detail_view_priority) || 0)) + 10,
      special_bonus_id1: 0, special_bonus_lv1: 0, bonus_view_id1: 0,
      special_bonus_id2: 0, special_bonus_lv2: 0, bonus_view_id2: 0, causality_conditions: '',
      special_set: { id, name: `Super Attack #${currentSpecials.length + 1}`, description: '',
        causality_description: '', aim_target: 0, increase_rate: 0, lv_bonus: 0 },
      specials: [], bonuses: []
    }])
  }

  const updateCardSpecial = (index, key, val) => {
    if (key === 'style') {
      toggleExtraOption(index, val === 'Extra', val)
      return
    }
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === index) {
        return { ...cs, [key]: val === '' ? null : (typeof val === 'number' ? val : val) }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const updateSpecialSet = (index, key, val) => {
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === index) {
        return {
          ...cs,
          special_set: {
            ...(cs.special_set || {}),
            [key]: val
          }
        }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const updateSpecialEffect = (csIdx, effIdx, key, val) => {
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === csIdx) {
        const effs = [...(cs.specials || [])]
        effs[effIdx] = { ...effs[effIdx], [key]: val }
        return { ...cs, specials: effs }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const addSpecialEffect = (csIdx) => {
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === csIdx) {
        const effs = [...(cs.specials || [])]
        const baseSetId = Number(cs.special_set_id) || Number(cs.id) || 1
        const newId = -Date.now()

        effs.push({
          id: newId,
          special_set_id: baseSetId,
          type: 'Special::NormalEfficacySpecial',
          efficacy_type: 3,
          target_type: 1,
          calc_option: 2,
          turn: 1,
          prob: 100,
          causality_conditions: '',
          eff_value1: 0,
          eff_value2: 0,
          eff_value3: 0
        })
        return { ...cs, specials: effs }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const deleteSpecialEffect = (csIdx, effIdx, effectId) => {
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === csIdx) {
        const effs = (cs.specials || []).filter((_, i) => i !== effIdx)
        return { ...cs, specials: effs }
      }
      return cs
    })
    onChange('card_specials', updated)

    if (effectId) {
      const deletedRows = [...(draft.deleted_rows || []), { table: 'specials', id: effectId }]
      onChange('deleted_rows', deletedRows)
    }
  }

  const createBonus = (csIdx, slot, animation = null) => {
    const temporaryIds = currentSpecials.flatMap(cs => (cs.bonuses || []).map(b => Math.abs(Number(b.id) || 0)))
    const id = -Math.max(Date.now(), ...temporaryIds.map(value => value + 1))
    onChange('card_specials', currentSpecials.map((cs, idx) => {
      if (idx !== csIdx) return cs
      const previous = (cs.bonuses || []).find(b => Number(b.id) === Number(cs[`special_bonus_id${slot}`]))
      const bonus = { ...(previous || {
        name: `Bonus Animation ${slot}`, description: '', efficacy_type: 1,
        target_type: 1, calc_option: 2, turn: 1, probability: 30,
        causality_conditions: '', eff_value1: 50, eff_value2: 0, eff_value3: 0
      }), id }
      const next = { ...cs, [`special_bonus_id${slot}`]: id }
      if (animation) {
        next[`bonus_view_id${slot}`] = Number(animation.id)
        bonus.name = animation.animation_name || animation.move_name || `Bonus Animation ${slot}`
        bonus.description = '30% chance; Greatly raises ATK for 1 turn'
      }
      const usedIds = [Number(next.special_bonus_id1), Number(next.special_bonus_id2)]
      next.bonuses = [...(cs.bonuses || []).filter(b => usedIds.includes(Number(b.id))), bonus]
      return next
    }))
  }

  const updateBonus = (csIdx, bonusId, key, val) => {
    const id = Number(bonusId)
    // One bonus ID represents one database row, even across several SA levels.
    const existing = currentSpecials.flatMap(cs => cs.bonuses || []).find(b => Number(b.id) === id)
    const record = { ...(existing || {
      id, name: 'Special Move Bonus', description: '', efficacy_type: 3,
      target_type: 1, calc_option: 0, turn: 1, probability: 100,
        causality_conditions: null, eff_value1: 0, eff_value2: 0, eff_value3: 0
    }), [key]: val }
    onChange('card_specials', currentSpecials.map((cs, idx) => {
      if (idx !== csIdx && Number(cs.special_bonus_id1) !== id && Number(cs.special_bonus_id2) !== id) return cs
      return { ...cs, bonuses: [...(cs.bonuses || []).filter(b => Number(b.id) !== id), record] }
    }))
  }

  const toggleExtraOption = (csIdx, enabled, requestedStyle) => {
    const baseAttacks = currentSpecials.filter((item, idx) => idx !== csIdx && item.style !== 'Extra' && !item.extra_special_option)
    const baseLevels = [...new Set(baseAttacks.map(item => Number(item.lv_start) || 0))].sort((a, b) => a - b)
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === csIdx) {
        if (!enabled) {
          if (cs.extra_special_option?.id > 0) {
            const deletedRows = [...(draft.deleted_rows || []), { table: 'extra_special_options', id: cs.extra_special_option.id }]
            onChange('deleted_rows', deletedRows)
          }
          return {
            ...cs,
            style: requestedStyle || cs._styleBeforeExtra || (cs.style === 'Extra' ? (Number(cs.eball_num_start) >= 18 ? 'Hyper' : 'Normal') : cs.style),
            priority: cs._priorityBeforeExtra ?? cs.priority,
            detail_view_priority: cs._detailPriorityBeforeExtra ?? cs.detail_view_priority,
            lv_start: cs._levelBeforeExtra ?? cs.lv_start,
            extra_special_option: null
          }
        }
        if (cs.extra_special_option) return { ...cs, style: 'Extra' }
        const currentLevel = Number(cs.lv_start) || 0
        const matchingLevel = baseLevels.includes(currentLevel)
          ? currentLevel
          : (baseLevels.filter(level => level <= currentLevel).at(-1) ?? baseLevels[0] ?? currentLevel)
        const otherPriorities = currentSpecials.filter((_, itemIdx) => itemIdx !== csIdx).map(item => Number(item.priority) || 0)
        const otherDetailPriorities = currentSpecials.filter((_, itemIdx) => itemIdx !== csIdx).map(item => Number(item.detail_view_priority) || 0)
        return {
          ...cs,
          _styleBeforeExtra: cs.style === 'Extra' ? undefined : cs.style,
          _priorityBeforeExtra: cs.priority,
          _detailPriorityBeforeExtra: cs.detail_view_priority,
          _levelBeforeExtra: cs.lv_start,
          style: 'Extra',
          priority: Math.max(20, ...otherPriorities.map(priority => priority + 20)),
          lv_start: matchingLevel,
          detail_view_priority: Math.max(20, ...otherDetailPriorities.map(priority => priority + 10)),
          extra_special_option: {
            id: newDraftId(),
            card_special_id: Number(cs.id) || 1,
            extra_special_type: 0,
            probability: 50,
            bgm_id: 0
          }
        }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const updateExtraOption = (csIdx, key, val) => {
    const updated = currentSpecials.map((cs, idx) => {
      if (idx === csIdx) {
        return {
          ...cs,
          extra_special_option: {
            ...(cs.extra_special_option || {}),
            [key]: val === '' ? null : Number(val)
          }
        }
      }
      return cs
    })
    onChange('card_specials', updated)
  }

  const deleteSuperAttack = (idx) => {
    const target = currentSpecials[idx]
    const deleted = [...(draft.deleted_rows || [])]
    for (const effect of target?.specials || []) if (effect?.id > 0) deleted.push({ table: 'specials', id: effect.id })
    if (target?.extra_special_option?.id > 0) deleted.push({ table: 'extra_special_options', id: target.extra_special_option.id })
    if (target?.id > 0) deleted.push({ table: 'card_specials', id: target.id })
    onChange('deleted_rows', deleted)
    onChange('card_specials', currentSpecials.filter((_, itemIdx) => itemIdx !== idx))
  }

  return (
    <div className="tab-pane specials-pane">
      <div className="section-bar space-between">
        <div className="bar-left">
          <Disc size={18} />
          <strong>Super Attack Repertory ({currentSpecials.length} attacks)</strong>
          <button type="button" className="btn secondary-btn" onClick={addSuperAttack}><Plus size={15} /> Thêm Super Attack</button>
        </div>
      </div>

      <div className="specials-list">
        {currentSpecials.map((cs, idx) => {
          const sSet = cs.special_set || {}
          const isUltra = Number(cs.eball_num_start) >= 18
          const baseLevels = [...new Set(currentSpecials.filter(item => item.style !== 'Extra' && !item.extra_special_option).map(item => Number(item.lv_start) || 0))].sort((a, b) => a - b)
          const mismatchedExLevel = (cs.style === 'Extra' || cs.extra_special_option) && baseLevels.length > 0 && !baseLevels.includes(Number(cs.lv_start) || 0)
          const matchingLevel = baseLevels.filter(level => level <= (Number(cs.lv_start) || 0)).at(-1) ?? baseLevels[0]
          const bonusesKey = `bonuses_${cs.id || idx}`
          const exKey = `ex_${cs.id || idx}`

          // Bonuses records
          const sb1Rec = (cs.bonuses || []).find((b) => Number(b.id) === Number(cs.special_bonus_id1)) || {
            id: cs.special_bonus_id1,
            name: 'Bonus Animation 1',
            description: '',
            efficacy_type: 3,
            target_type: 1,
            calc_option: 0,
            turn: 1,
            probability: 100,
            causality_conditions: '',
            eff_value1: 0,
            eff_value2: 0,
            eff_value3: 0
          }
          const sb2Rec = (cs.bonuses || []).find((b) => Number(b.id) === Number(cs.special_bonus_id2)) || {
            id: cs.special_bonus_id2,
            name: 'Bonus Animation 2',
            description: '',
            efficacy_type: 3,
            target_type: 1,
            calc_option: 0,
            turn: 1,
            probability: 100,
            causality_conditions: '',
            eff_value1: 0,
            eff_value2: 0,
            eff_value3: 0
          }

          return (
            <div key={cs.id || idx} className={`special-card edit-card ${isUltra ? 'ultra' : ''}`}>
              <div className="special-header">
                <div className="special-ki-badge">
                  <Zap size={14} />
                  <span>{isUltra ? 'ULTRA SUPER ATTACK' : 'SUPER ATTACK'} (Style: {cs.style || 'Normal'})</span>
                </div>
                <div className="special-tags">
                  <button type="button" className="btn-text-action" onClick={() => deleteSuperAttack(idx)}><Trash2 size={14} /> Xóa Super Attack</button>
                  <span className="id-tag">Card Special #{cs.id}</span>
                  <span className="id-tag">Special Set #{cs.special_set_id}</span>
                  {cs.view_id && (
                    <button
                      type="button"
                      className="btn-text-action"
                      onClick={onPlayAnim}
                      title="Xem hoạt ảnh"
                    >
                      <Film size={13} />
                      View #{cs.view_id}
                    </button>
                  )}
                </div>
              </div>

              {/* Special Set Name & Description */}
              <div className="form-field full-row">
                <label>Super Attack Name (name)</label>
                <input
                  type="text"
                  value={sSet.name || ''}
                  onChange={(e) => updateSpecialSet(idx, 'name', e.target.value)}
                  placeholder="Enter Super Attack name..."
                />
              </div>

              <DokkanDescriptionEditor
                label="Super Attack Description (Description In-Game)"
                fieldKey="description"
                skillName={sSet.name}
                skillType="SUPER ATTACK"
                value={sSet.description || ''}
                onChange={(val) => updateSpecialSet(idx, 'description', val)}
                placeholder="Enter Super Attack effect description..."
                defaultMode="split"
              />

              <div className="form-field full-row">
                <label>Condition Text (causality_description)</label>
                <textarea
                  rows={3}
                  value={sSet.causality_description || ''}
                  onChange={(e) => updateSpecialSet(idx, 'causality_description', e.target.value)}
                  placeholder="Condition shown in-game for this Super Attack..."
                />
                <span className="hint-text">Shown as the activation condition for this Super Attack; kept separate from its effect description.</span>
              </div>

              <div className="passive-compiler-actions">
                <button className="btn primary-btn" onClick={() => compileSpecial(idx)} disabled={compilingIdx === idx || !sSet.description?.trim()}>
                  <Sparkles size={15} /> {compilingIdx === idx ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
                </button>
                <span className="hint-text">Dùng hiệu ứng Super hiện tại làm mẫu và cập nhật thông số theo mô tả.</span>
              </div>

              {errors[idx] && <p className="passive-compiler-error">{errors[idx]}</p>}

              {proposals[idx] && (
                <div className="passive-compiler-preview">
                  <strong>{proposals[idx].specials.length} hiệu ứng đề xuất · {proposals[idx].source === 'database' ? 'khớp mô tả trong DB' : proposals[idx].source === 'database-template' ? 'mẫu gần trong DB' : 'nhận diện theo quy tắc'}</strong>
                  {proposals[idx].special_set && (
                    <p className="hint-text">Tự động cập nhật: increase_rate = {proposals[idx].special_set.increase_rate}%, lv_bonus = {proposals[idx].special_set.lv_bonus}</p>
                  )}
                  <div className="passive-compiler-preview-list">
                    {proposals[idx].specials.map((sp, spI) => (
                      <div key={spI}>
                        <span>#{spI + 1} · {meta?.efficacy_types?.[sp.efficacy_type] || `Efficacy ${sp.efficacy_type}`}</span>
                        <span>ATK: {sp.eff_value1}% · DEF: {sp.eff_value2}% · {sp.turn === 99 ? 'Vô hạn (Stack)' : `${sp.turn} turn`}</span>
                      </div>
                    ))}
                  </div>
                  <div className="passive-compiler-actions" style={{ marginTop: 10 }}>
                    <button className="btn primary-btn" onClick={() => applySpecialProposal(idx, true)}>
                      Áp dụng (Thay thế toàn bộ)
                    </button>
                    <button className="btn secondary-btn" onClick={() => applySpecialProposal(idx, false)}>
                      Áp dụng (Nối thêm)
                    </button>
                    <button className="btn ghost-btn" onClick={() => setProposals(prev => { const c = { ...prev }; delete c[idx]; return c })}>
                      Hủy
                    </button>
                  </div>
                </div>
              )}

              {/* General Special Configuration Grid */}
              <div className="fields-grid-3" style={{ marginTop: '12px' }}>
                <div className="form-field">
                  <label>Mức sát thương (mẫu trong database)</label>
                  <select value={(meta?.special_damage_profiles || []).find(profile => profile.increase_rate === sSet.increase_rate && profile.lv_bonus === sSet.lv_bonus)?.key || ''}
                    onChange={event => {
                      const profile = meta?.special_damage_profiles?.find(item => item.key === event.target.value)
                      if (profile) onChange('card_specials', currentSpecials.map((item, i) => i === idx ? { ...item,
                        special_set: { ...item.special_set, increase_rate: profile.increase_rate, lv_bonus: profile.lv_bonus } } : item))
                    }}>
                    <option value="">Tùy chỉnh / có điều chỉnh theo hiệu ứng</option>
                    {(meta?.special_damage_profiles || []).map(profile => <option key={profile.key} value={profile.key}>{profile.label} · {profile.increase_rate}% / +{profile.lv_bonus}</option>)}
                  </select>
                </div>
                <div className="form-field">
                  <label>Increase Rate (%)</label>
                  <input type="number" value={sSet.increase_rate ?? 0} onChange={event => updateSpecialSet(idx, 'increase_rate', Number(event.target.value))} />
                </div>
                <div className="form-field">
                  <label>Level Bonus (lv_bonus)</label>
                  <input type="number" value={sSet.lv_bonus ?? 0} onChange={event => updateSpecialSet(idx, 'lv_bonus', Number(event.target.value))} />
                </div>
                <p className="hint-text full-row">Increase Rate là giá trị gốc trong database, chưa phải tổng sát thương ở SA level tối đa. Bộ sinh đọc nhãn Supreme, Immense, Colossal… trong mô tả và điều chỉnh theo mẫu hiệu ứng; bạn vẫn có thể sửa số thủ công.</p>
                <div className="form-field">
                  <label>Required Ki Spheres (eball_num_start)</label>
                  <input
                    type="number"
                    value={cs.eball_num_start ?? 12}
                    onChange={(e) => updateCardSpecial(idx, 'eball_num_start', Number(e.target.value))}
                  />
                </div>

                <div className="form-field">
                  <label>Attack Style (style)</label>
                  <select
                    value={cs.style || 'Normal'}
                    onChange={(e) => updateCardSpecial(idx, 'style', e.target.value)}
                  >
                    <option value="Normal">Normal (Chiêu cơ bản)</option>
                    <option value="Hyper">Hyper (Ultra SA / Tuyệt kỹ)</option>
                    <option value="Extra">Extra (Chiêu phụ / kích hoạt)</option>
                  </select>
                </div>

                <div className="form-field">
                  <label>Execution Priority (priority)</label>
                  <input
                    type="number"
                    value={cs.priority ?? 0}
                    onChange={(e) => updateCardSpecial(idx, 'priority', Number(e.target.value))}
                  />
                </div>

                <div className="form-field">
                  <label>Mốc bộ chiêu (lv_start)</label>
                  <input
                    type="number"
                    value={cs.lv_start ?? 0}
                    onChange={(e) => updateCardSpecial(idx, 'lv_start', Number(e.target.value))}
                  />
                  <small className="hint-text">Đặt cùng mốc với SA/Ultra mà EX đi kèm (thường là 0). Mốc mở bonus được chỉnh riêng ở Min SA Level của bonus.</small>
                  {mismatchedExLevel && <div className="passive-compiler-error">
                    EX đang ở mốc {cs.lv_start}, còn SA/Ultra ở mốc {baseLevels.join(', ')}. Bộ chiêu có thể không được chọn cùng nhau.
                    <button type="button" className="btn secondary-btn" onClick={() => updateCardSpecial(idx, 'lv_start', matchingLevel)}>Đồng bộ với SA/Ultra: {matchingLevel}</button>
                  </div>}
                </div>

                <div className="form-field">
                  <label>Animation View ID (view_id)</label>
                  <input
                    type="number"
                    value={cs.view_id ?? ''}
                    onChange={(e) => updateCardSpecial(idx, 'view_id', e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="Animation View ID"
                  />
                  <AnimationLookup slot="super" onSelect={id => updateCardSpecial(idx, 'view_id', id)} />
                </div>

                <div className="form-field">
                  <label>Special Asset ID (special_asset_id)</label>
                  <input
                    type="number"
                    value={cs.special_asset_id ?? ''}
                    onChange={(e) => updateCardSpecial(idx, 'special_asset_id', e.target.value === '' ? null : Number(e.target.value))}
                    placeholder="Special Asset ID"
                  />
                </div>
              </div>

              {/* Super Attack Activation Causality */}
              <div style={{ marginTop: '12px' }}>
                <CausalityExpressionEditor
                  label="Super Attack Trigger Causality (causality_conditions)"
                  value={cs.causality_conditions}
                  onChange={(val) => updateCardSpecial(idx, 'causality_conditions', val)}
                  meta={meta}
                />
              </div>

              {/* Special Move Effects List */}
              <div className="effects-section" style={{ marginTop: '16px' }}>
                <div className="section-bar space-between">
                  <div className="bar-left">
                    <Sparkles size={16} />
                    <strong>Gameplay Effects & Stat Multipliers (specials table)</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-secondary btn-sm"
                    onClick={() => addSpecialEffect(idx)}
                  >
                    <Plus size={14} /> Add Effect Line
                  </button>
                </div>

                <div className="effects-list">
                  {(cs.specials || []).map((se, seIdx) => {
                    const effType = Number(se.efficacy_type) || 0
                    const details = meta?.efficacy_details?.[effType] || {}
                    const v1Label = details.v1 ? `Value 1 (${details.v1})` : 'Eff Value 1'
                    const v2Label = details.v2 ? `Value 2 (${details.v2})` : 'Eff Value 2'
                    const v3Label = details.v3 ? `Value 3 (${details.v3})` : 'Eff Value 3'

                    return (
                      <div key={se.id || seIdx} className="effect-card edit-card" style={{ marginBottom: '12px' }}>
                        <div className="effect-card-header space-between">
                          <span className="effect-tag">Effect Line #{se.id || seIdx + 1}</span>
                          <button
                            type="button"
                            className="btn-icon-danger"
                            onClick={() => deleteSpecialEffect(idx, seIdx, se.id)}
                            title="Xóa hiệu ứng này"
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>

                        <div className="fields-grid-3">
                          <div className="form-field">
                            <label>Efficacy Type</label>
                            <select
                              value={se.efficacy_type ?? 3}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'efficacy_type', Number(e.target.value))}
                            >
                              {meta?.efficacy_types && Object.entries(meta.efficacy_types).map(([id, name]) => (
                                <option key={id} value={id}>[{id}] {name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-field">
                            <label>Target Type</label>
                            <select
                              value={se.target_type ?? 1}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'target_type', Number(e.target.value))}
                            >
                              {meta?.target_types && Object.entries(meta.target_types).map(([id, name]) => (
                                <option key={id} value={id}>[{id}] {name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-field">
                            <label>Calculation Option</label>
                            <select
                              value={se.calc_option ?? 2}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'calc_option', Number(e.target.value))}
                            >
                              {meta?.calc_options && Object.entries(meta.calc_options).map(([id, name]) => (
                                <option key={id} value={id}>[{id}] {name}</option>
                              ))}
                            </select>
                          </div>

                          <div className="form-field">
                            <label>Turn Duration (turn)</label>
                            <input
                              type="number"
                              value={se.turn ?? 1}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'turn', Number(e.target.value))}
                            />
                          </div>

                          <div className="form-field">
                            <label>Trigger Probability (%)</label>
                            <input
                              type="number"
                              value={se.prob ?? 100}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'prob', Number(e.target.value))}
                            />
                          </div>
                        </div>

                        {/* Rich Efficacy Hint */}
                        <EfficacyHintCard effType={se.efficacy_type} meta={meta} />

                        {/* Values Grid */}
                        <div className="fields-grid-3" style={{ marginTop: '8px' }}>
                          <div className="form-field">
                            <label>{v1Label}</label>
                            <input
                              type="number"
                              value={se.eff_value1 ?? 0}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'eff_value1', Number(e.target.value))}
                            />
                          </div>
                          <div className="form-field">
                            <label>{v2Label}</label>
                            <input
                              type="number"
                              value={se.eff_value2 ?? 0}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'eff_value2', Number(e.target.value))}
                            />
                          </div>
                          <div className="form-field">
                            <label>{v3Label}</label>
                            <input
                              type="number"
                              value={se.eff_value3 ?? 0}
                              onChange={(e) => updateSpecialEffect(idx, seIdx, 'eff_value3', Number(e.target.value))}
                            />
                          </div>
                        </div>

                        {/* Causality Conditions for this effect */}
                        <div style={{ marginTop: '8px' }}>
                          <CausalityExpressionEditor
                            label="Effect Trigger Conditions (causality_conditions)"
                            value={se.causality_conditions}
                            onChange={(val) => updateSpecialEffect(idx, seIdx, 'causality_conditions', val)}
                            meta={meta}
                          />
                        </div>
                      </div>
                    )
                  })}
                  <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={() => addSpecialEffect(idx)}><Plus size={14} /> Add Effect Line</button></div>
                </div>
              </div>

              {/* Animation Bonuses Section */}
              <div className="accordion-card" style={{ marginTop: '14px' }}>
                <button
                  type="button"
                  className="accordion-toggle"
                  onClick={() => toggleSection(bonusesKey)}
                >
                  <div className="toggle-left">
                    {expandedSections[bonusesKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <strong>🎁 Special Move Animation Bonuses (Bonus 1 & 2)</strong>
                  </div>
                  <span className="toggle-badge">
                    {cs.special_bonus_id1 || cs.special_bonus_id2 ? 'Active' : 'Empty'}
                  </span>
                </button>

                {expandedSections[bonusesKey] && (
                  <div className="accordion-content" style={{ padding: '12px' }}>
                    <div className="fields-grid-2">
                      {/* Bonus 1 */}
                      <div className="bonus-box">
                        <h4 className="bonus-box-title">🎬 Bonus Animation 1</h4>
                        <div className="fields-grid-3">
                          <div className="form-field">
                            <label>Bonus 1 ID</label>
                            <input
                              type="number"
                              value={Number(cs.special_bonus_id1) < 0 ? '' : cs.special_bonus_id1 ?? 0}
                              readOnly={Number(cs.special_bonus_id1) < 0}
                              placeholder="Tự cấp ID khi sinh SQL"
                              onChange={(e) => updateCardSpecial(idx, 'special_bonus_id1', Number(e.target.value))}
                            />
                            <button type="button" className="btn secondary-btn" onClick={() => createBonus(idx, 1)}>
                              <Plus size={14} /> {cs.special_bonus_id1 ? 'Tạo bản sao với ID mới' : 'Tạo bonus mới'}
                            </button>
                            {Number(cs.special_bonus_id1) < 0 && <small className="hint-text">Bonus riêng. SQL live tự cấp ID mới và gán vào Bonus 1 của chiêu này.</small>}
                          </div>
                          <div className="form-field">
                            <label>Min SA Level</label>
                            <input
                              type="number"
                              value={cs.special_bonus_lv1 ?? 0}
                              onChange={(e) => updateCardSpecial(idx, 'special_bonus_lv1', Number(e.target.value))}
                            />
                          </div>
                          <div className="form-field">
                            <label>Animation View ID</label>
                            <input
                              type="number"
                              value={cs.bonus_view_id1 ?? 0}
                              onChange={(e) => updateCardSpecial(idx, 'bonus_view_id1', Number(e.target.value))}
                            />
                            <AnimationLookup slot="super" onSelect={(id, animation) => createBonus(idx, 1, { ...animation, id })} />
                          </div>
                        </div>

                        {Boolean(Number(cs.special_bonus_id1)) && (
                          <div style={{ marginTop: '10px' }}>
                            <div className="form-field">
                              <label>Bonus 1 Name</label>
                              <input
                                type="text"
                                value={sb1Rec.name || ''}
                                onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'name', e.target.value)}
                              />
                            </div>
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 1 Description</label>
                              <input
                                type="text"
                                value={sb1Rec.description || ''}
                                onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'description', e.target.value)}
                              />
                            </div>
                            <div className="fields-grid-3" style={{ marginTop: '6px' }}>
                              <div className="form-field">
                                <label>Efficacy Type</label>
                                <select
                                  value={sb1Rec.efficacy_type ?? 3}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'efficacy_type', Number(e.target.value))}
                                >
                                  {meta?.efficacy_types && Object.entries(meta.efficacy_types).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Target Type</label>
                                <select
                                  value={sb1Rec.target_type ?? 1}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'target_type', Number(e.target.value))}
                                >
                                  {meta?.target_types && Object.entries(meta.target_types).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Calculation Option</label>
                                <select
                                  value={sb1Rec.calc_option ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'calc_option', Number(e.target.value))}
                                >
                                  {meta?.calc_options && Object.entries(meta.calc_options).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <EfficacyHintCard effType={sb1Rec.efficacy_type} meta={meta} />
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 1 Turn (số lượt tác dụng)</label>
                              <input type="number" value={sb1Rec.turn ?? 1}
                                onChange={e => updateBonus(idx, cs.special_bonus_id1, 'turn', Number(e.target.value))} />
                              <small className="hint-text">Thời gian của hiệu ứng bonus; cách dùng giá trị turn phụ thuộc Efficacy Type.</small>
                            </div>
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 1 Probability (%)</label>
                              <input type="number" min="0" max="100" value={sb1Rec.probability ?? 100}
                                onChange={e => updateBonus(idx, cs.special_bonus_id1, 'probability', Math.max(0, Math.min(100, Number(e.target.value))))} />
                              <small className="hint-text">Xác suất của hiệu ứng bonus trong special_bonuses. Cách dùng phụ thuộc Efficacy Type; giá trị 0 có thể là dữ liệu hợp lệ. Animation View ID chọn hoạt ảnh khi bonus được kích hoạt.</small>
                            </div>
                            <div className="fields-grid-3" style={{ marginTop: '6px' }}>
                              <div className="form-field">
                                <label>Value 1</label>
                                <input
                                  type="number"
                                  value={sb1Rec.eff_value1 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'eff_value1', Number(e.target.value))}
                                />
                              </div>
                              <div className="form-field">
                                <label>Value 2</label>
                                <input
                                  type="number"
                                  value={sb1Rec.eff_value2 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'eff_value2', Number(e.target.value))}
                                />
                              </div>
                              <div className="form-field">
                                <label>Value 3</label>
                                <input
                                  type="number"
                                  value={sb1Rec.eff_value3 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id1, 'eff_value3', Number(e.target.value))}
                                />
                              </div>
                            </div>
                            <div style={{ marginTop: '8px' }}>
                              <CausalityExpressionEditor
                                label="Bonus 1 Causality Conditions"
                                value={sb1Rec.causality_conditions}
                                onChange={(val) => updateBonus(idx, cs.special_bonus_id1, 'causality_conditions', val)}
                                meta={meta}
                              />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Bonus 2 */}
                      <div className="bonus-box">
                        <h4 className="bonus-box-title">🎬 Bonus Animation 2</h4>
                        <div className="fields-grid-3">
                          <div className="form-field">
                            <label>Bonus 2 ID</label>
                            <input
                              type="number"
                              value={Number(cs.special_bonus_id2) < 0 ? '' : cs.special_bonus_id2 ?? 0}
                              readOnly={Number(cs.special_bonus_id2) < 0}
                              placeholder="Tự cấp ID khi sinh SQL"
                              onChange={(e) => updateCardSpecial(idx, 'special_bonus_id2', Number(e.target.value))}
                            />
                            <button type="button" className="btn secondary-btn" onClick={() => createBonus(idx, 2)}>
                              <Plus size={14} /> {cs.special_bonus_id2 ? 'Tạo bản sao với ID mới' : 'Tạo bonus mới'}
                            </button>
                            {Number(cs.special_bonus_id2) < 0 && <small className="hint-text">Bonus riêng. SQL live tự cấp ID mới và gán vào Bonus 2 của chiêu này.</small>}
                          </div>
                          <div className="form-field">
                            <label>Min SA Level</label>
                            <input
                              type="number"
                              value={cs.special_bonus_lv2 ?? 0}
                              onChange={(e) => updateCardSpecial(idx, 'special_bonus_lv2', Number(e.target.value))}
                            />
                          </div>
                          <div className="form-field">
                            <label>Animation View ID</label>
                            <input
                              type="number"
                              value={cs.bonus_view_id2 ?? 0}
                              onChange={(e) => updateCardSpecial(idx, 'bonus_view_id2', Number(e.target.value))}
                            />
                            <AnimationLookup slot="super" onSelect={(id, animation) => createBonus(idx, 2, { ...animation, id })} />
                          </div>
                        </div>

                        {Boolean(Number(cs.special_bonus_id2)) && (
                          <div style={{ marginTop: '10px' }}>
                            <div className="form-field">
                              <label>Bonus 2 Name</label>
                              <input
                                type="text"
                                value={sb2Rec.name || ''}
                                onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'name', e.target.value)}
                              />
                            </div>
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 2 Description</label>
                              <input
                                type="text"
                                value={sb2Rec.description || ''}
                                onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'description', e.target.value)}
                              />
                            </div>
                            <div className="fields-grid-3" style={{ marginTop: '6px' }}>
                              <div className="form-field">
                                <label>Efficacy Type</label>
                                <select
                                  value={sb2Rec.efficacy_type ?? 3}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'efficacy_type', Number(e.target.value))}
                                >
                                  {meta?.efficacy_types && Object.entries(meta.efficacy_types).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Target Type</label>
                                <select
                                  value={sb2Rec.target_type ?? 1}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'target_type', Number(e.target.value))}
                                >
                                  {meta?.target_types && Object.entries(meta.target_types).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                              <div className="form-field">
                                <label>Calculation Option</label>
                                <select
                                  value={sb2Rec.calc_option ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'calc_option', Number(e.target.value))}
                                >
                                  {meta?.calc_options && Object.entries(meta.calc_options).map(([id, name]) => (
                                    <option key={id} value={id}>[{id}] {name}</option>
                                  ))}
                                </select>
                              </div>
                            </div>
                            <EfficacyHintCard effType={sb2Rec.efficacy_type} meta={meta} />
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 2 Turn (số lượt tác dụng)</label>
                              <input type="number" value={sb2Rec.turn ?? 1}
                                onChange={e => updateBonus(idx, cs.special_bonus_id2, 'turn', Number(e.target.value))} />
                              <small className="hint-text">Thời gian của hiệu ứng bonus; cách dùng giá trị turn phụ thuộc Efficacy Type.</small>
                            </div>
                            <div className="form-field" style={{ marginTop: '6px' }}>
                              <label>Bonus 2 Probability (%)</label>
                              <input type="number" min="0" max="100" value={sb2Rec.probability ?? 100}
                                onChange={e => updateBonus(idx, cs.special_bonus_id2, 'probability', Math.max(0, Math.min(100, Number(e.target.value))))} />
                              <small className="hint-text">Xác suất của hiệu ứng bonus trong special_bonuses. Cách dùng phụ thuộc Efficacy Type; giá trị 0 có thể là dữ liệu hợp lệ. Animation View ID chọn hoạt ảnh khi bonus được kích hoạt.</small>
                            </div>
                            <div className="fields-grid-3" style={{ marginTop: '6px' }}>
                              <div className="form-field">
                                <label>Value 1</label>
                                <input
                                  type="number"
                                  value={sb2Rec.eff_value1 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'eff_value1', Number(e.target.value))}
                                />
                              </div>
                              <div className="form-field">
                                <label>Value 2</label>
                                <input
                                  type="number"
                                  value={sb2Rec.eff_value2 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'eff_value2', Number(e.target.value))}
                                />
                              </div>
                              <div className="form-field">
                                <label>Value 3</label>
                                <input
                                  type="number"
                                  value={sb2Rec.eff_value3 ?? 0}
                                  onChange={(e) => updateBonus(idx, cs.special_bonus_id2, 'eff_value3', Number(e.target.value))}
                                />
                              </div>
                            </div>
                            <div style={{ marginTop: '8px' }}>
                              <CausalityExpressionEditor
                                label="Bonus 2 Causality Conditions"
                                value={sb2Rec.causality_conditions}
                                onChange={(val) => updateBonus(idx, cs.special_bonus_id2, 'causality_conditions', val)}
                                meta={meta}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Extra Special Options Section */}
              <div className="accordion-card" style={{ marginTop: '10px' }}>
                <button
                  type="button"
                  className="accordion-toggle"
                  onClick={() => toggleSection(exKey)}
                >
                  <div className="toggle-left">
                    {expandedSections[exKey] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <strong>💥 EX Super Attack (Extra Special Option)</strong>
                  </div>
                  <span className="toggle-badge">
                    {cs.extra_special_option ? 'Enabled' : 'Disabled'}
                  </span>
                </button>

                {expandedSections[exKey] && (
                  <div className="accordion-content" style={{ padding: '12px' }}>
                    <div style={{ marginBottom: '10px' }}>
                      <label style={{ display: 'inline-flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                        <input
                          type="checkbox"
                          checked={Boolean(cs.extra_special_option)}
                          onChange={(e) => toggleExtraOption(idx, e.target.checked)}
                        />
                        <span style={{ fontWeight: 600 }}>Enable EX Super Attack for this move</span>
                      </label>
                    </div>

                    {cs.extra_special_option && <div className="hint-text ex-special-help">
                      <strong>EX Special Type chọn điều kiện để xét kích hoạt EX SA:</strong>
                      <ul>
                        <li><b>0:</b> Đòn đánh đầu tiên trong lượt là Super Attack và đạt ngưỡng Ki yêu cầu (Ki Start của dòng chiêu).</li>
                        <li><b>1:</b> Super Attack được tung từ một đòn đánh thêm (additional attack).</li>
                        <li><b>2:</b> Đòn đánh đầu tiên trong lượt là Super Attack gây chí mạng.</li>
                      </ul>
                      <p>Trigger Probability là xác suất chuyển thành EX SA khi thỏa điều kiện trên. Ví dụ 50 là 50%. EX dùng dòng chiêu có Style = Extra; bật tùy chọn này chưa tự tạo đầy đủ chiêu EX, hoạt ảnh hay điều kiện của nó.</p>
                      {cs.special_set?.causality_description && <p>Mô tả điều kiện của chiêu: {cs.special_set.causality_description}</p>}
                    </div>}

                    {cs.extra_special_option && (
                      <div className="fields-grid-3">
                        <div className="form-field">
                          <label>EX Option ID</label>
                          <input
                            type="text"
                            readOnly
                            value={cs.extra_special_option.id < 0 ? 'Tự cấp ID mới trong SQL live' : cs.extra_special_option.id ?? ''}
                          />
                        </div>
                        <div className="form-field">
                          <label>EX Special Type</label>
                          <select
                            value={cs.extra_special_option.extra_special_type ?? 0}
                            onChange={(e) => updateExtraOption(idx, 'extra_special_type', e.target.value)}
                          >
                            <option value="0">0 - SA đầu lượt đạt ngưỡng Ki</option>
                            <option value="1">1 - SA từ đòn đánh thêm</option>
                            <option value="2">2 - SA đầu lượt chí mạng</option>
                          </select>
                        </div>
                        <div className="form-field">
                          <label>Trigger Probability (%)</label>
                          <input
                            type="number"
                            value={cs.extra_special_option.probability ?? 50}
                            onChange={(e) => updateExtraOption(idx, 'probability', e.target.value)}
                          />
                        </div>
                        <div className="form-field">
                          <label>BGM Track ID (bgm_id)</label>
                          <input
                            type="number"
                            value={cs.extra_special_option.bgm_id ?? 0}
                            onChange={(e) => updateExtraOption(idx, 'bgm_id', e.target.value)}
                          />
                          <BgmCardLookup onSelect={id => updateExtraOption(idx, 'bgm_id', id)} />
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          )
        })}
      </div>
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={addSuperAttack}><Plus size={15} /> Thêm Super Attack</button></div>
    </div>
  )
}
