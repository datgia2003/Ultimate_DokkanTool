import React, { useState, useEffect, useMemo, useRef } from 'react'
import {
  Activity, Crown, Zap, Flame, GitBranch, Disc, Shield, Target,
  Network, Sliders, Database, PackageCheck, AlertCircle, CheckCircle2, X, Users, ArrowRightLeft, ChevronLeft, ChevronRight, Film, Clapperboard
} from 'lucide-react'

import { Sidebar } from './components/layout/Sidebar'
import { Header } from './components/layout/Header'
import { MusicWave } from './components/player/MusicWave'
import { BgmPlayer } from './components/player/BgmPlayer'
import { AnimPlayer } from './components/player/AnimPlayer'
import { CardArtViewer } from './components/common/CardArtViewer'

import { TabStats } from './components/tabs/TabStats'
import { TabLeader } from './components/tabs/TabLeader'
import { TabPassive } from './components/tabs/TabPassive'
import { PassiveScrollRail } from './components/common/PassiveScrollRail'
import { TabActive } from './components/tabs/TabActive'
import { TabTransform } from './components/tabs/TabTransform'
import { TabSpecials } from './components/tabs/TabSpecials'
import { TabStandby } from './components/tabs/TabStandby'
import { TabFinish } from './components/tabs/TabFinish'
import { TabCausality } from './components/tabs/TabCausality'
import { TabFields } from './components/tabs/TabFields'
import { TabSql } from './components/tabs/TabSql'
import { TabExport } from './components/tabs/TabExport'
import { TabAnimationConvert } from './components/tabs/TabAnimationConvert'
import { LuaAnimationStudio } from './components/tabs/LuaAnimationStudio'

import { TABS, getElementMeta } from './types'
import { api, setModWorkspace } from './api'
import './styles.css'

const TAB_ICONS = {
  Activity, Crown, Zap, Flame, GitBranch, Disc, Shield, Target,
  Network, Sliders, Database, PackageCheck, ArrowRightLeft, Clapperboard
}
const EMPTY_DRAFT = {}

