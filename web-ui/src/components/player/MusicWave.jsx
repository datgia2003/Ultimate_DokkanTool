import React, { useEffect, useRef } from 'react'

// The waveform owns no audio nodes and never triggers React renders per beat.
export function MusicWave({ className = '' }) {
  const canvasRef = useRef(null)
  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    const jukeboxMode = className.split(/\s+/).includes('jukebox-wave')
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)')
    const target = new Float32Array(24)
    const current = new Float32Array(24)
    const bandTarget = new Float32Array(56)
    const bandCurrent = new Float32Array(56)
    const peaks = new Float32Array(56)
    const peakHold = new Float64Array(56)
    let raf = 0, last = 0, width = 300, height = 64, visible = true
    let accent = '#66d9ff'
    const draw = (time) => {
      raf = 0
      if (!visible || document.hidden || reduced.matches) return
      if (time - last < 33) { raf = requestAnimationFrame(draw); return }
      const elapsed = Math.min(64, time - last || 33) / 1000
      last = time
      let energy = 0
      for (let i = 0; i < 24; i++) {
        current[i] += (target[i] - current[i]) * 0.35
        energy += current[i] + target[i]
      }
      for (let i = 0; i < bandCurrent.length; i++) {
        const smoothing = 1 - Math.exp(-elapsed / (bandTarget[i] > bandCurrent[i] ? 0.035 : 0.12))
        bandCurrent[i] += (bandTarget[i] - bandCurrent[i]) * smoothing
        if (bandCurrent[i] >= peaks[i]) {
          peaks[i] = bandCurrent[i]
          peakHold[i] = time + 160
        } else if (time > peakHold[i]) {
          peaks[i] = Math.max(bandCurrent[i], peaks[i] - elapsed * 0.6)
        }
        energy += bandCurrent[i] + bandTarget[i]
        if (jukeboxMode) energy += peaks[i]
      }
      ctx.clearRect(0, 0, width, height)
      ctx.strokeStyle = accent
      if (jukeboxMode) {
        const baseline = height * 0.76
        const plotHeight = baseline - 12
        const count = bandCurrent.length
        const slot = width / count
        const fill = ctx.createLinearGradient(0, baseline - plotHeight, 0, baseline)
        fill.addColorStop(0, '#f0fff7')
        fill.addColorStop(0.38, accent)
        fill.addColorStop(1, accent + '66')
        ctx.globalAlpha = 0.07
        ctx.strokeStyle = '#c3e4db'
        ctx.lineWidth = 1
        for (let row = 1; row <= 3; row++) {
          const y = baseline - plotHeight * row / 3
          ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
        }
        for (let i = 0; i < count; i++) {
          const amplitude = Math.max(1, bandCurrent[i] * plotHeight)
          const barWidth = Math.max(2, slot * 0.55)
          const x = i * slot + (slot - barWidth) / 2
          ctx.fillStyle = fill
          ctx.globalAlpha = 0.9
          ctx.beginPath()
          ctx.roundRect(x, baseline - amplitude, barWidth, amplitude, Math.min(2, amplitude / 2))
          ctx.fill()
          ctx.fillStyle = accent
          ctx.globalAlpha = 0.1
          ctx.fillRect(x, baseline + 4, barWidth, amplitude * 0.18)
          if (peaks[i] > 0.025) {
            ctx.fillStyle = '#defff0'
            ctx.globalAlpha = 0.55
            ctx.fillRect(x, baseline - peaks[i] * plotHeight - 3, barWidth, 1.5)
          }
        }
        ctx.globalAlpha = 0.16
        ctx.fillStyle = accent
        ctx.fillRect(0, baseline, width, 1)
        ctx.globalAlpha = 1
        if (energy > 0.003) raf = requestAnimationFrame(draw)
        return
      }
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
      bandTarget.fill(0)
      if (event.detail?.bands) bandTarget.set(event.detail.bands.subarray(0, bandTarget.length))
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
  }, [className])
  return <canvas ref={canvasRef} className={`music-wave ${className}`} aria-hidden="true" />
}
