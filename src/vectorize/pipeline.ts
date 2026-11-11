/**
 * Raster 鈫?vector pipeline: decode, quantize, smooth labels, then trace each
 * color plate. In `alpha` mode a plate is split into connected components and
 * every component (or alpha band inside it) keeps its own fill opacity, so
 * soft shadows, fades, and translucent layers survive.
 */
import sharp from 'sharp'
import { traceMask, polygonArea } from './contour.ts'
import { fitCircleLoop, fitClosedLoop } from './curve.ts'
import { hex, quantize } from './quantize.ts'
import type { Op, Shape, VectorizeOptions, VectorizeResult } from './types.ts'

/** Defaults tuned for flat artwork such as logos, icons, and decals. */
export const DEFAULT_OPTIONS: VectorizeOptions = {
  colors: 6,
  precision: 0.8,
  maxSize: 1600,
  smooth: 1,
  alphaThreshold: 128,
  alpha: false,
  widthMm: 100,
}

/** Decoded raster ready for tracing. */
export interface Raster {
  readonly data: Uint8Array
  readonly width: number
  readonly height: number
}

/** Per-component alpha statistics collected while labelling a plate. */
interface Component {
  minX: number
  minY: number
  maxX: number
  maxY: number
  count: number
  sumA: number
  minA: number
  maxA: number
}

/**
 * Decode a PNG/JPEG/WebP file into straight RGBA bytes, downscaling large inputs.
 * @param input - path to the source image.
 * @param maxSize - longest side of the working raster.
 * @returns the decoded raster.
 */
export async function loadRaster(input: string, maxSize: number): Promise<Raster> {
  const { data, info } = await sharp(input, { failOn: 'error', limitInputPixels: 268_435_456 })
    .rotate()
    .ensureAlpha()
    .resize({
      width: Math.max(16, Math.floor(maxSize)),
      height: Math.max(16, Math.floor(maxSize)),
      fit: 'inside',
      withoutEnlargement: true,
      kernel: 'lanczos3',
    })
    .raw()
    .toBuffer({ resolveWithObject: true })
  if (info.channels !== 4) throw new Error(`unexpected channel count ${info.channels}`)
  return { data: new Uint8Array(data.buffer, data.byteOffset, data.byteLength), width: info.width, height: info.height }
}

/**
 * Majority-filter the label map to remove antialiasing speckle before tracing.
 * @param labels - one palette index per pixel.
 * @param width - raster width.
 * @param height - raster height.
 * @param passes - number of 3x3 passes (0 disables).
 * @returns a new label map.
 */
export function smoothLabels(labels: Uint8Array, width: number, height: number, passes: number): Uint8Array {
  let current = labels
  for (let pass = 0; pass < passes; pass++) {
    const next = new Uint8Array(current.length)
    const counts = new Uint16Array(256)
    const touched: number[] = []
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const center = current[y * width + x]!
        for (let dy = -1; dy <= 1; dy++) {
          const ny = y + dy
          if (ny < 0 || ny >= height) continue
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx
            if (nx < 0 || nx >= width) continue
            const value = current[ny * width + nx]!
            if (counts[value] === 0) touched.push(value)
            counts[value]! += 1
          }
        }
        let best = center
        let bestCount = counts[center]!
        for (const value of touched) {
          const n = counts[value]!
          if (n > bestCount) {
            best = value
            bestCount = n
          }
        }
        for (const value of touched) counts[value] = 0
        touched.length = 0
        next[y * width + x] = best
      }
    }
    current = next
  }
  return current
}

