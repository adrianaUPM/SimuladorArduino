import { useEffect, useRef, useState } from 'react';
import { IconAlert, IconCheck, IconCode, IconError, IconPlay, IconStop } from '../components/Icons';
import { PaneControls } from '../components/PaneControls';
import { sim } from '../simulator/controller';
import { useSim } from '../state/simStore';
import { useApp } from '../state/store';
import { CodeEditor, type CodeEditorHandle } from './CodeEditor';
import { SerialConsole } from './SerialConsole';

export function CodePanel() {
  const code = useApp((s) => s.project.code);
  const setCode = useApp((s) => s.setCode);
  const loadCounter = useApp((s) => s.loadCounter);
  const status = useSim((s) => s.status);
  const diagnostics = useSim((s) => s.diagnostics);
  const runtimeError = useSim((s) => s.runtimeError);
  const editor = useRef<CodeEditorHandle>(null);
  const [consoleH, setConsoleH] = useState(() => Number(localStorage.getItem('esp32sim:consoleH')) || 220);
  const [dragging, setDragging] = useState(false);
  const panel = useRef<HTMLDivElement>(null);

  const errors = diagnostics.filter((d) => d.severity === 'error');
  const warnings = diagnostics.filter((d) => d.severity === 'warning');

  useEffect(() => {
    try {
      localStorage.setItem('esp32sim:consoleH', String(consoleH));
    } catch {
      /* sin almacenamiento */
    }
  }, [consoleH]);

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const rect = panel.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      const h = rect.bottom - ev.clientY;
      setConsoleH(Math.max(90, Math.min(rect.height - 140, h)));
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div className="pane" ref={panel} style={{ flex: 1 }}>
      <div className="pane-header">
        <div className="pane-title">
          <IconCode />
          Código
          <span className="file">sketch.ino</span>
        </div>
        <div className="spacer" />
        {status === 'running' ? (
          <button className="btn sm stop" onClick={() => sim.stop()} title="Detener (Ctrl+Shift+Enter)">
            <IconStop size={13} /> Stop
          </button>
        ) : (
          <button className="btn sm run" onClick={() => sim.run()} title="Ejecutar (Ctrl+Enter)">
            <IconPlay size={13} /> Run
          </button>
        )}
        <PaneControls pane="code" />
      </div>
      <CodeEditor
        ref={editor}
        value={code}
        resetKey={loadCounter}
        onChange={setCode}
        errorLine={status === 'error' && runtimeError ? runtimeError.line : null}
      />
      <div className="editor-status">
        {errors.length === 0 && warnings.length === 0 && (
          <span className="ok" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <IconCheck size={13} /> Sin errores
          </span>
        )}
        {errors.length > 0 && (
          <button className="e" onClick={() => editor.current?.goToLine(errors[0].line)} title={errors[0].message}>
            <IconError size={13} /> {errors.length} error{errors.length > 1 ? 'es' : ''} · línea {errors[0].line}: {truncate(errors[0].message, 60)}
          </button>
        )}
        {errors.length === 0 && warnings.length > 0 && (
          <button className="w" onClick={() => editor.current?.goToLine(warnings[0].line)} title={warnings[0].message}>
            <IconAlert size={13} /> {warnings.length} aviso{warnings.length > 1 ? 's' : ''} · línea {warnings[0].line}: {truncate(warnings[0].message, 60)}
          </button>
        )}
        <div className="spacer" />
        <span>C++ · Arduino · ESP32-S3</span>
      </div>
      <div className={`splitter h${dragging ? ' dragging' : ''}`} onPointerDown={startDrag} />
      <SerialConsole height={consoleH} onLineClick={(l) => editor.current?.goToLine(l)} />
    </div>
  );
}

function truncate(s: string, n: number) {
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
