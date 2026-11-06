/**
 * Command-line front end for the vectorizer, used for batch work and for
 * verifying the pipeline without starting an agent session.
 *
 *   node --import tsx plugins/vectorize/src/cli.ts input.png --format both --colors 4
 */

import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { DEFAULT_OPTIONS, vectorizeFile } from './vectorize/pipeline.ts'
import { toPdf } from './vectorize/pdf.ts'
import { toSvg } from './vectorize/svg.ts'

/** Parsed command-line options. */
interface CliOptions {
  input: string
  output?: string
  format: 'svg' | 'ai' | 'both'
  colors: number
  precision: number
  maxSize: number
  smooth: number
  alpha: boolean
  widthMm: number
}

function usage(): never {
  console.error(
    'usage: cli.ts <input.png|jpg> [--out path] [--format svg|ai|both] [--colors 2-64] '
    + '[--precision 0.2-3] [--max-size 64-4096] [--smooth 0-3] [--width-mm 100]',
  )
  process.exit(2)
}

function parse(argv: readonly string[]): CliOptions {
  let input = ''
  let output: string | undefined
  let format: CliOptions['format'] = 'svg'
  let colors = DEFAULT_OPTIONS.colors
  let precision = DEFAULT_OPTIONS.precision
  let maxSize = DEFAULT_OPTIONS.maxSize
  let smooth = DEFAULT_OPTIONS.smooth
  let alpha = DEFAULT_OPTIONS.alpha
  let widthMm = DEFAULT_OPTIONS.widthMm
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!
    const next = (): string => {
      const value = argv[++i]
      if (value === undefined) usage()
      return value
    }
    switch (arg) {
      case '--out': output = next(); break
      case '--format': {
        const value = next()
        if (value !== 'svg' && value !== 'ai' && value !== 'both') usage()
        format = value
        break
      }
      case '--colors': colors = Number(next()); break
      case '--precision': precision = Number(next()); break
      case '--max-size': maxSize = Number(next()); break
      case '--smooth': smooth = Number(next()); break
      case '--alpha': alpha = true; break
      case '--width-mm': widthMm = Number(next()); break
      case '--help': usage(); break
      default:
        if (arg.startsWith('--')) usage()
        input = arg
    }
  }
  if (input === '') usage()
  return { input, ...(output === undefined ? {} : { output }), format, colors, precision, maxSize, smooth, alpha, widthMm }
}

async function main(): Promise<void> {
  const options = parse(process.argv.slice(2))
  const started = Date.now()
  const result = await vectorizeFile(options.input, {
    colors: Math.min(64, Math.max(2, options.colors)),
    precision: Math.min(3, Math.max(0.2, options.precision)),
    maxSize: Math.min(4096, Math.max(64, options.maxSize)),
    smooth: Math.min(3, Math.max(0, options.smooth)),
    alpha: options.alpha,
    widthMm: options.widthMm,
  })
  const base = options.output ?? options.input.replace(/\.[^./\\]+$/, '')
  const jobs: Array<[string, string | Uint8Array]> = []
  if (options.format === 'svg' || options.format === 'both') jobs.push([`${base}.svg`, toSvg(result, options.widthMm)])
  if (options.format === 'ai' || options.format === 'both') {
    jobs.push([`${base}.ai`, toPdf(result, options.widthMm, `Vectorized ${options.input}`)])
  }
  for (const [path, data] of jobs) {
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, data)
  }
  console.log(
    `${options.input} -> ${result.width}x${result.height}px, ${result.shapes.length} plates, `
    + `${result.subpaths} subpaths, ${result.nodes} nodes, ${Date.now() - started}ms`,
  )
  console.log(`palette: ${result.palette.join(' ')}`)
  for (const [path] of jobs) console.log(`wrote ${path}`)
}

await main()




