import React, { useState, useRef, useEffect } from 'react'
import { Eye, Edit3, Sparkles, ArrowUp, ArrowDown, Repeat, Zap, Shield, Plus, Info } from 'lucide-react'

// Helper to format text line by converting Dokkan tags into rich JSX elements
export function formatDokkanLine(line, keyPrefix = '') {
  if (!line) return null

  // Split by known {passiveImg:...} tokens
  const tokenRegex = /(\{passiveImg:[a-zA-Z0-9_-]+\})/g
  const parts = line.split(tokenRegex)

  const elements = []
  parts.forEach((part, pIdx) => {
    const k = `${keyPrefix}_p${pIdx}`
    if (!part) return

    // 1. Tag replacements
    if (part === '{passiveImg:up_g}') {
      elements.push(
        <span key={k} className="dokkan-icon-up" title="Stat Boost">
          ▲
        </span>
      )
      return
    }
    if (part === '{passiveImg:down_y}') {
      elements.push(
        <span key={k} className="dokkan-icon-down-y" title="Stat Down (Medium)">
          ▼
        </span>
      )
      return
    }
    if (part === '{passiveImg:down_r}') {
      elements.push(
        <span key={k} className="dokkan-icon-down-r" title="Stat Down (High)">
          ▼
        </span>
      )
      return
    }
    if (part === '{passiveImg:once}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-once" title="Once Only">
          !1
        </span>
      )
      return
    }
    if (part === '{passiveImg:forever}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-forever" title="Permanent throughout battle">
          ∞
        </span>
      )
      return
    }
    if (part === '{passiveImg:atk_down}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-atkdown" title="ATK Down">
          ATK ⬇
        </span>
      )
      return
    }
    if (part === '{passiveImg:def_down}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-defdown" title="DEF Down">
          DEF ⬇
        </span>
      )
      return
    }
    if (part === '{passiveImg:stun}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-stun" title="Stun">
          STUN
        </span>
      )
      return
    }
    if (part === '{passiveImg:astute}') {
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-crit" title="Critical">
          CRIT
        </span>
      )
      return
    }
    if (part.startsWith('{passiveImg:')) {
      const tagContent = part.replace('{passiveImg:', '').replace('}', '')
      elements.push(
        <span key={k} className="dokkan-badge dokkan-badge-generic" title={tagContent}>
          {tagContent}
        </span>
      )
      return
    }

    // 2. Syntax highlighting for keywords: Ki, Categories in quotes, stats
    // Regex matches: "Category", Ki +N, ATK & DEF N%, DEF N%, ATK N%
    const kwRegex = /("(?:[^"\\]|\\.)+")|(Ki\s*[+-]\d+)|(ATK\s*&\s*DEF\s*\d+%?)|(ATK\s*\d+%?)|(DEF\s*\d+%?)|(Ki\s*Sphere[s]?)|(Super\s*Attack)|(critical\s*hit)|(Guards\s*all\s*attacks)|(Damage\s*reduction\s*rate\s*\d+%?)/gi
    const subParts = part.split(kwRegex).filter(Boolean)

    subParts.forEach((sp, spIdx) => {
      const subKey = `${k}_s${spIdx}`
      if (!sp) return

      // Category quotes
      if (sp.startsWith('"') && sp.endsWith('"')) {
        elements.push(
          <span key={subKey} className="dokkan-kw-cat">
            {sp}
          </span>
        )
      }
      // Ki +N
      else if (/^Ki\s*[+-]\d+$/i.test(sp)) {
        const numPart = sp.replace(/Ki\s*/i, '')
        elements.push(
          <span key={subKey} className="dokkan-kw-ki-group">
            <b className="dokkan-kw-ki">Ki</b> <span className="dokkan-kw-kinum">{numPart}</span>
          </span>
        )
      }
      // Stats: ATK & DEF, ATK, DEF
      else if (/^ATK\s*&\s*DEF/i.test(sp) || /^ATK\s*\d/i.test(sp) || /^DEF\s*\d/i.test(sp)) {
        elements.push(
          <b key={subKey} className="dokkan-kw-stat">
            {sp}
          </b>
        )
      }
      // Important gameplay terms
      else if (/^(Super\s*Attack|critical\s*hit|Guards\s*all\s*attacks|Ki\s*Sphere[s]?|Damage\s*reduction)/i.test(sp)) {
        elements.push(
          <span key={subKey} className="dokkan-kw-term">
            {sp}
          </span>
        )
      } else {
        elements.push(<span key={subKey}>{sp}</span>)
      }
    })
  })

  return elements
}

