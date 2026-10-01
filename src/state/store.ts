// Estado global de la aplicación: proyecto (código + circuito), interfaz,
// selección e historial deshacer/rehacer del circuito.

import { create } from 'zustand';
import { getDevice } from '../devices/registry';
import type { Circuit, ComponentInstance, Point, Rotation, Wire, WireEnd } from '../simulator/types';
import { sameEnd, snap } from '../utils/geometry';
import { EXAMPLES } from './examples';
import { loadAutosave, loadUiPrefs, saveUiPrefs } from './persistence';

export interface Project {
  name: string;
  code: string;
  circuit: Circuit;
}

export type ViewMode = 'code' | 'split' | 'circuit';

export interface Selection {
  comps: string[];
  wires: string[];
}

export const WIRE_COLORS = ['#2f9e44', '#e03131', '#1c1c1c', '#1971c2', '#f08c00', '#ae3ec9', '#f5f5f5', '#fab005', '#868e96'];

interface AppState {
  project: Project;
  view: ViewMode;
  codeSide: 'left' | 'right';
  split: number;
  maximized: 'code' | 'circuit' | null;
  selection: Selection;
  past: Circuit[];
  future: Circuit[];
  wireColor: string;
  soundOn: boolean;
  /** contador que cambia al cargar un proyecto (reinicia el editor) */
  loadCounter: number;

  setCode(code: string): void;
  setName(name: string): void;
  setView(v: ViewMode): void;
  setCodeSide(s: 'left' | 'right'): void;
  setSplit(f: number): void;
  setMaximized(m: 'code' | 'circuit' | null): void;
  setSoundOn(on: boolean): void;
  setWireColor(c: string): void;

  select(sel: Partial<Selection>, additive?: boolean): void;
  clearSelection(): void;

  /** guarda una instantánea del circuito en el historial */
  checkpoint(): void;
  /** modifica el circuito (sin historial: llama antes a checkpoint) */
  mutate(fn: (c: Circuit) => Circuit): void;

  addComponent(type: string, x: number, y: number, exact?: boolean): string | null;
  moveSelection(dx: number, dy: number, base: Map<string, Point>, wireBase: Map<string, Point[]>): void;
  updateProps(id: string, patch: Record<string, any>, live?: boolean): void;
  rotateSelection(): void;
  deleteSelection(): void;
  addWire(a: WireEnd, b: WireEnd, points: Point[]): void;
  updateWire(id: string, patch: Partial<Wire>, record?: boolean): void;
  undo(): void;
  redo(): void;
  clearCircuit(): void;
  loadProject(p: Project): void;
}

const MAX_HISTORY = 100;

