import { useRef, useState } from 'react';
import { ComponentLibrary } from '../components/ComponentLibrary';
import { IconAlert, IconCircuit, IconError, IconFit, IconRotate, IconTrash, IconZoomIn, IconZoomOut } from '../components/Icons';
import { PaneControls } from '../components/PaneControls';
import { PropertiesPanel } from '../components/PropertiesPanel';
import { useSim } from '../state/simStore';
import { useApp } from '../state/store';
import { CircuitCanvas, type CanvasHandle } from './CircuitCanvas';

export function CircuitPanel() {
  const canvas = useRef<CanvasHandle>(null);
  const [zoom, setZoom] = useState(1);
  const [showLib, setShowLib] = useState(true);
  const [showProps, setShowProps] = useState(true);
  const issues = useSim((s) => s.issues);
  const selection = useApp((s) => s.selection);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warning').length;
  const hasSel = selection.comps.length + selection.wires.length > 0;

  return (
    <div className="pane" style={{ flex: 1 }}>
      <div className="pane-header">
        <div className="pane-title">
          <IconCircuit />
          Circuito
        </div>
        {errors > 0 && (
          <span className="status-pill error" title="Errores eléctricos detectados">
            <IconError size={12} /> {errors}
          </span>
        )}
        {warns > 0 && (
          <span className="status-pill" style={{ color: 'var(--warn)', background: 'var(--warn-soft)' }} title="Avisos">
            <IconAlert size={12} /> {warns}
          </span>
        )}
        <div className="spacer" />
        <button className={`btn sm${showLib ? ' active' : ''}`} onClick={() => setShowLib(!showLib)} title="Mostrar/ocultar biblioteca">
          Componentes
        </button>
        <button className={`btn sm${showProps ? ' active' : ''}`} onClick={() => setShowProps(!showProps)} title="Mostrar/ocultar propiedades">
          Propiedades
        </button>
        <PaneControls pane="circuit" />
      </div>
      <div className="circuit-body">
        {showLib && <ComponentLibrary onAdd={(t) => canvas.current?.addAtCenter(t)} />}
        <div style={{ flex: 1, minWidth: 0, display: 'flex', position: 'relative' }}>
          <CircuitCanvas ref={canvas} onZoom={setZoom} />
          <div className="canvas-toolbar">
            <button className="btn sm icon" onClick={() => canvas.current?.zoomBy(1 / 1.2)} title="Alejar">
              <IconZoomOut size={15} />
            </button>
            <span className="zoom">{Math.round(zoom * 100)}%</span>
            <button className="btn sm icon" onClick={() => canvas.current?.zoomBy(1.2)} title="Acercar">
              <IconZoomIn size={15} />
            </button>
            <button className="btn sm icon" onClick={() => canvas.current?.fit()} title="Encuadrar todo">
              <IconFit size={15} />
            </button>
            <div className="tb-sep" style={{ height: 18 }} />
            <button className="btn sm icon" disabled={!selection.comps.length} onClick={() => useApp.getState().rotateSelection()} title="Girar selección (R)">
              <IconRotate size={15} />
            </button>
            <button className="btn sm icon danger" disabled={!hasSel} onClick={() => useApp.getState().deleteSelection()} title="Eliminar selección (Supr)">
              <IconTrash size={15} />
            </button>
          </div>
          <div className="canvas-hint">
            Fondo: mover · Rueda: zoom · Shift+arrastrar: seleccionar · Pin: cable
          </div>
        </div>
        {showProps && <PropertiesPanel />}
      </div>
    </div>
  );
}
