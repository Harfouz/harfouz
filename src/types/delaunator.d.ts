declare module 'delaunator' {
  /** Delaunay triangulation of flat [x0, y0, x1, y1, …] coordinates. */
  export default class Delaunator<T extends ArrayLike<number> = Float64Array> {
    constructor(coords: T);
    coords: T;
    triangles: Uint32Array;
    halfedges: Int32Array;
    hull: Uint32Array;
    update(): void;
  }
}
