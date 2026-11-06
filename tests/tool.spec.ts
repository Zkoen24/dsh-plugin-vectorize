import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { apply } from '../src/index.ts'

/** Minimal tool-registry stub: records definitions, returns a disposer. */
function stubContext() {
  const registered: any[] = []
  return {
    registered,
    ctx: { tools: { register: (definition: any) => { registered.push(definition); return () => {} } } } as any,
  }
}

describe('vectorize_image tool', () => {
  let dir = ''
  let png = ''

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), 'dsh-vectorize-'))
    png = join(dir, 'badge.png')
    await sharp({
      create: { width: 120, height: 80, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
    })
      .composite([{
        input: Buffer.from(
          `<svg xmlns="http://www.w3.org/2000/svg" width="120" height="80">`
          + `<rect x="20" y="20" width="80" height="40" rx="12" fill="#ff0000"/></svg>`,
        ),
      }])
      .png()
      .toFile(png)
  })

  afterAll(async () => {
    await rm(dir, { recursive: true, force: true })
  })

  it('registers a named tool with a canonical output schema', () => {
    const { ctx, registered } = stubContext()
    apply(ctx)
    expect(registered).toHaveLength(1)
    expect(registered[0].name).toBe('vectorize_image')
    expect(registered[0].output.schema.type).toBe('object')
  })

  it('writes SVG and AI output and reports path statistics', async () => {
    const { ctx, registered } = stubContext()
    apply(ctx)
    const value = await registered[0].execute(
      { input: png, format: 'both', colors: 4, precision: 1, max_size: 240, width_mm: 60 },
      { signal: new AbortController().signal },
    )
    expect(value.outputs).toHaveLength(2)
    expect(value.width).toBeGreaterThan(0)
    expect(value.shapes).toBeGreaterThanOrEqual(1)
    expect(value.palette).toContain('#ff0000')
    const svg = await readFile(value.outputs.find((p: string) => p.endsWith('.svg'))!, 'utf8')
    expect(svg).toContain('<svg')
    expect(svg).toContain('#ff0000')
    const ai = await readFile(value.outputs.find((p: string) => p.endsWith('.ai'))!)
    expect(ai.subarray(0, 8).toString()).toBe('%PDF-1.4')
  })

  it('rejects a missing input file', async () => {
    const { ctx, registered } = stubContext()
    apply(ctx)
    await expect(registered[0].execute(
      { input: join(dir, 'missing.png') },
      { signal: new AbortController().signal },
    )).rejects.toThrow(/no such image file/)
  })
})
