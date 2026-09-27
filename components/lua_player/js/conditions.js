
export const CONDITION_DEFS = [
  { key: '_IS_PLAYER_SIDE_', label: 'Player side', default: 1 },
  { key: '_IS_DODGE_', label: 'Dodge / counter', default: 0 },
  // Embedded previews set these from the shared K.O. Screen toggle.
  { key: '_IS_DEAD_', label: 'Dead', default: 0 },
  { key: '_IS_DEAD_LAST_', label: 'Dead last / K.O.', default: 0 },
  { key: '_IS_CRITICAL_', label: 'Critical', default: 0 },
  { key: '_IS_GUARD_', label: 'Guard', default: 0 },
  { key: '_IS_EXTRA_ATTACK_', label: 'Extra attack', default: 0 },
  { key: '_IS_KI_100_', label: 'Ki 100%', default: 0 },
  { key: '_IS_DOKKAN_MODE_', label: 'Dokkan mode', default: 0 },
  { key: '_IS_SPECIAL_ATTACK_', label: 'Special attack', default: 0 },
  { key: '_IS_SPECIAL_AIM_ALL_', label: 'Special aim all', default: 0 },
  { key: '_IS_FINISH_SPECIAL_ONLY_', label: 'Finish special only', default: 0 },
  { key: '_IS_ATK_FLASH_MOVE_END_', label: 'Atk flash move end', default: 0 },
  { key: '_IS_DFC_FLASH_MOVE_END_', label: 'Dfc flash move end', default: 0 },
  { key: '_IS_SKIP_', label: 'Skip', default: 0 },
  { key: '_IS_ZAWAKEN_', label: 'Z-Awaken', default: 0 },
  { key: '_IS_COSTUME_CHANGE_', label: 'Costume change', default: 0 },
  {
    key: '_SPECIAL_SKILL_LEVEL_',
    label: 'Special skill level',
    default: 0,
    type: 'select',
    options: [
      { value: 0, label: '0 — Normal / Ex (ef_008 · ef_008ex)' },
      { value: 1, label: '1 — EZA / Ex-EZA (ef_001 · ef_001ex)' },
      { value: 2, label: '2 — SEZA / Ex-SEZA (ef_002 · ef_002ex)' },
    ],
  },
];

export function detectUsedConditions(scriptText) {
  const used = new Set();
  const text = String(scriptText || '');
  for (const def of CONDITION_DEFS) {
    if (text.includes(def.key)) used.add(def.key);
  }
  if (
    text.includes('showCardCutin') ||
    text.includes('showCardCutinEx') ||
    text.includes('showCardCutinOffset')
  ) {
    used.add('_SPECIAL_SKILL_LEVEL_');
  }
  return used;
}

export function cutinHelperHint(scriptText) {
  const text = String(scriptText || '');
  const usesNormal = /(^|[^A-Za-z0-9_])showCardCutin\s*\(/.test(text);
  const usesEx = /(^|[^A-Za-z0-9_])showCardCutinEx\s*\(/.test(text);
  const usesOffset = /(^|[^A-Za-z0-9_])showCardCutinOffset\s*\(/.test(text);
  if (!usesNormal && !usesEx && !usesOffset) return '';
  const parts = [];
  if (usesNormal) parts.push('showCardCutin → ef_008 / ef_001 / ef_002');
  if (usesEx) parts.push('showCardCutinEx → ef_008ex / ef_001ex / ef_002ex');
  if (usesOffset) parts.push('showCardCutinOffset → ef_008c + name offset');
  return parts.join(' · ');
}

export function mountConditionList(root, { used, values, onChange }) {
  root.innerHTML = '';
  for (const def of CONDITION_DEFS) {
    const row = document.createElement('label');
    const isUsed = used.has(def.key);
    row.className = `condition ${isUsed ? 'used' : 'unused'}`;
    row.title = isUsed
      ? 'Referenced by this script'
      : 'Unused by this script — toggle to force that branch, then Play';

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = def.key;

    const lab = document.createElement('span');
    lab.textContent = def.label;

    if (def.type === 'select') {
      const sel = document.createElement('select');
      sel.dataset.key = def.key;
      for (const opt of def.options || []) {
        const o = document.createElement('option');
        o.value = String(opt.value);
        o.textContent = opt.label;
        sel.append(o);
      }
      const cur = Number(values[def.key] ?? def.default);
      sel.value = String(Number.isFinite(cur) ? cur : def.default);
      sel.addEventListener('change', () => {
        values[def.key] = Number(sel.value) || 0;
        onChange?.(def.key, values[def.key]);
      });
      row.append(sel, name, lab);
    } else {
      const cb = document.createElement('input');
      cb.type = 'checkbox';
      cb.checked = Number(values[def.key] ?? def.default) === 1;
      cb.dataset.key = def.key;
      cb.addEventListener('change', () => {
        values[def.key] = cb.checked ? 1 : 0;
        onChange?.(def.key, values[def.key]);
      });
      row.append(cb, name, lab);
    }

    root.append(row);
    if (!(def.key in values)) values[def.key] = def.default;
  }
}

export function defaultConditionValues() {
  const values = {};
  for (const def of CONDITION_DEFS) values[def.key] = def.default;
  return values;
}
