// Área principal: vista Código, Circuito o dividida con separador arrastrable.
// Ambos paneles permanecen montados para conservar su estado (zoom, cursor...).

import { useRef, useState } from 'react';
import { CodePanel } from '../editor/CodePanel';
import { CircuitPanel } from '../simulator/CircuitPanel';
import { useApp } from '../state/store';

export function Workspace() {
  const view = useApp((s) => s.view);
  const codeSide = useApp((s) => s.codeSide);
  const split = useApp((s) => s.split);
  const setSplit = useApp((s) => s.setSplit);
  const maximized = useApp((s) => s.maximized);
  const ref = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState(false);

  const showCode = view === 'code' || (view === 'split' && maximized !== 'circuit');
  const showCircuit = view === 'circuit' || (view === 'split' && maximized !== 'code');
  const both = showCode && showCircuit;

  const startDrag = (e: React.PointerEvent) => {
    e.preventDefault();
    setDragging(true);
    const rect = ref.current!.getBoundingClientRect();
    const move = (ev: PointerEvent) => {
      let f = (ev.clientX - rect.left) / rect.width;
      if (codeSide === 'right') f = 1 - f;
      setSplit(f);
    };
    const up = () => {
      setDragging(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const codeStyle: React.CSSProperties = {
    display: showCode ? 'flex' : 'none',
    flex: both ? `0 0 ${split * 100}%` : '1 1 auto',
    order: codeSide === 'left' ? 0 : 2,
  };
  const circuitStyle: React.CSSProperties = {
    display: showCircuit ? 'flex' : 'none',
    flex: '1 1 0',
    order: codeSide === 'left' ? 2 : 0,
  };

  return (
    <main className="workspace" ref={ref} style={dragging ? { userSelect: 'none', cursor: 'col-resize' } : undefined}>
      <div style={codeStyle} className="pane-host">
        <CodePanel />
      </div>
      {both && <div className={`splitter${dragging ? ' dragging' : ''}`} style={{ order: 1 }} onPointerDown={startDrag} onDoubleClick={() => setSplit(0.42)} />}
      <div style={circuitStyle} className="pane-host">
        <CircuitPanel />
      </div>
    </main>
  );
}
