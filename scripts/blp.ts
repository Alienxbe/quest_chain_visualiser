/**
 * Minimal BLP2 decoder (the WoW client's texture format), enough for world map tiles:
 * DXT1/3/5, palettized and uncompressed BGRA. Only the top mip level is decoded.
 */

export interface Image {
  width: number
  height: number
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8Array
}

export function decodeBlp(buf: Uint8Array): Image {
  const view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
  const magic = String.fromCharCode(...buf.subarray(0, 4))
  if (magic !== 'BLP2') throw new Error(`Not a BLP2 file (${magic})`)
  const compression = buf[8]
  const alphaDepth = buf[9]
  const alphaType = buf[10]
  const width = view.getUint32(12, true)
  const height = view.getUint32(16, true)
  const offset = view.getUint32(20, true)
  const size = view.getUint32(20 + 64, true)
  const src = buf.subarray(offset, offset + size)
  const out = new Uint8Array(width * height * 4)

  if (compression === 1) {
    // Palettized: 256 BGRA palette entries, then one index byte per pixel, then alpha bits.
    const paletteAt = 20 + 128
    const n = width * height
    for (let i = 0; i < n; i++) {
      const p = paletteAt + src[i] * 4
      out[i * 4] = buf[p + 2]
      out[i * 4 + 1] = buf[p + 1]
      out[i * 4 + 2] = buf[p]
      out[i * 4 + 3] = paletteAlpha(src, n, i, alphaDepth)
    }
  } else if (compression === 2) {
    const kind = alphaDepth <= 1 ? 1 : alphaType === 7 ? 5 : 3
    decodeDxt(src, width, height, kind, out)
  } else if (compression === 3) {
    for (let i = 0; i < width * height; i++) {
      out[i * 4] = src[i * 4 + 2]
      out[i * 4 + 1] = src[i * 4 + 1]
      out[i * 4 + 2] = src[i * 4]
      out[i * 4 + 3] = src[i * 4 + 3]
    }
  } else {
    throw new Error(`Unsupported BLP compression ${compression}`)
  }
  return { width, height, data: out }
}

function paletteAlpha(src: Uint8Array, n: number, i: number, depth: number): number {
  if (depth === 0) return 255
  if (depth === 8) return src[n + i]
  if (depth === 1) return (src[n + (i >> 3)] >> (i & 7)) & 1 ? 255 : 0
  if (depth === 4) return ((src[n + (i >> 1)] >> ((i & 1) * 4)) & 0xf) * 17
  return 255
}

function rgb565(c: number): [number, number, number] {
  const r = (c >> 11) & 0x1f
  const g = (c >> 5) & 0x3f
  const b = c & 0x1f
  return [(r << 3) | (r >> 2), (g << 2) | (g >> 4), (b << 3) | (b >> 2)]
}

function decodeDxt(src: Uint8Array, width: number, height: number, kind: 1 | 3 | 5, out: Uint8Array) {
  const blockSize = kind === 1 ? 8 : 16
  const bw = Math.max(1, Math.ceil(width / 4))
  const bh = Math.max(1, Math.ceil(height / 4))
  const colours = new Uint8Array(16)
  const alpha = new Uint8Array(16)
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      const at = (by * bw + bx) * blockSize
      const colourAt = kind === 1 ? at : at + 8
      alpha.fill(255)
      if (kind === 3) {
        for (let i = 0; i < 16; i++) alpha[i] = ((src[at + (i >> 1)] >> ((i & 1) * 4)) & 0xf) * 17
      } else if (kind === 5) {
        const a0 = src[at]
        const a1 = src[at + 1]
        const table = [a0, a1]
        if (a0 > a1) for (let k = 1; k < 7; k++) table.push(((7 - k) * a0 + k * a1) / 7 | 0)
        else {
          for (let k = 1; k < 5; k++) table.push(((5 - k) * a0 + k * a1) / 5 | 0)
          table.push(0, 255)
        }
        // 48 bits of 3-bit indices; read as two 24-bit halves to stay within int range.
        for (let half = 0; half < 2; half++) {
          const bits = src[at + 2 + half * 3] | (src[at + 3 + half * 3] << 8) | (src[at + 4 + half * 3] << 16)
          for (let i = 0; i < 8; i++) alpha[half * 8 + i] = table[(bits >> (i * 3)) & 7]
        }
      }
      const c0 = src[colourAt] | (src[colourAt + 1] << 8)
      const c1 = src[colourAt + 2] | (src[colourAt + 3] << 8)
      const p0 = rgb565(c0)
      const p1 = rgb565(c1)
      const palette: [number, number, number, number][] = [[...p0, 255], [...p1, 255]]
      if (c0 > c1 || kind !== 1) {
        palette.push(
          [(2 * p0[0] + p1[0]) / 3 | 0, (2 * p0[1] + p1[1]) / 3 | 0, (2 * p0[2] + p1[2]) / 3 | 0, 255],
          [(p0[0] + 2 * p1[0]) / 3 | 0, (p0[1] + 2 * p1[1]) / 3 | 0, (p0[2] + 2 * p1[2]) / 3 | 0, 255],
        )
      } else {
        palette.push([(p0[0] + p1[0]) >> 1, (p0[1] + p1[1]) >> 1, (p0[2] + p1[2]) >> 1, 255], [0, 0, 0, 0])
      }
      const bits = (src[colourAt + 4] | (src[colourAt + 5] << 8) | (src[colourAt + 6] << 16) | (src[colourAt + 7] << 24)) >>> 0
      for (let i = 0; i < 16; i++) colours[i] = (bits >>> (i * 2)) & 3
      for (let py = 0; py < 4; py++) {
        const y = by * 4 + py
        if (y >= height) break
        for (let px = 0; px < 4; px++) {
          const x = bx * 4 + px
          if (x >= width) break
          const i = py * 4 + px
          const c = palette[colours[i]]
          const o = (y * width + x) * 4
          out[o] = c[0]
          out[o + 1] = c[1]
          out[o + 2] = c[2]
          out[o + 3] = kind === 1 ? c[3] : alpha[i]
        }
      }
    }
  }
}
