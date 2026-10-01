// Estado "en vivo" de la simulación (consola, errores, estado visual de los componentes).

import { create } from 'zustand';
import type { Diagnostic } from '../engine/checker';
import type { Solution } from '../simulator/solver';
import type { Issue } from '../simulator/types';

export type ConsoleKind = 'out' | 'in' | 'warn' | 'error' | 'sys';

export interface ConsoleEntry {
  id: number;
  kind: ConsoleKind;
  text: string;
  line?: number;
}

interface SimState {
  status: 'stopped' | 'running' | 'error';
  console: ConsoleEntry[];
  diagnostics: Diagnostic[];
  runtimeError: { message: string; line: number } | null;
  states: Record<string, any>;
  issues: Issue[];
  solution: Solution | null;
  inputs: Record<string, Record<string, any>>;
}

export const useSim = create<SimState>(() => ({
  status: 'stopped',
  console: [],
  diagnostics: [],
  runtimeError: null,
  states: {},
  issues: [],
  solution: null,
  inputs: {},
}));

let nextId = 1;
const MAX_ENTRIES = 600;

export function pushConsole(entries: { kind: ConsoleKind; text: string; line?: number }[]) {
  if (!entries.length) return;
  useSim.setState((s) => {
    const out = s.console.slice();
    for (const e of entries) {
      const last = out[out.length - 1];
      // la salida serie se concatena a la última línea si no terminó en salto
      if (e.kind === 'out' && last && last.kind === 'out' && !last.text.endsWith('\n')) {
        out[out.length - 1] = { ...last, text: last.text + e.text };
      } else {
        out.push({ id: nextId++, ...e });
      }
    }
    return { console: out.length > MAX_ENTRIES ? out.slice(out.length - MAX_ENTRIES) : out };
  });
}

export function clearConsole() {
  useSim.setState({ console: [] });
}
