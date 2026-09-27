import React, { useLayoutEffect, useRef } from 'react'
import { Globe } from 'lucide-react'
import { DomainImage } from './DomainImage'
import { CausalityExpressionEditor } from './CausalityExpressionEditor'
import { EfficacyHintCard } from './EfficacyHintCard'

export function DomainPanel({ fields = [], activeRelations = [], passiveRelations = [], draft, onChange, meta, language = 'vi' }) {
  const vi = language !== 'en'
  const editor = useRef(null)
  const fitInputs = () => {
    editor.current?.querySelectorAll('textarea').forEach(input => {
      input.style.height = 'auto'
      input.style.height = `${input.scrollHeight + 2}px`
    })
  }
  useLayoutEffect(fitInputs)
  useLayoutEffect(() => {
    const node = editor.current
    let lastWidth = -1
    const observer = new ResizeObserver(([entry]) => {
      if (entry.contentRect.width === lastWidth) return
      lastWidth = entry.contentRect.width
      fitInputs()
    })
    if (node) observer.observe(node)
    return () => observer.disconnect()
  }, [])
  const current = draft.fields ?? fields
  const update = (index, key, value) => onChange('fields', current.map((field, i) => i === index ? { ...field, [key]: value } : field))
  const effect = (index, ei, key, value) => update(index, 'efficacies', (current[index].efficacies || []).map((row, i) => i === ei ? { ...row, [key]: value } : row))
  return <div className="domain-editor" ref={editor} onInputCapture={fitInputs}>
    <div className="section-intro"><Globe size={22} /><div><h3>Domain / Dokkan Field</h3>
      <p>{vi ? 'Domain thay nền chiến đấu và áp dụng hiệu ứng cho các đối tượng thỏa điều kiện. Các thông số bên dưới lấy từ domain liên kết với Active hoặc Passive của form này.' : 'Domains replace the battle background and apply effects to eligible targets. These values come from the domain linked to this form’s Active or Passive skill.'}</p>
    </div></div>
    {!current.length && <div className="form-card"><p className="hint-text">{vi ? 'Form này chưa có domain liên kết. Nếu domain được mở bởi form khác, hãy chuyển sang form đó để xem.' : 'This form has no linked domain. If another form activates one, switch to that form to view it.'}</p></div>}
    {current.map((field, index) => {
      const active = (draft.field_active_relations ?? activeRelations).filter(row => Number(row.dokkan_field_id) === Number(field.id))
      const passive = (draft.field_passive_relations ?? passiveRelations).filter(row => Number(row.dokkan_field_id) === Number(field.id))
      const resource = Number(field.resource_id) || 0
      return <section className="form-card" key={field.id}>
        <div className="form-header"><Globe size={18} /><strong>{field.name || 'Domain'} · #{field.id}</strong></div>
        <div className="domain-summary"><span>Resource #{resource}</span><span>Efficacy set #{field.dokkan_field_efficacy_set_id}</span>
          {active.map(row => <span key={`a${row.id}`}>Active Skill Set #{row.active_skill_set_id}</span>)}
          {passive.map(row => <span key={`p${row.id}`}>Passive Skill #{row.passive_skill_id}</span>)}
        </div>
        <div className={`domain-workspace${resource > 0 ? '' : ' domain-workspace-no-preview'}`}>
        <div className="domain-edit-fields">
        <div className="fields-grid-2">
          <div className="form-field"><label>{vi ? 'Tên domain' : 'Domain name'}</label><textarea rows={1} value={field.name || ''} onChange={e => update(index, 'name', e.target.value)} /></div>
          <div className="form-field"><label>{vi ? 'Resource ID (map / hoạt ảnh)' : 'Resource ID (map / animation)'}</label><input type="number" min="1" value={field.resource_id ?? 0} onChange={e => update(index, 'resource_id', Number(e.target.value))} /></div>
          <div className="form-field full-row"><label>{vi ? 'Mô tả hiệu ứng' : 'Effect description'}</label><textarea rows={3} value={field.description || ''} onChange={e => update(index, 'description', e.target.value)} /></div>
        </div>
        <h4>{vi ? 'Hiệu ứng domain' : 'Domain effects'} ({field.efficacies?.length || 0})</h4>
        {(field.efficacies || []).map((row, ei) => <div className="domain-effect" key={row.id ?? ei}>
          <strong>Effect #{row.id}</strong>
          <div className="fields-grid-3">
            {[["exec_timing_type", vi ? 'Thời điểm' : 'Timing', meta?.exec_timings], ['efficacy_type', 'Efficacy', meta?.efficacy_types], ['calc_option', vi ? 'Phép tính' : 'Calculation', meta?.calc_options]].map(([key, label, options]) =>
              <div className="form-field" key={key}><label>{label}</label><select value={row[key] ?? 0} onChange={e => effect(index, ei, key, Number(e.target.value))}>
                {!Object.hasOwn(options || {}, row[key] ?? 0) && <option value={row[key] ?? 0}>#{row[key] ?? 0}</option>}
                {Object.entries(options || {}).map(([id, name]) => <option key={id} value={id}>[{id}] {name}</option>)}
              </select></div>)}
            {[["turn", vi ? 'Số lượt' : 'Turns'], ['probability', vi ? 'Xác suất (%)' : 'Probability (%)'], ['is_once', vi ? 'Một lần (0/1)' : 'Once (0/1)'], ['eff_value1', 'Value 1'], ['eff_value2', 'Value 2'], ['eff_value3', 'Value 3']].map(([key, label]) =>
              <div className="form-field" key={key}><label>{label}</label><input type="number" value={row[key] ?? 0} onChange={e => effect(index, ei, key, Number(e.target.value))} /></div>)}
          </div>
          <EfficacyHintCard effType={row.efficacy_type} meta={meta} />
          <div className="form-field"><label>{vi ? 'Giá trị Efficacy' : 'Efficacy values'}</label><textarea rows={2} value={typeof row.efficacy_values === 'object' ? JSON.stringify(row.efficacy_values) : row.efficacy_values || ''} onChange={e => effect(index, ei, 'efficacy_values', e.target.value)} /></div>
          <CausalityExpressionEditor label={vi ? 'Điều kiện hiệu ứng domain' : 'Domain effect conditions'} value={row.causality_conditions} meta={meta} onChange={value => effect(index, ei, 'causality_conditions', value)} />
        </div>)}
        </div>
        {resource > 0 && <aside className="domain-preview-column"><DomainImage key={resource} resource={resource} name={field.name} /></aside>}
        </div>
      </section>
    })}
  </div>
}
