/**
 * PDF serializer whose output is a PDF-compatible Illustrator file: one artboard
 * per image, real vector paths, no raster fallbacks. Illustrator opens the
 * pages as artboards.
 */
import type { Op, VectorizeResult } from './types.ts'

const MM_TO_PT = 72 / 25.4

/** Format a PDF number. */
function n(value: number): string {
  const s = value.toFixed(4).replace(/0+$/, '').replace(/\.$/, '')
  return s === '-0' ? '0' : s
}

/** Convert one subpath into a PDF path fragment in page points (y flipped). */
function stream(ops: readonly Op[], sx: number, sy: number, pageH: number): string {
  const px = (x: number): string => n(x * sx)
  const py = (y: number): string => n(pageH - y * sy)
  const out: string[] = []
  for (const op of ops) {
    if (op.t === 'M') out.push(`${px(op.p[0])} ${py(op.p[1])} m`)
    else if (op.t === 'L') out.push(`${px(op.p[0])} ${py(op.p[1])} l`)
    else out.push(`${px(op.c1[0])} ${py(op.c1[1])} ${px(op.c2[0])} ${py(op.c2[1])} ${px(op.p[0])} ${py(op.p[1])} c`)
  }
  out.push('h')
  return out.join('\n')
}

function rgb(fill: string): [number, number, number] {
  const r = Number.parseInt(fill.slice(1, 3), 16) / 255
  const g = Number.parseInt(fill.slice(3, 5), 16) / 255
  const b = Number.parseInt(fill.slice(5, 7), 16) / 255
  return [r, g, b]
}

/**
 * Render the traced artwork as a single-page PDF/AI document.
 * @param result - the traced result.
 * @param widthMm - physical width of the artboard.
 * @param title - document title recorded in the info dictionary.
 * @returns the PDF bytes.
 */
export function toPdf(result: VectorizeResult, widthMm: number, title: string): Uint8Array {
  const pageW = widthMm * MM_TO_PT
  const pageH = (pageW * result.height) / result.width
  // PDF y grows upward; flip by emitting (height - y) through a negative scale in points.
  const sx = pageW / result.width
  const sy = pageH / result.height

  const content: string[] = ['q']
  const opacities = new Map<number, string>()
  const gsName = (alpha: number): string => {
    const key = Math.round(alpha * 1000) / 1000
    let name = opacities.get(key)
    if (name === undefined) {
      name = `GS${opacities.size + 1}`
      opacities.set(key, name)
    }
    return name
  }
  for (const shape of result.shapes) {
    const [r, g, b] = rgb(shape.fill)
    if (shape.opacity < 0.999) content.push(`/${gsName(shape.opacity)} gs`)
    content.push(`${n(r)} ${n(g)} ${n(b)} rg`)
    content.push(shape.subpaths.map((ops) => stream(ops, sx, sy, pageH)).join('\n'))
    content.push('f*')
  }
  content.push('Q')
  const streamBytes = Buffer.from(content.join('\n'), 'latin1')

  const objects: string[] = []
  const add = (body: string): number => {
    objects.push(body)
    return objects.length
  }

  const extGState = [...opacities.entries()]
    .map(([alpha, name]) => `/${name} << /Type /ExtGState /ca ${n(alpha)} /CA ${n(alpha)} >>`)
    .join(' ')

  const pagesNum = add('') // placeholder, filled after kids exist
  const catalogNum = add('')
  const contentNum = add(`<< /Length ${streamBytes.length} >>\nstream\n${streamBytes.toString('latin1')}\nendstream`)
  const pageNum = add(
    `<< /Type /Page /Parent ${pagesNum} 0 R /MediaBox [0 0 ${n(pageW)} ${n(pageH)}] `
    + `/Resources << /ProcSet [/PDF]${extGState === '' ? '' : ` /ExtGState << ${extGState} >>`} >> `
    + `/Contents ${contentNum} 0 R >>`,
  )

  objects[pagesNum - 1] = `<< /Type /Pages /Count 1 /Kids [${pageNum} 0 R] >>`
  objects[catalogNum - 1] = `<< /Type /Catalog /Pages ${pagesNum} 0 R >>`

  const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)
  const infoNum = add(
    `<< /Title (${title.replace(/[()\\]/g, ' ')}) /Creator (dsh-vectorize) /Producer (dsh-vectorize) `
    + `/CreationDate (D:${stamp}Z) /ModDate (D:${stamp}Z) >>`,
  )

  const chunks: Buffer[] = []
  let offset = 0
  const push = (text: string): void => {
    const buf = Buffer.from(text, 'latin1')
    chunks.push(buf)
    offset += buf.length
  }
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')
  const offsets: number[] = []
  for (let i = 0; i < objects.length; i++) {
    offsets.push(offset)
    push(`${i + 1} 0 obj\n${objects[i]}\nendobj\n`)
  }
  const startxref = offset
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogNum} 0 R /Info ${infoNum} 0 R >>\n`
  xref += `startxref\n${startxref}\n%%EOF\n`
  push(xref)
  return new Uint8Array(Buffer.concat(chunks))
}
