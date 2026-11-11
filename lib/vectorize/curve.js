import { polygonArea } from "./contour.js";
const EPS = 1e-12;
const KAPPA = 0.5522847498307936;
/** Subtract two points. */
function sub(a, b) {
    return [a[0] - b[0], a[1] - b[1]];
}
/** Add two points. */
function add(a, b) {
    return [a[0] + b[0], a[1] + b[1]];
}
/** Scale a vector. */
function mul(a, k) {
    return [a[0] * k, a[1] * k];
}
/** Euclidean length. */
function len(a) {
    return Math.hypot(a[0], a[1]);
}
/** Unit vector, or the zero vector for a degenerate input. */
function unit(a) {
    const l = len(a);
    return l < EPS ? [0, 0] : [a[0] / l, a[1] / l];
}
/**
 * Simplify a closed polygon with Ramer-Douglas-Peucker.
 * @param points - the closed contour.
 * @param eps - maximum deviation in pixels.
 * @returns the kept vertices, still closed.
 */
export function rdpClosed(points, eps) {
    const n = points.length;
    if (n <= 3)
        return points.slice();
    const keep = new Uint8Array(n);
    let far = 0;
    let best = -1;
    for (let i = 1; i < n; i++) {
        const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
        if (d > best) {
            best = d;
            far = i;
        }
    }
    keep[0] = 1;
    keep[far] = 1;
    const stack = [[0, far], [far, n]];
    while (stack.length > 0) {
        const [a, b] = stack.pop();
        if (b - a <= 1)
            continue;
        const pa = points[a % n];
        const pb = points[b % n];
        const ab = sub(pb, pa);
        const l = len(ab);
        let maxD = -1;
        let maxI = -1;
        for (let i = a + 1; i < b; i++) {
            const p = points[i % n];
            const d = l < EPS
                ? Math.hypot(p[0] - pa[0], p[1] - pa[1])
                : Math.abs(ab[0] * (p[1] - pa[1]) - ab[1] * (p[0] - pa[0])) / l;
            if (d > maxD) {
                maxD = d;
                maxI = i;
            }
        }
        if (maxD > eps && maxI > 0) {
            keep[maxI % n] = 1;
            stack.push([a, maxI], [maxI, b]);
        }
    }
    const out = [];
    for (let i = 0; i < n; i++)
        if (keep[i] === 1)
            out.push(points[i]);
    return out;
}
/**
 * Flag vertices where the contour turns more sharply than `angleDeg` over a window.
 * @param points - simplified closed contour.
 * @param angleDeg - turn threshold in degrees (default 58).
 * @param span - neighbour distance used to measure direction.
 * @returns one flag per vertex.
 */
