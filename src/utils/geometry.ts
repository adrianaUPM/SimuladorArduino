import { getDevice } from '../devices/registry';
import type { TerminalDef } from '../devices/types';
import type { ComponentInstance, Point, Wire, WireEnd } from '../simulator/types';

export const GRID = 8;
export const snap = (v: number, g = GRID) => Math.round(v / g) * g;

type Dir = TerminalDef['dir'];
const DIRS: Dir[] = ['up', 'right', 'down', 'left'];

export function rotateDir(d: Dir, rot: number): Dir {
  if (d === 'none') return d;
  const i = DIRS.indexOf(d);
  return DIRS[(i + Math.round(rot / 90)) % 4];
}

export function localToWorld(inst: ComponentInstance, w: number, h: number, p: Point): Point {
  const cx = w / 2;
  const cy = h / 2;
  const dx = p.x - cx;
  const dy = p.y - cy;
  let rx = dx;
  let ry = dy;
  switch (inst.rotation) {
    case 90:
      rx = -dy;
      ry = dx;
      break;
    case 180:
      rx = -dx;
      ry = -dy;
      break;
    case 270:
      rx = dy;
      ry = -dx;
      break;
  }
  return { x: inst.x + cx + rx, y: inst.y + cy + ry };
}

/** inversa de localToWorld */
export function worldToLocal(inst: ComponentInstance, w: number, h: number, p: Point): Point {
  const cx = w / 2;
  const cy = h / 2;
  const rx = p.x - inst.x - cx;
  const ry = p.y - inst.y - cy;
  let dx = rx;
  let dy = ry;
  switch (inst.rotation) {
    case 90:
      dx = ry;
      dy = -rx;
      break;
    case 180:
      dx = -rx;
      dy = -ry;
      break;
    case 270:
      dx = -ry;
      dy = rx;
      break;
  }
  return { x: cx + dx, y: cy + dy };
}

export function terminalPos(inst: ComponentInstance, termId: string): { p: Point; dir: Dir } | null {
  const def = getDevice(inst.type);
  const t = def?.terminals.find((x) => x.id === termId);
  if (!def || !t) return null;
  const off = inst.legs?.[termId];
  const local = off ? { x: t.x + off.x, y: t.y + off.y } : t;
  return { p: localToWorld(inst, def.width, def.height, local), dir: off ? 'none' : rotateDir(t.dir, inst.rotation) };
}

export function componentBounds(inst: ComponentInstance): { x: number; y: number; w: number; h: number } {
  const def = getDevice(inst.type);
  const w = def?.width ?? 20;
  const h = def?.height ?? 20;
  if (inst.rotation === 90 || inst.rotation === 270) {
    return { x: inst.x + w / 2 - h / 2, y: inst.y + h / 2 - w / 2, w: h, h: w };
  }
  return { x: inst.x, y: inst.y, w, h };
}

const step = (p: Point, d: Dir, s: number): Point => {
  switch (d) {
    case 'up':
      return { x: p.x, y: p.y - s };
    case 'down':
      return { x: p.x, y: p.y + s };
    case 'left':
      return { x: p.x - s, y: p.y };
    case 'right':
      return { x: p.x + s, y: p.y };
    default:
      return p;
  }
};
const horizontal = (d: Dir) => d === 'left' || d === 'right';

/** Ruta ortogonal sencilla entre dos terminales (o a través de los codos del usuario) */
export function routePoints(a: Point, aDir: Dir, b: Point, bDir: Dir | null, points: Point[]): Point[] {
  const S = 12;
  const a1 = step(a, aDir, S);
  if (points.length) {
    const first = points[0];
    const elbowA = horizontal(aDir) ? { x: first.x, y: a1.y } : { x: a1.x, y: first.y };
    const out: Point[] = [a, a1, elbowA, ...points];
    if (bDir) {
      const b1 = step(b, bDir, S);
      const last = points[points.length - 1];
      const elbowB = horizontal(bDir) ? { x: last.x, y: b1.y } : { x: b1.x, y: last.y };
      out.push(elbowB, b1);
    }
    out.push(b);
    return dedupe(out);
  }
  if (!bDir) {
    const mid = horizontal(aDir) ? { x: b.x, y: a1.y } : { x: a1.x, y: b.y };
    return dedupe([a, a1, mid, b]);
  }
  const b1 = step(b, bDir, S);
  let mids: Point[];
  if (horizontal(aDir) && horizontal(bDir)) {
    const mx = (a1.x + b1.x) / 2;
    mids = [{ x: mx, y: a1.y }, { x: mx, y: b1.y }];
  } else if (!horizontal(aDir) && !horizontal(bDir)) {
    const my = (a1.y + b1.y) / 2;
    mids = [{ x: a1.x, y: my }, { x: b1.x, y: my }];
  } else if (horizontal(aDir)) {
    mids = [{ x: b1.x, y: a1.y }];
  } else {
    mids = [{ x: a1.x, y: b1.y }];
  }
  return dedupe([a, a1, ...mids, b1, b]);
}

function dedupe(pts: Point[]): Point[] {
  const out: Point[] = [];
  for (const p of pts) {
    const last = out[out.length - 1];
    if (!last || Math.abs(last.x - p.x) > 0.01 || Math.abs(last.y - p.y) > 0.01) out.push(p);
  }
  // elimina puntos intermedios colineales
  const res: Point[] = [];
  for (let i = 0; i < out.length; i++) {
    const p = out[i];
    const prev = res[res.length - 1];
    const next = out[i + 1];
    if (prev && next) {
      const cross = (p.x - prev.x) * (next.y - p.y) - (p.y - prev.y) * (next.x - p.x);
      const dot = (p.x - prev.x) * (next.x - p.x) + (p.y - prev.y) * (next.y - p.y);
      if (Math.abs(cross) < 0.01 && dot >= 0) continue;
    }
    res.push(p);
  }
  return res;
}

/** Path SVG con esquinas ligeramente redondeadas */
export function pathFromPoints(pts: Point[], radius = 5): string {
  if (pts.length < 2) return '';
  let d = `M${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const p0 = pts[i - 1];
    const p = pts[i];
    const p1 = pts[i + 1];
    const l0 = Math.hypot(p.x - p0.x, p.y - p0.y);
    const l1 = Math.hypot(p1.x - p.x, p1.y - p.y);
    const r = Math.min(radius, l0 / 2, l1 / 2);
    const a = { x: p.x - ((p.x - p0.x) / l0) * r, y: p.y - ((p.y - p0.y) / l0) * r };
    const b = { x: p.x + ((p1.x - p.x) / l1) * r, y: p.y + ((p1.y - p.y) / l1) * r };
    d += ` L${a.x} ${a.y} Q${p.x} ${p.y} ${b.x} ${b.y}`;
  }
  const last = pts[pts.length - 1];
  d += ` L${last.x} ${last.y}`;
  return d;
}

export function wirePoints(wire: Wire, comps: Map<string, ComponentInstance>): Point[] | null {
  const ca = comps.get(wire.a.comp);
  const cb = comps.get(wire.b.comp);
  if (!ca || !cb) return null;
  const ta = terminalPos(ca, wire.a.term);
  const tb = terminalPos(cb, wire.b.term);
  if (!ta || !tb) return null;
  return routePoints(ta.p, ta.dir, tb.p, tb.dir, wire.points);
}

export function sameEnd(a: WireEnd, b: WireEnd) {
  return a.comp === b.comp && a.term === b.term;
}

export function distToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((p.x - a.x) * dx + (p.y - a.y) * dy) / l2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
