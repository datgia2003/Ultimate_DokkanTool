import React from 'react'
import { Menu, Save, RotateCcw, GitBranch, Film, Sparkles, CheckCircle2 } from 'lucide-react'
import { GameIconBadge } from '../common/CardBadge'
import { BgmPlayer } from '../player/BgmPlayer'
import { CharacterOstPlayer } from '../player/CharacterOstPlayer'
import { api } from '../../api'
import { MusicWave } from '../player/MusicWave'

export function Header({
  card,
  ostAccent,
  language = 'vi',
  cardData,
  chain = [],
  draft = {},
  customSql = '',
  pendingFormCount = 0,
  hasAudioDraft = false,
  hasAnimationDraft = false,
  onImportCustomBgm,
  isSaving,
  onSave,
  allowDatabaseSave = true,
  onReset,
  onSelectCard,
  onToggleSidebar,
  playerOpen,
  onTogglePlayer
}) {
  if (!card) return null

  const isDirty = Object.keys(draft).length > 0 || Boolean(customSql.trim()) || hasAudioDraft || hasAnimationDraft
  const hasDatabaseChanges = Object.keys(draft).length > 0 || Boolean(customSql.trim())
  const currentName = draft.name ?? card.name

  return (
    <header className="main-header">
      <div className="header-top">
        <div className="left-controls">
          <button className="icon-btn" onClick={onToggleSidebar} title={language === 'vi' ? 'Mở danh sách thẻ' : 'Toggle character sidebar'}>
            <Menu size={18} />
          </button>
          <div className="breadcrumbs">
            <span>{language === 'vi' ? 'Nhân vật' : 'Character'}</span>
            <span className="sep">/</span>
            <strong>#{card.id}</strong>
          </div>
        </div>

        {/* Global Dokkan BGM Jukebox Center Bar */}
        <div className="header-center-tools">
          <BgmPlayer accent={ostAccent} language={language} onImportCustomBgm={onImportCustomBgm} />
        </div>

        <div className="right-actions">
          {pendingFormCount > 0 && (
            <span className="unsaved-badge">
              <span className="dot" /> Bản nháp: {pendingFormCount} form
            </span>
          )}

          <button
            className="btn secondary-btn"
            onClick={onReset}
            disabled={!isDirty || isSaving}
            title={language === 'vi' ? 'Hủy thay đổi bản nháp' : 'Revert all unsaved draft changes'}
          >
            <RotateCcw size={14} />
            <span>{language === 'vi' ? 'Hoàn tác' : 'Revert'}</span>
          </button>

          {allowDatabaseSave && <button
            className="btn primary-btn"
            onClick={onSave}
            disabled={!hasDatabaseChanges || isSaving}
            title="Tùy chọn: chỉ lưu form hiện tại vào database; xuất patch dùng được ngay từ bản nháp"
          >
            <Save size={15} />
            <span>{isSaving ? (language === 'vi' ? 'Đang lưu…' : 'Saving…') : (language === 'vi' ? 'Lưu DB (tùy chọn)' : 'Save DB (optional)')}</span>
          </button>}

          <button 
            className={`btn toggle-player-btn ${playerOpen ? 'active' : ''}`}
            onClick={onTogglePlayer}
            title={language === 'vi' ? 'Xem animation và âm thanh' : 'Preview animation and audio'}
          >
            <Film size={15} />
          </button>
        </div>
      </div>

      {/* Card Info Banner */}
      <div className="card-banner">
        <div className="banner-visualizer" aria-hidden="true">
          <div className="banner-visualizer-orb">{Array.from({ length: 7 }, (_, i) => <i key={i} />)}</div>
          <MusicWave />
        </div>
        <div className="avatar-frame">
          <img
            src={api.getThumbUrl(card.id)}
            alt={card.name}
            onError={(e) => { e.currentTarget.style.display = 'none' }}
          />
        </div>

        <div className="banner-details">
          <h1 className="card-title">{currentName}</h1>
          <div className="banner-identity-row">
            <div className="banner-game-icons">
              <GameIconBadge kind="rarity" value={draft.rarity ?? card.rarity} />
              <GameIconBadge kind="element" value={draft.element ?? card.element} />
            </div>
            <div className="banner-tags">
              <span className="id-tag"><span>ID</span><strong>{card.id}</strong></span>
              <span className="id-tag"><span>Character</span><strong>{draft.character_id ?? card.character_id}</strong></span>
              <span className="cost-tag"><span>Cost</span><strong>{draft.cost ?? card.cost}</strong></span>
            </div>
          </div>
        </div>
        {chain.length > 1 && (
          <div className="chain-switcher">
            <span className="chain-label"><GitBranch size={14} /> FORMS</span>
            <div className="chain-nodes">
              {chain.map((node, index) => {
                const isCurrent = node.id === card.id
                return <React.Fragment key={node.id}>
                  <button className={`chain-node ${isCurrent ? 'current' : ''}`}
                    onClick={() => onSelectCard(node.id)} title={`Switch to: ${node.name} (#${node.id})`}>
                    <img src={api.getThumbUrl(node.id)} alt={node.name}
                      onError={(e) => { e.currentTarget.style.display = 'none' }} />
                    <span className="node-text"><small>{index === 0 ? 'Base' : `Form ${index}`}</small><strong>#{node.id}</strong></span>
                  </button>
                  {index < chain.length - 1 && <span className="chain-arrow">➜</span>}
                </React.Fragment>
              })}
            </div>
          </div>
        )}
        <CharacterOstPlayer cardData={cardData} draft={draft} accent={ostAccent} language={language} />
      </div>
    </header>
  )
}
