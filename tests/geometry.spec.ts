import { describe, expect, it } from 'vitest'
import { traceMask, polygonArea } from '../src/vectorize/contour.ts'
import { fitCircleLoop, fitClosedLoop, rdpClosed } from '../src/vectorize/curve.ts'
import type { Vec } from '../src/vectorize/types.ts'

function rectMask(w: number, h: number, x0: number, y0: number, x1: number, y1: number): Uint8Array {
  const mask = new Uint8Array(w * h)
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) mask[y * w + x] = 1
  return mask
}

describe('traceMask', () => {
  it('traces one closed contour around a rectangle', () => {
    const loops = traceMask(rectMask(40, 30, 5, 5, 25, 20), 40, 30)
    expect(loops).toHaveLength(1)
    const loop = loops[0]!
    const first = loop[0]!
    const last = loop[loop.length - 1]!
    expect(last).toEqual(first)
    expect(Math.abs(polygonArea(loop) - 20 * 15)).toBeLessThan(1)
    const xs = loop.map((p) => p[0])
    const ys = loop.map((p) => p[1])
    expect(Math.min(...xs)).toBe(5)
    expect(Math.max(...xs)).toBe(25)
    expect(Math.min(...ys)).toBe(5)
    expect(Math.max(...ys)).toBe(20)
  })

  it('returns an inner contour for a hole', () => {
    const mask = rectMask(40, 30, 5, 5, 30, 25)
    for (let y = 12; y < 18; y++) for (let x = 12; x < 22; x++) mask[y * 40 + x] = 0
    const loops = traceMask(mask, 40, 30)
    expect(loops).toHaveLength(2)
    for (const loop of loops) expect(loop[loop.length - 1]).toEqual(loop[0])
  })
})

describe('curve fitting', () => {
  const circle: Vec[] = Array.from({ length: 180 }, (_, i) => {
    const t = (i / 180) * Math.PI * 2
    return [60 + 40 * Math.cos(t), 60 + 40 * Math.sin(t)] as Vec
  })

  it('simplifies a dense contour', () => {
    expect(rdpClosed(circle, 0.5).length).toBeLessThan(40)
  })

  it('fits a closed loop whose samples stay near the circle', () => {
    const ops = fitClosedLoop(circle, 0.8)
    expect(ops).not.toBeNull()
    expect(ops!.length).toBeGreaterThan(2)
    expect(ops![0]!.t).toBe('M')
    const last = ops![ops!.length - 1]!
    expect(Math.hypot(last.p[0] - ops![0]!.p[0], last.p[1] - ops![0]!.p[1])).toBeLessThan(0.001)
    expect(ops!.filter((op) => op.t === 'C').length).toBeGreaterThan(1)
  })

  it('collapses a round contour into four exact arcs', () => {
    const ops = fitCircleLoop(circle, 0.8)
    expect(ops).not.toBeNull()
    expect(ops!).toHaveLength(5)
    const curves = ops!.filter((op) => op.t === 'C')
    expect(curves).toHaveLength(4)
    const radius = 40
    const center = [60, 60]
    // Anchors sit exactly on the circle; sampled curve points stay within a
    // fraction of a pixel of it (control points sit outside, as they must).
    for (const op of ops!) {
      expect(Math.abs(Math.hypot(op.p[0] - center[0]!, op.p[1] - center[1]!) - radius)).toBeLessThan(0.01)
    }
    let previous: Vec = (ops![0] as { p: Vec }).p
    for (const op of curves) {
      for (let step = 1; step <= 8; step++) {
        const t = step / 8
        const mt = 1 - t
        const x = mt ** 3 * previous[0] + 3 * mt ** 2 * t * op.c1[0] + 3 * mt * t ** 2 * op.c2[0] + t ** 3 * op.p[0]
        const y = mt ** 3 * previous[1] + 3 * mt ** 2 * t * op.c1[1] + 3 * mt * t ** 2 * op.c2[1] + t ** 3 * op.p[1]
        expect(Math.abs(Math.hypot(x - center[0]!, y - center[1]!) - radius)).toBeLessThan(0.3)
      }
      previous = op.p
    }
  })

  it('leaves a square alone instead of rounding it', () => {
    const square: Vec[] = [
      [10, 10], [50, 10], [50, 50], [10, 50],
    ]
    expect(fitCircleLoop(square, 0.8)).toBeNull()
  })
})