export function cornerFlags(points, angleDeg = 58, span = 5) {
    const n = points.length;
    const flags = new Array(n).fill(false);
    if (n < 8)
        return flags;
    const cosLimit = Math.cos((angleDeg * Math.PI) / 180);
    for (let i = 0; i < n; i++) {
        const v1 = unit(sub(points[i], points[(i - span + n) % n]));
        const v2 = unit(sub(points[(i + span) % n], points[i]));
        if ((v1[0] === 0 && v1[1] === 0) || (v2[0] === 0 && v2[1] === 0))
            continue;
        if (v1[0] * v2[0] + v1[1] * v2[1] < cosLimit)
            flags[i] = true;
    }
    return flags;
}
/** Evaluate a cubic at parameter values. */
function bez(p0, c1, c2, p3, u) {
    return u.map((t) => {
        const m = 1 - t;
        const a = m * m * m;
        const b = 3 * m * m * t;
        const c = 3 * m * t * t;
        const d = t * t * t;
        return [
            a * p0[0] + b * c1[0] + c * c2[0] + d * p3[0],
            a * p0[1] + b * c1[1] + c * c2[1] + d * p3[1],
        ];
    });
}
/** First derivative of a cubic at parameter values. */
function bezD1(p0, c1, c2, p3, u) {
    return u.map((t) => {
        const m = 1 - t;
        const a = 3 * m * m;
        const b = 6 * m * t;
        const c = 3 * t * t;
        return [
            a * (c1[0] - p0[0]) + b * (c2[0] - c1[0]) + c * (p3[0] - c2[0]),
            a * (c1[1] - p0[1]) + b * (c2[1] - c1[1]) + c * (p3[1] - c2[1]),
        ];
    });
}
/** Second derivative of a cubic at parameter values. */
function bezD2(p0, c1, c2, p3, u) {
    return u.map((t) => {
        const m = 1 - t;
        return [
            6 * m * (c2[0] - 2 * c1[0] + p0[0]) + 6 * t * (p3[0] - 2 * c2[0] + c1[0]),
            6 * m * (c2[1] - 2 * c1[1] + p0[1]) + 6 * t * (p3[1] - 2 * c2[1] + c1[1]),
        ];
    });
}
/** Chord-length parameterisation of a polyline. */
function chordParam(points) {
    const u = [0];
    let total = 0;
    for (let i = 1; i < points.length; i++) {
        total += len(sub(points[i], points[i - 1]));
        u.push(total);
    }
    if (total < EPS)
        return points.map((_, i) => (i === 0 ? 0 : i / (points.length - 1)));
    return u.map((v) => v / total);
}
/** Least-squares control points for fixed end tangents. */
function generateBezier(points, u, t1, t2) {
    const p0 = points[0];
    const p3 = points[points.length - 1];
    let c00 = 0;
    let c01 = 0;
    let c11 = 0;
    let x0 = 0;
    let x1 = 0;
    for (let i = 0; i < points.length; i++) {
        const t = u[i];
        const m = 1 - t;
        const b0 = m * m * m;
        const b1 = 3 * t * m * m;
        const b2 = 3 * t * t * m;
        const b3 = t * t * t;
        const a1x = t1[0] * b1;
        const a1y = t1[1] * b1;
        const a2x = t2[0] * b2;
        const a2y = t2[1] * b2;
        const tmpX = points[i][0] - (b0 * p0[0] + b3 * p3[0]);
        const tmpY = points[i][1] - (b0 * p0[1] + b3 * p3[1]);
        c00 += a1x * a1x + a1y * a1y;
        c01 += a1x * a2x + a1y * a2y;
        c11 += a2x * a2x + a2y * a2y;
        x0 += a1x * tmpX + a1y * tmpY;
        x1 += a2x * tmpX + a2y * tmpY;
    }
    const det = c00 * c11 - c01 * c01;
    let alpha1 = 0;
    let alpha2 = 0;
    if (Math.abs(det) > EPS) {
        alpha1 = (x0 * c11 - x1 * c01) / det;
        alpha2 = (c00 * x1 - c01 * x0) / det;
    }
    const chord = Math.max(len(sub(p3, p0)), EPS);
    if (alpha1 < 1e-4 * chord || alpha2 < 1e-4 * chord) {
        alpha1 = chord / 3;
        alpha2 = chord / 3;
    }
    return [p0, add(p0, mul(t1, alpha1)), add(p3, mul(t2, alpha2)), p3];
}
/** Maximum deviation between the fitted curve samples and the input points. */
function maxError(points, c, u) {
    const q = bez(c[0], c[1], c[2], c[3], u);
    let err = -1;
    let index = 0;
    for (let i = 0; i < q.length; i++) {
        const d = len(sub(q[i], points[i]));
        if (d > err) {
            err = d;
            index = i;
        }
    }
    return { err, index };
}
/** One Newton-Raphson reparameterisation step. */
function reparameterize(points, u, c) {
    const d = bez(c[0], c[1], c[2], c[3], u).map((q, i) => sub(q, points[i]));
    const d1 = bezD1(c[0], c[1], c[2], c[3], u);
    const d2 = bezD2(c[0], c[1], c[2], c[3], u);
    return u.map((t, i) => {
        const num = d[i][0] * d1[i][0] + d[i][1] * d1[i][1];
        const den = d1[i][0] ** 2 + d1[i][1] ** 2 + d[i][0] * d2[i][0] + d[i][1] * d2[i][1];
        const next = Math.abs(den) < EPS ? t : t - num / den;
        return Math.min(1, Math.max(0, Number.isFinite(next) ? next : t));
    });
}
/** Largest distance from samples to the control polyline; guards against bowing. */
function polylineDistance(samples, poly) {
    let worst = 0;
    for (const s of samples) {
        let best = Infinity;
        for (let i = 0; i + 1 < poly.length; i++) {
            const a = poly[i];
            const b = poly[i + 1];
            const abx = b[0] - a[0];
            const aby = b[1] - a[1];
            const l2 = Math.max(abx * abx + aby * aby, EPS);
            const t = Math.min(1, Math.max(0, ((s[0] - a[0]) * abx + (s[1] - a[1]) * aby) / l2));
            const qx = a[0] + t * abx;
            const qy = a[1] + t * aby;
            const d = Math.hypot(s[0] - qx, s[1] - qy);
            if (d < best)
                best = d;
        }
        if (best > worst)
            worst = best;
    }
    return worst;
}
/** Dense bow check between the curve body and its control polygon. */
function bowOk(c, poly, error) {
    const u = [];
    for (let i = 0; i <= 32; i++)
        u.push(i / 32);
    const samples = bez(c[0], c[1], c[2], c[3], u).slice(1, -1);
    return polylineDistance(samples, poly) <= error * 1.6;
}
/**
 * Fit cubic segments through a polyline with fixed end tangents, splitting
 * recursively until every segment stays within `error`.
 * @param points - span samples, first to last.
 * @param t1 - unit tangent leaving the first point.
 * @param t2 - unit tangent entering the last point.
 * @param error - maximum allowed deviation in pixels.
 * @returns cubic segments in order.
 */
