import React, { useEffect, useRef, useState } from 'react'
import { getModWorkspace } from '../../api'

export function DomainImage({ resource, name }) {
  const frame = useRef(null)
  const [ratio, setRatio] = useState(3 / 4)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState('')
  const [paused, setPaused] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const workspace = getModWorkspace()
  useEffect(() => {
    setReady(false)
    setError('')
    setPaused(false)
    const timer = setTimeout(() => setError('Tải domain quá lâu. Hãy thử tải lại.'), 150000)
    const receive = event => {
      if (event.origin !== location.origin || event.source !== frame.current?.contentWindow || event.data?.resource !== resource) return
      if (event.data.type === 'domain-ready') {
        clearTimeout(timer)
        if (event.data.width > 0 && event.data.height > 0) setRatio(event.data.width / event.data.height)
        setError('')
        setReady(true)
      } else if (event.data.type === 'domain-error') {
        clearTimeout(timer)
        setError(event.data.error)
      }
    }
    window.addEventListener('message', receive)
    return () => { clearTimeout(timer); window.removeEventListener('message', receive) }
  }, [resource, workspace, attempt])
  return <div className="domain-live-preview">
    <div className="domain-live-toolbar"><strong>Domain LWF</strong>
      <button type="button" className="btn secondary-btn" disabled={!ready || !!error} onClick={() => {
        frame.current?.contentWindow?.postMessage({ type: 'domain-control', paused: !paused }, location.origin)
        setPaused(value => !value)
      }}>{paused ? 'Phát' : 'Tạm dừng'}</button>
      <button type="button" className="btn secondary-btn" onClick={() => setAttempt(value => value + 1)}>Tải lại</button>
    </div>
    <div className="domain-live-stage" style={{ aspectRatio: ratio }}>
      <iframe key={`${workspace}:${resource}:${attempt}`} ref={frame} title={`Domain ${name || resource}`} src={`/player/domain.html?v=4&resource=${resource}&mod_workspace=${workspace || ''}`} />
      {(!ready || error) && <div className="domain-live-status">{error || 'Đang tải Domain LWF…'}</div>}
    </div>
  </div>
}
