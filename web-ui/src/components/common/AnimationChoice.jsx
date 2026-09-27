import React from 'react'
import { api } from '../../api'
import { RARITIES } from './AnimationBrowserControls'

export function AnimationChoice({ cardId, cardName, title, detail, tag, rarity, selected, disabled, onClick }) {
  return <button type="button" className={`animation-choice ${selected ? 'selected' : ''}`}
    aria-pressed={Boolean(selected)} disabled={disabled} onClick={onClick}>
    <img className="animation-choice-thumb" src={api.getThumbUrl(cardId)} alt={cardName || `Thẻ #${cardId}`}
      loading="lazy" onError={e => { e.currentTarget.style.visibility = 'hidden' }} />
    <span className="animation-choice-text">
      <strong>{title || cardName}</strong>
      {(tag || RARITIES[rarity]) && <span className="animation-choice-tags">{tag && <b title="SA: Super Attack · Ultra SA: Ultra Super Attack · EX SA: EX Super Attack">{tag}</b>}{RARITIES[rarity] && <b>{RARITIES[rarity]}</b>}</span>}
      <span>{cardName} · #{cardId}</span>
      {detail && <small>{detail}</small>}
    </span>
  </button>
}
