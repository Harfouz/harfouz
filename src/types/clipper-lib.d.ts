// Minimal types for the parts of clipper-lib (Clipper 6, Angus Johnson) Harfouz uses.
declare module 'clipper-lib' {
  type IntPoint = { X: number; Y: number };
  type Path = IntPoint[];
  class Clipper {
    AddPaths(paths: Path[], polyType: number, closed: boolean): boolean;
    Execute(clipType: number, solution: Path[], subjFill: number, clipFill: number): boolean;
    static Area(path: Path): number;
    static PointInPolygon(point: IntPoint, path: Path): number;
  }
  class ClipperOffset {
    constructor(miterLimit?: number, arcTolerance?: number);
    AddPaths(paths: Path[], joinType: number, endType: number): void;
    Execute(solution: Path[], delta: number): void;
  }
  const ClipperLib: {
    Clipper: typeof Clipper;
    ClipperOffset: typeof ClipperOffset;
    ClipType: { ctIntersection: number; ctUnion: number; ctDifference: number; ctXor: number };
    PolyType: { ptSubject: number; ptClip: number };
    PolyFillType: { pftEvenOdd: number; pftNonZero: number; pftPositive: number; pftNegative: number };
    JoinType: { jtSquare: number; jtRound: number; jtMiter: number };
    EndType: { etClosedPolygon: number; etClosedLine: number; etOpenButt: number; etOpenSquare: number; etOpenRound: number };
  };
  export default ClipperLib;
}