export function fitCubic(points, t1, t2, error) {
    if (points.length === 2) {
        const d = len(sub(points[1], points[0])) / 3;
        return [[points[0], add(points[0], mul(t1, d)), add(points[1], mul(t2, d)), points[1]]];
    }
    let u = chordParam(points);
    let curve = generateBezier(points, u, t1, t2);
    let { err, index } = maxError(points, curve, u);
    if (err <= error && bowOk(curve, points, error))
        return [curve];
    if (err <= error * 4) {
        for (let pass = 0; pass < 6; pass++) {
            const u2 = reparameterize(points, u, curve);
            const curve2 = generateBezier(points, u2, t1, t2);
            const measured = maxError(points, curve2, u2);
            if (measured.err <= error && bowOk(curve2, points, error))
                return [curve2];
            if (measured.err < err) {
                u = u2;
                curve = curve2;
                err = measured.err;
                index = measured.index;
            }
        }
    }
    const split = Math.max(1, Math.min(index, points.length - 2));
    let tangent = sub(points[split - 1], points[split + 1]);
    if (len(tangent) < 1e-9)
        tangent = sub(points[split - 1], points[split]);
    const center = unit(tangent);
    return [
        ...fitCubic(points.slice(0, split + 1), t1, center, error),
        ...fitCubic(points.slice(split), [-center[0], -center[1]], t2, error),
    ];
}
/**
 * Recognise a contour that is round within tolerance and express it as four
 * exact cubic arcs. Halftone dots and counters then cost five ops instead of a
 * dozen staircase-fitted segments.
 *
 * The radius comes from the enclosed area and the centre from the area
 * centroid, so a staircase contour keeps the dot's true size instead of growing
 * by the pixel grid. With `fallback`, a small round-ish blob that fails the
 * strict radial test (noise, a clipped rim) is still emitted as a clean circle.
 * @param loop - dense closed contour in pixel coordinates.
 * @param tolerance - allowed radial error in pixels.
 * @param fallback - accept a round-ish blob when the strict test fails.
 * @returns circle ops, or null when the contour is not circular enough.
 */
