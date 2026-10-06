import React, { useState, useEffect } from 'react'
import { PackageCheck, Upload, Download, Key, CheckCircle, AlertCircle, FileArchive, Sparkles, Code, ChevronDown, ChevronRight, Copy, Check, RotateCcw, Zap, Save } from 'lucide-react'
import { api } from '../../api'

export function TabExport({ card, importedMeta, hasCustomAnimation = false, draft = {}, patchChanges, customSql = '', pendingFormCount = 0, onChangeCustomSql }) {
  const [patchTitle, setPatchTitle] = useState(card ? `Mod ${card.name}` : 'My Dokkan Patch')
  const [author, setAuthor] = useState('Dokkan Modder')
  const [version, setVersion] = useState('1.0.0')
  const [uuid, setUuid] = useState(() => String(Math.floor(1000 + Math.random() * 9000)))
  const [description, setDescription] = useState('Custom character patch authored via Dokkan Modding Studio')
  const [cookie, setCookie] = useState(() => localStorage.getItem('dokkan_eclipse_cookie') || '')
  const [cookieSaved, setCookieSaved] = useState(false)
  const [exportMode, setExportMode] = useState(hasCustomAnimation ? 'full' : 'simple') // 'simple' (chỉ SQL / chỉ số) hoặc 'full' (kèm assets)
  const [incSql, setIncSql] = useState(true)
  const [includeAssets, setIncludeAssets] = useState(hasCustomAnimation)

  const [sqlContent, setSqlContent] = useState('')
  const [isManualSql, setIsManualSql] = useState(false)
  const [showSqlPreview, setShowSqlPreview] = useState(true)
  const [loadingSql, setLoadingSql] = useState(false)
  const [copiedSql, setCopiedSql] = useState(false)

  const [status, setStatus] = useState({ step: 'idle', message: '', details: null })
  const [isBuilding, setIsBuilding] = useState(false)


  useEffect(() => {
    setExportMode(hasCustomAnimation ? 'full' : 'simple')
    setIncludeAssets(hasCustomAnimation)
    setIsManualSql(false)
  }, [card?.id, hasCustomAnimation])
  useEffect(() => {
    if (!importedMeta) return
    setPatchTitle(importedMeta.patchName || importedMeta.Name || importedMeta.title || 'Imported Mod')
    const authors = importedMeta.authors || importedMeta.Authors || 'Dokkan Modder'
    setAuthor(Array.isArray(authors) ? authors.join(', ') : authors)
    setVersion(importedMeta.version || importedMeta.Version || '1.0.0')
    setDescription(importedMeta.description || importedMeta.Description || '')
    if (importedMeta.uuid || importedMeta.UUID) setUuid(String(importedMeta.uuid || importedMeta.UUID))
  }, [importedMeta])

  const hasDraft = pendingFormCount > 0 || Object.keys(draft || {}).length > 0

  // Load SQL preview automatically whenever card, draft, or customSql changes (unless manually edited)
  useEffect(() => {
    if (!card) return
    if (isManualSql) return // Keep user's custom edits in the textarea
    let active = true
    setLoadingSql(true)
    api.previewExportSql({ cardId: card.id, changes: patchChanges || draft, rawSql: patchChanges ? '' : customSql })
      .then((res) => {
        if (active) setSqlContent(res.sql || '-- Không có câu lệnh SQL nào được sinh ra')
      })
      .catch((err) => {
        if (active) setSqlContent(`-- Lỗi xem trước SQL: ${err.message}`)
      })
      .finally(() => {
        if (active) setLoadingSql(false)
      })
    return () => { active = false }
  }, [card?.id, draft, patchChanges, customSql, isManualSql])

  // Load saved cookie from backend config if not already in state
  useEffect(() => {
    api.getConfig().then((res) => {
      const saved = res?.config?.dokkan_cookie
      if (saved && saved.trim()) {
        setCookie((prev) => {
          if (!prev) {
            localStorage.setItem('dokkan_eclipse_cookie', saved.trim())
            return saved.trim()
          }
          return prev
        })
      }
    }).catch(() => {})
  }, [])

  const handleCookieChange = (val) => {
    setCookie(val)
    localStorage.setItem('dokkan_eclipse_cookie', val)
    if (val.trim()) {
      api.saveConfig({ dokkan_cookie: val.trim() }).catch(() => {})
      setCookieSaved(true)
      setTimeout(() => setCookieSaved(false), 2500)
    }
  }

  const copySql = () => {
    navigator.clipboard.writeText(sqlContent)
    setCopiedSql(true)
    setTimeout(() => setCopiedSql(false), 2000)
  }

  const handleResetToAutoSql = () => {
    setIsManualSql(false)
    if (!card) return
    setLoadingSql(true)
    api.previewExportSql({ cardId: card.id, changes: patchChanges || draft, rawSql: patchChanges ? '' : customSql })
      .then((res) => setSqlContent(res.sql || '-- Không có câu lệnh SQL nào'))
      .catch((err) => setSqlContent(`-- Lỗi xem trước SQL: ${err.message}`))
      .finally(() => setLoadingSql(false))
  }

  const handleBuildZip = async (saveMod = false) => {
    setIsBuilding(true)
    setStatus({ step: 'zipping', message: 'Archiving game resources into Dokkan ZIP structure...' })

    try {
      const cleanName = patchTitle.replace(/[^a-zA-Z0-9_\-]/g, '_')
      const filename = `${cleanName}.zip`
      const meta = {
        title: patchTitle,
        author,
        version,
        description,
        uuid: uuid ? parseInt(uuid, 10) : undefined
      }

      const res = await api.buildZip({
        filename,
        meta,
        cardId: card.id,
        incSql: saveMod || importedMeta ? true : incSql,
        includeAssets: saveMod ? true : (exportMode === 'full' ? includeAssets : false),
        sqlContent: (saveMod || importedMeta || incSql) && isManualSql ? sqlContent : '',
        changes: patchChanges || draft,
        rawSql: patchChanges ? '' : customSql
      })

      setStatus({
        step: 'zip_done',
        message: `ZIP archive generated successfully (${res.zip_size_kb.toFixed(1)} KB)!`,
        details: res.zip_path
      })
    } catch (err) {
      setStatus({ step: 'error', message: `Packaging error: ${err.message}` })
    } finally {
      setIsBuilding(false)
    }
  }

  const handleBuildEclp = async () => {
    const cleanCookie = cookie.trim()
    if (!cleanCookie) {
      alert('Vui lòng dán Dokkan Eclipse Session Cookie trước khi tạo file .eclp!')
      return
    }
    localStorage.setItem('dokkan_eclipse_cookie', cleanCookie)
    api.saveConfig({ dokkan_cookie: cleanCookie }).catch(() => {})

    setIsBuilding(true)
    setStatus({ step: 'zipping', message: 'Step 1/3: Preparing Dokkan standard ZIP archive...' })

    try {
      const cleanName = patchTitle.replace(/[^a-zA-Z0-9_\-]/g, '_')
      const filename = `${cleanName}.zip`
      const meta = {
        title: patchTitle,
        author,
        version,
        description,
        uuid: uuid ? parseInt(uuid, 10) : undefined
      }

      // 1. Build Zip with exact sqlContent and draft changes
      const zipRes = await api.buildZip({
        filename,
        meta,
        cardId: card.id,
        incSql,
        includeAssets: exportMode === 'full' ? includeAssets : false,
        sqlContent: incSql && isManualSql ? sqlContent : '',
        changes: patchChanges || draft,
        rawSql: patchChanges ? '' : customSql
      })

      // 2. Upload & Convert to ECLP
      setStatus({ step: 'converting', message: 'Step 2/3: Dispatching to Dokkan Eclipse server & compiling .eclp...' })
      const eclpRes = await api.buildEclp({
        zipPath: zipRes.zip_path,
        meta,
        cookie: cookie.trim()
      })

      setStatus({
        step: 'success',
        message: '🎉 .eclp patch compiled and downloaded successfully!',
        details: eclpRes.eclp_path,
        size: eclpRes.eclp_size_kb,
        url: eclpRes.downloadUrl
      })
    } catch (err) {
      setStatus({ step: 'error', message: `ECLP Build error: ${err.message}` })
    } finally {
      setIsBuilding(false)
    }
  }

  return (
    <div className="tab-pane export-pane">
      <div className="section-intro">
        <PackageCheck size={20} />
        <div>
          <h3>Export & Package Mod Patch (.eclp & .zip)</h3>
          <p>Package assets into official Dokkan mod structures, write manifest metadata, and compile .eclp format.</p>
        </div>
      </div>

      {/* Draft status alert / info banner */}
      {hasDraft || customSql ? (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '12px 16px',
          background: 'rgba(56, 189, 248, 0.1)',
          border: '1px solid rgba(56, 189, 248, 0.3)',
          borderRadius: '8px',
          marginBottom: '16px',
          color: '#38bdf8'
        }}>
          <Sparkles size={18} style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '13px', lineHeight: '1.5' }}>
            <strong>Đang có bản nháp của {pendingFormCount || 1} form.</strong>
            <div>Bản patch sẽ được đóng gói trực tiếp từ các dữ liệu này mà không cần bấm lưu vào database.</div>
          </div>
        </div>
      ) : (
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          padding: '10px 14px',
          background: 'rgba(255, 255, 255, 0.03)',
          border: '1px solid var(--line)',
          borderRadius: '8px',
          marginBottom: '16px',
          color: 'var(--muted)',
          fontSize: '12.5px'
        }}>
          <span>{importedMeta ? 'Chưa có chỉnh sửa thêm. Xuất ZIP sẽ giữ SQL và tài nguyên của mod đã import.' : 'Không có thay đổi nháp. Bản patch sẽ được đóng gói từ lịch sử đã lưu hoặc dữ liệu snapshot của thẻ trong database.'}</span>
        </div>
      )}

      {importedMeta && <p className="hint-text">SQL và tài nguyên có sẵn trong ZIP import được giữ khi xuất lại. Các thay đổi ở tab chỉnh sửa được thêm vào bản patch.</p>}
      {/* Metadata Form */}
      <div className="form-card">
        <div className="form-header">
          <Sparkles size={17} />
          <strong>Patch Manifest & Metadata</strong>
        </div>

        <div className="fields-grid-2">
          <div className="form-field full-row">
            <label>Patch Title</label>
            <input
              type="text"
              value={patchTitle}
              onChange={(e) => setPatchTitle(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Author</label>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>Version</label>
            <input
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
            />
          </div>

          <div className="form-field">
            <label>UUID (Tối đa 4 chữ số)</label>
            <input
              type="text"
              maxLength={4}
              value={uuid}
              onChange={(e) => setUuid(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="1000 - 9999"
            />
          </div>

          <div className="form-field full-row">
            <label>Patch Description</label>
            <textarea
              rows={2}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
      </div>

      {/* Export Preset Mode Selector */}
      <div className="form-card">
        <div className="form-header">
          <Zap size={17} style={{ color: '#38bdf8' }} />
          <strong>Chế độ xuất patch</strong>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: '12px', marginTop: '6px' }}>
          <div
            onClick={() => { setExportMode('simple'); setIncludeAssets(false); setIncSql(true); }}
            style={{
              padding: '14px',
              borderRadius: '8px',
              border: exportMode === 'simple' ? '2px solid #38bdf8' : '1px solid var(--line)',
              background: exportMode === 'simple' ? 'rgba(56, 189, 248, 0.1)' : 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', color: exportMode === 'simple' ? '#38bdf8' : 'var(--text)' }}>
              <Zap size={16} />
              <span>⚡ Xuất Đơn Giản (Chỉ SQL / Chỉ số)</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
              Dành cho khi <strong>chỉ sửa chỉ số</strong>, leader, passive... Chỉ nén file <code>patch.sql</code>. Siêu nhẹ (~1 KB), nạp game cực nhanh.
            </p>
          </div>

          <div
            onClick={() => { setExportMode('full'); setIncludeAssets(true); setIncSql(true); }}
            style={{
              padding: '14px',
              borderRadius: '8px',
              border: exportMode === 'full' ? '2px solid #a855f7' : '1px solid var(--line)',
              background: exportMode === 'full' ? 'rgba(168, 85, 247, 0.1)' : 'rgba(255, 255, 255, 0.02)',
              cursor: 'pointer',
              transition: 'all 0.15s ease'
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: '600', color: exportMode === 'full' ? '#a855f7' : 'var(--text)' }}>
              <PackageCheck size={16} />
              <span>📦 Xuất Đầy Đủ (Kèm Assets & Hoạt ảnh)</span>
            </div>
            <p style={{ margin: '6px 0 0', fontSize: '12px', color: 'var(--muted)', lineHeight: '1.4' }}>
              Bao gồm file <code>patch.sql</code> và quét nén toàn bộ hình ảnh thẻ, animation Lua, BGM từ thư mục <code>game res/</code>.
            </p>
          </div>
        </div>
      </div>

      {/* Package Contents Configuration */}
      <div className="form-card">
        <div className="form-header"><FileArchive size={17} /><strong>Thành phần patch</strong></div>
        <label className="form-field">
          <span><input type="checkbox" checked={importedMeta ? true : incSql} disabled={Boolean(importedMeta)} onChange={(e) => setIncSql(e.target.checked)} /> Bao gồm file Patch SQL (patch.sql)</span>
        </label>
        <label className="form-field">
          <span>
            <input
              type="checkbox"
              checked={exportMode === 'full' ? includeAssets : false}
              onChange={(e) => {
                setIncludeAssets(e.target.checked)
                if (e.target.checked) setExportMode('full')
                else setExportMode('simple')
              }}
            /> Bao gồm animation Lua và tài nguyên thẻ từ game res
          </span>
        </label>
        <p className="hint-text">
          {exportMode === 'simple'
            ? '⚡ Chế độ Đơn Giản đang bật: Patch chỉ chứa metadata và patch.sql thay đổi chỉ số/skill, không đóng gói tài nguyên game res.'
            : 'Tự động đóng gói các câu lệnh SQL và các asset của nhân vật từ game res. Bạn có thể xem và chỉnh sửa trực tiếp nội dung SQL bên dưới trước khi xuất.'}
        </p>

        {/* Live SQL Preview & Direct Edit Box */}
        {incSql && (
          <div style={{ marginTop: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <button
                  type="button"
                  className="btn secondary-btn"
                  style={{ fontSize: '12px', padding: '5px 10px' }}
                  onClick={() => setShowSqlPreview(!showSqlPreview)}
                >
                  <Code size={14} />
                  <span>{showSqlPreview ? 'Thu gọn khung SQL' : '👁️ Xem nội dung patch.sql'}</span>
                  {showSqlPreview ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                {isManualSql && (
                  <span style={{ fontSize: '11px', color: '#f59e0b', background: 'rgba(245, 158, 11, 0.1)', padding: '2px 8px', borderRadius: '4px', border: '1px solid rgba(245, 158, 11, 0.3)' }}>
                    Đã sửa thủ công
                  </span>
                )}
              </div>

              <div style={{ display: 'flex', gap: '6px' }}>
                {isManualSql && (
                  <button
                    type="button"
                    className="btn secondary-btn"
                    style={{ fontSize: '11px', padding: '4px 8px', color: '#38bdf8' }}
                    onClick={handleResetToAutoSql}
                    title="Khôi phục lại SQL tự động sinh từ dữ liệu đang chỉnh sửa"
                  >
                    <RotateCcw size={12} />
                    <span>Làm mới từ Draft</span>
                  </button>
                )}
                {sqlContent && (
                  <button
                    type="button"
                    className="btn secondary-btn"
                    style={{ fontSize: '11px', padding: '4px 8px' }}
                    onClick={copySql}
                  >
                    {copiedSql ? <Check size={12} /> : <Copy size={12} />}
                    <span>{copiedSql ? 'Đã copy' : 'Copy SQL'}</span>
                  </button>
                )}
              </div>
            </div>

            {showSqlPreview && (
              <div>
                <small style={{ color: 'var(--muted)', display: 'block', marginBottom: '6px' }}>
                  Nội dung dưới đây sẽ được đóng gói chính xác vào <code>files/patch.sql</code> (bạn có thể gõ chỉnh sửa trực tiếp vào ô này nếu muốn):
                </small>
                <textarea
                  className="custom-sql-input"
                  style={{
                    width: '100%',
                    minHeight: '180px',
                    fontFamily: "'JetBrains Mono', Consolas, monospace",
                    fontSize: '12.5px',
                    lineHeight: '1.6',
                    color: '#a8d8a9',
                    background: '#080a0f',
                    border: isManualSql ? '1px solid #f59e0b' : '1px solid var(--line)',
                    borderRadius: '8px',
                    padding: '12px',
                    resize: 'vertical'
                  }}
                  value={loadingSql ? '-- Đang tải câu lệnh SQL...' : sqlContent}
                  onChange={(e) => {
                    setSqlContent(e.target.value)
                    setIsManualSql(true)
                  }}
                  placeholder="-- Câu lệnh SQL cho patch..."
                />
              </div>
            )}
          </div>
        )}
      </div>

      {/* Dokkan Eclipse Cookie */}
      <div className="form-card">
        <div className="form-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
            <Key size={17} />
            <strong>Dokkan Eclipse Session Cookie (Tự động lưu vĩnh viễn)</strong>
          </div>
          {cookie.trim() && (
            <span style={{ fontSize: '12px', color: '#10b981', display: 'flex', alignItems: 'center', gap: '4px' }}>
              <Check size={14} /> {cookieSaved ? 'Đã lưu cấu hình!' : 'Đã ghi nhớ cho lần sau'}
            </span>
          )}
        </div>
        <p className="hint-text">
          Đăng nhập vào <code>dokkan-eclipse.com</code> trên trình duyệt, copy cookie phiên đăng nhập và dán vào đây. <strong>Tool tự động lưu vào bộ nhớ máy tính để bạn không bao giờ phải nhập lại.</strong>
        </p>
        <div className="form-field full-row">
          <input
            type="password"
            value={cookie}
            onChange={(e) => handleCookieChange(e.target.value)}
            placeholder="Dán chuỗi session cookie (ví dụ: session=... hoặc connect.sid=...)"
          />
        </div>
      </div>

      {/* Status Alert Box */}
      {status.step !== 'idle' && (
        <div className={`status-box ${status.step}`}>
          {status.step === 'success' || status.step === 'zip_done' ? (
            <CheckCircle size={20} />
          ) : status.step === 'error' ? (
            <AlertCircle size={20} />
          ) : (
            <div className="spinner-dot" />
          )}
          <div className="status-content">
            <strong>{status.message}</strong>
            {status.details && <small>File Path: <code>{status.details}</code></small>}
            {status.url && (
              <a href={status.url} target="_blank" rel="noreferrer" className="dl-link">
                Direct Browser Download ➔
              </a>
            )}
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="export-actions-row">
        {importedMeta && <button type="button" className="btn primary-btn large-btn" disabled={isBuilding}
          onClick={() => handleBuildZip(true)}>
          <Save size={17} /><span>Lưu mod đã chỉnh (ZIP)</span>
        </button>}
        <button
          className="btn secondary-btn large-btn"
          onClick={() => handleBuildZip()}
          disabled={isBuilding}
        >
          {exportMode === 'simple' ? <Zap size={17} /> : <FileArchive size={17} />}
          <span>{exportMode === 'simple' ? '⚡ Xuất ZIP Chỉ SQL (Siêu nhẹ)' : 'Package ZIP Đầy Đủ'}</span>
        </button>

        <button
          className="btn primary-btn large-btn"
          onClick={handleBuildEclp}
          disabled={isBuilding}
        >
          <Upload size={17} />
          <span>{exportMode === 'simple' ? '⚡ Compile .eclp Chỉ SQL' : '⚡ Compile & Download .eclp'}</span>
        </button>
      </div>
    </div>
  )
}