export function App() {
  const [importedMod, setImportedMod] = useState(null)
  const [importBusy, setImportBusy] = useState(false)
  const [importError, setImportError] = useState('')
  const baseWorkspaceRef = useRef(null)

  const [selectedId, setSelectedId] = useState(null) // Do not auto-load any card on initial open
  const [activeTab, setActiveTab] = useState('stats')
  const [luaEditorMode, setLuaEditorMode] = useState(false)
  const [luaPreviewAnimation, setLuaPreviewAnimation] = useState(null)
  const [luaTimelinePlayback, setLuaTimelinePlayback] = useState(null)
  const [cardData, setCardData] = useState(null)
  const [meta, setMeta] = useState(null)
  const [metaError, setMetaError] = useState('')
  const [draftsByCard, setDraftsByCard] = useState({})
  const [customSqlByCard, setCustomSqlByCard] = useState({})
  const [animationAssetsByCard, setAnimationAssetsByCard] = useState({})
  const [audioAssetsByCard, setAudioAssetsByCard] = useState({})
  const [unassignedAudioAssets, setUnassignedAudioAssets] = useState([])
  const [latestAnimationByCard, setLatestAnimationByCard] = useState({})
  const [convertedAnimationsByCard, setConvertedAnimationsByCard] = useState({})
  const draft = draftsByCard[selectedId] || EMPTY_DRAFT
  const customSql = customSqlByCard[selectedId] || ''
  const pendingFormCount = new Set([
    ...Object.entries(draftsByCard).filter(([, value]) => Object.keys(value || {}).length).map(([id]) => id),
    ...Object.entries(customSqlByCard).filter(([, value]) => value?.trim()).map(([id]) => id),
    ...Object.entries(animationAssetsByCard).filter(([, value]) => value?.length).map(([id]) => id),
    ...Object.entries(audioAssetsByCard).filter(([, value]) => value?.length).map(([id]) => id)
  ]).size
  const patchChanges = useMemo(() => ({
    ...draft, _form_drafts: draftsByCard, _form_custom_sql: customSqlByCard,
    _form_animation_assets: animationAssetsByCard, _form_audio_assets: audioAssetsByCard
  }), [draft, draftsByCard, customSqlByCard, animationAssetsByCard, audioAssetsByCard])
  
  const [sidebarOpen, setSidebarOpen] = useState(true) // Sidebar open by default to select character
  const [performanceMode, setPerformanceMode] = useState(() => localStorage.getItem('dokkan.performanceMode') === 'true')
  const [language, setLanguage] = useState(() => localStorage.getItem('dokkan.language') || 'vi')
  const [playerOpen, setPlayerOpen] = useState(() => localStorage.getItem('dokkan.performanceMode') !== 'true')
  const [cardArtOpen, setCardArtOpen] = useState(() => localStorage.getItem('dokkan.performanceMode') !== 'true')
  
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [toast, setToast] = useState(null)
  const [passiveMatches, setPassiveMatches] = useState({})
  const editorScrollRef = useRef(null)
  const tabNavigationRef = useRef(null)
  const [tabNavigationMetrics, setTabNavigationMetrics] = useState({ overflow: false, canScrollLeft: false, canScrollRight: false })

  useEffect(() => {
    const element = tabNavigationRef.current
    if (!element) return

    const updateMetrics = () => {
      const maxScroll = Math.max(0, element.scrollWidth - element.clientWidth)
      setTabNavigationMetrics({
        overflow: maxScroll > 1,
        canScrollLeft: element.scrollLeft > 1,
        canScrollRight: element.scrollLeft < maxScroll - 1
      })
    }

    updateMetrics()
    element.addEventListener('scroll', updateMetrics, { passive: true })
    window.addEventListener('resize', updateMetrics)
    let resizeObserver
    if (typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(updateMetrics)
      resizeObserver.observe(element)
      Array.from(element.children).forEach((child) => resizeObserver.observe(child))
    }
    return () => {
      element.removeEventListener('scroll', updateMetrics)
      window.removeEventListener('resize', updateMetrics)
      resizeObserver?.disconnect()
    }
  }, [language, cardData])

  const scrollTabs = (direction) => {
    const element = tabNavigationRef.current
    if (!element) return
    element.scrollBy({ left: direction * Math.max(180, element.clientWidth * 0.65), behavior: 'smooth' })
  }

  // 1. Fetch Metadata (Categories, Elements, Causality rules) once
  const reloadMeta = () => {
    setMetaError('')
    return api.getMeta()
      .then((data) => {
        if (!data?.efficacy_types || Object.keys(data.efficacy_types).length === 0) {
          throw new Error('API không trả danh sách Efficacy Type')
        }
        setMeta(data)
        return data
      })
      .catch((err) => {
        setMetaError(err.message)
        console.error('Failed to load metadata:', err)
      })
  }

  useEffect(() => {
    let cancelled = false
    let retryTimer
    const loadWithRetry = async (attemptsLeft) => {
      const data = await reloadMeta()
      if (!cancelled && !data && attemptsLeft > 1) {
        retryTimer = setTimeout(() => loadWithRetry(attemptsLeft - 1), 2000)
      }
    }
    loadWithRetry(10)
    return () => {
      cancelled = true
      clearTimeout(retryTimer)
    }
  }, [])

  useEffect(() => {
    api.getHealth().then((status) => {
      if (status.db_update?.startsWith('Đã cập nhật')) showToast('Database đã cập nhật từ server; bản cũ nằm trong backups trên ổ F.', 'success')
    }).catch(() => {})
  }, [])

  // 2. Fetch Card Details whenever selectedId changes
  useEffect(() => {
    if (!selectedId) return
    const controller = new AbortController()
    let active = true
    setIsLoading(true)
    setCardData(null)

    api.getCard(selectedId, controller.signal)
      .then((res) => {
        if (active) {
          setCardData(res)
          setIsLoading(false)
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        if (active) {
          console.error('Failed to load card:', err)
          showToast(`Error loading card data: ${err.message}`, 'error')
          setIsLoading(false)
        }
      })

    return () => { active = false; controller.abort() }
  }, [selectedId, importedMod?.id])

  useEffect(() => {
    if (activeTab !== 'passive') return
    const passive = cardData?.passive
    const description = (draft.passive_set || passive?.set)?.itemized_description || (draft.passive_set || passive?.set)?.description || ''
    const skills = passive?.skills || []
    setPassiveMatches({})
    if (!description || !skills.length) return
    let active = true
    const timer = setTimeout(() => {
      api.matchPassive(description, skills, passive?.set?.id).then((result) => {
        if (!active) return
        setPassiveMatches(Object.fromEntries((result.matches || []).map((match, index) => [skills[index]?.id, match])))
      }).catch(() => {})
    }, 300)
    return () => { active = false; clearTimeout(timer) }
  }, [activeTab, cardData?.passive, draft.passive_set])

  const showToast = (message, type = 'info') => {
    setToast({ message, type })
    setTimeout(() => setToast(null), 4000)
  }

  const handleDraftChange = (key, value) => {
    if (!selectedId) return
    setDraftsByCard((prev) => ({ ...prev, [selectedId]: { ...(prev[selectedId] || {}), [key]: value } }))
  }

  const setCustomSql = (value) => {
    if (!selectedId) return
    setCustomSqlByCard((prev) => ({ ...prev, [selectedId]: value }))
  }

  const handleResetDraft = () => {
    setDraftsByCard((prev) => {
      const next = { ...prev }
      delete next[selectedId]
      return next
    })
    setCustomSqlByCard((prev) => {
      const next = { ...prev }
      delete next[selectedId]
      return next
    })
    setAnimationAssetsByCard((prev) => {
      const next = { ...prev }
      delete next[selectedId]
      return next
    })
    setAudioAssetsByCard((prev) => {
      const next = { ...prev }
      for (const asset of next[selectedId] || []) if (asset.previewUrl) URL.revokeObjectURL(asset.previewUrl)
      delete next[selectedId]
      return next
    })
    setLatestAnimationByCard((prev) => {
      const next = { ...prev }
      delete next[selectedId]
      return next
    })
    setConvertedAnimationsByCard(prev => { const next = { ...prev }; delete next[selectedId]; return next })
    showToast('Đã hủy bản nháp của form hiện tại', 'info')
  }

  const handleSaveToDb = async (rawSql = customSql) => {
    if (!cardData?.card) return
    setIsSaving(true)

    try {
      const res = await api.applyChanges(cardData.card.id, draft, rawSql)
      showToast(`Database updated successfully! Backup: ${res.backup}`, 'success')
      // Refresh current card
      const refreshed = await api.getCard(cardData.card.id)
      setCardData(refreshed)
      setDraftsByCard((prev) => {
        const next = { ...prev }
        delete next[cardData.card.id]
        return next
      })
      setCustomSqlByCard((prev) => {
        const next = { ...prev }
        delete next[cardData.card.id]
        return next
      })
    } catch (err) {
      showToast(`Error committing to DB: ${err.message}`, 'error')
    } finally {
      setIsSaving(false)
    }
  }

  const importMod = async (file) => {
    if (!file || importBusy) return
    setImportBusy(true)
    setImportError('')
    try {
      const result = await api.importMod(file)
      baseWorkspaceRef.current = { selectedId, draftsByCard, customSqlByCard, animationAssetsByCard, audioAssetsByCard, latestAnimationByCard, convertedAnimationsByCard, activeTab }
      setModWorkspace(result.id)
      setImportedMod(result)
      setDraftsByCard({}); setCustomSqlByCard({}); setAnimationAssetsByCard({}); setAudioAssetsByCard({}); setLatestAnimationByCard({}); setConvertedAnimationsByCard({})
      setCardData(null)
      setSelectedId(result.selected_card_id || result.cards[0]?.id || null)
      setActiveTab('stats')
      setSidebarOpen(true)
    } catch (err) { setImportError(err.message) }
    finally { setImportBusy(false) }
  }
  const closeMod = () => {
    const saved = baseWorkspaceRef.current
    setModWorkspace('')
    setImportedMod(null)
    setCardData(null)
    setSelectedId(saved?.selectedId || null)
    setDraftsByCard(saved?.draftsByCard || {}); setCustomSqlByCard(saved?.customSqlByCard || {})
    setAnimationAssetsByCard(saved?.animationAssetsByCard || {}); setLatestAnimationByCard(saved?.latestAnimationByCard || {})
    setAudioAssetsByCard(saved?.audioAssetsByCard || {})
    setConvertedAnimationsByCard(saved?.convertedAnimationsByCard || {})
    setActiveTab(saved?.activeTab || 'stats')
    setImportError('')
  }

  const card = cardData?.card
  const chain = cardData?.chain || []
  const element = card ? getElementMeta(draft.element ?? card.element) : null
  const randomAccent = useMemo(() => ['#3a86ff', '#06d6a0', '#9d4edd', '#ff3366', '#ffbe0b'][Math.floor(Math.random() * 5)], [])
  const accent = element?.color || randomAccent
  const changePerformanceMode = (enabled) => {
    setPerformanceMode(enabled)
    localStorage.setItem('dokkan.performanceMode', String(enabled))
    setPlayerOpen(!enabled)
    setCardArtOpen(!enabled)
  }
  const changeLanguage = (value) => {
    setLanguage(value)
    localStorage.setItem('dokkan.language', value)
    document.documentElement.lang = value
  }
  const handleImportCustomBgm = (asset) => {
    if (!selectedId) { setUnassignedAudioAssets(prev => [...prev, asset]); return }
    setAudioAssetsByCard(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] || []), asset] }))
  }
  useEffect(() => {
    if (!selectedId || !unassignedAudioAssets.length) return
    setAudioAssetsByCard(prev => ({ ...prev, [selectedId]: [...(prev[selectedId] || []), ...unassignedAudioAssets] }))
    setUnassignedAudioAssets([])
  }, [selectedId, unassignedAudioAssets])
  useEffect(() => { document.documentElement.lang = language }, [language])
  useEffect(() => {
    setLuaEditorMode(false)
    setLuaPreviewAnimation(null)
  }, [selectedId])

  return (
    <div className="app-container" data-element={element?.typeCode?.toLowerCase() || 'neutral'}
      style={{ '--accent': accent, '--accent-2': accent, '--accent-glow': `${accent}40`, '--ost-accent': accent, '--ost-accent-soft': `${accent}24`, '--ost-accent-line': `${accent}85` }}>
      {/* Left Sidebar */}
      <Sidebar key={importedMod?.id || 'base'} importedCards={importedMod?.cards}
        importedMod={importedMod}
        importBusy={importBusy}
        importError={importError}
        onImportMod={importMod}
        onCloseMod={closeMod}
        selectedId={selectedId}
        onSelectCard={(id) => {
          setSelectedId(id)
          if (activeTab === 'lua-studio') setActiveTab('stats')
          setSidebarOpen(false)
        }}
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
        performanceMode={performanceMode}
        onPerformanceModeChange={changePerformanceMode}
        language={language}
        onLanguageChange={changeLanguage}
      />

      {/* Main Workspace */}
      <main className={`workspace-container ${card ? 'character-edit-workspace' : ''}`}>
        <div className={`app-global-ost-row ${!card && activeTab !== 'lua-studio' ? 'listening-room' : ''}`}>
          <BgmPlayer accent={accent} language={language} onImportCustomBgm={handleImportCustomBgm} immersive={!card && activeTab !== 'lua-studio'} />
        </div>
        {!card && activeTab !== 'lua-studio' && <button type="button"
          className={`empty-sidebar-edge-toggle ${sidebarOpen ? 'sidebar-visible' : 'sidebar-hidden'}`}
          style={{ left: sidebarOpen ? 368 : 0 }}
          onClick={() => setSidebarOpen(value => !value)}
          aria-label={sidebarOpen ? (language === 'vi' ? 'Ẩn bảng tìm kiếm thẻ' : 'Hide card search') : (language === 'vi' ? 'Hiện bảng tìm kiếm thẻ' : 'Show card search')}
          title={sidebarOpen ? (language === 'vi' ? 'Ẩn bảng tìm kiếm' : 'Hide search') : (language === 'vi' ? 'Hiện bảng tìm kiếm' : 'Show search')}>
          {sidebarOpen ? <ChevronLeft size={17} /> : <ChevronRight size={17} />}
        </button>}
        {card ? (
          <>
            <Header
              card={card}
              ostAccent={accent}
              cardData={cardData}
              chain={chain}
              draft={draft}
              customSql={customSql}
              pendingFormCount={pendingFormCount}
              hasAudioDraft={Boolean(audioAssetsByCard[selectedId]?.length)}
              hasAnimationDraft={Boolean(animationAssetsByCard[selectedId]?.length)}
              isSaving={isSaving}
              allowDatabaseSave={!importedMod}
              onSave={() => handleSaveToDb()}
              onReset={handleResetDraft}
              onSelectCard={(id) => setSelectedId(id)}
              onToggleSidebar={() => setSidebarOpen(!sidebarOpen)}
              playerOpen={playerOpen}
              onTogglePlayer={() => setPlayerOpen(!playerOpen)}
              language={language}
            />

            {/* Tab navigation with explicit controls for overflowing tabs. */}
            <div className="tab-navigation-shell">
              {tabNavigationMetrics.overflow && (
                <button
                  type="button"
                  className="tab-navigation-arrow"
                  onClick={() => scrollTabs(-1)}
                  disabled={!tabNavigationMetrics.canScrollLeft}
                  aria-label={language === 'vi' ? 'Cuộn tab sang trái' : 'Scroll tabs left'}
                  title={language === 'vi' ? 'Cuộn tab sang trái' : 'Scroll tabs left'}
                >
                  <ChevronLeft size={17} />
                </button>
              )}
              <nav className="tab-navigation-bar" ref={tabNavigationRef}>
                {TABS.map((tab) => {
                  const IconComponent = TAB_ICONS[tab.icon] || Activity
                  const isActive = activeTab === tab.id
                  const labelsEn = { stats: 'Card Profile', leader: 'Leader Skill', passive: 'Passive Skill', active: 'Active Skill', 'animation-convert': 'Animation Transfer', 'lua-studio': 'Lua Timeline', transform: 'Transformations', specials: 'Super Attacks', standby: 'Standby Skill', finish: 'Finish Attack', causality: 'Causality Logic', fields: 'Domain & Fields', sql: 'SQL Live Patch', export: 'Export Patch (.eclp)' }
                  return (
                    <button
                      key={tab.id}
                      className={`tab-btn ${isActive ? 'active' : ''}`}
                      onClick={() => setActiveTab(tab.id)}
                      title={language === 'vi' ? tab.descVi : tab.desc}
                    >
                      <IconComponent size={16} />
                      <span>{language === 'vi' ? ({ stats: 'Hồ sơ thẻ', leader: 'Kỹ năng thủ lĩnh', passive: 'Kỹ năng bị động', active: 'Kỹ năng chủ động', 'animation-convert': 'Chuyển animation', 'lua-studio': 'Timeline Lua', transform: 'Biến hình', specials: 'Siêu tấn công', standby: 'Standby', finish: 'Đòn kết liễu', causality: 'Điều kiện', fields: 'Domain & Field', sql: 'Bản vá SQL', export: 'Xuất patch' }[tab.id]) : labelsEn[tab.id]}</span>
                    </button>
                  )
                })}
              </nav>
              {tabNavigationMetrics.overflow && (
                <button
                  type="button"
                  className="tab-navigation-arrow"
                  onClick={() => scrollTabs(1)}
                  disabled={!tabNavigationMetrics.canScrollRight}
                  aria-label={language === 'vi' ? 'Cuộn tab sang phải' : 'Scroll tabs right'}
                  title={language === 'vi' ? 'Cuộn tab sang phải' : 'Scroll tabs right'}
                >
                  <ChevronRight size={17} />
                </button>
              )}
            </div>

            {/* 3-Column Persistent Studio Layout */}
            <div className="tab-body-layout three-column-studio">
              {/* Left Column: Persistent Card Art & 3D LWF */}
              <aside className={`studio-card-art-panel ${cardArtOpen && !performanceMode ? '' : 'collapsed'}`}>
                {performanceMode ? null : cardArtOpen
                  ? <CardArtViewer card={card} onToggleCollapse={() => setCardArtOpen(false)} />
                  : <button type="button" className="card-art-expand-btn" onClick={() => setCardArtOpen(true)}
                      title="Hiện Card Art" aria-label="Hiện Card Art"><ChevronRight size={17} /></button>}
              </aside>

              {/* Center Column: Scrollable Tab Editor */}
              <section className="studio-editor-panel">
                <div className="tab-content-scroll" ref={editorScrollRef}>
                  {isLoading ? (
                    <div className="loading-state">
                      <div className="spinner-large" />
                      <span>Loading character dataset...</span>
                    </div>
                  ) : (
                    <>
                      {activeTab === 'lua-studio' && (
                        <LuaAnimationStudio card={card} language={language} onNavigateBack={() => setActiveTab('stats')}
                          editorMode={luaEditorMode}
                          onToggleEditorMode={() => setLuaEditorMode(value => !value)}
                          previewAnimation={luaPreviewAnimation}
                          onPreviewChange={setLuaPreviewAnimation}
                          onTimelinePlay={setLuaTimelinePlayback}
                          onStageSaved={(asset) => setAnimationAssetsByCard(previous => ({
                            ...previous,
                            [card.id]: [...(previous[card.id] || []), [asset.source_path, asset.archive_path]]
                          }))} />
                      )}
                      {activeTab === 'stats' && (
                        <TabStats
                          categories={cardData.categories}
                          links={cardData.links}
                          meta={meta}
                          card={card}
                          draft={draft}
                          onChange={handleDraftChange}
                          onNavigateToExport={() => setActiveTab('export')}
                        />
                      )}
                      {activeTab === 'leader' && (
                        <TabLeader leader={cardData.leader} draft={draft} onChange={handleDraftChange} meta={meta} />
                      )}
                      {activeTab === 'passive' && (
                        <TabPassive
                          key={card.id}
                          passive={cardData.passive}
                          transformationDescriptions={cardData.transformation_descriptions}
                          draft={draft}
                          onChange={handleDraftChange}
                          meta={meta}
                          metaError={metaError}
                          onReloadMeta={reloadMeta}
                          matches={passiveMatches}
                          onPlayAnim={() => setPlayerOpen(true)}
                        />
                      )}
                      {activeTab === 'active' && (
                        <TabActive
                          card={card}
                          active={cardData.active}
                          transformationDescriptions={cardData.transformation_descriptions}
                          draft={draft}
                          onChange={handleDraftChange}
                          meta={meta}
                          onPlayAnim={() => setPlayerOpen(true)}
                        />
                      )}
                      {activeTab === 'animation-convert' && (
                        <TabAnimationConvert key={card.id} card={card} language={language} latestResult={latestAnimationByCard[card.id]}
                          onDone={(result) => {
                            setConvertedAnimationsByCard(prev => ({ ...prev, [card.id]: [...(prev[card.id] || []), result] }))
                            setLatestAnimationByCard((prev) => ({ ...prev, [card.id]: result }))
                            const generatedSql = (result?.sql_statements || []).join('\n')
                            if (!generatedSql) return
                            setCustomSqlByCard((prev) => ({
                              ...prev,
                              [card.id]: [prev[card.id], generatedSql].filter(Boolean).join('\n')
                            }))
                            if (result.pack_items?.length) setAnimationAssetsByCard((prev) => ({
                              ...prev,
                              [card.id]: [...(prev[card.id] || []), ...result.pack_items]
                            }))
                          }} />
                      )}
                      {activeTab === 'transform' && (
                        <TabTransform
                          card={card}
                          chain={chain}
                          data={cardData}
                          draft={draft}
                          onChange={handleDraftChange}
                          onSelectCard={(id) => setSelectedId(id)}
                        />
                      )}
                      {activeTab === 'specials' && (
                        <TabSpecials
                          card={card}
                          specials={cardData.specials}
                          draft={draft}
                          onChange={handleDraftChange}
                          meta={meta}
                          onPlayAnim={() => setPlayerOpen(true)}
                        />
                      )}
                      {activeTab === 'standby' && (
                        <TabStandby
                          standby={cardData.standby}
                          transformationDescriptions={cardData.transformation_descriptions}
                          draft={draft}
                          onChange={handleDraftChange}
                          meta={meta}
                          card={card}
                          onPlayAnim={() => setPlayerOpen(true)}
                        />
                      )}
                      {activeTab === 'finish' && (
                        <TabFinish
                          finish={cardData.finish}
                          transformationDescriptions={cardData.transformation_descriptions}
                          draft={draft}
                          onChange={handleDraftChange}
                          meta={meta}
                          card={card}
                          onPlayAnim={() => setPlayerOpen(true)}
                        />
                      )}
                      {activeTab === 'causality' && (
                        <TabCausality
                          passive={cardData.passive}
                          leader={cardData.leader}
                          active={cardData.active}
                          standby={cardData.standby}
                          finish={cardData.finish}
                          specials={cardData.specials}
                          meta={meta}
                        />
                      )}
                      {activeTab === 'fields' && (
                        <TabFields
                          language={language}
                          fields={cardData.fields}
                          activeRelations={cardData.field_active_relations}
                          passiveRelations={cardData.field_passive_relations}
                          card={card}
                          draft={draft}
                          onChange={handleDraftChange}
                          categories={cardData.categories}
                          links={cardData.links}
                          meta={meta}
                        />
                      )}
                      {activeTab === 'sql' && (
                        <TabSql
                          card={card}
                          importedMeta={importedMod?.metadata}
                          hasCustomAnimation={Boolean(importedMod?.has_custom_animation || (importedMod && Object.values(animationAssetsByCard).some(items => items.length)) || cardData?.has_custom_animation || [card.id, ...chain.map(c => c.id)].some(id => animationAssetsByCard[id]?.length))}
                          draft={draft}
                          patchChanges={patchChanges}
                          customSql={customSql}
                          onChangeCustomSql={setCustomSql}
                          allowDatabaseSave={!importedMod}
                          onApply={handleSaveToDb}
                          isSaving={isSaving}
                        />
                      )}
                      {activeTab === 'export' && (
                        <TabExport
                          card={card}
                          importedMeta={importedMod?.metadata}
                          hasCustomAnimation={Boolean(importedMod?.has_custom_animation || (importedMod && Object.values(animationAssetsByCard).some(items => items.length)) || cardData?.has_custom_animation || [card.id, ...chain.map(c => c.id)].some(id => animationAssetsByCard[id]?.length))}
                          draft={draft}
                          patchChanges={patchChanges}
                          customSql={customSql}
                          pendingFormCount={pendingFormCount}
                          onChangeCustomSql={setCustomSql}
                        />
                      )}
                    </>
                  )}
                </div>
                {activeTab === 'passive' && !isLoading && (draft.passive_skills || cardData.passive?.skills || []).length > 0 && <PassiveScrollRail
                  scrollRef={editorScrollRef}
                  skills={draft.passive_skills || cardData.passive?.skills || []}
                />}
              </section>

              {/* Right Column: Persistent Animation Studio */}
              <aside className={`studio-anim-panel ${playerOpen ? '' : 'collapsed'}`}>
                <AnimPlayer key={importedMod?.id || 'base'}
                  card={card} cardData={cardData} draft={draft} convertedAnimations={convertedAnimationsByCard[card.id]}
                  editorMode={activeTab === 'lua-studio' && luaEditorMode} previewAnimation={luaPreviewAnimation}
                  timelinePlayback={luaTimelinePlayback}
                  language={language}
                  isCollapsed={!playerOpen || performanceMode}
                  onToggleCollapse={() => setPlayerOpen(!playerOpen)}
                />
              </aside>
            </div>
          </>
        ) : activeTab === 'lua-studio' ? (
          <div className="standalone-timeline-view">
            <header className="standalone-timeline-topbar">
              <div className="standalone-timeline-topline">
                <div className="standalone-timeline-brand"><Clapperboard size={18} /><span>Lua Animation Timeline</span></div>
                <button type="button" className="standalone-timeline-back" onClick={() => { setActiveTab('stats'); setLuaEditorMode(false) }}>
                  {language === 'vi' ? 'Về nghe nhạc' : 'Back to music'}
                </button>
              </div>
            </header>
            <div className="standalone-timeline-content has-player">
              <div className="standalone-timeline-editor">
              <LuaAnimationStudio card={null} language={language} editorMode={luaEditorMode}
                onToggleEditorMode={() => setLuaEditorMode(value => !value)}
                previewAnimation={luaPreviewAnimation} onPreviewChange={setLuaPreviewAnimation}
                onTimelinePlay={setLuaTimelinePlayback} />
              </div>
              <aside className="standalone-timeline-preview">
                <AnimPlayer key="standalone-lua-preview"
                  card={{ id: luaPreviewAnimation?.card_id || 0, name: luaPreviewAnimation?.card_name || 'Lua Timeline', element: luaPreviewAnimation?.element ?? 0 }}
                  editorMode previewAnimation={luaPreviewAnimation} timelinePlayback={luaTimelinePlayback}
                  language={language} isCollapsed={false} />
              </aside>
            </div>
          </div>
        ) : (
          <div className="empty-workspace">
            <div className="empty-workspace-card">
              <div className="empty-hero-heading">
                <div className="empty-icon-wrap">
                  <Disc size={25} />
                  <i />
                </div>
                <span className="empty-kicker">DOKKAN STUDIO <i /> OST LISTENING ROOM</span>
              </div>
              <h2>{language === 'vi' ? 'Bật nhạc. Vào thế giới Dokkan.' : 'Press play. Enter the Dokkan world.'}</h2>
              <p>{language === 'vi' ? 'Nghe OST gốc và playlist tùy chỉnh ngay cả khi chưa mở thẻ nhân vật. Chọn thẻ bên trái khi muốn bắt đầu chỉnh sửa.' : 'Listen to original tracks and custom OSTs before opening a character card. Pick a card on the left when you are ready to edit.'}</p>
              <div className="empty-workspace-features">
                <span><Activity size={15} /> {language === 'vi' ? 'Chỉnh sửa dữ liệu' : 'Edit card data'}</span>
                <span><Film size={15} /> {language === 'vi' ? 'Xem animation' : 'Preview animation'}</span>
                <span><PackageCheck size={15} /> {language === 'vi' ? 'Xuất mod' : 'Export mod'}</span>
              </div>
              <button type="button" className="empty-lua-studio-link" onClick={() => { setActiveTab('lua-studio'); setLuaEditorMode(true); setSidebarOpen(false) }}>
                <Clapperboard size={16} /> {language === 'vi' ? 'Mở Lua Animation Editor' : 'Open Lua Animation Editor'}
              </button>
              <div className="empty-player-wrap">
                <div className="jukebox-visualizer"><MusicWave className="jukebox-wave" /><span>{language === 'vi' ? 'ÂM THANH PHẢN HỒI THEO NHẠC' : 'AUDIO REACTIVE VISUALIZER'}</span></div>
              </div>
            </div>
          </div>
        )}
      </main>

      {card && <div className="ambient-wave-strip"><MusicWave /></div>}

      {/* Floating Toast Notification */}
      {toast && (
        <div className={`floating-toast ${toast.type}`}>
          {toast.type === 'success' ? <CheckCircle2 size={18} /> : <AlertCircle size={18} />}
          <span>{toast.message}</span>
          <button className="toast-close" onClick={() => setToast(null)}>✕</button>
        </div>
      )}
    </div>
  )
}
