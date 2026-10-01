import { useEffect, useRef, useState } from 'react';
import { IconSend, IconTrash } from '../components/Icons';
import { sim } from '../simulator/controller';
import { clearConsole, useSim } from '../state/simStore';

const ENDINGS: Record<string, string> = { none: '', nl: '\n', cr: '\r', crlf: '\r\n' };

export function SerialConsole({ height, onLineClick }: { height: number; onLineClick(line: number): void }) {
  const entries = useSim((s) => s.console);
  const status = useSim((s) => s.status);
  const out = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const [input, setInput] = useState('');
  const [ending, setEnding] = useState('nl');

  useEffect(() => {
    if (autoScroll && out.current) out.current.scrollTop = out.current.scrollHeight;
  }, [entries, autoScroll]);

  const send = () => {
    if (!input && ending === 'none') return;
    sim.serialSend(input + ENDINGS[ending]);
    setInput('');
  };

  return (
    <div className="console" style={{ height, flexShrink: 0 }}>
      <div className="pane-header" style={{ height: 34 }}>
        <div className="pane-title">Monitor serie</div>
        <span style={{ color: 'var(--fg-dim)', fontSize: 11.5 }}>115200 baudios</span>
        <div className="spacer" />
        <label style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11.5, color: 'var(--fg-muted)' }}>
          <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} />
          Autoscroll
        </label>
        <button className="btn sm icon" onClick={clearConsole} title="Limpiar consola">
          <IconTrash size={14} />
        </button>
      </div>
      <div
        className="console-out"
        ref={out}
        onScroll={(e) => {
          const el = e.currentTarget;
          const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 24;
          if (atBottom !== autoScroll) setAutoScroll(atBottom);
        }}
      >
        {entries.length === 0 && (
          <div className="console-empty">
            {status === 'running' ? 'Esperando datos de Serial…' : 'Pulsa Run para compilar y ejecutar. Aquí verás la salida de Serial.print().'}
          </div>
        )}
        {entries.map((e) => (
          <div
            key={e.id}
            className={`c-${e.kind}${e.line ? ' line-link' : ''}`}
            onClick={e.line ? () => onLineClick(e.line!) : undefined}
            title={e.line ? `Ir a la línea ${e.line}` : undefined}
          >
            {e.kind === 'out' ? e.text.replace(/\r/g, '').replace(/\n$/, '') || ' ' : e.text}
          </div>
        ))}
      </div>
      <div className="console-input">
        <input
          value={input}
          placeholder={status === 'running' ? 'Enviar al ESP32 (Serial.read)…' : 'Ejecuta el programa para enviar datos'}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && send()}
          disabled={status !== 'running'}
        />
        <select
          value={ending}
          onChange={(e) => setEnding(e.target.value)}
          style={{ background: 'var(--panel-2)', border: '1px solid var(--border)', borderRadius: 6, fontSize: 11.5 }}
          title="Fin de línea"
        >
          <option value="none">Sin fin</option>
          <option value="nl">\n</option>
          <option value="cr">\r</option>
          <option value="crlf">\r\n</option>
        </select>
        <button className="btn sm outline" onClick={send} disabled={status !== 'running'}>
          <IconSend size={13} /> Enviar
        </button>
      </div>
    </div>
  );
}