function nextId(circuit: Circuit, prefix: string): string {
  const base = prefix.toLowerCase();
  let n = 1;
  const ids = new Set(circuit.components.map((c) => c.id));
  while (ids.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

function wireId(circuit: Circuit): string {
  let n = circuit.wires.length + 1;
  const ids = new Set(circuit.wires.map((w) => w.id));
  while (ids.has(`w${n}`)) n++;
  return `w${n}`;
}

export function defaultProps(type: string): Record<string, any> {
  const def = getDevice(type);
  const p: Record<string, any> = {};
  def?.props.forEach((pd) => (p[pd.key] = pd.default));
  return p;
}

const initialProject: Project = loadAutosave() ?? structuredClone(EXAMPLES[0].project);
const prefs = loadUiPrefs();

export const useApp = create<AppState>((set, get) => ({
  project: initialProject,
  view: prefs.view ?? 'split',
  codeSide: prefs.codeSide ?? 'left',
  split: prefs.split ?? 0.42,
  maximized: null,
  selection: { comps: [], wires: [] },
  past: [],
  future: [],
  wireColor: WIRE_COLORS[0],
  soundOn: prefs.soundOn ?? true,
  loadCounter: 0,

  setCode: (code) => set((s) => ({ project: { ...s.project, code } })),
  setName: (name) => set((s) => ({ project: { ...s.project, name } })),
  setView: (view) => {
    set({ view, maximized: null });
    persistPrefs();
  },
  setCodeSide: (codeSide) => {
    set({ codeSide });
    persistPrefs();
  },
  setSplit: (split) => {
    set({ split: Math.max(0.15, Math.min(0.85, split)) });
    persistPrefs();
  },
  setMaximized: (maximized) => set({ maximized }),
  setSoundOn: (soundOn) => {
    set({ soundOn });
    persistPrefs();
  },
  setWireColor: (wireColor) => set({ wireColor }),

  select: (sel, additive) =>
    set((s) => {
      if (!additive) return { selection: { comps: sel.comps ?? [], wires: sel.wires ?? [] } };
      const toggle = (arr: string[], items: string[] = []) => {
        const out = new Set(arr);
        items.forEach((i) => (out.has(i) ? out.delete(i) : out.add(i)));
        return [...out];
      };
      return { selection: { comps: toggle(s.selection.comps, sel.comps), wires: toggle(s.selection.wires, sel.wires) } };
    }),
  clearSelection: () => set({ selection: { comps: [], wires: [] } }),

  checkpoint: () =>
    set((s) => ({ past: [...s.past.slice(-MAX_HISTORY + 1), s.project.circuit], future: [] })),
  mutate: (fn) => set((s) => ({ project: { ...s.project, circuit: fn(s.project.circuit) } })),

  addComponent: (type, x, y, exact) => {
    const def = getDevice(type);
    if (!def) return null;
    const { circuit } = get().project;
    if (def.max && circuit.components.filter((c) => c.type === type).length >= def.max) return null;
    const id = nextId(circuit, def.prefix);
    const inst: ComponentInstance = { id, type, x: exact ? x : snap(x), y: exact ? y : snap(y), rotation: 0, props: defaultProps(type) };
    get().checkpoint();
    get().mutate((c) => ({ ...c, components: [...c.components, inst] }));
    set({ selection: { comps: [id], wires: [] } });
    return id;
  },

  moveSelection: (dx, dy, base, wireBase) => {
    get().mutate((c) => ({
      components: c.components.map((comp) => {
        const b = base.get(comp.id);
        return b ? { ...comp, x: b.x + dx, y: b.y + dy } : comp;
      }),
      wires: c.wires.map((w) => {
        const wb = wireBase.get(w.id);
        if (!wb) return w;
        return { ...w, points: wb.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      }),
    }));
  },

  updateProps: (id, patch, live) => {
    if (!live) get().checkpoint();
    get().mutate((c) => ({
      ...c,
      components: c.components.map((comp) => (comp.id === id ? { ...comp, props: { ...comp.props, ...patch } } : comp)),
    }));
  },

  rotateSelection: () => {
    const ids = new Set(get().selection.comps);
    if (!ids.size) return;
    get().checkpoint();
    get().mutate((c) => ({
      ...c,
      components: c.components.map((comp) =>
        ids.has(comp.id) ? { ...comp, rotation: (((comp.rotation + 90) % 360) as Rotation) } : comp,
      ),
    }));
  },

  deleteSelection: () => {
    const { comps, wires } = get().selection;
    if (!comps.length && !wires.length) return;
    const cs = new Set(comps);
    const ws = new Set(wires);
    get().checkpoint();
    get().mutate((c) => ({
      components: c.components.filter((x) => !cs.has(x.id)),
      wires: c.wires.filter((w) => !ws.has(w.id) && !cs.has(w.a.comp) && !cs.has(w.b.comp)),
    }));
    set({ selection: { comps: [], wires: [] } });
  },

  addWire: (a, b, points) => {
    if (sameEnd(a, b)) return;
    const { circuit } = get().project;
    const dup = circuit.wires.some((w) => (sameEnd(w.a, a) && sameEnd(w.b, b)) || (sameEnd(w.a, b) && sameEnd(w.b, a)));
    if (dup) return;
    get().checkpoint();
    const id = wireId(circuit);
    get().mutate((c) => ({ ...c, wires: [...c.wires, { id, a, b, color: get().wireColor, points }] }));
    set({ selection: { comps: [], wires: [id] } });
  },

  updateWire: (id, patch, record = true) => {
    if (record) get().checkpoint();
    get().mutate((c) => ({ ...c, wires: c.wires.map((w) => (w.id === id ? { ...w, ...patch } : w)) }));
    if (patch.color) set({ wireColor: patch.color });
  },

  undo: () =>
    set((s) => {
      if (!s.past.length) return {};
      const prev = s.past[s.past.length - 1];
      return {
        past: s.past.slice(0, -1),
        future: [s.project.circuit, ...s.future],
        project: { ...s.project, circuit: prev },
        selection: { comps: [], wires: [] },
      };
    }),
  redo: () =>
    set((s) => {
      if (!s.future.length) return {};
      const next = s.future[0];
      return {
        future: s.future.slice(1),
        past: [...s.past, s.project.circuit],
        project: { ...s.project, circuit: next },
        selection: { comps: [], wires: [] },
      };
    }),

  clearCircuit: () => {
    get().checkpoint();
    get().mutate(() => ({ components: [], wires: [] }));
    set({ selection: { comps: [], wires: [] } });
  },

  loadProject: (p) =>
    set((s) => ({
      project: structuredClone(p),
      past: [],
      future: [],
      selection: { comps: [], wires: [] },
      loadCounter: s.loadCounter + 1,
    })),
}));

function persistPrefs() {
  const s = useApp.getState();
  saveUiPrefs({ view: s.view, codeSide: s.codeSide, split: s.split, soundOn: s.soundOn });
}
