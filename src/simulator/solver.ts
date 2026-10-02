// Solver eléctrico: análisis nodal modificado (solo equivalentes Norton) con
// diodos lineales a tramos. Los PWM se promedian resolviendo el circuito en
// cada tramo del periodo en el que el conjunto de pines en alto es constante.

import { getDevice } from '../devices/registry';
import type { BoardView, DeviceDef, EvalCtx, StampCtx, TermKind } from '../devices/types';
import { terminalPos } from '../utils/geometry';
import type { Circuit, ComponentInstance, Issue, WireEnd } from './types';
import { termKey } from './types';

const GMIN = 1e-9;
const GND_KEY = '__GND__';

export interface Netlist {
  /** índice de net por terminal; 0 = GND */
  netOf: Map<string, number>;
  count: number;
  members: WireEnd[][];
  connected: Set<string>;
  kinds: Map<string, TermKind>;
}

export function buildNetlist(circuit: Circuit): Netlist {
  const parent = new Map<string, string>();
  const find = (k: string): string => {
    let r = k;
    while (parent.get(r) !== r) r = parent.get(r)!;
    let c = k;
    while (parent.get(c) !== r) {
      const nx = parent.get(c)!;
      parent.set(c, r);
      c = nx;
    }
    return r;
  };
  const union = (a: string, b: string) => {
    const ra = find(a);
    const rb = find(b);
    if (ra !== rb) parent.set(ra, rb);
  };
  parent.set(GND_KEY, GND_KEY);
  const kinds = new Map<string, TermKind>();
  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def) continue;
    for (const t of def.terminals) {
      const k = termKey(c.id, t.id);
      parent.set(k, k);
      kinds.set(k, t.kind);
      if (t.kind === 'ground') union(k, GND_KEY);
    }
  }
  // uniones internas (tiras de la protoboard, patas emparejadas del pulsador...)
  for (const c of circuit.components) {
    getDevice(c.type)?.bus?.forEach((g) => {
      for (let i = 1; i < g.length; i++) union(termKey(c.id, g[0]), termKey(c.id, g[i]));
    });
  }
  const connected = new Set<string>();
  // patas enchufadas en agujeros: mismo punto del lienzo
  const holes = new Map<string, string>();
  const posKey = (x: number, y: number) => `${Math.round(x)},${Math.round(y)}`;
  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def?.socket) continue;
    for (const t of def.terminals) {
      const tp = terminalPos(c, t.id);
      if (tp) holes.set(posKey(tp.p.x, tp.p.y), termKey(c.id, t.id));
    }
  }
  if (holes.size) {
    for (const c of circuit.components) {
      const def = getDevice(c.type);
      if (!def || def.socket) continue;
      for (const t of def.terminals) {
        const tp = terminalPos(c, t.id);
        const hole = tp && holes.get(posKey(tp.p.x, tp.p.y));
        if (hole) {
          const k = termKey(c.id, t.id);
          union(k, hole);
          connected.add(k);
          connected.add(hole);
        }
      }
    }
  }
  for (const w of circuit.wires) {
    const a = termKey(w.a.comp, w.a.term);
    const b = termKey(w.b.comp, w.b.term);
    if (!parent.has(a) || !parent.has(b)) continue;
    union(a, b);
    connected.add(a);
    connected.add(b);
  }
  const index = new Map<string, number>();
  index.set(find(GND_KEY), 0);
  const netOf = new Map<string, number>();
  const members: WireEnd[][] = [[]];
  for (const k of parent.keys()) {
    if (k === GND_KEY) continue;
    const r = find(k);
    let idx = index.get(r);
    if (idx === undefined) {
      idx = members.length;
      index.set(r, idx);
      members.push([]);
    }
    netOf.set(k, idx);
    const [comp, term] = splitKey(k);
    members[idx].push({ comp, term });
  }
  return { netOf, count: members.length, members, connected, kinds };
}

function splitKey(k: string): [string, string] {
  const i = k.indexOf(':');
  return [k.slice(0, i), k.slice(i + 1)];
}

// ----------------------------------------------------------------------------

interface DiodeRec {
  key: string;
  a: number;
  k: number;
  vf: number;
  ron: number;
}

interface PhaseResult {
  v: Float64Array;
  currents: Map<string, number>;
  edges: [number, number][];
}

export interface Solution {
  netlist: Netlist;
  vAvg: Float64Array;
  vMax: Float64Array;
  iAvg: Map<string, number>;
  iPeak: Map<string, number>;
  driven: boolean[];
}

