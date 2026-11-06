/**
 * Verify an installed copy of the plugin (plain Node, no tsx):
 *   node plugins/vectorize/tests/verify-installed.mjs <absolute path to lib/index.js>
 * Checks alpha preservation on a halftone, an opaque logo, and a synthetic ramp.
 */
import { mkdtemp, readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import sharp from 'sharp'

const target = process.argv[2]
if (!target) throw new Error('usage: verify-installed.mjs <lib/index.js>')

const { apply } = await import(pathToFileURL(target).href)
const registered = []
apply({ tools: { register: (definition) => { registered.push(definition); return () => {} } } })
const tool = registered[0]
const call = (args) => tool.execute(args, { signal: new AbortController().signal })
const dir = await mkdtemp(join(tmpdir(), 'dsh-verify-'))

const lid = await call({
  input: 'E:/deepseek/vectorize/lid3.png', output: join(dir, 'lid'), format: 'both',
  colors: 4, alpha: true, max_size: 600,
})
console.log('lid alpha  :', `${lid.width}x${lid.height}`, lid.shapes, 'objects,', lid.subpaths, 'subpaths,', lid.nodes, 'nodes')

const plain = await call({ input: 'E:/deepseek/vectorize/face.webp', output: join(dir, 'face'), format: 'svg', colors: 3 })
const alpha = await call({ input: 'E:/deepseek/vectorize/face.webp', output: join(dir, 'face-a'), format: 'svg', colors: 3, alpha: true })
console.log('face plain :', plain.shapes, 'objects,', plain.nodes, 'nodes')
console.log('face alpha :', alpha.shapes, 'objects,', alpha.nodes, 'nodes')

const w = 160
const h = 40
const raw = Buffer.alloc(w * h * 4)
for (let y = 0; y < h; y++) {
  for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4
    raw[i] = 10
    raw[i + 1] = 90
    raw[i + 2] = 200
    raw[i + 3] = Math.round((x / (w - 1)) * 255)
  }
}
await sharp(raw, { raw: { width: w, height: h, channels: 4 } }).png().toFile(join(dir, 'ramp.png'))
const ramp = await call({ input: join(dir, 'ramp.png'), output: join(dir, 'ramp'), format: 'both', colors: 2, alpha: true, max_size: 160 })
const svg = await readFile(join(dir, 'ramp.svg'), 'utf8')
const opacities = [...svg.matchAll(/fill-opacity="([\d.]+)"/g)].map((m) => Number(m[1])).sort((a, b) => a - b)
console.log('gradient   :', ramp.shapes, 'objects, opacity', opacities[0], '->', opacities[opacities.length - 1])
const pdf = (await readFile(join(dir, 'ramp.ai'))).toString('latin1')
console.log('gradient ai: ExtGState', pdf.includes('/ExtGState'), '| ca entries', (pdf.match(/\/ca /g) ?? []).length)
console.log('artifacts  :', dir)
