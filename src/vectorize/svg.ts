/** SVG serialization: one compound path per color plate, even-odd filled. */
import type { Op, VectorizeResult } from './types.ts'

/** Format a coordinate without trailing zero noise. */
function num(value: number): string {
  const rounded = Math.round(value * 100) / 100
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2).replace(/0+$/, '').replace(/\.$/, '')
}

/**
 * Serialize one subpath as SVG path data.
 * @param ops - the subpath drawing ops, starting with M.
 * @returns SVG `d` fragment.
 */
export function pathData(ops: readonly Op[]): string {
  const parts: string[] = []
  for (const op of ops) {
    if (op.t === 'M') parts.push(`M${num(op.p[0])} ${num(op.p[1])}`)
    else if (op.t === 'L') parts.push(`L${num(op.p[0])} ${num(op.p[1])}`)
    else parts.push(`C${num(op.c1[0])} ${num(op.c1[1])} ${num(op.c2[0])} ${num(op.c2[1])} ${num(op.p[0])} ${num(op.p[1])}`)
  }
  parts.push('Z')
  return parts.join(' ')
}

/**
 * Render the traced artwork as a standalone SVG document.
 * @param result - the traced result.
 * @param widthMm - physical width of the artwork.
 * @returns the SVG source.
 */
export function toSvg(result: VectorizeResult, widthMm: number): string {
  const heightMm = (widthMm * result.height) / result.width
  const lines: string[] = []
  lines.push('<?xml version="1.0" encoding="UTF-8"?>')
  lines.push(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${num(widthMm)}mm" height="${num(heightMm)}mm" `
    + `viewBox="0 0 ${result.width} ${result.height}">`,
  )
  lines.push(`<title>Vectorized artwork (${result.width}x${result.height})</title>`)
  for (const shape of result.shapes) {
    const d = shape.subpaths.map(pathData).join(' ')
    const alpha = shape.opacity < 0.999 ? ` fill-opacity="${Math.round(shape.opacity * 1000) / 1000}"` : ''
    lines.push(`<path fill="${shape.fill}"${alpha} fill-rule="evenodd" d="${d}"/>`)
  }
  lines.push('</svg>')
  return lines.join('\n') + '\n'
}
