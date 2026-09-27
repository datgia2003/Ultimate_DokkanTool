import React, { useEffect, useRef, useState } from 'react'

export function PassiveScrollRail({ scrollRef, skills }) {
  const railRef = useRef(null)
  const [layout, setLayout] = useState({ markers: [], thumbTop: 0, thumbHeight: 100, active: 0 })

  useEffect(() => {
    const scroll = scrollRef.current
    const rail = railRef.current
    if (!scroll || !rail) return
    let frame = 0
    const update = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => {
        const full = Math.max(scroll.scrollHeight, 1)
        const height = Math.max(rail.clientHeight, 1)
        const scrollTop = scroll.scrollTop
        const scrollRect = scroll.getBoundingClientRect()
        const markers = skills.map((skill, index) => {
          const node = scroll.querySelector(`#passive-efficacy-${index}`)
          const top = node ? node.getBoundingClientRect().top - scrollRect.top + scrollTop : 0
          const source = (node?.dataset.sourceDescription || '')
            .replace(/\{passiveImg:[^}]+\}/g, '').replace(/^[-•]\s*/, '')
          return { index, id: skill.id, top, y: Math.min(height - 8, Math.max(0, top / full * height)), source }
        })
        const active = markers.reduce((last, marker) => marker.top <= scrollTop + 100 ? marker.index : last, 0)
        const thumbHeight = Math.max(24, Math.min(height, scroll.clientHeight / full * height))
        setLayout({ markers, active,
          thumbTop: Math.min(height - thumbHeight, scrollTop / full * height),
          thumbHeight })
      })
    }
    const observer = new ResizeObserver(update)
    observer.observe(scroll)
    const content = scroll.querySelector('.passive-pane')
    if (content) observer.observe(content)
    observer.observe(rail)
    scroll.addEventListener('scroll', update, { passive: true })
    update()
    return () => {
      cancelAnimationFrame(frame)
      observer.disconnect()
      scroll.removeEventListener('scroll', update)
    }
  }, [scrollRef, skills])

  const jumpTo = (index) => {
    const scroll = scrollRef.current
    const node = scroll?.querySelector(`#passive-efficacy-${index}`)
    if (!scroll || !node) return
    const top = node.getBoundingClientRect().top - scroll.getBoundingClientRect().top + scroll.scrollTop
    scroll.scrollTo({ top: Math.max(0, top - 12), behavior: 'smooth' })
  }

  return <nav className="passive-scroll-rail" ref={railRef} aria-label="Đi tới efficacy">
    <div className="passive-rail-track" />
    <div className="passive-rail-thumb" style={{ top: layout.thumbTop, height: layout.thumbHeight }} />
    {layout.markers.map((marker) =>
      <button key={marker.index} type="button"
        className={`passive-rail-marker ${marker.index === layout.active ? 'active' : ''}`}
        style={{ top: marker.y }} onClick={() => jumpTo(marker.index)}
        aria-label={`Efficacy ${marker.index + 1}, ID ${marker.id || 'mới'}${marker.source ? `: ${marker.source}` : ''}`}>
        <span className="passive-rail-tick" />
        <span className="passive-rail-tooltip">
          <strong>Efficacy #{marker.index + 1} · ID {marker.id || 'mới'}</strong>
          <span>{marker.source || 'Chưa có mô tả đối chiếu'}</span>
        </span>
      </button>
    )}
  </nav>
}
