import React, { useState, useEffect } from 'react'
import { Network, Search, Filter, CheckCircle, AlertCircle, Plus, Save, Database, GitBranch, ArrowRight, RefreshCw, Sparkles, HelpCircle } from 'lucide-react'
import { api } from '../../api'
import { useCausalityDrafts } from '../common/CausalityDraftContext'

export function TabCausality({ passive, leader, active, standby, finish, specials, meta }) {
  const { rows: causalityDrafts, update: updateCausality } = useCausalityDrafts()
  const [activeSubTab, setActiveSubTab] = useState('editor') // 'editor' | 'tree'
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState([])
  const [isSearching, setIsSearching] = useState(false)
  const [selectedRecord, setSelectedCausality] = useState(null)
  const selectedCausality = causalityDrafts[selectedRecord?.id] || selectedRecord
  const updateSelectedCausality = row => { setSelectedCausality(row); updateCausality(row) }
  const [isSaving, setIsSaving] = useState(false)
  const [saveStatus, setSaveStatus] = useState(null)
  const [nextId, setNextId] = useState(1)

  // New causality state
  const [newCausId, setNewCausId] = useState('')
  const [newCausType, setNewCausType] = useState(1)
  const [newVal1, setNewVal1] = useState(0)
  const [newVal2, setNewVal2] = useState(0)
  const [newVal3, setNewVal3] = useState(0)
  const [createStatus, setCreateStatus] = useState(null)

  // Load initial causalities & next ID
  useEffect(() => {
    loadCausalities('')
  }, [])

  const loadCausalities = async (query = '') => {
    setIsSearching(true)
    try {
      const res = await api.getCausalities(query, 50)
      setSearchResults(res.items || [])
      if (res.next_id) {
        setNextId(res.next_id)
        if (!newCausId) setNewCausId(res.next_id)
      }
      if (res.items?.length > 0 && !selectedCausality && !query) {
        setSelectedCausality(res.items[0])
      }
    } catch (err) {
      console.error('Failed to load causalities:', err)
    } finally {
      setIsSearching(false)
    }
  }

  const handleSearch = (e) => {
    e.preventDefault()
    loadCausalities(searchQuery)
  }

  const selectCausalityById = async (id) => {
    if (causalityDrafts[id]) {
      setSelectedCausality(causalityDrafts[id])
      setActiveSubTab('editor')
      return
    }
    try {
      const caus = await api.getCausality(id)
      if (caus && caus.id) {
        setSelectedCausality(caus)
        setActiveSubTab('editor')
      }
    } catch (err) {
      alert(`Could not find Causality #${id}`)
    }
  }

  const handleSaveSelected = async () => {
    if (!selectedCausality) return
    setIsSaving(true)
    setSaveStatus(null)
    try {
      updateCausality({
        id: Number(selectedCausality.id),
        causality_type: Number(selectedCausality.causality_type),
        cau_val1: Number(selectedCausality.cau_val1 || 0),
        cau_val2: Number(selectedCausality.cau_val2 || 0),
        cau_val3: Number(selectedCausality.cau_val3 || 0)
      })
      setSaveStatus({ type: 'success', text: `Đã giữ Causality #${selectedCausality.id} trong SQL patch.` })
      loadCausalities(searchQuery)
    } catch (err) {
      setSaveStatus({ type: 'error', text: `Failed to save: ${err.message}` })
    } finally {
      setIsSaving(false)
    }
  }

  const handleCreateNew = async (e) => {
    e.preventDefault()
    if (!newCausId) return
    setIsSaving(true)
    setCreateStatus(null)
    try {
      const newRow = {
        id: Number(newCausId),
        causality_type: Number(newCausType),
        cau_val1: Number(newVal1 || 0),
        cau_val2: Number(newVal2 || 0),
        cau_val3: Number(newVal3 || 0)
      }
      updateCausality(newRow)
      setSelectedCausality(newRow)
      setCreateStatus({ type: 'success', text: `Đã thêm Causality #${newCausId} vào SQL patch.` })
      loadCausalities(searchQuery)
      setNextId(Number(newCausId) + 1)
      setNewCausId(Number(newCausId) + 1)
    } catch (err) {
      setCreateStatus({ type: 'error', text: `Failed to create: ${err.message}` })
    } finally {
      setIsSaving(false)
    }
  }

  // --- Aggregate Condition Tree from loaded character data ---
  const extractConditionIds = (raw) => {
    if (!raw) return []
    if (typeof raw === 'number') return [raw]
    let str = typeof raw === 'string' ? raw : JSON.stringify(raw)
    const matches = str.match(/\b\d+\b/g)
    if (!matches) return []
    return Array.from(new Set(matches.map((n) => Number(n)).filter((n) => n > 0 && n < 100000)))
  }

  const usedConditions = []

  // Leader
  leader?.skills?.forEach((sk) => {
    const ids = extractConditionIds(sk.causality_conditions)
    ids.forEach((cid) => {
      usedConditions.push({
        source: 'Leader Skill',
        skillId: sk.id,
        conditionId: cid,
        raw: sk.causality_conditions
      })
    })
  })

  // Passive
  passive?.skills?.forEach((sk) => {
    const ids = extractConditionIds(sk.causality_conditions)
    ids.forEach((cid) => {
      usedConditions.push({
        source: 'Passive Skill',
        skillId: sk.id,
        conditionId: cid,
        raw: sk.causality_conditions
      })
    })
  })

  // Active
  if (active?.set?.causality_conditions) {
    const ids = extractConditionIds(active.set.causality_conditions)
    ids.forEach((cid) => {
      usedConditions.push({
        source: 'Active Skill Set',
        skillId: active.set.id,
        conditionId: cid,
        raw: active.set.causality_conditions
      })
    })
  }

  // Standby
  if (standby?.set?.causality_conditions) {
    const ids = extractConditionIds(standby.set.causality_conditions)
    ids.forEach((cid) => {
      usedConditions.push({
        source: 'Standby Skill Set',
        skillId: standby.set.id,
        conditionId: cid,
        raw: standby.set.causality_conditions
      })
    })
  }

  // Finish
  if (Array.isArray(finish)) {
    finish.forEach((fItem) => {
      if (fItem?.set?.causality_conditions) {
        const ids = extractConditionIds(fItem.set.causality_conditions)
        ids.forEach((cid) => {
          usedConditions.push({
            source: 'Finish Skill Set',
            skillId: fItem.set.id,
            conditionId: cid,
            raw: fItem.set.causality_conditions
          })
        })
      }
    })
  }

  // Specials
  if (Array.isArray(specials)) {
    specials.forEach((cs) => {
      extractConditionIds(cs.causality_conditions).forEach((cid) => {
        usedConditions.push({
          source: 'Super Attack (Move Trigger)',
          skillId: cs.id,
          conditionId: cid,
          raw: cs.causality_conditions
        })
      })
      ;(cs.specials || []).forEach((se) => {
        extractConditionIds(se.causality_conditions).forEach((cid) => {
          usedConditions.push({
            source: `Super Attack Effect #${se.id}`,
            skillId: se.id,
            conditionId: cid,
            raw: se.causality_conditions
          })
        })
      })
      ;(cs.bonuses || []).forEach((sb) => {
        extractConditionIds(sb.causality_conditions).forEach((cid) => {
          usedConditions.push({
            source: `Super Attack Bonus #${sb.id}`,
            skillId: sb.id,
            conditionId: cid,
            raw: sb.causality_conditions
          })
        })
      })
    })
  }

  const selectedDetails = meta?.causality_details?.[selectedCausality?.causality_type] || {}
  const newTypeDetails = meta?.causality_details?.[newCausType] || {}

  return (
    <div className="tab-pane causality-pane">
      {/* Sub-tab switcher */}
      <div className="section-bar space-between" style={{ marginBottom: '14px' }}>
        <div style={{ display: 'flex', gap: '8px' }}>
          <button
            type="button"
            className={`btn ${activeSubTab === 'editor' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setActiveSubTab('editor')}
          >
            <Database size={14} /> skill_causalities Database Editor
          </button>
          <button
            type="button"
            className={`btn ${activeSubTab === 'tree' ? 'btn-primary' : 'btn-secondary'} btn-sm`}
            onClick={() => setActiveSubTab('tree')}
          >
            <GitBranch size={14} /> Card Condition Tree ({usedConditions.length} nodes)
          </button>
        </div>
      </div>

      {/* SUB-TAB 1: Database Editor */}
      {activeSubTab === 'editor' && (
        <div className="causality-db-grid" style={{ display: 'grid', gridTemplateColumns: '320px minmax(0, 1fr)', gap: '16px' }}>
          {/* Left Column: Search & List */}
          <div className="causality-sidebar edit-card" style={{ padding: '12px', display: 'flex', flexDirection: 'column', gap: '10px' }}>
            <form onSubmit={handleSearch} style={{ display: 'flex', gap: '6px' }}>
              <input
                type="text"
                placeholder="ID or condition keyword..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                style={{ flex: 1, padding: '6px 10px', fontSize: '12px' }}
              />
              <button type="submit" className="btn btn-secondary btn-sm" disabled={isSearching}>
                <Search size={14} />
              </button>
            </form>

            <div className="search-meta" style={{ fontSize: '11px', color: '#94a3b8', display: 'flex', justifyContent: 'space-between' }}>
              <span>Found {searchResults.length} conditions</span>
              <span>Next ID: #{nextId}</span>
            </div>

            <div className="causality-items-scroll" style={{ maxHeight: '560px', overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: '6px' }}>
              {searchResults.map((c) => {
                const isSelected = selectedCausality?.id === c.id
                return (
                  <div
                    key={c.id}
                    onClick={() => { setSelectedCausality(c); setSaveStatus(null) }}
                    className={`causality-list-item ${isSelected ? 'active' : ''}`}
                    style={{
                      padding: '8px 10px',
                      borderRadius: '6px',
                      background: isSelected ? 'rgba(56, 189, 248, 0.15)' : '#0f172a',
                      border: isSelected ? '1px solid #38bdf8' : '1px solid #1e293b',
                      cursor: 'pointer',
                      fontSize: '11.5px'
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '2px' }}>
                      <strong style={{ color: isSelected ? '#38bdf8' : '#e2e8f0' }}>#{c.id}</strong>
                      <span style={{ fontSize: '10px', color: '#94a3b8' }}>Type {c.causality_type}</span>
                    </div>
                    <div style={{ color: '#cbd5e1', fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {c.name}
                    </div>
                    <div style={{ fontSize: '10px', color: '#64748b', marginTop: '2px' }}>
                      V1={c.cau_val1} · V2={c.cau_val2} · V3={c.cau_val3}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>

          {/* Right Column: Editor & Creator */}
          <div className="causality-main-editor" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            {selectedCausality ? (
              <div className="edit-card" style={{ padding: '16px' }}>
                <div className="section-bar space-between">
                  <div className="bar-left">
                    <Sparkles size={16} />
                    <strong>Edit Causality ID: #{selectedCausality.id}</strong>
                  </div>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleSaveSelected}
                    disabled={isSaving}
                  >
                    <Save size={14} /> {isSaving ? 'Đang lưu…' : 'Giữ trong SQL patch'}
                  </button>
                </div>

                {saveStatus && (
                  <div className={`status-banner ${saveStatus.type}`} style={{ margin: '8px 0', padding: '8px', borderRadius: '6px', fontSize: '12px' }}>
                    {saveStatus.text}
                  </div>
                )}

                <div className="fields-grid-2" style={{ marginTop: '12px' }}>
                  {/* Causality Type */}
                  <div className="form-field">
                    <label>Causality Type (causality_type)</label>
                    <select
                      value={selectedCausality.causality_type}
                      onChange={(e) => {
                        const newType = Number(e.target.value)
                        updateSelectedCausality({
                          ...selectedCausality,
                          causality_type: newType,
                          name: meta?.causality?.[newType] || `Type ${newType}`
                        })
                      }}
                    >
                      {meta?.causality && Object.entries(meta.causality).map(([id, name]) => (
                        <option key={id} value={id}>[{id}] {name}</option>
                      ))}
                    </select>
                  </div>

                  <div className="form-field">
                    <label>Condition Name / Meaning</label>
                    <input
                      type="text"
                      disabled
                      value={selectedCausality.name || meta?.causality?.[selectedCausality.causality_type] || ''}
                      style={{ opacity: 0.8 }}
                    />
                  </div>
                </div>

                {/* Rich Details Card */}
                {selectedDetails.desc && (
                  <div className="hint-card" style={{ background: '#091528', border: '1px solid #1e3a5f', padding: '10px 14px', borderRadius: '6px', margin: '10px 0' }}>
                    <div style={{ fontSize: '11px', color: '#60a5fa', fontWeight: 700, marginBottom: '2px' }}>
                      📖 Condition Gameplay Description:
                    </div>
                    <div style={{ fontSize: '12px', color: '#e2e8f0', lineHeight: 1.45 }}>
                      {selectedDetails.desc}
                    </div>
                  </div>
                )}

                {/* Values Grid with dynamic labels */}
                <div className="fields-grid-3" style={{ marginTop: '12px' }}>
                  <div className="form-field">
                    <label>
                      {selectedDetails.v1 ? `Value 1 (${selectedDetails.v1})` : 'Value 1 (cau_val1)'}
                    </label>
                    <input
                      type="number"
                      value={selectedCausality.cau_val1 ?? 0}
                      onChange={(e) => updateSelectedCausality({ ...selectedCausality, cau_val1: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-field">
                    <label>
                      {selectedDetails.v2 ? `Value 2 (${selectedDetails.v2})` : 'Value 2 (cau_val2)'}
                    </label>
                    <input
                      type="number"
                      value={selectedCausality.cau_val2 ?? 0}
                      onChange={(e) => updateSelectedCausality({ ...selectedCausality, cau_val2: Number(e.target.value) })}
                    />
                  </div>

                  <div className="form-field">
                    <label>
                      {selectedDetails.v3 ? `Value 3 (${selectedDetails.v3})` : 'Value 3 (cau_val3)'}
                    </label>
                    <input
                      type="number"
                      value={selectedCausality.cau_val3 ?? 0}
                      onChange={(e) => updateSelectedCausality({ ...selectedCausality, cau_val3: Number(e.target.value) })}
                    />
                  </div>
                </div>
              </div>
            ) : (
              <div className="empty-tab mini">
                <AlertCircle size={28} />
                <p>Select a condition from the list or search to start editing.</p>
              </div>
            )}

            {/* Create New Causality Card */}
            <div className="edit-card" style={{ padding: '16px' }}>
              <div className="section-bar space-between">
                <div className="bar-left">
                  <Plus size={16} />
                  <strong>➕ Create New Causality Record (Next ID: #{nextId})</strong>
                </div>
              </div>

              {createStatus && (
                <div className={`status-banner ${createStatus.type}`} style={{ margin: '8px 0', padding: '8px', borderRadius: '6px', fontSize: '12px' }}>
                  {createStatus.text}
                </div>
              )}

              <form onSubmit={handleCreateNew} style={{ marginTop: '10px' }}>
                <div className="fields-grid-2">
                  <div className="form-field">
                    <label>New Causality ID</label>
                    <input
                      type="number"
                      value={newCausId}
                      onChange={(e) => setNewCausId(e.target.value)}
                      placeholder="Suggested ID..."
                      required
                    />
                  </div>

                  <div className="form-field">
                    <label>Causality Type</label>
                    <select
                      value={newCausType}
                      onChange={(e) => setNewCausType(Number(e.target.value))}
                    >
                      {meta?.causality && Object.entries(meta.causality).map(([id, name]) => (
                        <option key={id} value={id}>[{id}] {name}</option>
                      ))}
                    </select>
                  </div>
                </div>

                {newTypeDetails.desc && (
                  <div className="hint-card" style={{ background: '#091528', border: '1px solid #1e3a5f', padding: '8px 12px', borderRadius: '6px', margin: '8px 0' }}>
                    <div style={{ fontSize: '10.5px', color: '#60a5fa', fontWeight: 700 }}>
                      ℹ️ {newTypeDetails.desc}
                    </div>
                  </div>
                )}

                <div className="fields-grid-3" style={{ marginTop: '10px' }}>
                  <div className="form-field">
                    <label>{newTypeDetails.v1 ? `Value 1 (${newTypeDetails.v1})` : 'Value 1'}</label>
                    <input
                      type="number"
                      value={newVal1}
                      onChange={(e) => setNewVal1(Number(e.target.value))}
                    />
                  </div>
                  <div className="form-field">
                    <label>{newTypeDetails.v2 ? `Value 2 (${newTypeDetails.v2})` : 'Value 2'}</label>
                    <input
                      type="number"
                      value={newVal2}
                      onChange={(e) => setNewVal2(Number(e.target.value))}
                    />
                  </div>
                  <div className="form-field">
                    <label>{newTypeDetails.v3 ? `Value 3 (${newTypeDetails.v3})` : 'Value 3'}</label>
                    <input
                      type="number"
                      value={newVal3}
                      onChange={(e) => setNewVal3(Number(e.target.value))}
                    />
                  </div>
                </div>

                <div style={{ marginTop: '14px', textAlign: 'right' }}>
                  <button type="submit" className="btn btn-primary btn-sm" disabled={isSaving}>
                    <Plus size={14} /> Create Causality Record
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* SUB-TAB 2: Condition Tree */}
      {activeSubTab === 'tree' && (
        <div className="causality-tree-view">
          <div className="section-intro" style={{ marginBottom: '14px' }}>
            <Network size={20} />
            <div>
              <h3>Character Condition Tree & Trigger Graph</h3>
              <p>Consolidated trigger conditions, categories, HP thresholds, and restrictions extracted across all character skills.</p>
            </div>
          </div>

          {usedConditions.length === 0 ? (
            <div className="empty-tab mini">
              <CheckCircle size={32} />
              <h4>No Special Causality Restrictions Found</h4>
              <p>All skills activate unconditionally or based on standard innate multipliers.</p>
            </div>
          ) : (
            <div className="conditions-grid" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: '12px' }}>
              {usedConditions.map((item, idx) => {
                const desc = meta?.causality?.[item.conditionId] || `Condition ID #${item.conditionId}`
                const detail = meta?.causality_details?.[item.conditionId]

                return (
                  <div key={idx} className="condition-node-card edit-card" style={{ padding: '12px' }}>
                    <div className="node-header" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '8px' }}>
                      <span className="source-tag" style={{ fontSize: '11px', color: '#94a3b8', background: '#1e293b', padding: '2px 6px', borderRadius: '4px' }}>
                        {item.source}
                      </span>
                      <button
                        type="button"
                        className="btn-text-action"
                        onClick={() => selectCausalityById(item.conditionId)}
                        title="Edit in Database Editor"
                        style={{ fontSize: '11px', color: '#38bdf8' }}
                      >
                        Inspect #{item.conditionId} <ArrowRight size={12} />
                      </button>
                    </div>

                    <div className="condition-body">
                      <strong className="condition-title" style={{ color: '#f8fafc', fontSize: '13px' }}>
                        #{item.conditionId} - {desc}
                      </strong>
                      {detail && (
                        <p className="condition-detail" style={{ fontSize: '11.5px', color: '#94a3b8', marginTop: '4px', lineHeight: 1.4 }}>
                          {detail}
                        </p>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
