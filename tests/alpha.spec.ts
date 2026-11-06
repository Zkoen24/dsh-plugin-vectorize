import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { vectorizeFile } from '../src/vectorize/pipeline.ts'
import { toPdf } from '../src/vectorize/pdf.ts'
import { toSvg } from '../src/vectorize/svg.ts'

describe('alpha preservation', () => {
  let dir = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-vectorize-alpha-'))
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('keeps a uniformly translucent square translucent', async () => {
    const file = join(dir, 'half.png')
    await sharp({
      create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'
          + '<rect x="20" y="20" width="80" height="40" fill="#ff0000" fill-opacity="0.5"/></svg>',
        ),
      }])
      .png()
      .toFile(file)

    const result = await vectorizeFile(file, { alpha: true, colors: 4, precision: 1, maxSize: 240 })
    expect(result.shapes).toHaveLength(1)
    expect(result.shapes[0]!.opacity).toBeGreaterThan(0.42)
    expect(result.shapes[0]!.opacity).toBeLessThan(0.58)

    const svg = toSvg(result, 50)
    expect(svg).toMatch(/fill-opacity="0\.(4|5)/)

    const pdf = Buffer.from(toPdf(result, 50, 'half')).toString('latin1')
    expect(pdf).toContain('/ExtGState')
    expect(pdf).toMatch(/\/ca 0\.(4|5)/)
  })

  it('splits a gradient body into opacity bands', async () => {
    const file = join(dir, 'ramp.png')
    const width = 200
    const height = 60
    const raw = Buffer.alloc(width * height * 4)
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const i = (y * width + x) * 4
        raw[i] = 20
        raw[i + 1] = 120
        raw[i + 2] = 220
        raw[i + 3] = Math.round((x / (width - 1)) * 255)
      }
    }
    await sharp(raw, { raw: { width, height, channels: 4 } }).png().toFile(file)

    const result = await vectorizeFile(file, { alpha: true, colors: 2, precision: 1, maxSize: 200, smooth: 0 })
    expect(result.shapes.length).toBeGreaterThan(1)
    const opacities = result.shapes.map((shape) => shape.opacity).sort((a, b) => a - b)
    expect(opacities[0]!).toBeLessThan(0.4)
    expect(opacities[opacities.length - 1]!).toBeGreaterThan(0.6)
  })

  it('treats opaque art as fully opaque even with soft edges', async () => {
    const file = join(dir, 'opaque.png')
    await sharp({
      create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">'
          + '<rect x="20" y="20" width="80" height="40" fill="#ff0000"/></svg>',
        ),
      }])
      .png()
      .toFile(file)

    const result = await vectorizeFile(file, { alpha: true, colors: 4, precision: 1, maxSize: 240 })
    expect(result.shapes).toHaveLength(1)
    expect(result.shapes[0]!.opacity).toBe(1)
    expect(toSvg(result, 50)).not.toContain('fill-opacity')
  })
})
