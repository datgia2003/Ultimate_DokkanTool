// Dokkan Battle Types & Design Constants

export const RARITY_MAP = {
  5: { label: 'LR', color: '#ffd700', bg: 'linear-gradient(135deg, #f72585, #7209b7, #4cc9f0)', glow: '#f7258580' },
  4: { label: 'UR', color: '#ffb703', bg: 'linear-gradient(135deg, #fb8500, #ffb703)', glow: '#fb850060' },
  3: { label: 'SSR', color: '#e63946', bg: 'linear-gradient(135deg, #e63946, #d90429)', glow: '#e6394650' },
  2: { label: 'SR', color: '#a8dadc', bg: '#457b9d', glow: '#457b9d30' },
  1: { label: 'R', color: '#8d99ae', bg: '#2b2d42', glow: '#2b2d4230' },
  0: { label: 'N', color: '#6c757d', bg: '#212529', glow: '#21252930' },
}

export const ELEMENT_TYPES = [
  { id: 'all', label: 'All Types', color: '#9aa4b4' },
  { id: 'super', label: 'Super Class', color: '#4cc9f0' },
  { id: 'extreme', label: 'Extreme Class', color: '#f72585' },
  { id: 'agl', label: 'AGL (Agility)', color: '#3a86ff' },
  { id: 'teq', label: 'TEQ (Technique)', color: '#06d6a0' },
  { id: 'int', label: 'INT (Intelligence)', color: '#8338ec' },
  { id: 'str', label: 'STR (Strength)', color: '#e63946' },
  { id: 'phy', label: 'PHY (Physical)', color: '#ffbe0b' },
]

export function getElementMeta(elementId) {
  const n = Number(elementId) || 0
  const isExtreme = n >= 20
  const isSuper = n >= 10 && n < 20
  const classPrefix = isExtreme ? 'Extreme ' : isSuper ? 'Super ' : ''
  const typeIndex = n % 10
  const types = ['AGL', 'TEQ', 'INT', 'STR', 'PHY']
  const typeCode = types[typeIndex] || `Type ${n}`
  
  const colors = {
    AGL: '#3a86ff',
    TEQ: '#06d6a0',
    INT: '#9d4edd',
    STR: '#ff3366',
    PHY: '#ffbe0b'
  }

  return {
    fullName: classPrefix + typeCode,
    typeCode,
    isSuper,
    isExtreme,
    color: colors[typeCode] || '#a0aec0',
    bg: isExtreme ? 'linear-gradient(135deg, #480ca8, #7209b7)' : isSuper ? 'linear-gradient(135deg, #0077b6, #0096c7)' : '#2d3748'
  }
}

export const TABS = [
  { id: 'stats', label: 'Card Profile', icon: 'Activity', desc: 'Card stats, rarity, type, cost, and level', descVi: 'Chỉ số, độ hiếm, hệ, cost và level của thẻ' },
  { id: 'leader', label: 'Leader Skill', icon: 'Crown', desc: 'Leader effects, stat boosts, and categories', descVi: 'Hiệu ứng, chỉ số tăng và category của Leader Skill' },
  { id: 'passive', label: 'Passive Skill', icon: 'Zap', desc: 'Passive effects, conditions, and effect lines', descVi: 'Hiệu ứng, điều kiện và các dòng Passive Skill' },
  { id: 'active', label: 'Active Skill', icon: 'Flame', desc: 'Active Skill conditions, animations, and attacks', descVi: 'Điều kiện, hoạt ảnh và đòn đánh của Active Skill' },
  { id: 'animation-convert', label: 'Animation Transfer', icon: 'ArrowRightLeft', desc: 'Copy Entrance, Active, Super, or Finish animations from another card', descVi: 'Chuyển Entrance, Active, Super hoặc Finish từ thẻ khác' },
  { id: 'lua-studio', label: 'Lua Timeline', icon: 'Clapperboard', desc: 'Cut, combine, edit, and stage custom animation Lua scripts', descVi: 'Cắt, ghép, sửa và thêm script Lua animation custom vào patch' },
  { id: 'transform', label: 'Transformations', icon: 'GitBranch', desc: 'Transformation chain, form links, and descriptions', descVi: 'Chuỗi biến hình, liên kết form và mô tả' },
  { id: 'specials', label: 'Super Attacks', icon: 'Disc', desc: 'Super Attack sets, effects, multipliers, and EX options', descVi: 'Bộ Super Attack, hiệu ứng, hệ số sát thương và EX option' },
  { id: 'standby', label: 'Standby Skill', icon: 'Shield', desc: 'Standby phase, charge conditions, and support effects', descVi: 'Standby, điều kiện tích charge và hiệu ứng hỗ trợ' },
  { id: 'finish', label: 'Finish Attack', icon: 'Target', desc: 'Finish attacks, charge count, and damage scaling', descVi: 'Finish Attack, số charge và hệ số sát thương' },
  { id: 'causality', label: 'Causality Logic', icon: 'Network', desc: 'Causality conditions and trigger logic', descVi: 'Điều kiện Causality và logic kích hoạt' },
  { id: 'fields', label: 'Domain & Fields', icon: 'Sliders', desc: 'Domain effects, field resources, and sound IDs', descVi: 'Hiệu ứng Domain, tài nguyên field và ID âm thanh' },
  { id: 'sql', label: 'SQL Live Patch', icon: 'Database', desc: 'Review generated SQL and optionally save changes to the database', descVi: 'Xem SQL được tạo và tùy chọn lưu vào database' },
  { id: 'export', label: 'Export Patch (.eclp)', icon: 'PackageCheck', desc: 'Package the mod as a ZIP or build an Eclipse patch', descVi: 'Đóng gói mod thành ZIP hoặc tạo patch Eclipse' },
]
