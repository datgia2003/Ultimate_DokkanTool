export function makeBattleParamDraft(paramNo, ownerKey) {
  return {
    draft_key: ownerKey,
    param_no: Number(paramNo),
    rows: Array.from({ length: 9 }, (_, idx) => ({ idx, value: 0 }))
  }
}

export function updateBattleParamDrafts(drafts, add = [], removeKey = '') {
  const withoutRemoved = (drafts || []).filter(row => !removeKey || row.draft_key !== removeKey)
  return [...withoutRemoved, ...add]
}