// In-Game Dokkan Formatted Box (Visual Preview)
export function DokkanDescriptionPreview({ text, skillName = '', skillType = 'PASSIVE SKILL' }) {
  if (!text || !text.trim()) {
    return (
      <div className="dokkan-preview-empty">
        <Info size={16} /> No description entered yet. Switch to "Edit" to type description.
      </div>
    )
  }

  const rawLines = text.split('\n')
  const renderedItems = []

  rawLines.forEach((line, lineIdx) => {
    const trimmed = line.trim()
    if (!trimmed) {
      renderedItems.push(<div key={`empty_${lineIdx}`} className="dokkan-row-spacer" />)
      return
    }

    // Condition Header: surrounded by *...* or *...
    const isHeader = (trimmed.startsWith('*') && trimmed.endsWith('*') && trimmed.length > 2) ||
                     (trimmed.startsWith('*') && !trimmed.startsWith('*-')) ||
                     /^Activates the Entrance/i.test(trimmed) ||
                     /^Basic effect/i.test(trimmed) ||
                     /^When /i.test(trimmed) && !trimmed.startsWith('-') ||
                     /^After /i.test(trimmed) && !trimmed.startsWith('-') ||
                     /^Before /i.test(trimmed) && !trimmed.startsWith('-') ||
                     /^At the start/i.test(trimmed) && !trimmed.startsWith('-')

    if (isHeader) {
      const cleanHeader = trimmed.replace(/^\*+|\*+$/g, '').trim()
      renderedItems.push(
        <div key={`head_${lineIdx}`} className="dokkan-desc-header">
          {cleanHeader}
        </div>
      )
      return
    }

    // Bullet point line (starts with - or *-)
    if (trimmed.startsWith('-') || trimmed.startsWith('•')) {
      const content = trimmed.replace(/^[-•]\s*/, '')
      renderedItems.push(
        <div key={`bullet_${lineIdx}`} className="dokkan-desc-bullet">
          <span className="dokkan-bullet-dash">-</span>
          <span className="dokkan-bullet-text">{formatDokkanLine(content, `b_${lineIdx}`)}</span>
        </div>
      )
      return
    }

    // Normal text line
    renderedItems.push(
      <div key={`line_${lineIdx}`} className="dokkan-desc-regular">
        {formatDokkanLine(trimmed, `l_${lineIdx}`)}
      </div>
    )
  })

  return (
    <div className="dokkan-preview-container">
      {skillType && <div className="dokkan-preview-banner">{skillType}</div>}
      {skillName && <div className="dokkan-preview-title">{skillName}</div>}
      <div className="dokkan-preview-body">{renderedItems}</div>
    </div>
  )
}

