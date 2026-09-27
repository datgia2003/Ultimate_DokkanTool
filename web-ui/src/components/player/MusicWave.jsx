import React, { useEffect, useRef } from 'react'

// The waveform owns no audio nodes and never triggers React renders per beat.
export function MusicWave({ className = '' }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const target = new Float32Array(24)
    const current = new Float32Array(24)
    let raf = 0, last = 0, width = 300, height = 64, visible = true
    let accent = '#66d9ff'
    const draw = (time) => {
      raf = 0
      if (!visible || document.hidden || reduced.matches) return
      if (time - last < 33) { raf = requestAnimationFrame(draw); return }
      last = time
      let energy = 0
      for (let i = 0; i < 24; i++) {
        current[i] += (target[i] - current[i]) * 0.35
        energy += current[i] + target[i]
      }
      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = accent
      for (let layer = 0; layer < 3; layer++) {
        ctx.globalAlpha = [0.65, 0.28, 0.12][layer]
        ctx.lineWidth = layer === 0 ? 1.6 : 1
        ctx.beginPath()
        for (let x = 0; x <= width; x += 3) {
          const p = x / width
          const index = p * 23
          const i = Math.floor(index)
          const amplitude = current[i] * (1 - index + i) + current[Math.min(23, i + 1)] * (index - i)
          const envelope = Math.sin(p * Math.PI)
          const y = height / 2 + Math.sin(p * Math.PI * (6 + layer * 2) + time * 0.0015 + layer) * amplitude * height * 0.42 * envelope
          if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
        }
        ctx.stroke()
      }
      if (energy > 0.01) raf = requestAnimationFrame(draw)
    }
    const wake = () => { if (!raf && visible && !document.hidden && !reduced.matches) raf = requestAnimationFrame(draw) }
    const onSpectrum = (event) => {
      target.fill(0)
      if (event.detail?.levels) target.set(event.detail.levels.subarray(0, 24))
      wake()
    }
    const resize = new ResizeObserver(([entry]) => {
      width = Math.max(1, entry.contentRect.width)
      height = Math.max(1, entry.contentRect.height)
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5)
      canvas.width = Math.round(width * dpr)
      canvas.height = Math.round(height * dpr)
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      accent = getComputedStyle(canvas).getPropertyValue('--accent').trim() || '#66d9ff'
      wake()
    })
    resize.observe(canvas)
    const observer = new IntersectionObserver(([entry]) => {
      visible = entry.isIntersecting
      if (!visible) { cancelAnimationFrame(raf); raf = 0 } else wake()
    })
    observer.observe(canvas)
    const onVisibility = () => {
      if (document.hidden || reduced.matches) {
        cancelAnimationFrame(raf); raf = 0
        ctx.clearRect(0, 0, width, height)
      } else wake()
    }
    document.addEventListener('visibilitychange', onVisibility)
    reduced.addEventListener('change', onVisibility)
    window.addEventListener('dokkan:character-ost-spectrum', onSpectrum)
    return () => {
      cancelAnimationFrame(raf)
      resize.disconnect(); observer.disconnect()
      document.removeEventListener('visibilitychange', onVisibility)
      reduced.removeEventListener('change', onVisibility)
      window.removeEventListener('dokkan:character-ost-spectrum', onSpectrum)
    }
  }, [])
  return <canvas ref={canvasRef} className={`music-wave ${className}`} aria-hidden="true" />
}
