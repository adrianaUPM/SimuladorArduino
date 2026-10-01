import { useCallback, useEffect, useState } from 'react';
import { HelpDialog, OpenDialog } from './components/Dialogs';
import { IconCheck } from './components/Icons';
import { TopBar } from './components/TopBar';
import { Workspace } from './components/Workspace';
import { sim } from './simulator/controller';
import { saveAutosave, saveProject } from './state/persistence';
import { useApp } from './state/store';

function loadTheme(): 'dark' | 'light' {
  try {
    const t = localStorage.getItem('esp32sim:theme');
    if (t === 'light' || t === 'dark') return t;
  } catch {
    /* sin almacenamiento */
  }
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function App() {
  const [dialog, setDialog] = useState<'open' | 'help' | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState(loadTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try {
      localStorage.setItem('esp32sim:theme', theme);
    } catch {
      /* sin almacenamiento */
    }
  }, [theme]);

  useEffect(() => {
    sim.start();
  }, []);

  // autoguardado
  useEffect(() => {
    let t: ReturnType<typeof setTimeout> | null = null;
    const unsub = useApp.subscribe((s, prev) => {
      if (s.project === prev.project) return;
      if (t) clearTimeout(t);
      t = setTimeout(() => saveAutosave(useApp.getState().project), 400);
    });
    return () => {
      unsub();
      if (t) clearTimeout(t);
    };
  }, []);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast((cur) => (cur === msg ? null : cur)), 2400);
  }, []);

  // atajos de teclado globales
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const typing = !!target.closest('input, textarea, select, .cm-editor');
      const mod = e.ctrlKey || e.metaKey;
      const st = useApp.getState();
      if (mod && e.key === 'Enter') {
        e.preventDefault();
        if (e.shiftKey) sim.stop();
        else sim.run();
        return;
      }
      if (mod && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (saveProject(st.project)) showToast(`Proyecto "${st.project.name}" guardado`);
        return;
      }
      if (typing) return;
      if (mod && e.key.toLowerCase() === 'z' && !e.shiftKey) {
        e.preventDefault();
        st.undo();
      } else if (mod && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
        e.preventDefault();
        st.redo();
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        st.deleteSelection();
      } else if (e.key.toLowerCase() === 'r' && !mod) {
        st.rotateSelection();
      } else if (e.key === 'Escape') {
        st.clearSelection();
      } else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault();
        st.select({ comps: st.project.circuit.components.map((c) => c.id), wires: st.project.circuit.wires.map((w) => w.id) });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showToast]);

  return (
    <div className="app">
      <TopBar onOpen={() => setDialog('open')} onHelp={() => setDialog('help')} onToast={showToast} theme={theme} onTheme={setTheme} />
      <Workspace />
      {dialog === 'open' && <OpenDialog onClose={() => setDialog(null)} onToast={showToast} />}
      {dialog === 'help' && <HelpDialog onClose={() => setDialog(null)} />}
      {toast && (
        <div className="toast">
          <IconCheck size={15} /> {toast}
        </div>
      )}
    </div>
  );
}
