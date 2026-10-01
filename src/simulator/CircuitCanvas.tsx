// Lienzo SVG del circuito: zoom/pan, arrastre de componentes, cableado,
// selección múltiple, resaltado de nets y tooltips de pines.

import { forwardRef, memo, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { getDevice } from '../devices/registry';
import type { DeviceDef, TerminalDef } from '../devices/types';
import { useSim } from '../state/simStore';
import { useApp } from '../state/store';
import {
  componentBounds, distToSegment, pathFromPoints, routePoints, snap, terminalPos, wirePoints,
} from '../utils/geometry';
import { HoleIndex, holePositions, pluggedInto, snapCorrection } from '../utils/sockets';
import { sim } from './controller';
import type { ComponentInstance, Issue, Point, Wire, WireEnd } from './types';
import { termKey } from './types';

type Mode =
  | { kind: 'none' }
  | { kind: 'pan'; sx: number; sy: number; ox: number; oy: number; moved: boolean; clearOnClick: boolean }
  | {
      kind: 'drag';
      start: Point;
      primary: string;
      base: Map<string, Point>;
      wireBase: Map<string, Point[]>;
      holes: HoleIndex;
      moved: boolean;
    }
  | { kind: 'marquee'; start: Point; cur: Point }
  | { kind: 'wire'; from: WireEnd; points: Point[]; cursor: Point; downClient: Point | null; dragged: boolean }
  | { kind: 'handle'; wireId: string; index: number; moved: boolean };

interface ViewState {
  x: number;
  y: number;
  zoom: number;
}

export interface CanvasHandle {
  fit(): void;
  zoomBy(f: number): void;
  addAtCenter(type: string): void;
}

interface TooltipInfo {
  x: number;
  y: number;
  comp: ComponentInstance;
  term: TerminalDef;
}

const ZMIN = 0.25;
const ZMAX = 4;

export const CircuitCanvas = forwardRef<CanvasHandle, { onZoom?(z: number): void }>(function CircuitCanvas({ onZoom }, ref) {
  const circuit = useApp((s) => s.project.circuit);
  const selection = useApp((s) => s.selection);
  const loadCounter = useApp((s) => s.loadCounter);
  const states = useSim((s) => s.states);
  const issues = useSim((s) => s.issues);
  const solution = useSim((s) => s.solution);
  const running = useSim((s) => s.status === 'running');
  const previewColor = useApp((s) => s.wireColor);

  const wrap = useRef<HTMLDivElement>(null);
  const svg = useRef<SVGSVGElement>(null);
  const [view, setView] = useState<ViewState>({ x: 40, y: 40, zoom: 1 });
  const viewRef = useRef(view);
  viewRef.current = view;
  const [mode, setModeState] = useState<Mode>({ kind: 'none' });
  const modeRef = useRef<Mode>(mode);
  const setMode = (m: Mode) => {
    modeRef.current = m;
    setModeState(m);
  };
  const [hoverTerm, setHoverTerm] = useState<string | null>(null);
  const [hoverWire, setHoverWire] = useState<string | null>(null);
  const [tooltip, setTooltip] = useState<TooltipInfo | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);
  const handlersRef = useRef<TermHandlers>(null!);
  const termHandlers = useMemo<TermHandlers>(
    () => ({
      down: (e, end) => handlersRef.current.down(e, end),
      enter: (e, c, t, k) => handlersRef.current.enter(e, c, t, k),
      move: (e) => handlersRef.current.move(e),
      leave: () => handlersRef.current.leave(),
    }),
    [],
  );

  const compMap = useMemo(() => new Map(circuit.components.map((c) => [c.id, c])), [circuit.components]);

  // ------------------------------------------------------------ coordenadas
  const toWorld = useCallback((cx: number, cy: number): Point => {
    const r = svg.current!.getBoundingClientRect();
    const v = viewRef.current;
    return { x: (cx - r.left - v.x) / v.zoom, y: (cy - r.top - v.y) / v.zoom };
  }, []);

  const fit = useCallback(() => {
    const el = wrap.current;
    if (!el) return;
    const comps = useApp.getState().project.circuit.components;
    if (!comps.length) {
      setView({ x: el.clientWidth / 2 - 100, y: 60, zoom: 1 });
      return;
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const c of comps) {
      const b = componentBounds(c);
      x0 = Math.min(x0, b.x);
      y0 = Math.min(y0, b.y - 14);
      x1 = Math.max(x1, b.x + b.w);
      y1 = Math.max(y1, b.y + b.h);
    }
    for (const w of useApp.getState().project.circuit.wires) {
      for (const p of w.points) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    const pad = 50;
    const zoom = Math.max(ZMIN, Math.min(1.6, Math.min((el.clientWidth - pad * 2) / (x1 - x0), (el.clientHeight - pad * 2) / (y1 - y0))));
    setView({
      zoom,
      x: (el.clientWidth - (x1 - x0) * zoom) / 2 - x0 * zoom,
      y: (el.clientHeight - (y1 - y0) * zoom) / 2 - y0 * zoom,
    });
  }, []);

  const zoomAt = useCallback((factor: number, cx?: number, cy?: number) => {
    const el = svg.current!;
    const r = el.getBoundingClientRect();
    const px = (cx ?? r.left + r.width / 2) - r.left;
    const py = (cy ?? r.top + r.height / 2) - r.top;
    setView((v) => {
      const zoom = Math.max(ZMIN, Math.min(ZMAX, v.zoom * factor));
      const k = zoom / v.zoom;
      return { zoom, x: px - (px - v.x) * k, y: py - (py - v.y) * k };
    });
  }, []);

  useImperativeHandle(ref, () => ({
    fit,
    zoomBy: (f) => zoomAt(f),
    addAtCenter: (type) => {
      const el = wrap.current!;
      const r = el.getBoundingClientRect();
      const p = toWorld(r.left + r.width / 2, r.top + r.height / 2);
      const def = getDevice(type);
      if (!def) return;
      const n = useApp.getState().project.circuit.components.length;
      placeSnapped(type, p.x - def.width / 2 + (n % 5) * 16, p.y - def.height / 2 + (n % 5) * 16);
    },
  }));

  useEffect(() => onZoom?.(view.zoom), [view.zoom, onZoom]);

  // encuadre al cargar proyecto y al cambiar el tamaño del panel por primera vez
  useEffect(() => {
    const t = setTimeout(fit, 30);
    return () => clearTimeout(t);
  }, [loadCounter, fit]);

  // rueda: zoom (con Ctrl o sin él) — el desplazamiento con trackpad hace pan
  useEffect(() => {
    const el = svg.current!;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || Math.abs(e.deltaY) >= 40 || e.deltaMode !== 0) {
        zoomAt(Math.exp(-e.deltaY * (e.ctrlKey ? 0.01 : 0.0015)), e.clientX, e.clientY);
      } else {
        setView((v) => ({ ...v, x: v.x - e.deltaX, y: v.y - e.deltaY }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoomAt]);

  // teclas propias del lienzo
  useEffect(() => {
    const isTyping = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      return t.closest('input, textarea, select, .cm-editor') !== null;
    };
    const down = (e: KeyboardEvent) => {
      if (isTyping(e)) return;
      if (e.code === 'Space') setSpaceDown(true);
      const m = modeRef.current;
      if (e.key === 'Escape' && m.kind === 'wire') {
        setMode({ kind: 'none' });
        e.stopPropagation();
      }
      if (e.key === 'Backspace' && m.kind === 'wire' && m.points.length) {
        setMode({ ...m, points: m.points.slice(0, -1) });
        e.stopPropagation();
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') setSpaceDown(false);
    };
    window.addEventListener('keydown', down, true);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down, true);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // ------------------------------------------------------------ terminales
  const allTerminals = useMemo(() => {
    const out: { key: string; end: WireEnd; p: Point }[] = [];
    // las patas antes que los agujeros: al buscar el terminal más cercano gana la pata
    const ordered = [...circuit.components].sort((a, b) => Number(!!getDevice(a.type)?.socket) - Number(!!getDevice(b.type)?.socket));
    for (const c of ordered) {
      const def = getDevice(c.type);
      def?.terminals.forEach((t) => {
        const tp = terminalPos(c, t.id);
        if (tp) out.push({ key: termKey(c.id, t.id), end: { comp: c.id, term: t.id }, p: tp.p });
      });
    }
    return out;
  }, [circuit.components]);

  const nearestTerminal = (p: Point, exclude?: WireEnd): { key: string; end: WireEnd; p: Point } | null => {
    const r = 9 / Math.min(1.5, viewRef.current.zoom);
    let best: (typeof allTerminals)[number] | null = null;
    let bd = r;
    for (const t of allTerminals) {
      if (exclude && t.end.comp === exclude.comp && t.end.term === exclude.term) continue;
      const d = Math.hypot(t.p.x - p.x, t.p.y - p.y);
      if (d < bd) {
        bd = d;
        best = t;
      }
    }
    return best;
  };

  // ------------------------------------------------------------ net resaltado
  const highlighted = useMemo(() => {
    const terms = new Set<string>();
    const wires = new Set<string>();
    if (!solution) return { terms, wires };
    let net: number | undefined;
    if (hoverTerm) net = solution.netlist.netOf.get(hoverTerm);
    else if (hoverWire) {
      const w = circuit.wires.find((x) => x.id === hoverWire);
      if (w) net = solution.netlist.netOf.get(termKey(w.a.comp, w.a.term));
    }
    if (net === undefined) return { terms, wires };
    // en el net de GND solo resaltamos lo que está cableado
    for (const m of solution.netlist.members[net] ?? []) {
      const k = termKey(m.comp, m.term);
      if (net !== 0 || solution.netlist.connected.has(k)) terms.add(k);
    }
    for (const w of circuit.wires) {
      if (terms.has(termKey(w.a.comp, w.a.term))) wires.add(w.id);
    }
    return { terms, wires };
  }, [hoverTerm, hoverWire, solution, circuit.wires]);

  const issueByComp = useMemo(() => {
    const m = new Map<string, Issue[]>();
    for (const is of issues) for (const c of is.comps) m.set(c, [...(m.get(c) ?? []), is]);
    return m;
  }, [issues]);
  const issueTerms = useMemo(() => {
    const s = new Set<string>();
    for (const is of issues) if (is.severity !== 'info') is.terminals?.forEach((t) => s.add(termKey(t.comp, t.term)));
    return s;
  }, [issues]);

  /** añade un componente; si cae sobre una protoboard, sus patas se enchufan */
  const placeSnapped = (type: string, x: number, y: number) => {
    const st = useApp.getState();
    const def = getDevice(type);
    let px = snap(x);
    let py = snap(y);
    if (def && !def.socket) {
      const corr = snapCorrection(
        [{ id: '_', type, x: px, y: py, rotation: 0, props: {} }],
        new HoleIndex(holePositions(st.project.circuit)),
      );
      if (corr) {
        px += corr.x;
        py += corr.y;
      }
    }
    st.addComponent(type, px, py, true);
  };

  // ------------------------------------------------------------ eventos
  const onBackgroundDown = (e: React.PointerEvent) => {
    if (e.button === 2) return;
    const m = modeRef.current;
    const p = toWorld(e.clientX, e.clientY);
    svg.current!.setPointerCapture(e.pointerId);
    if (m.kind === 'wire') {
      // añadir un codo
      const near = nearestTerminal(p, m.from);
      if (near) finishWire(m, near.end);
      else setMode({ ...m, points: [...m.points, { x: snap(p.x), y: snap(p.y) }], downClient: null });
      return;
    }
    if (e.button === 1 || spaceDown || (e.button === 0 && !e.shiftKey)) {
      const v = viewRef.current;
      setMode({ kind: 'pan', sx: e.clientX, sy: e.clientY, ox: v.x, oy: v.y, moved: false, clearOnClick: e.button === 0 });
      return;
    }
    if (e.button === 0 && e.shiftKey) {
      setMode({ kind: 'marquee', start: p, cur: p });
    }
  };

  const onComponentDown = (e: React.PointerEvent, comp: ComponentInstance) => {
    if (e.button !== 0 || spaceDown) return;
    e.stopPropagation();
    const m = modeRef.current;
    if (m.kind === 'wire') return;
    const st = useApp.getState();
    const additive = e.shiftKey || e.ctrlKey || e.metaKey;
    let selected = st.selection.comps;
    if (additive) {
      st.select({ comps: [comp.id] }, true);
      selected = useApp.getState().selection.comps;
      if (!selected.includes(comp.id)) return;
    } else if (!selected.includes(comp.id)) {
      st.select({ comps: [comp.id], wires: [] });
      selected = [comp.id];
    }
    const circ = st.project.circuit;
    const ids = new Set(selected);
    // al mover una protoboard se mueve también todo lo que lleva enchufado
    for (const id of [...ids]) {
      const c = circ.components.find((x) => x.id === id);
      if (c && getDevice(c.type)?.socket) pluggedInto(circ, id).forEach((x) => ids.add(x));
    }
    const base = new Map<string, Point>();
    for (const c of circ.components) if (ids.has(c.id)) base.set(c.id, { x: c.x, y: c.y });
    const wireBase = new Map<string, Point[]>();
    for (const w of circ.wires) {
      if (w.points.length && ids.has(w.a.comp) && ids.has(w.b.comp)) wireBase.set(w.id, w.points);
    }
    const holes = new HoleIndex(holePositions(circ, ids));
    svg.current!.setPointerCapture(e.pointerId);
    setMode({ kind: 'drag', start: toWorld(e.clientX, e.clientY), primary: comp.id, base, wireBase, holes, moved: false });
  };

  const onTerminalDown = (e: React.PointerEvent, end: WireEnd) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const m = modeRef.current;
    if (m.kind === 'wire') {
      if (m.from.comp === end.comp && m.from.term === end.term) {
        setMode({ kind: 'none' });
        return;
      }
      finishWire(m, end);
      return;
    }
    svg.current!.setPointerCapture(e.pointerId);
    const p = toWorld(e.clientX, e.clientY);
    setTooltip(null);
    setMode({ kind: 'wire', from: end, points: [], cursor: p, downClient: { x: e.clientX, y: e.clientY }, dragged: false });
  };

  const finishWire = (m: Mode & { kind: 'wire' }, to: WireEnd) => {
    useApp.getState().addWire(m.from, to, m.points);
    setMode({ kind: 'none' });
  };

  const onWireDown = (e: React.PointerEvent, w: Wire) => {
    if (e.button !== 0 || spaceDown) return;
    const m = modeRef.current;
    if (m.kind === 'wire') return;
    e.stopPropagation();
    useApp.getState().select({ wires: [w.id], comps: [] }, e.shiftKey || e.ctrlKey || e.metaKey);
  };

  const onWireDoubleClick = (e: React.MouseEvent, w: Wire) => {
    e.stopPropagation();
    // inserta un codo en el punto pulsado
    const p = toWorld(e.clientX, e.clientY);
    const pts = wirePoints(w, compMap);
    if (!pts) return;
    const full = [pts[0], ...w.points, pts[pts.length - 1]];
    let bestI = 0;
    let bd = Infinity;
    for (let i = 0; i < full.length - 1; i++) {
      const d = distToSegment(p, full[i], full[i + 1]);
      if (d < bd) {
        bd = d;
        bestI = i;
      }
    }
    const np = [...w.points];
    np.splice(bestI, 0, { x: snap(p.x), y: snap(p.y) });
    useApp.getState().updateWire(w.id, { points: np });
  };

  const onHandleDown = (e: React.PointerEvent, w: Wire, index: number) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    svg.current!.setPointerCapture(e.pointerId);
    setMode({ kind: 'handle', wireId: w.id, index, moved: false });
  };

  const onMove = (e: React.PointerEvent) => {
    const m = modeRef.current;
    if (m.kind === 'none') return;
    const p = toWorld(e.clientX, e.clientY);
    switch (m.kind) {
      case 'pan': {
        const dx = e.clientX - m.sx;
        const dy = e.clientY - m.sy;
        if (!m.moved && Math.hypot(dx, dy) < 3) return;
        setView((v) => ({ ...v, x: m.ox + dx, y: m.oy + dy }));
        if (!m.moved) setMode({ ...m, moved: true });
        break;
      }
      case 'drag': {
        const dx = p.x - m.start.x;
        const dy = p.y - m.start.y;
        if (!m.moved) {
          if (Math.hypot(dx, dy) * viewRef.current.zoom < 3) return;
          useApp.getState().checkpoint();
          setMode({ ...m, moved: true });
        }
        const pb = m.base.get(m.primary)!;
        let ddx = snap(pb.x + dx) - pb.x;
        let ddy = snap(pb.y + dy) - pb.y;
        if (!m.holes.empty) {
          const moving = useApp
            .getState()
            .project.circuit.components.filter((c) => m.base.has(c.id))
            .map((c) => ({ ...c, x: m.base.get(c.id)!.x + ddx, y: m.base.get(c.id)!.y + ddy }));
          const corr = snapCorrection(moving, m.holes);
          if (corr) {
            ddx += corr.x;
            ddy += corr.y;
          }
        }
        useApp.getState().moveSelection(ddx, ddy, m.base, m.wireBase);
        break;
      }
      case 'marquee':
        setMode({ ...m, cur: p });
        break;
      case 'wire': {
        let dragged = m.dragged;
        if (m.downClient && !dragged && Math.hypot(e.clientX - m.downClient.x, e.clientY - m.downClient.y) > 6) dragged = true;
        setMode({ ...m, cursor: p, dragged });
        const near = nearestTerminal(p, m.from);
        setHoverTerm(near ? near.key : null);
        break;
      }
      case 'handle': {
        const st = useApp.getState();
        const w = st.project.circuit.wires.find((x) => x.id === m.wireId);
        if (!w) return;
        if (!m.moved) {
          st.checkpoint();
          setMode({ ...m, moved: true });
        }
        const pts = w.points.map((q, i) => (i === m.index ? { x: snap(p.x), y: snap(p.y) } : q));
        st.updateWire(w.id, { points: pts }, false);
        break;
      }
    }
  };

  const onUp = (e: React.PointerEvent) => {
    const m = modeRef.current;
    switch (m.kind) {
      case 'pan':
        if (!m.moved && m.clearOnClick) useApp.getState().clearSelection();
        setMode({ kind: 'none' });
        break;
      case 'drag':
        setMode({ kind: 'none' });
        break;
      case 'marquee': {
        const x0 = Math.min(m.start.x, m.cur.x);
        const x1 = Math.max(m.start.x, m.cur.x);
        const y0 = Math.min(m.start.y, m.cur.y);
        const y1 = Math.max(m.start.y, m.cur.y);
        const comps = circuit.components
          .filter((c) => {
            const b = componentBounds(c);
            return b.x < x1 && b.x + b.w > x0 && b.y < y1 && b.y + b.h > y0;
          })
          .map((c) => c.id);
        const ids = new Set(comps);
        const wires = circuit.wires.filter((w) => ids.has(w.a.comp) && ids.has(w.b.comp)).map((w) => w.id);
        useApp.getState().select({ comps, wires });
        setMode({ kind: 'none' });
        break;
      }
      case 'wire': {
        if (!m.downClient) break; // modo clic: espera al siguiente clic
        const p = toWorld(e.clientX, e.clientY);
        const near = nearestTerminal(p, m.from);
        if (near && m.dragged) {
          finishWire(m, near.end);
        } else if (m.dragged) {
          // soltado en vacío: añadimos un codo y seguimos en modo cable
          setMode({ ...m, points: [...m.points, { x: snap(p.x), y: snap(p.y) }], downClient: null });
        } else {
          setMode({ ...m, downClient: null });
        }
        break;
      }
      case 'handle':
        setMode({ kind: 'none' });
        break;
    }
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    if (modeRef.current.kind === 'wire') setMode({ kind: 'none' });
  };

  // ------------------------------------------------------------ soltar desde la biblioteca
  const onDrop = (e: React.DragEvent) => {
    const type = e.dataTransfer.getData('application/x-esp32sim-device');
    if (!type) return;
    e.preventDefault();
    const def = getDevice(type);
    if (!def) return;
    const p = toWorld(e.clientX, e.clientY);
    placeSnapped(type, p.x - def.width / 2, p.y - def.height / 2);
  };

  // ------------------------------------------------------------ render
  const selComps = useMemo(() => new Set(selection.comps), [selection.comps]);
  const selWires = useMemo(() => new Set(selection.wires), [selection.wires]);

  const wireMode = mode.kind === 'wire' ? mode : null;
  let previewPath = '';
  if (wireMode) {
    const fromComp = compMap.get(wireMode.from.comp);
    const tp = fromComp ? terminalPos(fromComp, wireMode.from.term) : null;
    if (tp) {
      const near = nearestTerminal(wireMode.cursor, wireMode.from);
      let target = { x: snap(wireMode.cursor.x, 4), y: snap(wireMode.cursor.y, 4) };
      let tdir: TerminalDef['dir'] | null = null;
      if (near) {
        const tc = compMap.get(near.end.comp)!;
        const t2 = terminalPos(tc, near.end.term)!;
        target = t2.p;
        tdir = t2.dir;
      }
      previewPath = pathFromPoints(routePoints(tp.p, tp.dir, target, tdir, wireMode.points));
    }
  }

  const marquee = mode.kind === 'marquee' ? mode : null;
  const gridSize = 16 * view.zoom;

  const showTooltip = (e: React.PointerEvent, comp: ComponentInstance, term: TerminalDef) => {
    if (modeRef.current.kind !== 'none') return;
    setTooltip({ x: e.clientX, y: e.clientY, comp, term });
  };

  handlersRef.current = {
    down: (e, end) => onTerminalDown(e, end),
    enter: (e, c, t, key) => {
      if (modeRef.current.kind !== 'wire') setHoverTerm(key);
      showTooltip(e, c, t);
    },
    move: (e) => setTooltip((tt) => (tt ? { ...tt, x: e.clientX, y: e.clientY } : tt)),
    leave: () => {
      if (modeRef.current.kind !== 'wire') setHoverTerm(null);
      setTooltip(null);
    },
  };

  /** props por componente de la capa de terminales (cadenas para que memo funcione) */
  const termLayerProps = (id: string) => {
    const pre = `${id}:`;
    const pick = (set: Set<string>) => [...set].filter((k) => k.startsWith(pre)).join('|');
    return {
      hl: pick(highlighted.terms),
      issue: pick(issueTerms),
      target: wireMode && hoverTerm?.startsWith(pre) ? hoverTerm : '',
      handlers: termHandlers,
    };
  };

  return (
    <div
      ref={wrap}
      className={`canvas-wrap${mode.kind === 'pan' && mode.moved ? ' panning' : ''}${wireMode ? ' wiring' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes('application/x-esp32sim-device')) {
          e.preventDefault();
          e.dataTransfer.dropEffect = 'copy';
        }
      }}
      onDrop={onDrop}
    >
      <svg
        ref={svg}
        className="canvas"
        onPointerDown={onBackgroundDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onContextMenu={onContextMenu}
        style={{ cursor: spaceDown ? 'grab' : undefined }}
      >
        <defs>
          <pattern id="grid" width={gridSize} height={gridSize} patternUnits="userSpaceOnUse" x={view.x % gridSize} y={view.y % gridSize}>
            <circle cx={gridSize / 2} cy={gridSize / 2} r={Math.max(0.7, 1.1 * Math.min(1, view.zoom))} fill="var(--grid-dot)" />
          </pattern>
          <filter id="led-glow" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
          <filter id="led-glow-big" x="-100%" y="-100%" width="300%" height="300%">
            <feGaussianBlur stdDeviation="7" />
          </filter>
          <filter id="shadow" x="-10%" y="-10%" width="130%" height="130%">
            <feDropShadow dx="0" dy="2" stdDeviation="3" floodOpacity="0.35" />
          </filter>
        </defs>
        <rect width="100%" height="100%" fill="url(#grid)" />
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {/* protoboards (debajo de todo) y sus agujeros */}
          {circuit.components.filter((c) => getDevice(c.type)?.under).map((c) => (
            <ComponentView
              key={c.id}
              inst={c}
              state={states[c.id]}
              selected={selComps.has(c.id)}
              running={running}
              issues={issueByComp.get(c.id)}
              onDown={onComponentDown}
            />
          ))}
          {circuit.components.filter((c) => getDevice(c.type)?.under).map((c) => (
            <TermLayer key={c.id} comp={c} {...termLayerProps(c.id)} />
          ))}
          {/* componentes */}
          {circuit.components.filter((c) => !getDevice(c.type)?.under).map((c) => (
            <ComponentView
              key={c.id}
              inst={c}
              state={states[c.id]}
              selected={selComps.has(c.id)}
              running={running}
              issues={issueByComp.get(c.id)}
              onDown={onComponentDown}
            />
          ))}
          {/* cables */}
          {circuit.wires.map((w) => {
            const pts = wirePoints(w, compMap);
            if (!pts) return null;
            const d = pathFromPoints(pts);
            const sel = selWires.has(w.id);
            const hl = highlighted.wires.has(w.id);
            return (
              <g
                key={w.id}
                className={`wire${sel ? ' selected' : ''}${hl ? ' hl' : ''}`}
                onPointerDown={(e) => onWireDown(e, w)}
                onDoubleClick={(e) => onWireDoubleClick(e, w)}
                onPointerEnter={() => setHoverWire(w.id)}
                onPointerLeave={() => setHoverWire(null)}
              >
                <path className="wire-hit" d={d} />
                <path className="wire-under" d={d} />
                <path className="wire-line" d={d} stroke={w.color} />
                <circle cx={pts[0].x} cy={pts[0].y} r={2.6} fill={w.color} />
                <circle cx={pts[pts.length - 1].x} cy={pts[pts.length - 1].y} r={2.6} fill={w.color} />
                {sel &&
                  w.points.map((p, i) => (
                    <circle
                      key={i}
                      className="handle"
                      cx={p.x}
                      cy={p.y}
                      r={4.5}
                      onPointerDown={(e) => onHandleDown(e, w, i)}
                      onDoubleClick={(e) => {
                        e.stopPropagation();
                        useApp.getState().updateWire(w.id, { points: w.points.filter((_, j) => j !== i) });
                      }}
                    />
                  ))}
              </g>
            );
          })}
          {/* terminales del resto de componentes */}
          {circuit.components.filter((c) => !getDevice(c.type)?.under).map((c) => (
            <TermLayer key={c.id} comp={c} {...termLayerProps(c.id)} />
          ))}
          {wireMode && previewPath && <path className="wire-preview" d={previewPath} stroke={previewColor} />}
          {marquee && (
            <rect
              className="marquee"
              x={Math.min(marquee.start.x, marquee.cur.x)}
              y={Math.min(marquee.start.y, marquee.cur.y)}
              width={Math.abs(marquee.cur.x - marquee.start.x)}
              height={Math.abs(marquee.cur.y - marquee.start.y)}
            />
          )}
        </g>
      </svg>
      {wireMode && (
        <div className="canvas-banner">
          Cable desde <b>{wireMode.from.comp} · {terminalLabel(wireMode.from)}</b> — clic en un terminal para conectar · clic en vacío: codo · <kbd>Esc</kbd> cancela
        </div>
      )}
      {tooltip && <PinTooltip info={tooltip} />}
    </div>
  );
});

interface TermHandlers {
  down(e: React.PointerEvent, end: WireEnd): void;
  enter(e: React.PointerEvent, comp: ComponentInstance, term: TerminalDef, key: string): void;
  move(e: React.PointerEvent): void;
  leave(): void;
}

/** zonas activas de los terminales de un componente (memo: la protoboard tiene 830) */
const TermLayer = memo(function TermLayer({
  comp, hl, issue, target, handlers,
}: { comp: ComponentInstance; hl: string; issue: string; target: string; handlers: TermHandlers }) {
  const def = getDevice(comp.type);
  if (!def) return null;
  const hlSet = new Set(hl ? hl.split('|') : []);
  const issueSet = new Set(issue ? issue.split('|') : []);
  return (
    <g>
      {def.terminals.map((t) => {
        const tp = terminalPos(comp, t.id);
        if (!tp) return null;
        const key = termKey(comp.id, t.id);
        const cls = `term${def.socket ? ' hole' : ''}${hlSet.has(key) ? ' hl' : ''}${target === key ? ' target' : ''}${issueSet.has(key) ? ' issue' : ''}`;
        return (
          <g
            key={key}
            data-term={key}
            className={cls}
            onPointerDown={(e) => handlers.down(e, { comp: comp.id, term: t.id })}
            onPointerEnter={(e) => handlers.enter(e, comp, t, key)}
            onPointerMove={handlers.move}
            onPointerLeave={handlers.leave}
          >
            <circle className="term-hit" cx={tp.p.x} cy={tp.p.y} r={def.socket ? 5.5 : 7} />
            <circle className="term-ring" cx={tp.p.x} cy={tp.p.y} r={def.socket ? 4 : 4.5} />
          </g>
        );
      })}
    </g>
  );
});

function terminalLabel(end: WireEnd): string {
  const comp = useApp.getState().project.circuit.components.find((c) => c.id === end.comp);
  const def = comp ? getDevice(comp.type) : undefined;
  return def?.terminals.find((t) => t.id === end.term)?.label ?? end.term;
}

// ------------------------------------------------------------ componente

interface CompProps {
  inst: ComponentInstance;
  state: any;
  selected: boolean;
  running: boolean;
  issues: Issue[] | undefined;
  onDown(e: React.PointerEvent, c: ComponentInstance): void;
}

const ComponentView = memo(function ComponentView({ inst, state, selected, running, issues, onDown }: CompProps) {
  const def = getDevice(inst.type) as DeviceDef | undefined;
  const setInput = useCallback((patch: Record<string, any>) => sim.setInput(inst.id, patch), [inst.id]);
  const setLiveProp = useCallback((key: string, value: any) => useApp.getState().updateProps(inst.id, { [key]: value }, true), [inst.id]);
  if (!def) return null;
  const { Render } = def;
  const worst = issues?.some((i) => i.severity === 'error') ? 'error' : issues?.some((i) => i.severity === 'warning') ? 'warning' : issues?.length ? 'info' : null;
  const pad = 6;
  return (
    <g
      className={`comp${selected ? ' selected' : ''}`}
      data-comp={inst.id}
      transform={`translate(${inst.x} ${inst.y}) rotate(${inst.rotation} ${def.width / 2} ${def.height / 2})`}
      onPointerDown={(e) => onDown(e, inst)}
    >
      <rect className="hit" x={-2} y={-2} width={def.width + 4} height={def.height + 4} />
      <Render inst={inst} state={state} selected={selected} running={running} setInput={setInput} setLiveProp={setLiveProp} />
      {worst === 'error' && <rect className="err-outline" x={-pad} y={-pad} width={def.width + pad * 2} height={def.height + pad * 2} rx={6} />}
      {worst === 'warning' && <rect className="warn-outline" x={-pad} y={-pad} width={def.width + pad * 2} height={def.height + pad * 2} rx={6} />}
      {selected && <rect className="sel-outline" x={-pad - 2} y={-pad - 2} width={def.width + pad * 2 + 4} height={def.height + pad * 2 + 4} rx={7} />}
      {worst && (worst !== 'info' || selected) && (
        <g className="issue-badge" transform={`translate(${def.width + 2} ${-10}) rotate(${-inst.rotation} 0 0)`}>
          <title>{issues!.map((i) => `${i.title}: ${i.detail}`).join('\n\n')}</title>
          <circle r={8} fill={worst === 'error' ? 'var(--err)' : worst === 'warning' ? 'var(--warn)' : 'var(--info)'} />
          <text y={3.5} textAnchor="middle" fontSize={11} fontWeight={800} fill="#fff" fontFamily="Inter, sans-serif">
            {worst === 'info' ? 'i' : '!'}
          </text>
        </g>
      )}
      {inst.type !== 'esp32s3' && inst.type !== 'gnd' && inst.type !== 'vcc' && (
        <text className="comp-label" x={def.width + 5} y={def.height - 2} transform={`rotate(${-inst.rotation} ${def.width / 2} ${def.height / 2})`}>
          {inst.id}
        </text>
      )}
    </g>
  );
});

// ------------------------------------------------------------ tooltip de pin

function PinTooltip({ info }: { info: TooltipInfo }) {
  const solution = useSim((s) => s.solution);
  const states = useSim((s) => s.states);
  const running = useSim((s) => s.status === 'running');
  const { comp, term } = info;
  const def = getDevice(comp.type);
  const key = termKey(comp.id, term.id);
  const net = solution?.netlist.netOf.get(key);
  const v = net !== undefined && solution ? solution.vAvg[net] : null;
  const connected = solution?.netlist.connected.has(key);
  const gpio = comp.type === 'esp32s3' && term.id.startsWith('GPIO') ? Number(term.id.slice(4)) : null;
  const pinSt = gpio !== null ? states[comp.id]?.pins?.[gpio] : null;
  const MODE: Record<string, string> = {
    unset: 'sin configurar', input: 'INPUT', input_pullup: 'INPUT_PULLUP', input_pulldown: 'INPUT_PULLDOWN',
    output: 'OUTPUT', open_drain: 'OPEN_DRAIN', pwm: 'PWM', tone: 'tone()', servo: 'Servo',
  };
  const kindLabel: Record<string, string> = { gpio: 'GPIO', power: 'Alimentación', ground: 'GND', vcc: 'VCC', gnd: 'GND', passive: 'Terminal', signal: 'Señal', en: 'Control' };
  return (
    <div className="tooltip" style={{ left: info.x + 16, top: info.y + 14 }}>
      <div className="tt-title">
        {term.label} <span className={`chip ${term.kind}`}>{kindLabel[term.kind]}</span>
      </div>
      <div className="tt-sub">
        {def?.name} · <span style={{ fontFamily: 'var(--mono)' }}>{comp.id}</span>
      </div>
      <div style={{ marginTop: 5 }}>{term.desc}</div>
      <div className="tt-live">
        {v !== null && (connected || term.kind === 'power' || term.kind === 'ground' || running) && (
          <span>
            V = <b>{v.toFixed(2)} V</b>
          </span>
        )}
        {pinSt && running && (
          <span>
            modo <b>{MODE[pinSt.mode] ?? pinSt.mode}</b>
          </span>
        )}
        {pinSt && running && pinSt.mode === 'output' && (
          <span>
            nivel <b>{pinSt.level ? 'HIGH' : 'LOW'}</b>
          </span>
        )}
        {pinSt && running && (pinSt.mode === 'pwm' || pinSt.mode === 'servo' || pinSt.mode === 'tone') && (
          <span>
            duty <b>{(pinSt.duty * 100).toFixed(1)} %</b>
          </span>
        )}
        {!connected && term.kind !== 'ground' && <span style={{ color: 'var(--fg-dim)' }}>sin conectar</span>}
      </div>
    </div>
  );
}
