import React, { useState, useEffect } from 'react'
import { Database, Copy, Check, Save, RotateCcw, AlertTriangle, ShieldCheck } from 'lucide-react'
import { api } from '../../api'

export function TabSql({ card, draft, patchChanges, customSql = '', onChangeCustomSql, onApply, isSaving, allowDatabaseSave = true }) {
  const [sql, setSql] = useState('')
  const rawSql = customSql
  const setRawSql = onChangeCustomSql || (() => {})
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)

  // Fetch live preview SQL
  useEffect(() => {
    if (!card) return
    let active = true
    const timer = setTimeout(() => {
      setLoading(true)
      api.previewSql(card.id, patchChanges || draft, patchChanges ? '' : rawSql)
        .then((res) => {
          if (active) setSql(res.sql || '-- No pending database modifications')
        })
        .catch((err) => {
          if (active) setSql(`-- SQL generation error: ${err.message}`)
        })
        .finally(() => {
          if (active) setLoading(false)
        })
    }, 200)

    return () => { active = false; clearTimeout(timer) }
  }, [card?.id, draft, patchChanges, rawSql])

  const copyToClipboard = () => {
    navigator.clipboard.writeText(sql)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleApply = () => {
    onApply(rawSql)
  }

  return (
    <div className="tab-pane sql-pane">
      <div className="section-bar space-between">
        <div className="bar-left">
          <Database size={18} />
          <strong>SQL Patch Live Preview & Generation</strong>
        </div>
        <div className="bar-right">
          <button className="btn secondary-btn" onClick={copyToClipboard}>
            {copied ? <Check size={14} /> : <Copy size={14} />}
            <span>{copied ? 'Copied' : 'Copy SQL'}</span>
          </button>
        </div>
      </div>

      {/* SQL Output Box */}
      <div className="sql-box-wrap">
        <pre className="sql-code-view">
          {loading ? '-- Generating real-time SQL statements...' : sql}
        </pre>
      </div>

      {/* Custom SQL Input */}
      <div className="form-card">
        <div className="form-header">
          <Database size={17} />
          <strong>Custom SQL Queries & Statements</strong>
        </div>
        <p className="hint-text">
          You may append custom SQL expressions here (e.g. <code>UPDATE cards SET ...</code>). These queries are merged directly into the final patch or applied to the local SQLite database.
        </p>
        <textarea
          className="custom-sql-input"
          rows={4}
          value={rawSql}
          onChange={(e) => setRawSql(e.target.value)}
          placeholder="-- Enter custom SQL queries here..."
        />
      </div>

      {/* Safety & Apply Warning */}
      {allowDatabaseSave && <div className="apply-section-card">
        <div className="safety-badge">
          <ShieldCheck size={16} />
          <span>Safety Guard: The engine automatically snapshots SQLite database into <code>backups/</code> prior to commits.</span>
        </div>

        <button
          className="btn primary-btn large-btn"
          onClick={handleApply}
          disabled={(!Object.keys(draft).length && !rawSql) || isSaving}
        >
          <Save size={16} />
          <span>{isSaving ? 'Đang ghi Database...' : 'Ghi SQL vào Database (tùy chọn)'}</span>
        </button>
      </div>}
    </div>
  )
}