/** Resuelve G·v = I con eliminación gaussiana y pivoteo parcial */
function solveLinear(G: Float64Array[], I: Float64Array): Float64Array {
  const n = I.length;
  const A = G.map((row, i) => {
    const r = new Float64Array(n + 1);
    r.set(row);
    r[n] = I[i];
    return r;
  });
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(A[col][col]);
    for (let r = col + 1; r < n; r++) {
      const v = Math.abs(A[r][col]);
      if (v > best) {
        best = v;
        piv = r;
      }
    }
    if (best < 1e-18) continue;
    if (piv !== col) [A[piv], A[col]] = [A[col], A[piv]];
    const pr = A[col];
    for (let r = col + 1; r < n; r++) {
      const f = A[r][col] / pr[col];
      if (f === 0) continue;
      const row = A[r];
      for (let c = col; c <= n; c++) row[c] -= f * pr[c];
    }
  }
  const x = new Float64Array(n);
  for (let r = n - 1; r >= 0; r--) {
    let s = A[r][n];
    for (let c = r + 1; c < n; c++) s -= A[r][c] * x[c];
    x[r] = Math.abs(A[r][r]) < 1e-18 ? 0 : s / A[r][r];
  }
  return x;
}

export interface SolveInput {
  circuit: Circuit;
  board: BoardView;
  inputs: Record<string, Record<string, any>>;
  /** GPIO -> fracción del periodo en alto (PWM) */
  pwm: Map<number, number>;
}

