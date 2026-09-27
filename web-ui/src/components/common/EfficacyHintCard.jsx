import React from 'react'
import { HelpCircle, Info, BookOpen, AlertCircle } from 'lucide-react'

export function EfficacyHintCard({ effType, meta, compact = false }) {
  if (!effType) return null
  const details = meta?.efficacy_details?.[effType]
  if (!details) return null

  const hasDesc = Boolean(details.desc && details.desc.trim())
  const hasV1 = Boolean(details.v1 && details.v1.trim() && details.v1.toLowerCase() !== 'nan')
  const hasV2 = Boolean(details.v2 && details.v2.trim() && details.v2.toLowerCase() !== 'nan')
  const hasV3 = Boolean(details.v3 && details.v3.trim() && details.v3.toLowerCase() !== 'nan')
  const hasNotes = Boolean(details.notes && details.notes.trim() && details.notes.toLowerCase() !== 'nan')
  const hasVals = Boolean(details.vals && details.vals.trim() && details.vals.toLowerCase() !== 'nan')

  if (!hasDesc && !hasV1 && !hasV2 && !hasV3 && !hasNotes && !hasVals) return null

  if (compact) {
    return (
      <div className="efficacy-hint-compact">
        <Info size={12} className="hint-icon" />
        <span className="hint-text">{details.desc || 'Xem chi tiết thông số bên dưới'}</span>
      </div>
    )
  }

  return (
    <div className="efficacy-hint-card">
      <div className="hint-card-header">
        <BookOpen size={13} />
        <strong>Hướng dẫn điền thông số hiệu ứng (Efficacy #{effType})</strong>
      </div>

      {hasDesc && (
        <div className="hint-card-desc">
          <span className="hint-label">Mô tả hiệu ứng:</span> {details.desc}
        </div>
      )}

      {(hasV1 || hasV2 || hasV3) && (
        <div className="hint-card-values-guide">
          <div className="guide-title">Gợi ý điền các ô Value:</div>
          <div className="guide-chips">
            {hasV1 && (
              <span className="val-guide-chip v1">
                <b>Value 1:</b> {details.v1}
              </span>
            )}
            {hasV2 && (
              <span className="val-guide-chip v2">
                <b>Value 2:</b> {details.v2}
              </span>
            )}
            {hasV3 && (
              <span className="val-guide-chip v3">
                <b>Value 3:</b> {details.v3}
              </span>
            )}
          </div>
        </div>
      )}

      {hasVals && (
        <div className="hint-card-row">
          <span className="hint-label">Định dạng mảng JSON:</span>
          <code>{details.vals}</code>
        </div>
      )}

      {hasNotes && (
        <div className="hint-card-notes">
          <Info size={12} />
          <span><b>Lưu ý:</b> {details.notes}</span>
        </div>
      )}
    </div>
  )
}