/** Fit one cropped mask into a shape, offsetting the traced coordinates. */
function shapeFromMask(
  mask: Uint8Array,
  maskWidth: number,
  maskHeight: number,
  offsetX: number,
  offsetY: number,
  fill: string,
  opacity: number,
  coverage: number,
  precision: number,
): Shape | null {
  const minArea = Math.max(2, (maskWidth * maskHeight) * 1e-6)
  const subpaths: Op[][] = []
  let nodes = 0
  for (const loop of traceMask(mask, maskWidth, maskHeight)) {
    const area = polygonArea(loop)
    if (area < minArea) continue
    let minX = Infinity
    let minY = Infinity
    let maxX = -Infinity
    let maxY = -Infinity
    for (const point of loop) {
      if (point[0] < minX) minX = point[0]
      if (point[1] < minY) minY = point[1]
      if (point[0] > maxX) maxX = point[0]
      if (point[1] > maxY) maxY = point[1]
    }
    const width = maxX - minX
    const height = maxY - minY
    // Hairline slivers from threshold noise are not editable artwork.
    if (Math.min(width, height) < 1.5 && area < 6) continue
    const shifted = loop.map(([x, y]) => [x + offsetX, y + offsetY] as const)
    const small = Math.max(width, height) <= 24
    const ops = fitCircleLoop(shifted, precision, small) ?? fitClosedLoop(shifted, precision)
    if (ops === null) continue
    subpaths.push(ops)
    nodes += ops.length
  }
  if (subpaths.length === 0 || nodes === 0) return null
  return { fill, coverage, opacity, subpaths, nodes }
}

/**
 * Vectorize a decoded raster.
 * @param raster - decoded RGBA pixels.
 * @param options - palette, smoothing, fitting, and transparency controls.
 * @returns the traced result.
 */