export function fitCircleLoop(loop, tolerance, fallback = false) {
    if (loop.length < 8)
        return null;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const point of loop) {
        if (point[0] < minX)
            minX = point[0];
        if (point[1] < minY)
            minY = point[1];
        if (point[0] > maxX)
            maxX = point[0];
        if (point[1] > maxY)
            maxY = point[1];
    }
    const width = maxX - minX;
    const height = maxY - minY;
    if (width < 2 || height < 2)
        return null;
    const aspect = Math.max(width, height) / Math.min(width, height);
    if (aspect > 1.35)
        return null;
    // Area centroid and area-equivalent radius (shoelace).
    let cross = 0;
    let cxAcc = 0;
    let cyAcc = 0;
    for (let i = 0; i < loop.length; i++) {
        const a = loop[i];
        const b = loop[(i + 1) % loop.length];
        const c = a[0] * b[1] - b[0] * a[1];
        cross += c;
        cxAcc += (a[0] + b[0]) * c;
        cyAcc += (a[1] + b[1]) * c;
    }
    const area = Math.abs(cross) / 2;
    if (area < 2.5 || Math.abs(cross) < EPS)
        return null;
    const cx = cxAcc / (3 * cross);
    const cy = cyAcc / (3 * cross);
    const r = Math.sqrt(area / Math.PI);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || r < 1.2)
        return null;
    let deviation = 0;
    for (const point of loop) {
        deviation = Math.max(deviation, Math.abs(Math.hypot(point[0] - cx, point[1] - cy) - r));
    }
    const allowed = Math.max(0.75, r * 0.18, tolerance * 0.7);
    const fill = area / (width * height);
    if (deviation > allowed) {
        if (!fallback || aspect > 1.6 || fill < 0.55 || fill > 0.95)
            return null;
    }
    const k = r * KAPPA;
    return [
        { t: 'M', p: [cx + r, cy] },
        { t: 'C', c1: [cx + r, cy + k], c2: [cx + k, cy + r], p: [cx, cy + r] },
        { t: 'C', c1: [cx - k, cy + r], c2: [cx - r, cy + k], p: [cx - r, cy] },
        { t: 'C', c1: [cx - r, cy - k], c2: [cx - k, cy - r], p: [cx, cy - r] },
        { t: 'C', c1: [cx + k, cy - r], c2: [cx + r, cy - k], p: [cx + r, cy] },
    ];
}
/**
 * Fit one closed contour into a single subpath of lines and cubics.
 * @param loop - dense closed contour in pixel coordinates.
 * @param tol - maximum deviation in pixels.
 * @returns the drawing ops, or null when the contour is degenerate.
 */
export function fitClosedLoop(loop, tol) {
    let points = rdpClosed(loop, Math.max(tol * 0.55, 0.3));
    const n = points.length;
    if (n < 3)
        return null;
    const flags = cornerFlags(points);
    const corners = [];
    for (let i = 0; i < n; i++)
        if (flags[i])
            corners.push(i);
    let spans;
    if (corners.length >= 2) {
        const shift = corners[0];
        points = [...points.slice(shift), ...points.slice(0, shift)];
        const rotated = cornerFlags(points);
        const cs = [];
        for (let i = 0; i < n; i++)
            if (rotated[i])
                cs.push(i);
        spans = cs.map((c, k) => [c, k + 1 < cs.length ? cs[k + 1] : n]);
    }
    else {
        let far = Math.floor(n / 2);
        if (n > 12) {
            let best = -1;
            for (let i = 1; i < n; i++) {
                const d = Math.hypot(points[i][0] - points[0][0], points[i][1] - points[0][1]);
                if (d > best) {
                    best = d;
                    far = i;
                }
            }
        }
        if (far < 4)
            far = Math.floor(n / 2);
        spans = [[0, far], [far, n]];
    }
    const ext = [...points, points[0]];
    const ops = [{ t: 'M', p: points[0] }];
    for (const [a, b] of spans) {
        const span = ext.slice(a, b + 1);
        if (span.length < 2)
            continue;
        const start = span[0];
        const end = span[span.length - 1];
        const chord = sub(end, start);
        const chordLength = len(chord);
        if (chordLength < 1e-6)
            continue;
        if (chordLength > 1.5) {
            let dev = 0;
            for (const p of span) {
                const rel = sub(p, start);
                dev = Math.max(dev, Math.abs(chord[0] * rel[1] - chord[1] * rel[0]) / chordLength);
            }
            if (dev <= tol * 0.7) {
                ops.push({ t: 'L', p: end });
                continue;
            }
        }
        const t1 = unit(sub(span[1], start));
        const t2 = unit(sub(span[span.length - 2], end));
        for (const [, c1, c2, p3] of fitCubic(span, t1, t2, tol)) {
            ops.push({ t: 'C', c1, c2, p: p3 });
        }
    }
    const last = ops[ops.length - 1];
    if (last.t === 'C')
        ops[ops.length - 1] = { t: 'C', c1: last.c1, c2: last.c2, p: points[0] };
    else
        ops[ops.length - 1] = { t: 'L', p: points[0] };
    return ops;
}
