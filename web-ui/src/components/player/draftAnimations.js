// Project only animation fields so stat/description edits do not restart playback.
export function draftAnimationReferences(cardData, draft) {
  const references = []
  const replaceSlots = []
  const deleted = draft.deleted_rows || []
  const alive = (table, row) => !deleted.some(item => item.table === table && Number(item.id) === Number(row.id))
  const add = (slot, key, id, name, bgm_id, move_tag) => {
    if (Number(id) > 0) references.push({ slot, key, id: Number(id), name, move_tag, ...(bgm_id == null ? {} : { bgm_id }) })
  }
  if ('passive_skills' in draft || deleted.some(r => r.table === 'passive_skills')) {
    replaceSlots.push('entrance')
    ;(draft.passive_skills ?? cardData?.passive?.skills ?? []).forEach((row, i) => {
      if (alive('passive_skills', row)) add('entrance', `passive:${row.id ?? i}`, row.passive_skill_effect_id, row.name || 'Entrance / Passive Effect')
    })
  }
  for (const slot of ['active', 'standby']) {
    if (`${slot}_set` in draft) {
      replaceSlots.push(slot)
      const set = draft[`${slot}_set`]
      if (set) {
        add(slot, `${slot}:main`, set.special_view_id, set.name || slot, set.bgm_id)
        add(slot, `${slot}:costume`, set.costume_special_view_id, `${set.name || slot} · Costume`, set.bgm_id)
      }
    }
  }
  if ('card_specials' in draft || deleted.some(r => r.table === 'card_specials')) {
    replaceSlots.push('super')
    ;(draft.card_specials ?? cardData?.specials ?? []).forEach((row, i) => {
      if (!alive('card_specials', row)) return
      const key = `super:${row.id ?? i}`
      const name = row.special_set?.name || 'Super Attack'
      const tag = row.style === 'Extra' || row.extra_special_option ? 'EX SA'
        : `${row.style === 'Hyper' || Number(row.eball_num_start) >= 18 ? 'Ultra SA' : 'SA'}${row.style === 'Condition' ? ' · Conditional' : ''}`
      add('super', key, row.view_id, name, row.extra_special_option?.bgm_id, tag)
      add('super', `${key}:bonus1`, row.bonus_view_id1, `${name} · Bonus 1`, undefined, 'Bonus 1')
      add('super', `${key}:bonus2`, row.bonus_view_id2, `${name} · Bonus 2`, undefined, 'Bonus 2')
    })
  }
  if ('finish_skill_sets' in draft || deleted.some(r => r.table === 'finish_skill_sets')) {
    replaceSlots.push('finish')
    ;(draft.finish_skill_sets ?? cardData?.finish ?? []).forEach((row, i) => {
      const set = row.set
      if (!set || !alive('finish_skill_sets', set)) return
      const key = `finish:${set.id ?? i}`
      add('finish', key, set.special_view_id, set.name || 'Finish Skill', set.bgm_id)
      add('finish', `${key}:costume`, set.costume_special_view_id, `${set.name || 'Finish Skill'} · Costume`, set.bgm_id)
    })
  }
  return { references, replaceSlots }
}
