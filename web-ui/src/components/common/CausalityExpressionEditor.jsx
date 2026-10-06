import React, { useState, useEffect, useMemo } from 'react'
import { Sparkles, Search, CheckCircle2, AlertCircle, Plus, Save, ChevronDown, ChevronUp, Info } from 'lucide-react'
import { api, getModWorkspace } from '../../api'
import { useCausalityDrafts } from './CausalityDraftContext'

// Extract clean expression string from whatever format is stored in database
export function getCausalityExprString(raw) {
  if (raw === undefined || raw === null || raw === '') return ''
  if (typeof raw === 'object') {
    return raw.source ? String(raw.source) : ''
  }
  const str = String(raw).trim()
  if (str.startsWith('{') && str.endsWith('}')) {
    try {
      const parsed = JSON.parse(str)
      if (parsed && parsed.source) return String(parsed.source)
    } catch (e) {}
  }
  return str
}

// Parse a logical expression string with &, |, () into Dokkan AST structure
export function parseCausalityExpr(exprStr) {
  if (!exprStr || !exprStr.trim()) return null
  const clean = exprStr.replace(/\s+/g, '')
  const tokens = clean.match(/\d+|&|\||\(|\)/g)
  if (!tokens || tokens.join('') !== clean) {
    throw new Error('Biểu thức chứa ký tự không hợp lệ. Chỉ dùng số ID, &, |, (, )')
  }

  let idx = 0

  function parseFactor() {
    if (idx >= tokens.length) throw new Error('Biểu thức kết thúc bất ngờ')
    const token = tokens[idx]
    if (token === '(') {
      idx++
      const res = parseExpression()
      if (idx >= tokens.length || tokens[idx] !== ')') {
        throw new Error("Thiếu dấu đóng ngoặc ')'")
      }
      idx++
      return res
    } else if (/^\d+$/.test(token)) {
      idx++
      return parseInt(token, 10)
    } else {
      throw new Error(`Ký tự không hợp lệ tại vị trí này: '${token}'`)
    }
  }

  function parseTerm() {
    let factors = [parseFactor()]
    while (idx < tokens.length && tokens[idx] === '&') {
      idx++
      factors.push(parseFactor())
    }
    if (factors.length === 1) return factors[0]
    const flat = []
    for (const f of factors) {
      if (Array.isArray(f) && f.length > 0 && f[0] === '&') {
        flat.push(...f.slice(1))
      } else {
        flat.push(f)
      }
    }
    return ['&', ...flat]
  }

  function parseExpression() {
    let terms = [parseTerm()]
    while (idx < tokens.length && tokens[idx] === '|') {
      idx++
      terms.push(parseTerm())
    }
    if (terms.length === 1) return terms[0]
    const flat = []
    for (const t of terms) {
      if (Array.isArray(t) && t.length > 0 && t[0] === '|') {
        flat.push(...t.slice(1))
      } else {
        flat.push(t)
      }
    }
    return ['|', ...flat]
  }

  const result = parseExpression()
  if (idx < tokens.length) {
    throw new Error(`Ký tự dư thừa: '${tokens[idx]}'`)
  }
  return result
}

// Compile a user-written expression into Dokkan's JSON string
export function compileCausalityJson(exprStr) {
  if (!exprStr || !exprStr.trim()) return ''
  const clean = exprStr.replace(/\s+/g, '')
  if (/^\d+$/.test(clean)) {
    return JSON.stringify({
      source: clean,
      compiled: parseInt(clean, 10)
    })
  }
  try {
    const compiled = parseCausalityExpr(clean)
    return JSON.stringify({
      source: clean,
      compiled: compiled
    })
  } catch (e) {
    // If syntax error while typing, preserve user input string
    return clean
  }
}