export function vectorizeRaster(raster: Raster, options: VectorizeOptions): VectorizeResult {
  const { width, height, data } = raster
  const pixelCount = width * height
  const quantized = quantize(data, width, height, options)
  const labels = options.smooth > 0
    ? smoothLabels(quantized.labels, width, height, Math.min(3, options.smooth))
    : quantized.labels

  const coverage = new Float64Array(quantized.palette.length)
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i]!
    if (label !== 255) coverage[label]! += 1
  }

  const minPlate = Math.max(4, pixelCount * 1e-5)
  const shapes: Shape[] = []

  for (let index = 0; index < quantized.palette.length; index++) {
    if (coverage[index]! < minPlate) continue
    const fill = hex(quantized.palette[index]!)
    const mask = new Uint8Array(pixelCount)
    for (let i = 0; i < labels.length; i++) if (labels[i] === index) mask[i] = 1

    if (!options.alpha) {
      const shape = shapeFromMask(mask, width, height, 0, 0, fill, 1, coverage[index]!, options.precision)
      if (shape !== null) shapes.push(shape)
      continue
    }

    // Alpha mode: split the plate into connected components, then into alpha
    // bands inside a component whose transparency actually varies.
    const comp = new Int32Array(pixelCount)
    const components: Component[] = []
    const stack: number[] = []
    for (let start = 0; start < pixelCount; start++) {
      if (mask[start] !== 1 || comp[start] !== 0) continue
      const id = components.length + 1
      const stats: Component = {
        minX: width, minY: height, maxX: 0, maxY: 0, count: 0, sumA: 0, minA: 255, maxA: 0,
      }
      stack.push(start)
      comp[start] = id
      while (stack.length > 0) {
        const p = stack.pop()!
        const x = p % width
        const y = (p - x) / width
        const a = data[p * 4 + 3]!
        stats.count += 1
        stats.sumA += a
        if (a < stats.minA) stats.minA = a
        if (a > stats.maxA) stats.maxA = a
        if (x < stats.minX) stats.minX = x
        if (y < stats.minY) stats.minY = y
        if (x > stats.maxX) stats.maxX = x
        if (y > stats.maxY) stats.maxY = y
        if (x > 0 && mask[p - 1] === 1 && comp[p - 1] === 0) { comp[p - 1] = id; stack.push(p - 1) }
        if (x + 1 < width && mask[p + 1] === 1 && comp[p + 1] === 0) { comp[p + 1] = id; stack.push(p + 1) }
        if (y > 0 && mask[p - width] === 1 && comp[p - width] === 0) { comp[p - width] = id; stack.push(p - width) }
        if (y + 1 < height && mask[p + width] === 1 && comp[p + width] === 0) { comp[p + width] = id; stack.push(p + width) }
      }
      components.push(stats)
    }

    for (let c = 0; c < components.length; c++) {
      const stats = components[c]!
      const id = c + 1
      const cw = stats.maxX - stats.minX + 1
      const ch = stats.maxY - stats.minY + 1

      // Decide from the alpha distribution whether this component is solid with
      // antialiased edges (one opaque shape), uniformly translucent (one shape
      // with that opacity), or a real gradient across its body (alpha bands).
      const hist = new Uint32Array(256)
      for (let y = stats.minY; y <= stats.maxY; y++) {
        for (let x = stats.minX; x <= stats.maxX; x++) {
          const p = y * width + x
          if (comp[p] !== id) continue
          hist[data[p * 4 + 3]!]! += 1
        }
      }
      const percentile = (fraction: number): number => {
        const target = stats.count * fraction
        let seen = 0
        for (let a = 0; a < 256; a++) {
          seen += hist[a]!
          if (seen >= target) return a
        }
        return 255
      }
      const solid = (() => {
        let n = 0
        for (let a = 230; a < 256; a++) n += hist[a]!
        return n / stats.count
      })()
      const median = percentile(0.5)
      if (median < 5) continue
      let bands = 1
      let low = median
      let high = median
      // Small components are dots and marks: their alpha falls off radially from
      // the antialiased rim, so banding would shred one dot into concentric
      // rings. Keep them whole and let the median carry the opacity instead.
      const small = Math.max(cw, ch) <= 24
      if (!small && solid < 0.5) {
        const p15 = percentile(0.15)
        const p85 = percentile(0.85)
        if (p85 - p15 >= 32) {
          bands = Math.min(4, Math.max(2, Math.ceil((p85 - p15) / 32)))
          low = p15
          high = p85
        }
      }

      const cropped = new Uint8Array(cw * ch)
      const bandStats = Array.from({ length: bands }, () => ({ count: 0, sumA: 0 }))
      for (let y = stats.minY; y <= stats.maxY; y++) {
        for (let x = stats.minX; x <= stats.maxX; x++) {
          const p = y * width + x
          if (comp[p] !== id) continue
          const a = data[p * 4 + 3]!
          const band = bands === 1
            ? 0
            : Math.min(bands - 1, Math.max(0, Math.floor(((a - low) / Math.max(1, high - low)) * bands)))
          cropped[(y - stats.minY) * cw + (x - stats.minX)] = band + 1
          bandStats[band]!.count += 1
          bandStats[band]!.sumA += a
        }
      }
      for (let band = 0; band < bands; band++) {
        const info = bandStats[band]!
        if (info.count === 0) continue
        const bandMask = new Uint8Array(cw * ch)
        for (let i = 0; i < cropped.length; i++) if (cropped[i] === band + 1) bandMask[i] = 1
        // A nearly opaque body with antialiased edges is opaque art, not a 91% layer.
        const opacity = bands === 1
          ? (median >= 230 ? 1 : Math.max(0.02, median / 255))
          : Math.max(0.02, Math.min(1, info.sumA / info.count / 255))
        const shape = shapeFromMask(
          bandMask, cw, ch, stats.minX, stats.minY, fill, opacity, info.count, options.precision,
        )
        if (shape !== null) shapes.push(shape)
      }
    }
  }

  shapes.sort((a, b) => b.coverage - a.coverage)
  const subpaths = shapes.reduce((n, shape) => n + shape.subpaths.length, 0)
  const nodes = shapes.reduce((n, shape) => n + shape.nodes, 0)
  return {
    width,
    height,
    shapes,
    palette: quantized.palette.map(hex),
    subpaths,
    nodes,
    hasTransparency: quantized.hasTransparency,
  }
}

/**
 * Vectorize an image file in one call.
 * @param input - path to a PNG, JPEG, or WebP image.
 * @param overrides - partial option overrides.
 * @returns the traced result.
 */
export async function vectorizeFile(
  input: string,
  overrides: Partial<VectorizeOptions> = {},
): Promise<VectorizeResult> {
  const options = { ...DEFAULT_OPTIONS, ...overrides }
  const raster = await loadRaster(input, options.maxSize)
  return vectorizeRaster(raster, options)
}

