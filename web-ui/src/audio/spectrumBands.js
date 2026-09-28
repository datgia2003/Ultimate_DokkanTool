// Logarithmic bands measured in linear power, then mapped from dB to display height.
// Byte FFT data clips at the analyser's default -30 dB ceiling on loud music.
export function createFrequencyRanges(sampleRate, fftSize, count = 56) {
  const binHz = sampleRate / fftSize
  const minHz = 60
  const maxHz = Math.min(16000, sampleRate * 0.45)
  const ranges = []
  let previous = Math.max(1, Math.floor(minHz / binHz))
  for (let i = 0; i < count; i++) {
    const edge = minHz * (maxHz / minHz) ** ((i + 1) / count)
    const end = Math.min(fftSize / 2, Math.max(previous + 1, Math.floor(edge / binHz)))
    ranges.push([previous, end])
    previous = end
  }
  return ranges
}

export function measureFrequencyBands(frequencies, ranges, output) {
  for (let i = 0; i < ranges.length; i++) {
    const [start, end] = ranges[i]
    let power = 0
    for (let bin = start; bin < end; bin++) {
      const db = frequencies[bin]
      if (Number.isFinite(db)) power += 10 ** (db / 10)
    }
    const db = power > 0 ? 10 * Math.log10(power / (end - start)) : -Infinity
    const height = Math.max(0, Math.min(1, (db + 80) / 68))
    output[i] = height ** 1.35
  }
  return output
}
