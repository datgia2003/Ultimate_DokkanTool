import { AnimationLookup } from '../common/AnimationLookup'
import React, { useEffect, useState } from 'react'
import { Zap, Sparkles, Plus, Trash2, AlertTriangle, Copy } from 'lucide-react'
import { DokkanDescriptionEditor, DokkanDescriptionPreview } from '../common/DokkanDescriptionEditor'
import { CausalityExpressionEditor } from '../common/CausalityExpressionEditor'
import { EfficacyHintCard } from '../common/EfficacyHintCard'
import { api } from '../../api'
import { copyEfficacyFields, PassiveEfficacyClonePicker } from './PassiveEfficacyClonePicker'
import { makeBattleParamDraft, updateBattleParamDrafts } from './battleParamDrafts'

const EXPECTED_COMPILER_VERSION = '2026-09-24.2'
const TRANSFORM_EFFICACY_TYPES = new Set([79, 103, 131])

export const isTransformEfficacy = (skill) => TRANSFORM_EFFICACY_TYPES.has(Number(skill?.efficacy_type))

export function mergePreservedTransformSkills(originalSkills, generatedSkills) {
  const ordinary = generatedSkills.filter((skill) => !isTransformEfficacy(skill))
  const merged = []
  let next = 0
  for (const skill of originalSkills) {
    if (isTransformEfficacy(skill)) merged.push({ ...skill })
    else if (next < ordinary.length) merged.push(ordinary[next++])
  }
  return [...merged, ...ordinary.slice(next)]
}

const STANDARD_FIELDS = [
  ['exec_timing_type', 'Execution timing'], ['exec_game_type', 'Game type'],
  ['target_type', 'Target'], ['sub_target_type_set_id', 'Sub-target set ID'],
  ['calc_option', 'Calculation'], ['turn', 'Turn / duration'],
  ['is_once', 'Once only'], ['probability', 'Probability %'],
  ['passive_skill_effect_id', 'Animation effect ID']
]

export function descriptionLines(text) {
  const lines = []
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (/^[-–—•*]/.test(line) || !lines.length) lines.push(line)
    else lines[lines.length - 1] += ` ${line}`
  }
  return lines
}

// A DB row has no persisted description index. Suggest a match, but keep it
// visibly provisional and let the editor pick the correct line.
export function suggestedLineIndex(skill, lines, position, total) {
  const type = Number(skill.efficacy_type)
  const cues = {
    1: ['atk'], 2: ['def'], 3: ['atk', 'def'], 5: ['ki'], 13: ['damage reduction', 'reduces damage'],
    76: ['effective'], 77: ['guard'], 78: ['guard'], 81: ['additional attack'], 98: ['atk', 'def'],
    119: ['nullif', 'nulifi'], 120: ['counter']
  }[type] || []
  if (!cues.length) return null
  const numeric = [skill.eff_value1, skill.eff_value2, skill.eff_value3]
    .map(Number).filter(n => n > 0 && n < 10000)
  const candidates = lines.map((line, index) => {
    if (line.startsWith('*')) return { index, score: -1 }
    const lower = line.toLowerCase()
    let score = cues.reduce((sum, cue) => sum + (lower.includes(cue) ? 4 : 0), 0)
    if (numeric.some(n => new RegExp(`(^|\\D)${n}(\\D|$)`).test(line))) score += 3
    score -= Math.abs(index / Math.max(lines.length, 1) - position / Math.max(total, 1))
    return { index, score }
  }).sort((a, b) => b.score - a.score)
  return candidates[0]?.score >= 3 ? candidates[0].index : null
}

function conditionForLine(lines, index) {
  if (index == null) return ''
  for (let i = index - 1; i >= 0; i--) {
    if (lines[i].startsWith('*')) return lines[i].replace(/\*/g, '').trim()
  }
  return ''
}

