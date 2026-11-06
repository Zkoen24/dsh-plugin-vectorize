const BINS = 1 << 15;
/** Format an RGB triple as `#rrggbb`. */
export function hex(color) {
    const to = (v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0');
    return `#${to(color[0])}${to(color[1])}${to(color[2])}`;
}
function histogram(rgba, threshold) {
    const count = new Float64Array(BINS);
    const sumR = new Float64Array(BINS);
    const sumG = new Float64Array(BINS);
    const sumB = new Float64Array(BINS);
    let transparent = false;
    for (let i = 0; i < rgba.length; i += 4) {
        const a = rgba[i + 3];
        if (a < threshold) {
            transparent = true;
            continue;
        }
        const r = rgba[i];
        const g = rgba[i + 1];
        const b = rgba[i + 2];
        const bin = ((r >> 3) << 10) | ((g >> 3) << 5) | (b >> 3);
        count[bin] += 1;
        sumR[bin] += r;
        sumG[bin] += g;
        sumB[bin] += b;
    }
    const ids = [];
    for (let bin = 0; bin < BINS; bin++)
        if (count[bin] > 0)
            ids.push(bin);
    return { stats: { count, sumR, sumG, sumB, ids }, transparent };
}
function boxColor(stats, bins) {
    let n = 0;
    let r = 0;
    let g = 0;
    let b = 0;
    for (const bin of bins) {
        n += stats.count[bin];
        r += stats.sumR[bin];
        g += stats.sumG[bin];
        b += stats.sumB[bin];
    }
    if (n === 0)
        return [0, 0, 0];
    return [r / n, g / n, b / n];
}
function splitBox(stats, box) {
    if (box.bins.length < 2)
        return null;
    const mean = (bin) => {
        const n = stats.count[bin] || 1;
        return [stats.sumR[bin] / n, stats.sumG[bin] / n, stats.sumB[bin] / n];
    };
    const colors = box.bins.map(mean);
    const ranges = [];
    for (let axis = 0; axis < 3; axis++) {
        let lo = Infinity;
        let hi = -Infinity;
        for (const c of colors) {
            const v = c[axis];
            if (v < lo)
                lo = v;
            if (v > hi)
                hi = v;
        }
        ranges.push([lo, hi]);
    }
    let axis = 0;
    for (let k = 1; k < 3; k++) {
        if (ranges[k][1] - ranges[k][0] > ranges[axis][1] - ranges[axis][0])
            axis = k;
    }
    const order = box.bins
        .map((bin, i) => ({ bin, v: colors[i][axis] }))
        .sort((left, right) => left.v - right.v);
    let half = 0;
    for (const entry of order)
        half += stats.count[entry.bin];
    half /= 2;
    let running = 0;
    let cut = 1;
    for (let i = 0; i < order.length - 1; i++) {
        running += stats.count[order[i].bin];
        cut = i + 1;
        if (running >= half)
            break;
    }
    const left = order.slice(0, cut).map((e) => e.bin);
    const right = order.slice(cut).map((e) => e.bin);
    if (left.length === 0 || right.length === 0)
        return null;
    const weight = (bins) => bins.reduce((n, bin) => n + stats.count[bin], 0);
    return [
        { bins: left, count: weight(left) },
        { bins: right, count: weight(right) },
    ];
}
/**
 * Reduce a raster to at most `colors` palette entries and label every pixel.
 * @param rgba - decoded RGBA bytes (row-major).
 * @param width - raster width.
 * @param height - raster height.
 * @param options - palette size, alpha preservation, and the transparent threshold.
 * @returns palette, per-pixel labels, and whether transparent pixels exist.
 */
export function quantize(rgba, width, height, options) {
    const labelThreshold = options.alpha ? 5 : options.alphaThreshold;
    // Palette colors are learned from confident pixels only: faint antialiasing
    // must join its shape's plate, not invent a fringe color.
    const paletteThreshold = options.alpha ? 128 : options.alphaThreshold;
    let { stats, transparent } = histogram(rgba, paletteThreshold);
    if (stats.ids.length === 0)
        ({ stats, transparent } = histogram(rgba, labelThreshold));
    if (stats.ids.length === 0) {
        return { palette: [], labels: new Uint8Array(width * height).fill(255), hasTransparency: transparent };
    }
    const target = Math.max(2, Math.min(options.colors, 64));
    let boxes = [{ bins: stats.ids.slice(), count: stats.ids.reduce((n, bin) => n + stats.count[bin], 0) }];
    while (boxes.length < target) {
        let pick = -1;
        let bestScore = -1;
        for (let i = 0; i < boxes.length; i++) {
            const box = boxes[i];
            if (box.bins.length < 2)
                continue;
            if (box.count > bestScore) {
                bestScore = box.count;
                pick = i;
            }
        }
        if (pick < 0)
            break;
        const split = splitBox(stats, boxes[pick]);
        if (split === null) {
            boxes[pick] = { ...boxes[pick], bins: boxes[pick].bins.slice(0, 1) };
            break;
        }
        boxes.splice(pick, 1, ...split);
    }
    const palette = boxes.map((box) => boxColor(stats, box.bins));
    // Merge near-identical entries: flat artwork otherwise splits one ink into
    // two plates that differ only by compression noise.
    const weights = boxes.map((box) => box.count);
    const parent = palette.map((_, i) => i);
    const find = (i) => {
        let root = i;
        while (parent[root] !== root)
            root = parent[root];
        return root;
    };
    for (let i = 0; i < palette.length; i++) {
        for (let j = i + 1; j < palette.length; j++) {
            const a = palette[i];
            const b = palette[j];
            if (Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]) < 32) {
                const ri = find(i);
                const rj = find(j);
                if (ri !== rj)
                    parent[rj] = ri;
            }
        }
    }
    const merged = [];
    const remap = new Array(palette.length).fill(0);
    for (let i = 0; i < palette.length; i++) {
        if (find(i) === i) {
            remap[i] = merged.length;
            merged.push({ color: [0, 0, 0], weight: 0 });
        }
    }
    for (let i = 0; i < palette.length; i++)
        remap[i] = remap[find(i)];
    for (let i = 0; i < palette.length; i++) {
        const slot = merged[remap[i]];
        const w = weights[i];
        for (let k = 0; k < 3; k++)
            slot.color[k] = slot.color[k] + palette[i][k] * w;
        slot.weight += w;
    }
    const finalPalette = merged.map((slot) => {
        const w = slot.weight || 1;
        return [slot.color[0] / w, slot.color[1] / w, slot.color[2] / w];
    });
    const lut = new Uint8Array(BINS);
    for (let bin = 0; bin < BINS; bin++) {
        const r = ((bin >> 10) & 31) * 8 + 4;
        const g = ((bin >> 5) & 31) * 8 + 4;
        const b = (bin & 31) * 8 + 4;
        let best = 0;
        let bestD = Infinity;
        for (let p = 0; p < finalPalette.length; p++) {
            const c = finalPalette[p];
            const d = (r - c[0]) ** 2 + (g - c[1]) ** 2 + (b - c[2]) ** 2;
            if (d < bestD) {
                bestD = d;
                best = p;
            }
        }
        lut[bin] = best;
    }
    const labels = new Uint8Array(width * height);
    for (let i = 0, p = 0; i < rgba.length; i += 4, p++) {
        const a = rgba[i + 3];
        if (a < labelThreshold) {
            labels[p] = 255;
            continue;
        }
        const bin = ((rgba[i] >> 3) << 10) | ((rgba[i + 1] >> 3) << 5) | (rgba[i + 2] >> 3);
        labels[p] = lut[bin];
    }
    return { palette: finalPalette, labels, hasTransparency: transparent };
}
