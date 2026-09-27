export function encodeLoopingWav(audioBuffer) {
  const channels = 2
  const frameCount = audioBuffer.length
  const dataLength = frameCount * channels * 2
  const buffer = new ArrayBuffer(112 + dataLength)
  const view = new DataView(buffer)
  const writeText = (offset, value) => [...value].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  writeText(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); writeText(8, 'WAVE')
  writeText(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true)
  view.setUint16(22, channels, true); view.setUint32(24, 44100, true); view.setUint32(28, 44100 * channels * 2, true)
  view.setUint16(32, channels * 2, true); view.setUint16(34, 16, true)
  writeText(36, 'smpl'); view.setUint32(40, 60, true)
  view.setUint32(44, 0, true); view.setUint32(48, 0, true); view.setUint32(52, Math.round(1e9 / 44100), true)
  view.setUint32(56, 60, true); view.setUint32(60, 0, true); view.setUint32(64, 0, true)
  view.setUint32(68, 1, true); view.setUint32(72, 0, true)
  view.setUint32(76, 0, true); view.setUint32(80, 0, true); view.setUint32(84, 0, true)
  view.setUint32(88, frameCount - 1, true); view.setUint32(92, 0, true); view.setUint32(96, 0, true)
  writeText(104, 'data'); view.setUint32(108, dataLength, true)
  const left = audioBuffer.getChannelData(0)
  const right = audioBuffer.getChannelData(1)
  let offset = 112
  for (let i = 0; i < frameCount; i++) {
    for (const sample of [left[i], right[i]]) {
      const value = Math.max(-1, Math.min(1, sample))
      view.setInt16(offset, value < 0 ? value * 0x8000 : value * 0x7fff, true)
      offset += 2
    }
  }
  return buffer
}
