import React from 'react'

export const RARITIES = ['N', 'R', 'SR', 'SSR', 'UR', 'LR']

export function AnimationSearchFilter({ value, onChange, source = false, language = 'vi' }) {
  const vi = language !== 'en'
  return <label className="animation-rarity-filter">{vi ? 'Tìm theo' : 'Search by'}
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="card_name">{vi ? 'Tên thẻ' : 'Card name'}</option>
      <option value="card_id">{vi ? 'ID thẻ' : 'Card ID'}</option>
      <option value="move_name">{vi ? 'Tên chiêu' : 'Move name'}</option>
      {!source && <option value="animation_id">{vi ? 'ID animation' : 'Animation ID'}</option>}
      {!source && <option value="script">{vi ? 'Tên Lua' : 'Lua name'}</option>}
    </select>
  </label>
}

export function AnimationRarityFilter({ value, onChange, language = 'vi' }) {
  const vi = language !== 'en'
  return <label className="animation-rarity-filter">{vi ? 'Độ hiếm' : 'Rarity'}
    <select value={value} onChange={e => onChange(e.target.value)}>
      <option value="">{vi ? 'Tất cả rarity' : 'All rarities'}</option>
      {RARITIES.map((name, index) => <option key={name} value={index}>{name}</option>)}
    </select>
  </label>
}

export function AnimationPagination({ page, totalPages, total, loading, onChange, language = 'vi' }) {
  const vi = language !== 'en'
  return <div className="animation-pagination">
    <span>{vi ? `${total.toLocaleString()} kết quả · Trang ${page}/${totalPages}` : `${total.toLocaleString()} results · Page ${page}/${totalPages}`}</span>
    <button type="button" className="btn secondary-btn" disabled={loading || page <= 1} onClick={() => onChange(page - 1)}>{vi ? 'Trước' : 'Previous'}</button>
    <label>{vi ? 'Đến trang' : 'Go to page'} <input aria-label={vi ? 'Đến trang kết quả' : 'Go to results page'} type="number" min="1" max={totalPages} value={page} disabled={loading}
      onChange={e => { const n = Number(e.target.value); if (n >= 1 && n <= totalPages) onChange(n) }} /></label>
    <button type="button" className="btn secondary-btn" disabled={loading || page >= totalPages} onClick={() => onChange(page + 1)}>{vi ? 'Sau' : 'Next'}</button>
  </div>
}
