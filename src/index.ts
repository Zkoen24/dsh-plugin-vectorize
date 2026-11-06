/**
 * Model-facing `vectorize_image` tool: turns a PNG/JPEG/WebP raster into clean
 * vector paths (SVG and/or a PDF-compatible Illustrator file) and reports the
 * resulting node economy.
 * @module @deepseek-ai/dsh-plugin-vectorize
 */

import { mkdir, stat, writeFile } from 'node:fs/promises'
import { dirname, extname, isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'
import { DEFAULT_OPTIONS, vectorizeFile } from './vectorize/pipeline.ts'
import { toPdf } from './vectorize/pdf.ts'
import { toSvg } from './vectorize/svg.ts'

export const name = 'vectorize'
export const inject = ['tools']

const DESCRIPTION =
  'Convert a raster image (PNG, JPEG, or WebP) into true vector paths: trace every color plate, '
  + 'fit simplified cubic Bezier curves, and write an SVG and/or a PDF-compatible Illustrator (.ai) file. '
  + 'Use it for logos, icons, decals, line art, and flat illustrations. `colors` sets the palette size '
  + '(2-64); `precision` is the curve tolerance in pixels (smaller keeps detail, larger gives fewer, smoother nodes); '
  + '`max_size` caps the working resolution. The result reports palette, path count, and node count so you can '
  + 'judge how much the lines were optimized. Photographs vectorize into posterized color plates, not faithful copies.'

/** Arguments accepted by the tool body after schema validation. */
interface Args {
  input: string
  output?: string
  format?: 'svg' | 'ai' | 'both'
  colors?: number
  precision?: number
  max_size?: number
  smooth?: number
  alpha?: boolean
  width_mm?: number
}

/** Canonical result value of one vectorization call. */
interface VectorizeValue {
  input: string
  outputs: string[]
  width: number
  height: number
  palette: string[]
  shapes: number
  subpaths: number
  nodes: number
  bytes: number
}

function targetPath(input: string, output: string | undefined, extension: string): string {
  if (output !== undefined && output.trim().length > 0) {
    const resolved = isAbsolute(output) ? output : resolve(output)
    const current = extname(resolved).toLowerCase()
    const wanted = `.${extension}`
    if (current === '.svg' || current === '.ai' || current === '.pdf') {
      return current === wanted ? resolved : resolved.slice(0, -current.length) + wanted
    }
    return resolved + wanted
  }
  return input.replace(/\.[^./\\]+$/, '') + `.${extension}`
}

/**
 * Register the vectorize tool.
 * @param ctx - plugin context; the registration is disposed with it.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'vectorize_image',
    description: DESCRIPTION,
    timeoutMs: 180_000,
    parameters: {
      input: { type: 'string', required: true, description: 'Path to a PNG, JPEG, or WebP image.' },
      output: {
        type: 'string',
        description: 'Output path (SVG or AI). Defaults to the input path with the chosen extension. '
          + 'When format is `both`, the extension selects the directory and both files share the base name.',
      },
      format: {
        type: 'string',
        enum: ['svg', 'ai', 'both'],
        description: 'Output format. `ai` writes a PDF-compatible Illustrator file. Defaults to `svg`.',
      },
      colors: { type: 'integer', description: 'Palette size, 2-64. Defaults to 6; flat logos keep their exact colors.' },
      precision: { type: 'number', description: 'Curve-fitting tolerance in source pixels, 0.2-3. Defaults to 0.8.' },
      max_size: { type: 'integer', description: 'Longest side of the working raster, 64-4096. Defaults to 1600.' },
      smooth: { type: 'integer', description: 'Label smoothing passes, 0-3. Defaults to 1; use 0 for pixel-art crispness.' },
      alpha: {
        type: 'boolean',
        description: 'Preserve translucent pixels as plates with their own fill opacity (soft shadows, fades, gradients). '
          + 'Off by default: pixels under the alpha threshold are then dropped.',
      },
      width_mm: { type: 'number', description: 'Physical artwork width for SVG/AI, in millimetres. Defaults to 100.' },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          input: { type: 'string' },
          outputs: { type: 'array', items: { type: 'string' } },
          width: { type: 'integer' },
          height: { type: 'integer' },
          palette: { type: 'array', items: { type: 'string' } },
          shapes: { type: 'integer' },
          subpaths: { type: 'integer' },
          nodes: { type: 'integer' },
          bytes: { type: 'integer' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: [
          `Vectorized ${value.width}x${value.height}px into ${value.shapes} color plate(s), `
          + `${value.subpaths} subpaths, ${value.nodes} nodes.`,
          `Palette: ${(value.palette ?? []).join(' ')}`,
          ...(value.outputs ?? []).map((path) => `Wrote ${path}`),
        ].join('\n'),
      }],
    },
    async execute(args: Args, exec): Promise<VectorizeValue> {
      if (args.input.trim().length === 0) throw new Error('input must be a non-empty path')
      const input = isAbsolute(args.input) ? args.input : resolve(args.input)
      const info = await stat(input).catch(() => undefined)
      if (info === undefined || !info.isFile()) throw new Error(`no such image file: ${input}`)
      if (exec.signal.aborted) throw new Error('aborted before vectorization started')

      const format = args.format ?? 'svg'
      const colors = Math.min(64, Math.max(2, args.colors ?? DEFAULT_OPTIONS.colors))
      const precision = Math.min(3, Math.max(0.2, args.precision ?? DEFAULT_OPTIONS.precision))
      const maxSize = Math.min(4096, Math.max(64, args.max_size ?? DEFAULT_OPTIONS.maxSize))
      const smooth = Math.min(3, Math.max(0, args.smooth ?? DEFAULT_OPTIONS.smooth))
      const alpha = args.alpha ?? DEFAULT_OPTIONS.alpha
      const widthMm = Math.max(1, args.width_mm ?? DEFAULT_OPTIONS.widthMm)

      const result = await vectorizeFile(input, { colors, precision, maxSize, smooth, widthMm, alpha })
      if (result.shapes.length === 0) throw new Error('no opaque pixels found; nothing to vectorize')

      const outputs: string[] = []
      let bytes = 0
      const write = async (path: string, data: string | Uint8Array): Promise<void> => {
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path, data)
        outputs.push(path)
        bytes += typeof data === 'string' ? Buffer.byteLength(data) : data.byteLength
      }

      if (format === 'svg' || format === 'both') {
        await write(targetPath(input, args.output, 'svg'), toSvg(result, widthMm))
      }
      if (format === 'ai' || format === 'both') {
        await write(targetPath(input, args.output, 'ai'), toPdf(result, widthMm, `Vectorized ${input}`))
      }

      return {
        input,
        outputs,
        width: result.width,
        height: result.height,
        palette: [...result.palette],
        shapes: result.shapes.length,
        subpaths: result.subpaths,
        nodes: result.nodes,
        bytes,
      }
    },
  }))
}