export function CausalityExpressionEditor({
  value,
  onChange,
  label = "Causality Condition Expression",
  placeholder = "e.g. 930 | (296 & 3537) hoặc ID đơn",
  meta,
  allowEditValues = true
}) {
  const { rows: causalityDrafts, update: updateCausality } = useCausalityDrafts()
  const workspaceId = getModWorkspace()
  const initialExpr = useMemo(() => getCausalityExprString(value), [value])
  const [exprText, setExprText] = useState(initialExpr)
  const [parseError, setParseError] = useState('')
  const [detailsCache, setDetailsCache] = useState({})
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [searching, setSearching] = useState(false)
  const [savingId, setSavingId] = useState(null)
  const [feedbackMsg, setFeedbackMsg] = useState('')
  const [creatingFor, setCreatingFor] = useState(null)
  const [createType, setCreateType] = useState(1)
  const [createValues, setCreateValues] = useState([0, 0, 0])
  const [nextCausalityId, setNextCausalityId] = useState(1)
  const [createError, setCreateError] = useState('')

  // Sync if external value changes drastically
  useEffect(() => {
    const currentClean = getCausalityExprString(value)
    if (currentClean !== exprText && currentClean !== exprText.replace(/\s+/g, '')) {
      setExprText(currentClean)
    }
  }, [value])

  // Extract all numeric IDs from the typed expression
  const extractedIds = useMemo(() => {
    if (!exprText) return []
    const matches = exprText.match(/\d+/g) || []
    return Array.from(new Set(matches.map(Number)))
  }, [exprText])

  // Validate syntax in real time
  useEffect(() => {
    if (!exprText.trim()) {
      setParseError('')
      return
    }
    try {
      parseCausalityExpr(exprText)
      setParseError('')
    } catch (err) {
      setParseError(err.message)
    }
  }, [exprText])

  // Load details for extracted IDs
  useEffect(() => {
    let active = true
    setDetailsCache({})
    extractedIds.forEach(id => {
        api.getCausality(id)
          .then(res => {
            if (active && res && !res.error) {
              setDetailsCache(prev => ({ ...prev, [id]: res }))
            }
          })
          .catch(() => {})
    })
    return () => { active = false }
  }, [extractedIds, workspaceId])

  // Handle typing expression
  const handleTextChange = (text) => {
    setExprText(text)
    const compiled = compileCausalityJson(text)
    onChange(compiled)
  }

  // Handle condition value updates (cau_val1, cau_val2, cau_val3)
  const handleValChange = (id, field, val) => {
    const num = val === '' ? 0 : Number(val)
  const current = detailsCache[id] || causalityDrafts[id] ? { ...detailsCache[id], ...causalityDrafts[id] } : null
    if (current) updateCausality({ ...current, id, [field]: num })
    setDetailsCache(prev => {
      const cur = prev[id] || {}
      return {
        ...prev,
        [id]: { ...cur, [field]: num }
      }
    })
  }

  const openCreateCausality = async () => {
    setCreatingFor('expression')
    setCreateType(1)
    setCreateValues([0, 0, 0])
    setCreateError('')
    try {
      const data = await api.getCausalities('', 1)
      const used = [...Object.keys(causalityDrafts).map(Number), ...Object.keys(detailsCache).map(Number)]
      setNextCausalityId(Math.max(Number(data.next_id) || 1, ...used.map(id => id + 1), 1))
    } catch (error) { setCreateError(error.message) }
  }

  const createCausality = () => {
    const id = nextCausalityId
    if (!Number.isInteger(id) || id <= 0) { setCreateError('ID causality mới không hợp lệ.'); return }
    const detail = meta?.causality_details?.[createType] || {}
    const row = {
      id, causality_type: Number(createType), cau_val1: Number(createValues[0]) || 0,
      cau_val2: Number(createValues[1]) || 0, cau_val3: Number(createValues[2]) || 0,
      name: meta?.causality?.[createType] || `Type ${createType}`,
      desc: detail.desc || '', v1: detail.v1 || '', v2: detail.v2 || '', v3: detail.v3 || ''
    }
    updateCausality(row)
    setDetailsCache(previous => ({ ...previous, [id]: row }))
    const expression = creatingFor === 'expression'
      ? (exprText.trim() ? `(${exprText.trim()}) & ${id}` : String(id))
      : exprText.replace(new RegExp(`\\b${creatingFor}\\b`, 'g'), String(id))
    handleTextChange(expression)
    setNextCausalityId(id + 1)
    setCreatingFor(null)
    setCreateError('')
    setFeedbackMsg(creatingFor === 'expression'
      ? `Đã tạo Causality #${id} trong bản nháp và thêm vào biểu thức.`
      : `Đã tạo Causality #${id} trong bản nháp và thay ID #${creatingFor} trong biểu thức.`)
  }

  // Save modified causality to database
  const handleSaveCondition = async (id) => {
    const item = detailsCache[id] || causalityDrafts[id] ? { ...detailsCache[id], ...causalityDrafts[id] } : null
    if (!item) return
    setSavingId(id)
    try {
      updateCausality({
        id: item.id,
        causality_type: item.causality_type,
        cau_val1: item.cau_val1 ?? 0,
        cau_val2: item.cau_val2 ?? 0,
        cau_val3: item.cau_val3 ?? 0
      })
      setFeedbackMsg(`Đã giữ Causality #${id} trong SQL patch!`)
      setTimeout(() => setFeedbackMsg(''), 3000)
    } catch (err) {
      setFeedbackMsg(`Lỗi khi lưu #${id}: ${err.message}`)
    } finally {
      setSavingId(null)
    }
  }

  // Search causality database
  const handleSearch = async (q) => {
    setSearchQuery(q)
    if (!q.trim()) {
      setSearchResults([])
      return
    }
    setSearching(true)
    try {
      const res = await api.getCausalities(q.trim(), 20)
      setSearchResults(res.items || [])
    } catch (e) {
      setSearchResults([])
    } finally {
      setSearching(false)
    }
  }

  // Insert ID into expression
  const handleInsertId = (id) => {
    const current = exprText.trim()
    let nextText = ''
    if (!current) {
      nextText = String(id)
    } else {
      nextText = `${current} & ${id}`
    }
    handleTextChange(nextText)
  }

  return (
    <div className="causality-expr-editor">
      <div className="expr-label-bar">
        <label className="expr-label">
          <Sparkles size={13} className="sparkle-icon" />
          <span>{label}</span>
        </label>
        <button
          type="button"
          className="search-toggle-btn"
          onClick={() => setSearchOpen(!searchOpen)}
          title="Tra cứu danh mục Causality trong Database"
        >
          <Search size={12} />
          <span>{searchOpen ? 'Đóng tra cứu' : '🔍 Tra cứu điều kiện'}</span>
          {searchOpen ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>
        {allowEditValues && <button type="button" className="search-toggle-btn" onClick={() => creatingFor === 'expression' ? setCreatingFor(null) : void openCreateCausality()}>
          <Plus size={12} /><span>{creatingFor === 'expression' ? 'Đóng tạo mới' : 'Tạo causality mới'}</span>
        </button>}
      </div>

      {creatingFor === 'expression' && <div className="causality-create-inline expression-causality-create">
        <strong>Tạo causality mới cho biểu thức</strong>
        <div className="form-field"><label>Loại điều kiện</label>
          <select value={createType} onChange={event => setCreateType(Number(event.target.value))}>
            {Object.entries(meta?.causality || {}).map(([typeId, name]) => <option key={typeId} value={typeId}>[{typeId}] {name}</option>)}
          </select>
        </div>
        {meta?.causality_details?.[createType]?.desc && <p className="hint-text">{meta.causality_details[createType].desc}</p>}
        <div className="node-vals-inputs">
          {[1, 2, 3].map((number, index) => {
            const hint = meta?.causality_details?.[createType] || {}
            return <div className="val-field" key={number}><label>{hint[`v${number}`] || `Value ${number} (cau_val${number})`}</label>
              <input type="number" value={createValues[index]} onChange={event => setCreateValues(previous => previous.map((value, i) => i === index ? event.target.value : value))} />
            </div>
          })}
        </div>
        <small>ID mới dự kiến: #{nextCausalityId}</small>
        {createError && <p className="passive-compiler-error">{createError}</p>}
        <button type="button" className="btn primary-btn" onClick={createCausality}><Plus size={13} /> Tạo và thêm vào biểu thức</button>
      </div>}

      {/* Main Expression Input */}
      <div className={`expr-input-wrapper ${parseError ? 'has-error' : (exprText.trim() ? 'is-valid' : '')}`}>
        <input
          type="text"
          className="expr-input"
          value={exprText}
          onChange={(e) => handleTextChange(e.target.value)}
          placeholder={placeholder}
          title="Nhập biểu thức logic dùng số ID, &, |, và ngoặc (). Ví dụ: 930|(296&3537)"
        />
        <div className="expr-status-icon">
          {parseError ? (
            <AlertCircle size={15} className="error-icon" title={parseError} />
          ) : exprText.trim() ? (
            <CheckCircle2 size={15} className="success-icon" title="Cú pháp Dokkan AST hợp lệ" />
          ) : null}
        </div>
      </div>

      {parseError && (
        <div className="expr-error-message">
          <AlertCircle size={12} />
          <span>{parseError}</span>
        </div>
      )}

      {feedbackMsg && (
        <div className="expr-feedback-badge">
          <span>{feedbackMsg}</span>
        </div>
      )}

      {/* Search / Lookup Drawer */}
      {searchOpen && (
        <div className="causality-search-drawer">
          <div className="drawer-search-bar">
            <Search size={14} />
            <input
              type="text"
              placeholder="Nhập tên điều kiện hoặc số ID (ví dụ: turn, hp, pure saiyans, 930)..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              autoFocus
            />
            {searching && <span className="drawer-loading">Đang tìm...</span>}
          </div>

          <div className="drawer-results-list">
            {searchResults.length === 0 ? (
              <div className="drawer-empty-hint">
                {searchQuery ? 'Không tìm thấy điều kiện nào phù hợp.' : 'Gõ từ khóa để tra cứu trong 3.700+ điều kiện của Dokkan...'}
              </div>
            ) : (
              searchResults.map((item) => (
                <div key={item.id} className="search-result-item">
                  <div className="item-info">
                    <div className="item-title">
                      <span className="cid-badge">ID #{item.id}</span>
                      <strong>{item.name}</strong>
                    </div>
                    {item.desc && <div className="item-desc">{item.desc}</div>}
                    <div className="item-vals">
                      {item.v1 && <span>{item.v1}: <b>{item.cau_val1}</b></span>}
                      {item.v2 && <span>{item.v2}: <b>{item.cau_val2}</b></span>}
                      {item.v3 && <span>{item.v3}: <b>{item.cau_val3}</b></span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="insert-btn"
                    onClick={() => handleInsertId(item.id)}
                    title="Chèn ID này vào biểu thức"
                  >
                    <Plus size={13} /> Chèn
                  </button>
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* Extracted Conditions Inspector Card */}
      {extractedIds.length > 0 && (
        <div className="causality-inspector-list">
          <div className="inspector-head">
            <Info size={12} />
            <span>Chi tiết các điều kiện trong biểu thức ({extractedIds.length} điều kiện):</span>
          </div>

          <div className="inspector-cards-grid">
            {extractedIds.map(id => {
              const item = detailsCache[id] || causalityDrafts[id] ? { ...detailsCache[id], ...causalityDrafts[id] } : null
              const typeName = item?.name || meta?.causality?.[id] || `Condition ID #${id}`
              const desc = item?.desc || meta?.causality_details?.[id]?.desc || ''
              const v1Label = item?.v1 || meta?.causality_details?.[id]?.v1 || 'Value 1'
              const v2Label = item?.v2 || meta?.causality_details?.[id]?.v2 || 'Value 2'
              const v3Label = item?.v3 || meta?.causality_details?.[id]?.v3 || 'Value 3'

              return (
                <div key={id} className="causality-node-card">
                  <div className="node-head">
                    <span className="node-id-pill">ID #{id}</span>
                    <strong className="node-title">{typeName}</strong>
                    {allowEditValues && item && (
                      <>
                        <button type="button" className="save-node-btn" onClick={() => handleSaveCondition(id)}
                          disabled={savingId === id} title="Giữ các giá trị này trong SQL patch">
                          <Save size={12} /><span>{savingId === id ? 'Lưu...' : 'Lưu'}</span>
                        </button>
                      </>
                    )}
                  </div>

                  {desc && <div className="node-desc">{desc}</div>}

                  {allowEditValues && item ? (
                    <div className="node-vals-inputs">
                      <div className="val-field">
                        <label title={v1Label}>{v1Label}</label>
                        <input
                          type="number"
                          value={item.cau_val1 ?? 0}
                          onChange={(e) => handleValChange(id, 'cau_val1', e.target.value)}
                        />
                      </div>
                      <div className="val-field">
                        <label title={v2Label}>{v2Label}</label>
                        <input
                          type="number"
                          value={item.cau_val2 ?? 0}
                          onChange={(e) => handleValChange(id, 'cau_val2', e.target.value)}
                        />
                      </div>
                      <div className="val-field">
                        <label title={v3Label}>{v3Label}</label>
                        <input
                          type="number"
                          value={item.cau_val3 ?? 0}
                          onChange={(e) => handleValChange(id, 'cau_val3', e.target.value)}
                        />
                      </div>
                    </div>
                  ) : item ? (
                    <div className="node-vals-readonly">
                      <span>{v1Label}: <b>{item.cau_val1 ?? 0}</b></span>
                      <span>{v2Label}: <b>{item.cau_val2 ?? 0}</b></span>
                      <span>{v3Label}: <b>{item.cau_val3 ?? 0}</b></span>
                    </div>
                  ) : (
                    <div className="node-loading">Đang tải thông số điều kiện...</div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