// Full Editor with Auto-Height Textarea, Dokkan In-Game Preview & Quick Insert Toolbar
export function DokkanDescriptionEditor({
  value = '',
  onChange,
  label = 'Skill Description',
  fieldKey = 'itemized_description',
  skillName = '',
  skillType = 'PASSIVE SKILL',
  placeholder = 'Enter skill description with {passiveImg:up_g}...',
  defaultMode = 'preview', // 'preview' | 'edit' | 'split'
  minHeight = 120
}) {
  const [mode, setMode] = useState(defaultMode)
  const textareaRef = useRef(null)

  // Auto-fit height based on scrollHeight so there is NO internal vertical scrolling!
  const adjustHeight = () => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      const newHeight = Math.max(minHeight, textareaRef.current.scrollHeight + 4)
      textareaRef.current.style.height = `${newHeight}px`
    }
  }

  useEffect(() => {
    adjustHeight()
  }, [value, mode])

  const handleChange = (e) => {
    onChange?.(e.target.value)
    adjustHeight()
  }

  // Insert helper token at current caret position
  const insertToken = (token) => {
    const ta = textareaRef.current
    if (!ta) {
      onChange?.((value || '') + token)
      return
    }
    const start = ta.selectionStart ?? value.length
    const end = ta.selectionEnd ?? value.length
    const nextVal = value.substring(0, start) + token + value.substring(end)
    onChange?.(nextVal)
    setTimeout(() => {
      ta.focus()
      ta.selectionStart = start + token.length
      ta.selectionEnd = start + token.length
      adjustHeight()
    }, 10)
  }

  return (
    <div className="dokkan-editor-card full-row">
      <div className="dokkan-editor-top">
        <div className="dokkan-editor-label">
          <Sparkles size={14} className="accent-icon" />
          <span>{label}</span>
          <code className="dokkan-field-tag">({fieldKey})</code>
        </div>

        {/* Mode Toggle Bar */}
        <div className="dokkan-mode-toggles">
          <button
            type="button"
            className={`dokkan-toggle-btn ${mode === 'preview' ? 'active' : ''}`}
            onClick={() => setMode('preview')}
            title="In-Game Dokkan Display with Icons"
          >
            <Eye size={13} />
            <span>In-Game View</span>
          </button>
          <button
            type="button"
            className={`dokkan-toggle-btn ${mode === 'edit' ? 'active' : ''}`}
            onClick={() => setMode('edit')}
            title="Edit Raw Text & Database Tags"
          >
            <Edit3 size={13} />
            <span>Edit Text</span>
          </button>
          <button
            type="button"
            className={`dokkan-toggle-btn ${mode === 'split' ? 'active' : ''}`}
            onClick={() => setMode('split')}
            title="Split: Side-by-Side In-Game View & Editor"
          >
            <Zap size={13} />
            <span>Split View</span>
          </button>
        </div>
      </div>

      {/* Quick Insert Dokkan Tags Toolbar (shown during edit or split) */}
      {(mode === 'edit' || mode === 'split') && (
        <div className="dokkan-tags-toolbar">
          <span className="toolbar-hint">Insert Dokkan Tag:</span>
          <button
            type="button"
            className="tag-insert-btn tag-up"
            onClick={() => insertToken('{passiveImg:up_g}')}
            title="Green Up Arrow: Boost ({passiveImg:up_g})"
          >
            <span className="dokkan-icon-up">▲</span> up_g
          </button>
          <button
            type="button"
            className="tag-insert-btn tag-down-y"
            onClick={() => insertToken('{passiveImg:down_y}')}
            title="Yellow Down Arrow ({passiveImg:down_y})"
          >
            <span className="dokkan-icon-down-y">▼</span> down_y
          </button>
          <button
            type="button"
            className="tag-insert-btn tag-down-r"
            onClick={() => insertToken('{passiveImg:down_r}')}
            title="Red Down Arrow ({passiveImg:down_r})"
          >
            <span className="dokkan-icon-down-r">▼</span> down_r
          </button>
          <button
            type="button"
            className="tag-insert-btn tag-badge-once"
            onClick={() => insertToken('{passiveImg:once}')}
            title="Once Only Badge ({passiveImg:once})"
          >
            <span className="dokkan-badge dokkan-badge-once">!1</span> once
          </button>
          <button
            type="button"
            className="tag-insert-btn tag-badge-forever"
            onClick={() => insertToken('{passiveImg:forever}')}
            title="Permanent Turn Badge ({passiveImg:forever})"
          >
            <span className="dokkan-badge dokkan-badge-forever">∞</span> forever
          </button>
          <button
            type="button"
            className="tag-insert-btn"
            onClick={() => insertToken('*Condition Header*\n- ')}
            title="Add Condition Header"
          >
            <Plus size={11} /> *Header*
          </button>
        </div>
      )}

      {/* Editor Content Display */}
      <div className={`dokkan-editor-content mode-${mode}`}>
        {/* In-Game Preview */}
        {(mode === 'preview' || mode === 'split') && (
          <div className="dokkan-preview-panel">
            <DokkanDescriptionPreview
              text={value}
              skillName={skillName}
              skillType={skillType}
            />
          </div>
        )}

        {/* Raw Textarea with Auto-Height */}
        {(mode === 'edit' || mode === 'split') && (
          <div className="dokkan-edit-panel">
            <textarea
              ref={textareaRef}
              className="dokkan-auto-textarea"
              value={value || ''}
              onChange={handleChange}
              placeholder={placeholder}
              rows={4}
            />
          </div>
        )}
      </div>
    </div>
  )
}
