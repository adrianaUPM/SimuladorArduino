import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CLASSES, FUNCTIONS } from '../engine/library';
import { deleteProject, importProjectFile, listProjects, type SavedProject } from '../state/persistence';
import { useApp } from '../state/store';
import { IconClose, IconFolder, IconTrash, IconUpload } from './Icons';

export function Modal({ title, onClose, children, footer, wide }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className={`modal${wide ? ' wide' : ''}`} role="dialog" aria-label={title}>
        <div className="modal-header">
          <h2>{title}</h2>
          <button className="btn sm icon" onClick={onClose} aria-label="Cerrar">
            <IconClose size={15} />
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

export function OpenDialog({ onClose, onToast }: { onClose(): void; onToast(msg: string): void }) {
  const [items, setItems] = useState<SavedProject[]>(() => listProjects());
  const [error, setError] = useState<string | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const load = useApp((s) => s.loadProject);

  return (
    <Modal
      title="Abrir proyecto"
      onClose={onClose}
      footer={
        <>
          <input
            ref={file}
            type="file"
            accept=".json,application/json"
            style={{ display: 'none' }}
            onChange={async (e) => {
              const f = e.target.files?.[0];
              if (!f) return;
              try {
                const p = await importProjectFile(f);
                load(p);
                onToast(`Proyecto "${p.name}" importado`);
                onClose();
              } catch (err) {
                setError((err as Error).message);
              }
            }}
          />
          <button className="btn outline" onClick={() => file.current?.click()}>
            <IconUpload size={15} /> Importar archivo .json
          </button>
          <button className="btn" onClick={onClose}>
            Cancelar
          </button>
        </>
      }
    >
      {error && <div className="issue error" style={{ cursor: 'default' }}>{error}</div>}
      {items.length === 0 && <div className="empty">No hay proyectos guardados en este navegador todavía.<br />Usa «Guardar» para guardar el proyecto actual.</div>}
      {items.map((p) => (
        <div className="project-row" key={p.name}>
          <IconFolder size={18} />
          <div className="grow">
            <div className="n">{p.name}</div>
            <div className="meta">
              {new Date(p.savedAt).toLocaleString()} · {p.circuit.components.length} componentes · {p.code.split('\n').length} líneas
            </div>
          </div>
          <button
            className="btn sm primary"
            onClick={() => {
              load(p);
              onToast(`Proyecto "${p.name}" abierto`);
              onClose();
            }}
          >
            Abrir
          </button>
          <button
            className="btn sm icon danger"
            title="Eliminar"
            onClick={() => {
              if (confirm(`¿Eliminar el proyecto "${p.name}" de este navegador?`)) {
                deleteProject(p.name);
                setItems(listProjects());
              }
            }}
          >
            <IconTrash size={14} />
          </button>
        </div>
      ))}
    </Modal>
  );
}

export function HelpDialog({ onClose }: { onClose(): void }) {
  return (
    <Modal title="Ayuda · ESP32-S3 Simulator" onClose={onClose} wide>
      <div className="help">
        <p>
          Simulador educativo de la placa <b>ESP32-S3-DevKitC-1</b>. Diseña el circuito, escribe el programa en C++/Arduino y pulsa
          <b> Run</b>: el intérprete ejecuta tu código y el circuito reacciona en tiempo real. No es un compilador real: interpreta un
          subconjunto educativo del lenguaje y de la API de Arduino-ESP32.
        </p>
        <h4>Circuito</h4>
        <ul>
          <li>Arrastra componentes desde la biblioteca (o haz doble clic sobre ellos).</li>
          <li>Haz clic en un pin y arrastra hasta otro terminal para crear un cable. Si sueltas en vacío se añade un codo y puedes seguir haciendo clic.</li>
          <li>Los cables siguen a los componentes al moverlos. Selecciona un cable para cambiar su color o mover sus codos.</li>
          <li>Pasa el ratón por un pin para ver su función y su tensión; se resalta todo lo que está conectado a él.</li>
          <li>Los problemas eléctricos (cortocircuitos, falta de GND, 5 V en un GPIO, LED sin resistencia…) se marcan en rojo/ámbar con una explicación.</li>
        </ul>
        <h4>Atajos</h4>
        <div className="help-grid">
          <span><kbd>Ctrl</kbd>+<kbd>Enter</kbd></span><span>Ejecutar</span>
          <span><kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>Enter</kbd></span><span>Detener</span>
          <span><kbd>Ctrl</kbd>+<kbd>S</kbd></span><span>Guardar proyecto en el navegador</span>
          <span><kbd>Ctrl</kbd>+<kbd>Z</kbd> / <kbd>Ctrl</kbd>+<kbd>Y</kbd></span><span>Deshacer / rehacer (circuito)</span>
          <span><kbd>Supr</kbd></span><span>Eliminar selección</span>
          <span><kbd>R</kbd></span><span>Girar selección 90°</span>
          <span><kbd>Esc</kbd></span><span>Cancelar cable / quitar selección</span>
          <span><kbd>Shift</kbd>+arrastrar</span><span>Selección múltiple por área</span>
          <span><kbd>Ctrl</kbd>/<kbd>Shift</kbd>+clic</span><span>Añadir/quitar de la selección</span>
          <span>Rueda / arrastrar fondo</span><span>Zoom / mover la vista</span>
        </div>
        <h4>Funciones soportadas</h4>
        <p style={{ fontFamily: 'var(--mono)', fontSize: 11.5, lineHeight: 1.7 }}>
          {Object.values(FUNCTIONS).map((f) => f.sig).join(' · ')}
        </p>
        <h4>Clases soportadas</h4>
        {Object.entries(CLASSES).map(([name, c]) => (
          <p key={name} style={{ fontSize: 12 }}>
            <b>{name === 'HardwareSerial' ? 'Serial' : name === 'TwoWire' ? 'Wire' : name}</b> — {c.doc}{' '}
            <span style={{ fontFamily: 'var(--mono)', fontSize: 11, color: 'var(--fg-muted)' }}>{Object.keys(c.methods).join(', ')}</span>
          </p>
        ))}
        <h4>Lenguaje</h4>
        <p>
          Variables globales y locales (<code>int</code>, <code>long</code>, <code>float</code>, <code>bool</code>, <code>char</code>,
          <code>byte</code>, <code>String</code>…), <code>const</code>, <code>#define</code>, arrays de una dimensión, funciones con
          parámetros y paso por referencia (<code>&amp;</code>), <code>if/else</code>, <code>for</code>, <code>while</code>,
          <code>do/while</code>, <code>switch</code>, operadores aritméticos, lógicos y de bits, <code>attachInterrupt</code>.
          No hay punteros, estructuras ni clases propias.
        </p>
      </div>
    </Modal>
  );
}