export function solve({ circuit, board, inputs, pwm }: SolveInput): Solution {
  const netlist = buildNetlist(circuit);
  const N = netlist.count; // incluye GND (índice 0)
  const comps = circuit.components
    .map((c) => ({ c, def: getDevice(c.type) }))
    .filter((x): x is { c: ComponentInstance; def: DeviceDef } => !!x.def && !!x.def.stamp);

  // tramos PWM
  const duties = [...new Set([...pwm.values()].filter((d) => d > 0 && d < 1))].sort((a, b) => a - b);
  const bounds = [0, ...duties, 1];
  const phases: { weight: number; high: Set<number> }[] = [];
  for (let i = 0; i < bounds.length - 1; i++) {
    const s0 = bounds[i];
    const w = bounds[i + 1] - s0;
    if (w <= 0) continue;
    const high = new Set<number>();
    pwm.forEach((d, pin) => {
      if (d > s0) high.add(pin);
    });
    phases.push({ weight: w, high });
  }
  if (phases.length === 0) phases.push({ weight: 1, high: new Set() });

  const diodeOn = new Map<string, boolean>();
  let prevV = new Float64Array(N);

  const runPhase = (high: Set<number>): PhaseResult => {
    let result: PhaseResult | null = null;
    for (let iter = 0; iter < 60; iter++) {
      const G = Array.from({ length: N - 1 }, () => new Float64Array(N - 1));
      const I = new Float64Array(N - 1);
      const diodes: DiodeRec[] = [];
      const resistors: { key: string; a: number; b: number; r: number }[] = [];
      const sources: { key: string; a: number; b: number; v: number; r: number }[] = [];
      const edges: [number, number][] = [];

      const addG = (a: number, b: number, g: number) => {
        if (a > 0) G[a - 1][a - 1] += g;
        if (b > 0) G[b - 1][b - 1] += g;
        if (a > 0 && b > 0) {
          G[a - 1][b - 1] -= g;
          G[b - 1][a - 1] -= g;
        }
      };
      const addI = (a: number, i: number) => {
        if (a > 0) I[a - 1] += i;
      };

      for (const { c, def } of comps) {
        const ctx: StampCtx = {
          inst: c,
          props: c.props,
          inputs: inputs[c.id] ?? {},
          board,
          n: (term) => netlist.netOf.get(termKey(c.id, term)) ?? 0,
          resistor: (a, b, r, key) => {
            if (a === b) return;
            const g = 1 / Math.max(r, 1e-4);
            addG(a, b, g);
            if (r < 1e8) edges.push([a, b]);
            if (key) resistors.push({ key: `${c.id}/${key}`, a, b, r: Math.max(r, 1e-4) });
          },
          source: (a, b, v, r, key) => {
            const rr = Math.max(r, 1e-4);
            const g = 1 / rr;
            if (a !== b) {
              addG(a, b, g);
              addI(a, v * g);
              addI(b, -v * g);
              edges.push([a, b]);
            }
            if (key) sources.push({ key: `${c.id}/${key}`, a, b, v, r: rr });
          },
          diode: (a, k, vf, ron, key) => {
            const fullKey = `${c.id}/${key}`;
            diodes.push({ key: fullKey, a, k, vf, ron });
            if (a === k) return;
            if (diodeOn.get(fullKey)) {
              const g = 1 / ron;
              addG(a, k, g);
              // corriente equivalente: I = (Vd - vf)/ron  ->  fuente -vf*g de a a k
              addI(a, vf * g);
              addI(k, -vf * g);
              edges.push([a, k]);
            } else {
              addG(a, k, GMIN);
            }
          },
          v: (node) => (node > 0 ? prevV[node] : 0),
          phaseHigh: (gpio) => high.has(gpio),
        };
        def.stamp!(ctx);
      }
      for (let i = 0; i < N - 1; i++) G[i][i] += GMIN;

      const x = N > 1 ? solveLinear(G, I) : new Float64Array(0);
      const v = new Float64Array(N);
      v.set(x, 1);

      // actualizar estado de los diodos
      let changed = false;
      for (const d of diodes) {
        const vd = v[d.a] - v[d.k];
        const on = diodeOn.get(d.key) ?? false;
        const nowOn = on ? vd > d.vf - 1e-9 : vd > d.vf + 1e-6;
        if (nowOn !== on) {
          diodeOn.set(d.key, nowOn);
          changed = true;
        }
      }
      let maxDv = 0;
      for (let i = 0; i < N; i++) maxDv = Math.max(maxDv, Math.abs(v[i] - prevV[i]));
      prevV = v;

      const currents = new Map<string, number>();
      for (const r of resistors) currents.set(r.key, (v[r.a] - v[r.b]) / r.r);
      for (const s of sources) currents.set(s.key, (s.v - (v[s.a] - v[s.b])) / s.r);
      for (const d of diodes) {
        currents.set(d.key, diodeOn.get(d.key) ? Math.max(0, (v[d.a] - v[d.k] - d.vf) / d.ron) : 0);
      }
      result = { v, currents, edges };
      if (!changed && maxDv < 1e-7 && iter > 0) break;
    }
    return result!;
  };

  const vAvg = new Float64Array(N);
  const vMax = new Float64Array(N).fill(-Infinity);
  const iAvg = new Map<string, number>();
  const iPeak = new Map<string, number>();
  const edgeSet: [number, number][] = [];
  for (const ph of phases) {
    const r = runPhase(ph.high);
    for (let i = 0; i < N; i++) {
      vAvg[i] += r.v[i] * ph.weight;
      vMax[i] = Math.max(vMax[i], r.v[i]);
    }
    r.currents.forEach((cur, k) => {
      iAvg.set(k, (iAvg.get(k) ?? 0) + cur * ph.weight);
      if (Math.abs(cur) > Math.abs(iPeak.get(k) ?? 0)) iPeak.set(k, cur);
    });
    edgeSet.push(...r.edges);
  }

  // nets con camino conductor a GND / fuentes
  const parent = Array.from({ length: N }, (_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (const [a, b] of edgeSet) parent[find(a)] = find(b);
  const driven = Array.from({ length: N }, (_, i) => find(i) === find(0));

  return { netlist, vAvg, vMax, iAvg, iPeak, driven };
}

// ----------------------------------------------------------------------------

export interface Evaluation {
  states: Record<string, any>;
  issues: Issue[];
}

export function evaluate(circuit: Circuit, sol: Solution, board: BoardView, inputs: SolveInput['inputs'], esp32Id: string | null): Evaluation {
  const states: Record<string, any> = {};
  const issues: Issue[] = [];
  const { netlist } = sol;
  const compById = new Map(circuit.components.map((c) => [c.id, c]));

  const gpiosOnNet = (net: number): number[] => {
    if (!esp32Id) return [];
    const out: number[] = [];
    for (const m of netlist.members[net] ?? []) {
      if (m.comp === esp32Id && m.term.startsWith('GPIO')) out.push(Number(m.term.slice(4)));
    }
    return out;
  };

  for (const c of circuit.components) {
    const def = getDevice(c.type);
    if (!def?.evaluate) continue;
    const net = (term: string) => netlist.netOf.get(termKey(c.id, term)) ?? 0;
    let n = 0;
    const ctx: EvalCtx = {
      inst: c,
      props: c.props,
      inputs: inputs[c.id] ?? {},
      board,
      v: (t) => sol.vAvg[net(t)] ?? 0,
      vMax: (t) => {
        const x = sol.vMax[net(t)];
        return Number.isFinite(x) ? x : 0;
      },
      i: (k) => sol.iAvg.get(`${c.id}/${k}`) ?? 0,
      iPeak: (k) => sol.iPeak.get(`${c.id}/${k}`) ?? 0,
      connected: (t) => netlist.connected.has(termKey(c.id, t)),
      linked: (t) => {
        const n = net(t);
        if (n === 0) return true; // está en GND
        return (netlist.members[n] ?? []).some((m) => m.comp !== c.id && !getDevice(compById.get(m.comp)?.type ?? '')?.socket);
      },
      driven: (t) => sol.driven[net(t)] ?? false,
      netPeers: (t) =>
        (netlist.members[net(t)] ?? [])
          .filter((m) => !(m.comp === c.id && m.term === t))
          .map((m) => ({
            ...m,
            kind: netlist.kinds.get(termKey(m.comp, m.term)) ?? 'passive',
            type: compById.get(m.comp)?.type ?? '',
          })),
      gpiosOnNet: (t) => gpiosOnNet(net(t)),
      issue: (severity, title, detail, terminals) => {
        issues.push({
          id: `${c.id}#${n++}`,
          severity,
          title,
          detail,
          comps: [c.id],
          terminals: terminals?.map((term) => ({ comp: c.id, term })),
        });
      },
    };
    try {
      states[c.id] = def.evaluate(ctx);
    } catch (e) {
      console.error('evaluate', c.type, e);
    }
  }
  return { states, issues };
}
