// One AudioContext/analyser and one sampler for both music players and all visuals.
let context = null
let analyser = null
let bins = null
let active = null
let timer = 0
const sources = new Set()
const levels = new Float32Array(24)
const eventName = 'dokkan:character-ost-spectrum'

function publish(detail) {
  window.dispatchEvent(new CustomEvent(eventName, { detail }))
}
function stopSampling() {
  clearTimeout(timer)
  timer = 0
  levels.fill(0)
  publish(null)
}
function sample() {
  timer = 0
  if (!active || active.audio.paused || document.hidden) return
  analyser.getByteFrequencyData(bins)
  for (let i = 0; i < levels.length; i++) {
    const lo = Math.floor(1 + (i / levels.length) ** 1.8 * 180)
    const hi = Math.max(lo + 1, Math.floor(1 + ((i + 1) / levels.length) ** 1.8 * 180))
    let energy = 0
    for (let k = lo; k < hi; k++) energy += bins[k]
    const target = energy / ((hi - lo) * 255)
    levels[i] += (target - levels[i]) * (target > levels[i] ? 0.65 : 0.28)
  }
  publish({ levels, bass: (levels[0] + levels[1] + levels[2]) / 3 })
  timer = window.setTimeout(sample, 50) // 20 Hz analysis; visuals interpolate separately.
}
function visibilityChanged() {
  clearTimeout(timer)
  timer = 0
  if (document.hidden) publish(null)
  else if (active && !active.audio.paused) sample()
}

export function createMusicSource(audio) {
  let source = null
  let bass = null
  let clarity = null
  let presence = null
  let compressor = null
  let transition = null
  let transitionTimer = 0
  let settleTransition = null
  let transitionLevel = 1
  let punch = false
  let eqEnabled = true
  let disposed = false
  const handle = {
    audio,
    start() {
      if (disposed) return
      try {
        if (!context) {
          const AC = window.AudioContext || window.webkitAudioContext
          if (!AC) return
          context = new AC()
          analyser = context.createAnalyser()
          analyser.fftSize = 512
          analyser.smoothingTimeConstant = 0.65
          bins = new Uint8Array(analyser.frequencyBinCount)
          analyser.connect(context.destination)
        }
        if (!source) {
          source = context.createMediaElementSource(audio)
          bass = context.createBiquadFilter()
          bass.type = 'lowshelf'
          bass.frequency.value = 115
          clarity = context.createBiquadFilter()
          clarity.type = 'peaking'
          clarity.frequency.value = 320
          clarity.Q.value = 0.8
          clarity.gain.value = -1.3
          presence = context.createBiquadFilter()
          presence.type = 'highshelf'
          presence.frequency.value = 3600
          compressor = context.createDynamicsCompressor()
          compressor.threshold.value = -16
          compressor.knee.value = 18
          compressor.ratio.value = 2
          compressor.attack.value = 0.012
          compressor.release.value = 0.22
          transition = context.createGain()
          transition.gain.value = transitionLevel
          source.connect(bass).connect(clarity).connect(presence).connect(compressor).connect(transition).connect(analyser)
          handle.setPunch(punch)
          handle.setEqEnabled(eqEnabled)
        }
        active = handle
        void context.resume().catch(() => {})
        clearTimeout(timer)
        sample()
      } catch (error) {
        console.warn('Music visualization unavailable:', error)
      }
    },
    stop() {
      if (active !== handle) return
      active = null
      stopSampling()
    },
    setPunch(value) {
      punch = value
      if (!bass) return
      bass.gain.setTargetAtTime(!eqEnabled ? 0 : value ? 4.2 : 2.2, context.currentTime, 0.05)
      presence.gain.setTargetAtTime(!eqEnabled ? 0 : value ? 2.5 : 1.4, context.currentTime, 0.05)
      clarity.gain.setTargetAtTime(eqEnabled ? -1.3 : 0, context.currentTime, 0.05)
    },
    setEqEnabled(value) {
      eqEnabled = value
      if (!bass) return
      bass.gain.setTargetAtTime(!value ? 0 : punch ? 4.2 : 2.2, context.currentTime, 0.05)
      clarity.gain.setTargetAtTime(value ? -1.3 : 0, context.currentTime, 0.05)
      presence.gain.setTargetAtTime(!value ? 0 : punch ? 2.5 : 1.4, context.currentTime, 0.05)
    },
    setTransitionGain(value) {
      transitionLevel = Math.max(0, Math.min(1, value))
      if (transition) transition.gain.value = transitionLevel
    },
    cancelFade() {
      clearTimeout(transitionTimer)
      transitionTimer = 0
      if (settleTransition) settleTransition(false)
      settleTransition = null
    },
    fadeTo(target, duration = 280) {
      handle.cancelFade()
      if (disposed) return Promise.resolve(false)
      const from = transitionLevel
      const to = Math.max(0, Math.min(1, target))
      const started = performance.now()
      if (duration <= 0 || Math.abs(from - to) < 0.001) {
        handle.setTransitionGain(to)
        return Promise.resolve(true)
      }
      return new Promise(resolve => {
        settleTransition = resolve
        const tick = () => {
          const progress = Math.min(1, (performance.now() - started) / duration)
          const eased = progress * progress * (3 - 2 * progress)
          handle.setTransitionGain(from + (to - from) * eased)
          if (progress < 1 && !disposed) transitionTimer = setTimeout(tick, 16)
          else {
            transitionTimer = 0
            settleTransition = null
            resolve(!disposed)
          }
        }
        tick()
      })
    },
    dispose() {
      if (disposed) return
      disposed = true
      handle.cancelFade()
      handle.stop()
      audio.pause()
      audio.removeAttribute('src')
      audio.load()
      source?.disconnect()
      bass?.disconnect()
      clarity?.disconnect()
      presence?.disconnect()
      compressor?.disconnect()
      transition?.disconnect()
      sources.delete(handle)
      if (!sources.size) {
        document.removeEventListener('visibilitychange', visibilityChanged)
        analyser?.disconnect()
        void context?.close().catch(() => {})
        context = analyser = bins = null
      }
    }
  }
  if (!sources.size) document.addEventListener('visibilitychange', visibilityChanged)
  sources.add(handle)
  return handle
}
