import React, { useEffect, useState } from 'react'
import { ArrowRightLeft, RefreshCw, Copy, MonitorPlay } from 'lucide-react'
import { api } from '../../api'
import { BgmCardLookup } from './BgmCardLookup'

export function CustomLuaTransfer({ card, onDone, results = [], refreshKey, onPreview, canPreview }) {
  const [items, setItems] = useState([])
  const [filename, setFilename] = useState('')
  const [slot, setSlot] = useState('active')
  const [name, setName] = useState('')
  const [bgm, setBgm] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [reload, setReload] = useState(0)
  useEffect(() => {
    const controller = new AbortController()
    api.getCustomLuaList(controller.signal).then(data => {
      setItems(data.items || [])
      setFilename(previous => (data.items || []).some(item => item.filename === previous) ? previous : (data.items?.[0]?.filename || ''))
    }).catch(err => { if (err.name !== 'AbortError') setError(err.message) })
    return () => controller.abort()
  }, [refreshKey, reload])
  const convert = async () => {
    if (!card || !filename || busy) return
    setBusy(true); setError(''); setResult(null)
    try {
      const response = await api.transmuteAnimation({ source_custom_lua: filename, source_bgm_id: Number(bgm) || 0,
        target_card_id: card.id, target_slot: slot, custom_script_name: name.trim() || null,
        copy_bgm: true, strip_damage: slot === 'entrance' })
      const converted = { ...response.result, source_name: filename, source_card_id: card.id }
      onDone?.(converted)
      setResult(converted)
    } catch (err) { setError(err.message) }
    finally { setBusy(false) }
  }
  const history = results.length ? [...results].reverse() : result ? [result] : []
  return <section className="lua-panel lua-save-panel">
    <header><ArrowRightLeft size={15} /><strong>Chuyển animation Lua custom đã lưu</strong>
      <button type="button" className="btn ghost-btn" onClick={() => { setError(''); setReload(value => value + 1) }}><RefreshCw size={13} /> Tải lại</button>
    </header>
    <div className="fields-grid-2" style={{ padding: 12 }}>
      <div className="form-field"><label>Animation custom nguồn</label><select value={filename} onChange={event => { setFilename(event.target.value); setResult(null) }}>
        {!items.length && <option value="">Chưa có Lua custom đã lưu</option>}
        {items.map(item => <option key={item.filename} value={item.filename}>{item.filename}</option>)}
      </select></div>
      <div className="form-field"><label>Loại animation đích · thẻ #{card?.id || '—'}</label><select value={slot} onChange={event => setSlot(event.target.value)}>
        <option value="entrance">Entrance</option><option value="active">Active Skill</option><option value="super">Super Attack</option><option value="finish">Finish Skill</option>
      </select></div>
      <div className="form-field"><label>Tên Lua mới (tùy chọn)</label><input value={name} onChange={event => setName(event.target.value)} placeholder="Để trống để tự tạo tên" /></div>
      <div className="form-field"><label>BGM ID (tùy chọn)</label><input type="number" min="0" value={bgm} onChange={event => setBgm(event.target.value)} /><BgmCardLookup onSelect={setBgm} /></div>
    </div>
    <p className="lua-browser-hint">Entrance tự bỏ lệnh damage. Sau khi chuyển, điền ID vừa tạo vào dòng kỹ năng muốn dùng; Lua và SQL được thêm vào bản nháp của thẻ.</p>
    {!card && <p className="lua-browser-hint">Chọn thẻ nhân vật trước khi chuyển animation custom.</p>}
    <button type="button" className="lua-action secondary" style={{ margin: 12 }} disabled={!filename || !canPreview} onClick={() => onPreview?.(filename)}><MonitorPlay size={14} /> Play preview</button>
    {error && <p className="lua-export-error">{error}</p>}
    {!!history.length && <div style={{ padding: 12 }}>
      <strong>Animation đã chuyển cho thẻ #{card?.id}</strong>
      {history.map((item, index) => {
        const id = item.target_slot === 'entrance' ? item.target_pse_id : item.special_view_id
        if (!id) return null
        return <p key={`${item.target_slot}-${id}-${index}`} className="lua-browser-hint">
          {item.target_slot} · {item.script_name} · ID <strong>{id}</strong>
          <button type="button" className="btn ghost-btn" onClick={async () => {
            try { await navigator.clipboard.writeText(String(id)) }
            catch (err) { setError(err.message) }
          }}><Copy size={13} /> Sao chép ID</button>
          {Boolean(item.bgm_id) && <> · BGM ID <strong>{item.bgm_id}</strong></>}
        </p>
      })}
    </div>}
    <button type="button" className="lua-action primary" style={{ margin: 12 }} disabled={!card || !filename || busy} onClick={convert}><ArrowRightLeft size={14} />{busy ? 'Đang chuyển…' : 'Chuyển vào thẻ đang sửa'}</button>
  </section>
}