export function TabPassive({ passive, transformationDescriptions = [], draft, onChange, meta, metaError, onReloadMeta, matches = {}, language = 'vi', onAllocateBattleParam }) {
  const [proposal, setProposal] = useState(null)
  const [compiling, setCompiling] = useState(false)
  const [error, setError] = useState('')
  const [keepTransformEffects, setKeepTransformEffects] = useState(true)
  const [cloneTargetIndex, setCloneTargetIndex] = useState(null)
  const currentSet = draft.passive_set !== undefined ? draft.passive_set : passive?.set
  const currentSkills = draft.passive_skills || passive?.skills || []
  const originalSkills = passive?.skills || []
  const originalTransformSkills = originalSkills.filter(isTransformEfficacy)
  const description = currentSet?.itemized_description || currentSet?.description || ''
  const descLines = descriptionLines(description)
  useEffect(() => setKeepTransformEffects(true), [currentSet?.id])
  const sourceIndex = (sk, index, total) => {
    const explicit = sk._sourceLineIndex ?? sk.manual_desc_idx
    if (explicit === -1) return null
    if (explicit != null && descLines[Number(explicit)] && !descLines[Number(explicit)].startsWith('*')) return Number(explicit)
    const fromCompiler = sk.id ? matches[sk.id]?.index : null
    return fromCompiler != null && descLines[fromCompiler] && !descLines[fromCompiler].startsWith('*')
      ? fromCompiler : suggestedLineIndex(sk, descLines, index, total)
  }

  if (!currentSet) return (
    <div className="tab-pane empty-tab">
      <Zap size={36} />
      <h3>No Passive Skill Set found for this character</h3>
      <p>Check the <code>passive_skill_set_id</code> field in card profile.</p>
    </div>
  )

  const updateSet = (key, value) => onChange('passive_set', { ...currentSet, [key]: value })
  const updateSkill = (index, key, value) => {
    const oldSkill = currentSkills[index]
    let update = { [key]: value }
    let addParams = []
    let removeKey = ''
    if (key === 'efficacy_type' && Number(value) === 103 && Number(oldSkill?.efficacy_type) !== 103) {
      const draftKey = `passive-transform-${currentSet?.id || 0}-${oldSkill?._draftKey || oldSkill?.id || index}-${Date.now()}`
      const paramNo = onAllocateBattleParam?.()
      if (paramNo) {
        update = { ...update, eff_value3: paramNo, _battle_param_draft_key: draftKey }
        addParams = [makeBattleParamDraft(paramNo, draftKey)]
      }
    } else if (key === 'efficacy_type' && Number(value) !== 103 && Number(oldSkill?.efficacy_type) === 103 && oldSkill?._battle_param_draft_key) {
      removeKey = oldSkill._battle_param_draft_key
      update = { ...update, eff_value3: null, _battle_param_draft_key: undefined }
    }
    onChange('passive_skills', currentSkills.map((sk, idx) => idx === index ? { ...sk, ...update } : sk))
    if (addParams.length || removeKey) onChange('battle_params_draft', updateBattleParamDrafts(draft.battle_params_draft, addParams, removeKey))
  }

  const compile = async () => {
    setCompiling(true)
    setError('')
    setProposal(null)
    try {
      const result = await api.compilePassive(description, currentSet.id)
      setProposal({ ...result, description })
    } catch (err) {
      setError(err.message)
    } finally {
      setCompiling(false)
    }
  }

  const applyProposal = (replace) => {
    if (!proposal?.skills?.length || proposal.description !== description ||
        proposal.compiler_version !== EXPECTED_COMPILER_VERSION) return
    const newBattleParamDrafts = []
    const generated = proposal.skills.map((sk, index) => {
      const draftKey = `compiled-${Date.now()}-${index}`
      const next = {
        ...sk, _draftKey: draftKey,
        name: currentSet.name || 'Passive Skill', exec_game_type: sk.exec_game_type ?? 0,
        sub_target_type_set_id: sk.sub_target_type_set_id ?? 0,
        efficacy_values: sk.efficacy_values ?? '{}'
      }
      if (Number(sk.efficacy_type) === 103 && onAllocateBattleParam) {
        const battleDraftKey = `passive-transform-${draftKey}`
        const paramNo = onAllocateBattleParam()
        next.eff_value3 = paramNo
        next._battle_param_draft_key = battleDraftKey
        newBattleParamDrafts.push(makeBattleParamDraft(paramNo, battleDraftKey))
      }
      return next
    })
    const preserve = keepTransformEffects && originalTransformSkills.length > 0
    const applied = replace && preserve
      ? mergePreservedTransformSkills(originalSkills, generated)
      : generated
    onChange('passive_set', currentSet)
    onChange('passive_skills', replace ? applied : [...currentSkills, ...generated])
    if (newBattleParamDrafts.length) onChange('battle_params_draft', updateBattleParamDrafts(draft.battle_params_draft, newBattleParamDrafts))
    onChange('passive_replace_existing', replace)
    if (replace) {
      onChange('passive_keep_transform_effects', preserve)
    }
    setProposal(null)
  }

  const addBlank = () => {
    onChange('passive_set', currentSet)
    const newIndex = currentSkills.length
    onChange('passive_skills', [...currentSkills, {
      _draftKey: `manual-${Date.now()}`, name: currentSet.name || 'Passive Skill',
      exec_timing_type: 1, exec_game_type: 0, target_type: 1, efficacy_type: 1,
      sub_target_type_set_id: 0, calc_option: 0, turn: 1, is_once: 0,
      probability: 100, causality_conditions: '', eff_value1: null,
      eff_value2: null, eff_value3: null, efficacy_values: ''
    }])
    setCloneTargetIndex(newIndex)
  }

  const applyClonedEfficacies = (sources) => {
    const targetIndex = Number(cloneTargetIndex)
    const target = currentSkills[targetIndex]
    if (!target || !sources.length) return
    const copied = sources.map((source, index) => copyEfficacyFields(
      source, index === 0 ? target : {
        _draftKey: `cloned-${Date.now()}-${index}`, name: currentSet.name || 'Passive Skill',
        _sourceLineIndex: -1
      }, index === 0 ? target._draftKey : `cloned-${Date.now()}-${index}`
    ))
    const updated = [...currentSkills]
    updated.splice(targetIndex, 1, ...copied)
    onChange('passive_skills', updated)
    setCloneTargetIndex(null)
  }

  const removeSkill = (index) => {
    const target = currentSkills[index]
    onChange('passive_skills', currentSkills.filter((_, idx) => idx !== index))
    if (cloneTargetIndex === index) setCloneTargetIndex(null)
    else if (cloneTargetIndex > index) setCloneTargetIndex(cloneTargetIndex - 1)
    if (target?.id) {
      const deletedRows = draft.deleted_rows || []
      // A skill row may be shared by another set; removing it here only unlinks
      // this set's relation. The unreferenced row can be cleaned separately.
      const additions = target.relation_id
        ? [{ table: 'passive_skill_set_relations', id: target.relation_id }]
        : []
      onChange('deleted_rows', [...deletedRows, ...additions])
    }
  }

  const deletePassiveSet = () => {
    const deleted = [...(draft.deleted_rows || [])]
    if (currentSet?.id > 0) deleted.push({ table: 'passive_skill_sets', id: currentSet.id })
    for (const skill of currentSkills) if (skill?.relation_id > 0) deleted.push({ table: 'passive_skill_set_relations', id: skill.relation_id })
    const descriptions = draft.transformation_descriptions !== undefined ? draft.transformation_descriptions : transformationDescriptions
    const removedDescriptions = descriptions.filter(item => item.skill_type === 'PassiveSkill' && currentSkills.some(skill => Number(skill.id) === Number(item.skill_id)))
    for (const item of removedDescriptions) if (item.id > 0) deleted.push({ table: 'transformation_descriptions', id: item.id })
    onChange('deleted_rows', deleted)
    if (removedDescriptions.length) onChange('transformation_descriptions', descriptions.filter(item => !removedDescriptions.includes(item)))
    onChange('passive_skill_set_id', 0)
    onChange('passive_set', null)
    onChange('passive_skills', [])
  }

  const selectField = (idx, sk, field, map) => {
    const value = sk[field]
    const key = value == null ? '' : String(value)
    const hasCurrentOption = key === '' || Object.prototype.hasOwnProperty.call(map || {}, key)
    return (
      <select value={key} onChange={(e) => updateSkill(idx, field, e.target.value === '' ? null : Number(e.target.value))}>
        <option value="">-- None --</option>
        {!hasCurrentOption && <option value={key}>{key} - Chưa có tên trong metadata</option>}
        {map && Object.entries(map).map(([val, label]) => (
          <option key={val} value={val}>{label}</option>
        ))}
      </select>
    )
  }

  return (
    <div className="tab-pane passive-pane">
      <div className="skill-hero-card editable">
        <div className="hero-top" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div className="hero-badge">PASSIVE SKILL SET #{currentSet.id}</div>
          <button type="button" className="btn ghost-btn" onClick={deletePassiveSet}><Trash2 size={14} /> Xóa Passive Skill</button>
        </div>
        <div className="form-field full-row">
          <label>Passive Skill Name</label>
          <input type="text" className="hero-input" value={currentSet.name || ''}
            onChange={(e) => updateSet('name', e.target.value)} placeholder="Tên nội tại..." />
        </div>
        <DokkanDescriptionEditor label="Passive Skill Description" fieldKey="itemized_description"
          skillName={currentSet.name} skillType="PASSIVE SKILL" value={description}
          onChange={(value) => onChange('passive_set', {
            ...currentSet, itemized_description: value, description: value
          })}
          placeholder="Enter itemized passive skill description with {passiveImg:up_g}..."
          defaultMode="split" />
        <div className="passive-compiler-actions">
          <button className="btn primary-btn" onClick={compile} disabled={compiling || !description.trim()}>
            <Sparkles size={15} /> {compiling ? 'Đang phân tích...' : 'Sinh efficacy từ mô tả'}
          </button>
          <span className="hint-text">Sinh bản nháp trước; chưa ghi vào DB cho đến khi bấm Save.</span>
        </div>
        {error && <p className="passive-compiler-error">{error}</p>}
        {proposal && <div className="passive-compiler-preview">
          <strong>{proposal.skills.length} dòng đề xuất · {proposal.source === 'database' ? 'khớp mô tả trong DB' : proposal.source === 'database-template' ? 'mẫu cùng cấu trúc trong DB — cần sửa số' : 'nhận diện theo quy tắc'}</strong>
          <p className="hint-text">Compiler API: {proposal.compiler_version || 'phiên bản cũ — đóng API Python cũ rồi mở lại run_react_tool.bat'}</p>
          {proposal.compiler_version !== EXPECTED_COMPILER_VERSION &&
            <p className="passive-compiler-error">API đang chạy compiler cũ. Đóng cửa sổ Dokkan React API cũ rồi mở lại tool trước khi áp dụng bản nháp.</p>}
          {proposal.description !== description && <p className="passive-compiler-error">Mô tả đã đổi; hãy sinh lại trước khi áp dụng.</p>}
          {proposal.warnings?.map((warning, index) => <p className="passive-compiler-warning" key={index}><AlertTriangle size={14} /> {warning}</p>)}
          {proposal.skills.length > 0 && <>
            {originalTransformSkills.length > 0 && <label className="hint-text" style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '12px 0' }}>
              <input type="checkbox" checked={keepTransformEffects}
                onChange={(event) => setKeepTransformEffects(event.target.checked)} />
              Giữ {originalTransformSkills.length} effect biến hình gốc khi thay Passive
            </label>}
            <div className="passive-compiler-preview-list">
              {proposal.skills.map((sk, index) => <div key={index}>
                <span>#{index + 1} · {meta?.efficacy_types?.[sk.efficacy_type] || `Efficacy ${sk.efficacy_type}`}
                  {sourceIndex(sk, index, proposal.skills.length) != null &&
                    <small className="efficacy-preview-source">↳ {sk.manual_desc_idx == null ? '[gợi ý] ' : ''}{conditionForLine(descLines, sourceIndex(sk, index, proposal.skills.length)) ? `${conditionForLine(descLines, sourceIndex(sk, index, proposal.skills.length))} · ` : ''}{descLines[sourceIndex(sk, index, proposal.skills.length)]}</small>}
                </span>
                <span>v: {[sk.eff_value1, sk.eff_value2, sk.eff_value3].map(v => v ?? 0).join(' / ')} · timing {sk.exec_timing_type} · {sk.probability ?? 100}%</span>
              </div>)}
            </div>
            <div className="passive-compiler-actions">
              <button className="btn primary-btn" disabled={proposal.description !== description || proposal.compiler_version !== EXPECTED_COMPILER_VERSION} onClick={() => applyProposal(true)}>Thay các dòng hiện tại</button>
              <button className="btn secondary-btn" disabled={proposal.description !== description || proposal.compiler_version !== EXPECTED_COMPILER_VERSION} onClick={() => applyProposal(false)}>Thêm vào cuối</button>
            </div>
            <p className="hint-text">Thêm vào cuối luôn giữ các dòng cũ. Thay dòng sẽ gỡ các dòng cũ, trừ effect biến hình nếu bật tùy chọn trên. Backup DB được tạo khi Save.</p>
          </>}
        </div>}
      </div>

      <div className="sub-skills-section">
        {!meta?.efficacy_types || Object.keys(meta.efficacy_types).length === 0 ? (
          <p className="passive-compiler-warning">
            Danh sách tên Efficacy Type chưa tải được{metaError ? `: ${metaError}` : ''}. ID hiện tại vẫn được giữ nguyên.{' '}
            <button type="button" className="btn secondary-btn" onClick={onReloadMeta}>Tải lại danh sách</button>
          </p>
        ) : null}
        <div className="section-bar space-between">
          <div className="bar-left"><Zap size={17} /><strong>Individual Passive Skill Efficacies ({currentSkills.length} skills)</strong></div>
          <button className="btn secondary-btn" onClick={addBlank}><Plus size={15} /> Thêm dòng</button>
        </div>
        {draft.passive_replace_existing && <p className="hint-text">Đang thay các dòng của set này; {draft.passive_keep_transform_effects ? 'effect biến hình gốc được giữ nguyên.' : 'toàn bộ dòng cũ sẽ được gỡ liên kết.'}</p>}
        <div className="sub-passives-list">
          {currentSkills.map((sk, idx) => {
            const lineIndex = sourceIndex(sk, idx, currentSkills.length)
            const matchConfidence = sk._sourceLineIndex != null ? 'manual'
              : sk.source_match_confidence || (sk.manual_desc_idx != null ? 'compiler' : matches[sk.id]?.confidence || 'suggested')
            const effType = Number(sk.efficacy_type) || 0
            const details = meta?.efficacy_details?.[effType]
            const v1Label = details?.v1 ? `Value 1 (${details.v1})` : 'Value 1 (eff_value1)'
            const v2Label = details?.v2 ? `Value 2 (${details.v2})` : 'Value 2 (eff_value2)'
            const v3Label = details?.v3 ? `Value 3 (${details.v3})` : 'Value 3 (eff_value3)'

            return (
              <div id={`passive-efficacy-${idx}`} key={sk.id || sk._draftKey || idx}
                data-source-description={lineIndex != null ? `${conditionForLine(descLines, lineIndex) ? `${conditionForLine(descLines, lineIndex)} · ` : ''}${descLines[lineIndex]}` : ''}
                className="passive-item-card edit-card">
                <div className="passive-item-head">
                  <div className="head-left">
                    <span className="idx-tag">Efficacy #{idx + 1}</span>
                    <span className="id-tag">{sk.id ? `ID: ${sk.id}` : 'Dòng mới'}</span>
                  </div>
                  <button className="btn secondary-btn" onClick={() => removeSkill(idx)} title="Gỡ dòng khỏi set">
                    <Trash2 size={14} />
                  </button>
                </div>
                <div className="passive-efficacy-clone-trigger-row">
                  <button type="button" className="btn secondary-btn" onClick={() => setCloneTargetIndex(cloneTargetIndex === idx ? null : idx)}>
                    <Copy size={14} /> {cloneTargetIndex === idx ? 'Đóng tìm kiếm' : 'Tìm efficacy để sao chép'}
                  </button>
                </div>
                {cloneTargetIndex === idx && <PassiveEfficacyClonePicker
                  onClose={() => setCloneTargetIndex(null)} onCopy={applyClonedEfficacies} meta={meta} language={language} />}
                <div className="efficacy-source-row">
                  <div className="efficacy-source-label">Dòng mô tả đối chiếu {lineIndex != null && matchConfidence === 'suggested' ? '· gợi ý, cần kiểm tra' : ''}</div>
                  <select value={lineIndex ?? ''} onChange={(e) => updateSkill(idx, '_sourceLineIndex', e.target.value === '' ? -1 : Number(e.target.value))}>
                    <option value="">Chưa xác định — chọn dòng thủ công</option>
                    {descLines.map((line, lineIdx) => line.startsWith('*') ? null :
                      <option key={lineIdx} value={lineIdx}>{`Dòng ${lineIdx + 1}: ${line}`}</option>)}
                  </select>
                  {lineIndex != null && <div className="efficacy-source-ingame">
                    <DokkanDescriptionPreview
                      text={`${conditionForLine(descLines, lineIndex) ? `*${conditionForLine(descLines, lineIndex)}*\n` : ''}${descLines[lineIndex]}`}
                      skillType="" skillName="" />
                  </div>}
                </div>
                <div className="passive-props-grid">
                  <div className="form-field full-row">
                    <label>Efficacy Type</label>
                    {meta?.efficacy_types && Object.keys(meta.efficacy_types).length > 0
                      ? selectField(idx, sk, 'efficacy_type', meta.efficacy_types)
                      : <input type="number" value={sk.efficacy_type ?? ''}
                          onChange={(e) => updateSkill(idx, 'efficacy_type', e.target.value === '' ? null : Number(e.target.value))}
                          placeholder="Efficacy Type ID" />}
                  </div>

                  {/* Guidance Card for this Efficacy Type */}
                  <div className="full-row">
                    <EfficacyHintCard effType={effType} meta={meta} />
                  </div>

                  {/* Dynamic Values Grid */}
                  <div className="fields-grid-3 full-row" style={{ marginTop: 2, marginBottom: 4 }}>
                    <div className="form-field">
                      <label title={details?.v1 || 'Value 1'}>{v1Label}</label>
                      <input
                        type="number"
                        value={sk.eff_value1 ?? ''}
                        onChange={(e) => updateSkill(idx, 'eff_value1', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder={details?.v1 || 'Value 1'}
                      />
                    </div>
                    <div className="form-field">
                      <label title={details?.v2 || 'Value 2'}>{v2Label}</label>
                      <input
                        type="number"
                        value={sk.eff_value2 ?? ''}
                        onChange={(e) => updateSkill(idx, 'eff_value2', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder={details?.v2 || 'Value 2'}
                      />
                    </div>
                    <div className="form-field">
                      <label title={details?.v3 || 'Value 3'}>{v3Label}</label>
                      <input
                        type="number"
                        value={sk.eff_value3 ?? ''}
                        onChange={(e) => updateSkill(idx, 'eff_value3', e.target.value === '' ? null : Number(e.target.value))}
                        placeholder={details?.v3 || 'Value 3'}
                        disabled={Number(sk.efficacy_type) === 103 && Boolean(sk._battle_param_draft_key)}
                        title={sk._battle_param_draft_key ? 'Auto-assigned unique battle parameter' : undefined}
                      />
                    </div>
                  </div>

                  {STANDARD_FIELDS.map(([field, label]) => (
                    <div className="form-field" key={field}>
                      <label>{label} ({field})</label>
                      {field === 'exec_timing_type' && meta?.exec_timings
                        ? selectField(idx, sk, field, meta.exec_timings)
                        : field === 'target_type' && meta?.target_types
                          ? selectField(idx, sk, field, meta.target_types)
                          : field === 'calc_option' && meta?.calc_options
                            ? selectField(idx, sk, field, meta.calc_options)
                            : <input type="number" value={sk[field] ?? ''}
                                onChange={(e) => updateSkill(idx, field, e.target.value === '' ? null : Number(e.target.value))} />}
                      {field === 'passive_skill_effect_id' && <AnimationLookup slot="entrance" onSelect={id => updateSkill(idx, field, id)} />}
                    </div>
                  ))}

                  <div className="form-field full-row">
                    <label>
                      Efficacy values (JSON)
                      {details?.vals && <small style={{ color: '#ffca28', marginLeft: 8 }}>Format: {details.vals}</small>}
                    </label>
                    <textarea rows={2} value={typeof sk.efficacy_values === 'object' ? JSON.stringify(sk.efficacy_values) : (sk.efficacy_values || '')}
                      onChange={(e) => updateSkill(idx, 'efficacy_values', e.target.value)}
                      placeholder="{}" />
                  </div>

                  <div className="full-row">
                    <CausalityExpressionEditor
                      value={sk.causality_conditions}
                      onChange={(val) => updateSkill(idx, 'causality_conditions', val)}
                      label="Causality Conditions (Biểu thức điều kiện kích hoạt)"
                      meta={meta}
                    />
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
      <div className="list-add-footer"><button type="button" className="btn secondary-btn" onClick={addBlank}><Plus size={15} /> Thêm dòng</button></div>
    </div>
  )
}
