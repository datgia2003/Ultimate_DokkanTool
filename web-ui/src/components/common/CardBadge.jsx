import React, { useState } from 'react'
import { RARITY_MAP, getElementMeta } from '../../types'

export function GameIconBadge({ kind, value }) {
  const [failedUrl, setFailedUrl] = useState('')
  const url = `/api/v2/game-badge/${kind}/${Number(value)}?v=1`
  const label = kind === 'rarity' ? RARITY_MAP[value]?.label || `Rarity ${value}` : getElementMeta(value).fullName
  return <span className={`game-icon-badge game-icon-${kind}`} title={label}>
    {failedUrl === url ? <span>{label}</span> : <img src={url} alt={label} onError={() => setFailedUrl(url)} />}
  </span>
}

export function RarityBadge({ rarity }) {
  const meta = RARITY_MAP[rarity] || { label: `Rarity ${rarity}`, color: '#fff', bg: '#4a5568' }
  return (
    <span 
      className="badge-rarity"
      style={{
        background: meta.bg,
        color: '#fff',
        boxShadow: meta.glow ? `0 0 10px ${meta.glow}` : 'none'
      }}
    >
      {meta.label}
    </span>
  )
}

export function ElementBadge({ element }) {
  const meta = getElementMeta(element)
  return (
    <span 
      className="badge-element"
      style={{
        border: `1px solid ${meta.color}50`,
        color: meta.color,
        background: `${meta.color}15`
      }}
    >
      <span className="dot" style={{ background: meta.color }} />
      {meta.fullName}
    </span>
  )
}
