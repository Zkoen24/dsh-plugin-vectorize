/**
 * Trace every closed boundary of a binary mask.
 * @param mask - one byte per pixel, non-zero means "inside".
 * @param width - raster width in pixels.
 * @param height - raster height in pixels.
 * @returns closed contours in pixel coordinates (pixel corners at integers).
 */
export function traceMask(mask, width, height) {
    const w = width;
    const h = height;
    const stride = w + 2;
    const padded = new Uint8Array((w + 2) * (h + 2));
    for (let y = 0; y < h; y++) {
        const from = y * w;
        padded.set(mask.subarray(from, from + w), (y + 1) * stride + 1);
    }
    const K = 2 * w + 3;
    const segments = [];
    for (let j = 0; j <= h; j++) {
        const row0 = j * stride;
        const row1 = row0 + stride;
        for (let i = 0; i <= w; i++) {
            const a = padded[row0 + i];
            const b = padded[row0 + i + 1];
            const c = padded[row1 + i + 1];
            const d = padded[row1 + i];
            if (a === b && b === c && c === d)
                continue;
            const x2 = 2 * i;
            const y2 = 2 * j;
            const top = y2 * K + (x2 + 1);
            const right = (y2 + 1) * K + (x2 + 2);
            const bottom = (y2 + 2) * K + (x2 + 1);
            const left = (y2 + 1) * K + x2;
            const inside = a | (b << 1) | (c << 2) | (d << 3);
            switch (inside) {
                case 1:
                    segments.push([left, top]);
                    break;
                case 2:
                    segments.push([top, right]);
                    break;
                case 3:
                    segments.push([left, right]);
                    break;
                case 4:
                    segments.push([right, bottom]);
                    break;
                case 5:
                    // Diagonal foreground corners stay separate (4-connected foreground).
                    segments.push([left, top], [right, bottom]);
                    break;
                case 6:
                    segments.push([top, bottom]);
                    break;
                case 7:
                    segments.push([left, bottom]);
                    break;
                case 8:
                    segments.push([bottom, left]);
                    break;
                case 9:
                    segments.push([bottom, top]);
                    break;
                case 10:
                    segments.push([top, right], [left, bottom]);
                    break;
                case 11:
                    segments.push([right, bottom]);
                    break;
                case 12:
                    segments.push([right, left]);
                    break;
                case 13:
                    segments.push([top, right]);
                    break;
                case 14:
                    segments.push([left, top]);
                    break;
                default: break;
            }
        }
    }
    if (globalThis.__TRACE_DEBUG) {
        globalThis.__SEGS = segments;
        console.log('TRACE segments', segments.length, 'w', w, 'h', h);
    }
    const adjacency = new Map();
    for (let s = 0; s < segments.length; s++) {
        const [p, q] = segments[s];
        const listP = adjacency.get(p);
        if (listP === undefined)
            adjacency.set(p, [s]);
        else
            listP.push(s);
        const listQ = adjacency.get(q);
        if (listQ === undefined)
            adjacency.set(q, [s]);
        else
            listQ.push(s);
    }
    const used = new Uint8Array(segments.length);
    const loops = [];
    for (let start = 0; start < segments.length; start++) {
        if (used[start] === 1)
            continue;
        used[start] = 1;
        const [p0, q0] = segments[start];
        const keys = [p0, q0];
        let cursor = q0;
        let previous = start;
        for (let guard = 0; guard <= segments.length; guard++) {
            const candidates = adjacency.get(cursor);
            if (candidates === undefined)
                break;
            let next = -1;
            for (const candidate of candidates) {
                if (candidate !== previous && used[candidate] === 0) {
                    next = candidate;
                    break;
                }
            }
            if (next < 0) {
                if (globalThis.__TRACE_DEBUG && keys.length > 1000)
                    console.log('DEADEND at', cursor % K / 2, ((cursor - cursor % K) / K) / 2, 'cands', JSON.stringify(candidates), 'prev', previous);
                break;
            }
            used[next] = 1;
            const [a, b] = segments[next];
            const other = a === cursor ? b : a;
            keys.push(other);
            previous = next;
            cursor = other;
            if (other === p0)
                break;
        }
        if (keys.length < 4)
            continue;
        const loop = new Array(keys.length);
        for (let k = 0; k < keys.length; k++) {
            const key = keys[k];
            const x = key % K;
            const y = (key - x) / K;
            loop[k] = [x / 2 - 0.5, y / 2 - 0.5];
        }
        loops.push(loop);
    }
    return loops;
}
/**
 * Absolute polygon area of a closed contour.
 * @param points - closed contour.
 * @returns area in square pixels.
 */
export function polygonArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i++) {
        const a = points[i];
        const b = points[(i + 1) % points.length];
        sum += a[0] * b[1] - b[0] * a[1];
    }
    return Math.abs(sum) / 2;
}
