declare module '@kninnug/constrainautor' {
  /** Makes a Delaunay triangulation follow the given edges (in place). */
  export default class Constrainautor {
    constructor(del: { coords: ArrayLike<number>; triangles: Uint32Array; halfedges: Int32Array }, edges?: readonly [number, number][]);
    constrainOne(a: number, b: number): number;
    constrainAll(edges: readonly [number, number][]): this;
  }
}
