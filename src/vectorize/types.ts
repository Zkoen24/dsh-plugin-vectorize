/** Shared geometry vocabulary for the vectorizer. */

/** A point in source-image pixel coordinates (y grows downward). */
export type Vec = readonly [number, number]

/** One drawing command of a closed vector path. */
export type Op =
  | { readonly t: 'M'; readonly p: Vec }
  | { readonly t: 'L'; readonly p: Vec }
  | { readonly t: 'C'; readonly c1: Vec; readonly c2: Vec; readonly p: Vec }

/** A traced, fitted path plus the fill color it belongs to. */
export interface Shape {
  /** `#rrggbb` fill color. */
  readonly fill: string
  /** Number of drawn pixels covered by this color, used for painter ordering. */
  readonly coverage: number
  /** Closed subpaths; the first op of each is `M` and the last point repeats it. */
  readonly subpaths: readonly (readonly Op[])[]
  /** Fill opacity, 0..1; below 1 means the plate carries transparency. */
  readonly opacity: number
  /** Number of anchor-and-control points, for reporting only. */
  readonly nodes: number
}

/** Options shared by the CLI and the `vectorize_image` tool. */
export interface VectorizeOptions {
  /** Palette size (2-64). Flat artwork yields its exact colors. */
  readonly colors: number
  /** Curve-fitting tolerance in source pixels; larger means fewer, smoother nodes. */
  readonly precision: number
  /** Longest side of the working raster; larger inputs are downscaled first. */
  readonly maxSize: number
  /** Majority-filter passes over the color labels before tracing (0-3). */
  readonly smooth: number
  /** Alpha below this (0-255) is treated as transparent background. */
  readonly alphaThreshold: number
  /** Keep translucent pixels as plates with their own fill opacity (gradients, shadows). */
  readonly alpha: boolean
  /** Physical width of the artwork for SVG and AI output. */
  readonly widthMm: number
}

/** Result of tracing one raster image. */
export interface VectorizeResult {
  readonly width: number
  readonly height: number
  readonly shapes: readonly Shape[]
  readonly palette: readonly string[]
  readonly subpaths: number
  readonly nodes: number
  /** True when the source has any pixel below the alpha threshold. */
  readonly hasTransparency: boolean
}


