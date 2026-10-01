// Guardado local de proyectos (localStorage) e importación/exportación JSON.

import type { Project } from './store';

const AUTOSAVE = 'esp32sim:autosave';
const PROJECTS = 'esp32sim:projects';
const PREFS = 'esp32sim:prefs';

export interface SavedProject extends Project {
  savedAt: number;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}

export function isProject(p: any): p is Project {
  return (
    p && typeof p === 'object' && typeof p.code === 'string' && p.circuit &&
    Array.isArray(p.circuit.components) && Array.isArray(p.circuit.wires)
  );
}

export function loadAutosave(): Project | null {
  const p = read<Project>(AUTOSAVE);
  return isProject(p) ? p : null;
}

export function saveAutosave(p: Project) {
  write(AUTOSAVE, p);
}

export function listProjects(): SavedProject[] {
  const all = read<Record<string, SavedProject>>(PROJECTS) ?? {};
  return Object.values(all)
    .filter(isProject)
    .sort((a, b) => b.savedAt - a.savedAt);
}

export function saveProject(p: Project): boolean {
  const all = read<Record<string, SavedProject>>(PROJECTS) ?? {};
  all[p.name] = { ...p, savedAt: Date.now() };
  return write(PROJECTS, all);
}

export function deleteProject(name: string) {
  const all = read<Record<string, SavedProject>>(PROJECTS) ?? {};
  delete all[name];
  write(PROJECTS, all);
}

export function exportProject(p: Project) {
  const blob = new Blob([JSON.stringify({ format: 'esp32s3-sim', version: 1, ...p }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${p.name.replace(/[^\w\-áéíóúñÁÉÍÓÚÑ ]+/g, '_') || 'proyecto'}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function importProjectFile(file: File): Promise<Project> {
  const text = await file.text();
  const data = JSON.parse(text);
  if (!isProject(data)) throw new Error('El archivo no es un proyecto válido del simulador');
  return { name: data.name || file.name.replace(/\.json$/i, ''), code: data.code, circuit: data.circuit };
}

export interface UiPrefs {
  view?: 'code' | 'split' | 'circuit';
  codeSide?: 'left' | 'right';
  split?: number;
  soundOn?: boolean;
}

export function loadUiPrefs(): UiPrefs {
  return read<UiPrefs>(PREFS) ?? {};
}

export function saveUiPrefs(p: UiPrefs) {
  write(PREFS, p);
}
