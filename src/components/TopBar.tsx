import { useEffect, useRef, useState } from 'react';
import { sim } from '../simulator/controller';
import { blankProject, EXAMPLES } from '../state/examples';
import { exportProject, saveProject } from '../state/persistence';
import { useSim } from '../state/simStore';
import { useApp, type ViewMode } from '../state/store';
import {
  IconBook, IconBroom, IconChevron, IconCircuit, IconCode, IconDownload, IconFolder, IconHelp, IconMoon, IconMute, IconNew,
  IconPlay, IconRedo, IconReset, IconSave, IconSound, IconSplit, IconStop, IconSun, IconUndo,
} from './Icons';

interface Props {
  onOpen(): void;
  onHelp(): void;
  onToast(msg: string): void;
  theme: 'dark' | 'light';
  onTheme(t: 'dark' | 'light'): void;
}

export function TopBar({ onOpen, onHelp, onToast, theme, onTheme }: Props) {
  const name = useApp((s) => s.project.name);
  const setName = useApp((s) => s.setName);
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const canUndo = useApp((s) => s.past.length > 0);
  const canRedo = useApp((s) => s.future.length > 0);
  const soundOn = useApp((s) => s.soundOn);
  const status = useSim((s) => s.status);
  const [examplesOpen, setExamplesOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!examplesOpen) return;
    const close = (e: PointerEvent) => {
      if (!menuRef.current?.contains(e.target as Node)) setExamplesOpen(false);
    };
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [examplesOpen]);

  const running = status === 'running';

  const newProject = () => {
    if (!confirm('¿Crear un proyecto nuevo? El proyecto actual se perderá si no lo has guardado.')) return;
    sim.stop();
    useApp.getState().loadProject(blankProject());
  };

  const save = () => {
    const p = useApp.getState().project;
    if (saveProject(p)) onToast(`Proyecto "${p.name}" guardado en este navegador`);
    else onToast('No se pudo guardar (almacenamiento lleno o bloqueado)');
  };

  const views: { v: ViewMode; label: string; icon: React.ReactNode }[] = [
    { v: 'code', label: 'Código', icon: <IconCode size={14} /> },
    { v: 'split', label: 'Dividida', icon: <IconSplit size={14} /> },
    { v: 'circuit', label: 'Circuito', icon: <IconCircuit size={14} /> },
  ];

  return (
    <header className="topbar">
      <div className="brand">
        <div className="brand-logo">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2" strokeLinecap="round">
            <rect x="6" y="6" width="12" height="12" rx="2" />
            <path d="M9 2v4M15 2v4M9 18v4M15 18v4M2 9h4M2 15h4M18 9h4M18 15h4" />
          </svg>
        </div>
        <div>
          <div className="brand-title">ESP32-S3 Lab</div>
          <div className="brand-sub">Simulador IoT</div>
        </div>
      </div>
      <input className="project-name" value={name} onChange={(e) => setName(e.target.value)} title="Nombre del proyecto" />

      <div className="tb-group tb-collapsible">
        <button className="btn" onClick={newProject} title="Nuevo proyecto">
          <IconNew /> <span className="label">Nuevo</span>
        </button>
        <button className="btn" onClick={onOpen} title="Abrir proyecto guardado o importar">
          <IconFolder /> <span className="label">Abrir</span>
        </button>
        <button className="btn" onClick={save} title="Guardar en el navegador (Ctrl+S)">
          <IconSave /> <span className="label">Guardar</span>
        </button>
        <button className="btn icon" onClick={() => exportProject(useApp.getState().project)} title="Descargar como archivo .json">
          <IconDownload />
        </button>
        <div className="dropdown" ref={menuRef}>
          <button className={`btn${examplesOpen ? ' active' : ''}`} onClick={() => setExamplesOpen(!examplesOpen)}>
            <IconBook /> <span className="label">Ejemplos</span> <IconChevron size={13} />
          </button>
          {examplesOpen && (
            <div className="menu">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex.id}
                  className="menu-item"
                  onClick={() => {
                    setExamplesOpen(false);
                    sim.stop();
                    useApp.getState().loadProject(ex.project);
                    onToast(`Ejemplo "${ex.title}" cargado`);
                  }}
                >
                  <span className="t">{ex.title}</span>
                  <span className="d">{ex.description}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="tb-sep" />

      <div className="tb-group">
        {running ? (
          <button className="btn stop" onClick={() => sim.stop()} title="Detener (Ctrl+Shift+Enter)">
            <IconStop size={14} /> Detener
          </button>
        ) : (
          <button className="btn run" onClick={() => sim.run()} title="Compilar y ejecutar (Ctrl+Enter)">
            <IconPlay size={14} /> Ejecutar
          </button>
        )}
        <button className="btn icon" onClick={() => sim.reset()} title="Reset (reinicia el programa, como el botón RST)">
          <IconReset />
        </button>
        <span className={`status-pill ${status}`} style={{ marginLeft: 6 }}>
          <span className="dot" />
          {status === 'running' ? 'En ejecución' : status === 'error' ? 'Error' : 'Detenido'}
        </span>
      </div>

      <div className="tb-sep" />

      <div className="tb-group tb-collapsible">
        <button className="btn icon" disabled={!canUndo} onClick={() => useApp.getState().undo()} title="Deshacer (Ctrl+Z)">
          <IconUndo />
        </button>
        <button className="btn icon" disabled={!canRedo} onClick={() => useApp.getState().redo()} title="Rehacer (Ctrl+Y)">
          <IconRedo />
        </button>
        <button
          className="btn danger"
          onClick={() => {
            if (confirm('¿Eliminar todos los componentes y cables del circuito?')) useApp.getState().clearCircuit();
          }}
          title="Limpiar circuito"
        >
          <IconBroom /> <span className="label">Limpiar</span>
        </button>
      </div>

      <div className="spacer" />

      <div className="segmented" role="tablist" aria-label="Vista">
        {views.map((x) => (
          <button key={x.v} className={`btn sm${view === x.v ? ' active' : ''}`} onClick={() => setView(x.v)} role="tab" aria-selected={view === x.v}>
            {x.icon}
            <span className="label">{x.label}</span>
          </button>
        ))}
      </div>
      <button className="btn icon" onClick={() => useApp.getState().setSoundOn(!soundOn)} title={soundOn ? 'Silenciar buzzers' : 'Activar sonido de buzzers'}>
        {soundOn ? <IconSound /> : <IconMute />}
      </button>
      <button className="btn icon" onClick={() => onTheme(theme === 'dark' ? 'light' : 'dark')} title="Tema claro/oscuro">
        {theme === 'dark' ? <IconSun /> : <IconMoon />}
      </button>
      <button className="btn icon" onClick={onHelp} title="Ayuda">
        <IconHelp />
      </button>
    </header>
  );
}
