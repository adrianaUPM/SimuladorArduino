// Enchufado de patas en agujeros (protoboard): búsqueda de agujeros cercanos
// para "encajar" al arrastrar, y componentes enchufados en una protoboard.

import { getDevice } from '../devices/registry';
import type { Circuit, ComponentInstance, Point } from '../simulator/types';
import { terminalPos } from './geometry';

const key = (p: Point) => `${Math.round(p.x)},${Math.round(p.y)}`;

/** posiciones de los agujeros de todas las protoboards, salvo las excluidas */
export function holePositions(circuit: Circuit, exclude: Set<string> = new Set()): Point[] {
  const out: Point[] = [];
  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def?.socket || exclude.has(c.id)) continue;
    for (const t of def.terminals) {
      const tp = terminalPos(c, t.id);
      if (tp) out.push(tp.p);
    }
  }
  return out;
}

/** índice espacial sencillo (celdas de 16 px) para buscar agujeros cercanos */
export class HoleIndex {
  private cells = new Map<string, Point[]>();
  constructor(holes: Point[]) {
    for (const h of holes) {
      const k = `${Math.floor(h.x / 16)},${Math.floor(h.y / 16)}`;
      const arr = this.cells.get(k);
      if (arr) arr.push(h);
      else this.cells.set(k, [h]);
    }
  }
  get empty() {
    return this.cells.size === 0;
  }
  nearest(p: Point, radius: number): Point | null {
    const cx = Math.floor(p.x / 16);
    const cy = Math.floor(p.y / 16);
    let best: Point | null = null;
    let bd = radius;
    for (let i = -1; i <= 1; i++) {
      for (let j = -1; j <= 1; j++) {
        for (const h of this.cells.get(`${cx + i},${cy + j}`) ?? []) {
          const d = Math.hypot(h.x - p.x, h.y - p.y);
          if (d < bd) {
            bd = d;
            best = h;
          }
        }
      }
    }
    return best;
  }
}

/**
 * Corrección (dx, dy) para que las patas de los componentes caigan justo en
 * agujeros. Devuelve la del terminal más cercano a un agujero, o null.
 */
export function snapCorrection(comps: ComponentInstance[], index: HoleIndex, radius = 9): Point | null {
  if (index.empty) return null;
  let best: Point | null = null;
  let bd = Infinity;
  for (const c of comps) {
    const def = getDevice(c.type);
    if (!def || def.socket) continue;
    for (const t of def.terminals) {
      const tp = terminalPos(c, t.id);
      if (!tp) continue;
      const h = index.nearest(tp.p, radius);
      if (!h) continue;
      const d = Math.hypot(h.x - tp.p.x, h.y - tp.p.y);
      if (d < bd) {
        bd = d;
        best = { x: h.x - tp.p.x, y: h.y - tp.p.y };
      }
    }
  }
  return best;
}

/** componentes con alguna pata enchufada en la protoboard indicada */
export function pluggedInto(circuit: Circuit, socketId: string): string[] {
  const sock = circuit.components.find((c) => c.id === socketId);
  if (!sock) return [];
  const holes = new Set(holePositions({ components: [sock], wires: [] }).map(key));
  const out: string[] = [];
  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def || def.socket || c.id === socketId) continue;
    if (def.terminals.some((t) => {
      const tp = terminalPos(c, t.id);
      return tp && holes.has(key(tp.p));
    })) out.push(c.id);
  }
  return out;
}

/** agujero ("bb1 · c12") en el que está enchufado un terminal, si lo hay */
export function holeAt(circuit: Circuit, comp: ComponentInstance, termId: string): string | null {
  const tp = terminalPos(comp, termId);
  if (!tp) return null;
  const k = key(tp.p);
  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def?.socket || c.id === comp.id) continue;
    for (const t of def.terminals) {
      const hp = terminalPos(c, t.id);
      if (hp && key(hp.p) === k) return `${c.id} · ${t.id}`;
    }
  }
  return null;
}
