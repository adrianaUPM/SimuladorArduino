import { formatOhms } from '../devices/common';
import { getDevice } from '../devices/registry';
import type { PropDef } from '../devices/types';
import { useSim } from '../state/simStore';
import { useApp, WIRE_COLORS } from '../state/store';
import type { ComponentInstance, Issue } from '../simulator/types';
import { holeAt, pluggedInto } from '../utils/sockets';
import { IconAlert, IconCheck, IconError, IconInfo, IconRotate, IconTrash } from './Icons';

export function PropertiesPanel() {
  const selection = useApp((s) => s.selection);
  const circuit = useApp((s) => s.project.circuit);

  let content: React.ReactNode;
  if (selection.comps.length === 1 && selection.wires.length === 0) {
    const comp = circuit.components.find((c) => c.id === selection.comps[0]);
    content = comp ? <ComponentProps comp={comp} /> : null;
  } else if (selection.wires.length === 1 && selection.comps.length === 0) {
    content = <WireProps id={selection.wires[0]} />;
  } else if (selection.comps.length + selection.wires.length > 1) {
    content = <MultiProps />;
  } else {
    content = <CircuitSummary />;
  }
  return (
    <div className="props">
      <div className="props-scroll">{content}</div>
    </div>
  );
}

// ------------------------------------------------------------------ componente

function ComponentProps({ comp }: { comp: ComponentInstance }) {
  const def = getDevice(comp.type)!;
  const circuit = useApp((s) => s.project.circuit);
  const updateProps = useApp((s) => s.updateProps);
  const state = useSim((s) => s.states[comp.id]);
  const issues = useSim((s) => s.issues.filter((i) => i.comps.includes(comp.id)));

  const connections = (termId: string) =>
    circuit.wires
      .filter((w) => (w.a.comp === comp.id && w.a.term === termId) || (w.b.comp === comp.id && w.b.term === termId))
      .map((w) => (w.a.comp === comp.id && w.a.term === termId ? w.b : w.a))
      .map((e) => {
        const other = circuit.components.find((c) => c.id === e.comp);
        const t = other ? getDevice(other.type)?.terminals.find((x) => x.id === e.term) : undefined;
        return `${e.comp} · ${t?.label ?? e.term}`;
      });

  const live = liveInfo(comp.type, state);
  const isBoard = comp.type === 'esp32s3';

  return (
    <>
      <h3>
        {def.name}
        <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--fg-muted)', fontWeight: 500 }}>{comp.id}</span>
      </h3>
      <div className="muted">{def.description}</div>

      {issues.length > 0 && (
        <div className="section">
          <IssueList issues={issues} />
        </div>
      )}

      {def.props.length > 0 && (
        <div className="section">
          <div className="section-title">Propiedades</div>
          {def.props.map((p) => (
            <PropField key={p.key} def={p} value={comp.props[p.key]} onChange={(v) => updateProps(comp.id, { [p.key]: v }, p.live)} />
          ))}
        </div>
      )}

      {live.length > 0 && (
        <div className="section">
          <div className="section-title">Simulación</div>
          <dl className="kv">
            {live.map(([k, v]) => (
              <Fragment2 key={k} k={k} v={v} />
            ))}
          </dl>
        </div>
      )}

      {def.socket && (
        <div className="section">
          <div className="section-title">Enchufado en la protoboard</div>
          <div className="muted">
            {pluggedInto(circuit, comp.id).join(', ') || 'Nada todavía. Arrastra un componente encima: sus patas encajan en los agujeros.'}
          </div>
          <div className="muted" style={{ marginTop: 10 }}>
            Al moverla se mueve todo lo que lleva enchufado. Pasa el ratón por un agujero para ver qué otros están unidos a él.
          </div>
        </div>
      )}
      {!isBoard && !def.socket && (
        <div className="section">
          <div className="section-title">Conexiones</div>
          <div className="term-list">
            {def.terminals.map((t) => {
              const hole = holeAt(circuit, comp, t.id);
              const cs = [...(hole ? [`enchufado en ${hole}`] : []), ...connections(t.id)];
              return (
                <div className="term-row" key={t.id} title={t.desc}>
                  <span>{t.label}</span>
                  <span className={`to${cs.length ? '' : ' none'}`}>{cs.length ? cs.join(', ') : 'sin conectar'}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}
      {isBoard && <BoardPins comp={comp} />}

      {def.flexLegs && (
        <div className="section">
          <div className="section-title">Patas</div>
          <div className="muted">
            Con el componente seleccionado, arrastra el extremo de una pata (cuadrado naranja) para doblarla y enchufarla en
            otro agujero. Doble clic sobre el extremo la endereza.
          </div>
          {comp.legs && (
            <button className="btn sm outline" style={{ marginTop: 8 }} onClick={() => useApp.getState().resetLegs(comp.id)}>
              Enderezar patas
            </button>
          )}
        </div>
      )}

      <div className="section row">
        <button className="btn sm outline" onClick={() => useApp.getState().rotateSelection()}>
          <IconRotate size={14} /> Girar <kbd>R</kbd>
        </button>
        <button className="btn sm outline danger" onClick={() => useApp.getState().deleteSelection()}>
          <IconTrash size={14} /> Eliminar <kbd>Supr</kbd>
        </button>
      </div>
    </>
  );
}

function Fragment2({ k, v }: { k: string; v: string }) {
  return (
    <>
      <dt>{k}</dt>
      <dd>{v}</dd>
    </>
  );
}

function BoardPins({ comp }: { comp: ComponentInstance }) {
  const state = useSim((s) => s.states[comp.id]);
  const running = useSim((s) => s.status === 'running');
  const circuit = useApp((s) => s.project.circuit);
  const used = new Set(
    circuit.wires.flatMap((w) => [w.a, w.b]).filter((e) => e.comp === comp.id).map((e) => e.term),
  );
  const pins = Object.entries((state?.pins ?? {}) as Record<string, { v: number; mode: string; level: number; duty: number }>)
    .filter(([g, p]) => used.has(`GPIO${g}`) || p.mode !== 'unset');
  return (
    <div className="section">
      <div className="section-title">GPIO en uso</div>
      {pins.length === 0 && <div className="muted">Ningún GPIO conectado todavía. Pasa el ratón sobre un pin para ver sus funciones.</div>}
      <div className="term-list">
        {pins.map(([g, p]) => (
          <div className="term-row" key={g}>
            <span style={{ fontFamily: 'var(--mono)' }}>GPIO{g}</span>
            <span className="to">
              {running ? `${p.mode === 'unset' ? '—' : p.mode.toUpperCase()} · ` : ''}
              {p.v.toFixed(2)} V
            </span>
          </div>
        ))}
      </div>
      <div className="muted" style={{ marginTop: 10 }}>
        Lógica 3.3 V · GPIO no tolerantes a 5 V · ADC: GPIO1–20 · I2C por defecto SDA=8, SCL=9 · SPI: MOSI=11, MISO=13, SCK=12, SS=10 · UART0: TX=43, RX=44
      </div>
    </div>
  );
}

function PropField({ def, value, onChange }: { def: PropDef; value: any; onChange(v: any): void }) {
  const v = value ?? def.default;
  switch (def.type) {
    case 'select':
      return (
        <label className="field">
          <span>{def.label}</span>
          <select
            value={String(v)}
            onChange={(e) => {
              const opt = def.options!.find((o) => String(o.value) === e.target.value);
              onChange(opt ? opt.value : e.target.value);
            }}
          >
            {def.options!.map((o) => (
              <option key={String(o.value)} value={String(o.value)}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      );
    case 'boolean':
      return (
        <label className="field checkbox">
          <input type="checkbox" checked={!!v} onChange={(e) => onChange(e.target.checked)} />
          <span>{def.label}</span>
        </label>
      );
    case 'range':
      return (
        <label className="field">
          <span>
            {def.label}
            <b style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>
              {v}
              {def.unit}
            </b>
          </span>
          <input type="range" min={def.min} max={def.max} step={def.step ?? 1} value={v} onChange={(e) => onChange(Number(e.target.value))} />
        </label>
      );
    case 'number':
      return (
        <div className="field">
          <span>
            {def.label}
            {def.unit === 'Ω' && <b style={{ fontFamily: 'var(--mono)', fontWeight: 500 }}>{formatOhms(Number(v))}</b>}
          </span>
          <input
            type="number"
            min={def.min}
            max={def.max}
            value={v}
            onChange={(e) => {
              const n = Number(e.target.value);
              if (Number.isFinite(n) && n >= (def.min ?? -Infinity) && n <= (def.max ?? Infinity)) onChange(n);
            }}
          />
          {def.options && (
            <div className="presets">
              {def.options.map((o) => (
                <button key={String(o.value)} className={Number(v) === o.value ? 'on' : ''} onClick={() => onChange(o.value)}>
                  {o.label}
                </button>
              ))}
            </div>
          )}
        </div>
      );
    default:
      return (
        <label className="field">
          <span>{def.label}</span>
          <input type="text" value={String(v)} onChange={(e) => onChange(e.target.value)} />
        </label>
      );
  }
}

function liveInfo(type: string, s: any): [string, string][] {
  if (!s) return [];
  const mA = (i: number) => `${(i * 1000).toFixed(2)} mA`;
  switch (type) {
    case 'led':
      return [['Corriente', mA(s.current)], ['Brillo', `${Math.round(s.brightness * 100)} %`]];
    case 'rgbled':
      return [['Rojo', `${Math.round(s.r * 100)} %`], ['Verde', `${Math.round(s.g * 100)} %`], ['Azul', `${Math.round(s.b * 100)} %`]];
    case 'resistor':
      return [['Corriente', mA(Math.abs(s.current))], ['Potencia', `${(s.power * 1000).toFixed(1)} mW`]];
    case 'button':
      return [['Estado', s.pressed ? 'pulsado' : 'suelto']];
    case 'potentiometer':
      return [['Cursor', `${s.vw.toFixed(3)} V`], ['analogRead ≈', String(Math.round((Math.max(0, Math.min(3.3, s.vw)) / 3.3) * 4095))]];
    case 'servo':
      return [['Ángulo', `${Math.round(s.angle)}°`], ['Pulso', s.pulse ? `${Math.round(s.pulse)} µs` : '—'], ['Alimentado', s.powered ? 'sí' : 'no']];
    case 'motor':
      return [['Velocidad', `${Math.round(s.speed * 100)} %`], ['Corriente', mA(Math.abs(s.current))]];
    case 'buzzer':
      return [['Sonando', s.on ? 'sí' : 'no'], ['Frecuencia', s.freq ? `${Math.round(s.freq)} Hz` : '—']];
    case 'analogSensor':
      return [['Salida', `${s.out.toFixed(3)} V`], ['analogRead ≈', String(Math.round((Math.max(0, Math.min(3.3, s.out)) / 3.3) * 4095))]];
    case 'digitalSensor':
      return [['Salida', `${s.out.toFixed(2)} V`], ['Detectando', s.active ? 'sí' : 'no']];
    case 'oled':
      return [['Alimentada', s.powered ? 'sí' : 'no'], ['En el bus I2C', s.ready ? 'sí' : 'no'], ['Dirección', `0x${s.addr.toString(16).toUpperCase()}`]];
    case 'vcc':
      return [['Corriente', mA(s.current)]];
    default:
      return [];
  }
}

// ------------------------------------------------------------------ cable

function WireProps({ id }: { id: string }) {
  const wire = useApp((s) => s.project.circuit.wires.find((w) => w.id === id));
  const updateWire = useApp((s) => s.updateWire);
  if (!wire) return null;
  return (
    <>
      <h3>
        Cable <span style={{ fontFamily: 'var(--mono)', fontSize: 11.5, color: 'var(--fg-muted)', fontWeight: 500 }}>{wire.id}</span>
      </h3>
      <div className="muted">
        {wire.a.comp}.{wire.a.term} → {wire.b.comp}.{wire.b.term}
      </div>
      <div className="section">
        <div className="section-title">Color</div>
        <div className="swatches">
          {WIRE_COLORS.map((c) => (
            <button key={c} className={`swatch${wire.color === c ? ' on' : ''}`} style={{ background: c }} onClick={() => updateWire(id, { color: c })} title={c} />
          ))}
        </div>
      </div>
      <div className="section">
        <div className="muted">
          Arrastra los puntos para mover los codos. Doble clic sobre el cable añade un codo; doble clic sobre un punto lo elimina.
        </div>
      </div>
      <div className="section row">
        {wire.points.length > 0 && (
          <button className="btn sm outline" onClick={() => updateWire(id, { points: [] })}>
            Enderezar
          </button>
        )}
        <button className="btn sm outline danger" onClick={() => useApp.getState().deleteSelection()}>
          <IconTrash size={14} /> Eliminar <kbd>Supr</kbd>
        </button>
      </div>
    </>
  );
}

function MultiProps() {
  const selection = useApp((s) => s.selection);
  return (
    <>
      <h3>Selección múltiple</h3>
      <div className="muted">
        {selection.comps.length} componente{selection.comps.length === 1 ? '' : 's'} y {selection.wires.length} cable{selection.wires.length === 1 ? '' : 's'}.
        Arrastra cualquiera de ellos para mover el grupo.
      </div>
      <div className="section row">
        {selection.comps.length > 0 && (
          <button className="btn sm outline" onClick={() => useApp.getState().rotateSelection()}>
            <IconRotate size={14} /> Girar
          </button>
        )}
        <button className="btn sm outline danger" onClick={() => useApp.getState().deleteSelection()}>
          <IconTrash size={14} /> Eliminar
        </button>
      </div>
    </>
  );
}

// ------------------------------------------------------------------ resumen

function CircuitSummary() {
  const issues = useSim((s) => s.issues);
  const circuit = useApp((s) => s.project.circuit);
  const errors = issues.filter((i) => i.severity === 'error').length;
  const warns = issues.filter((i) => i.severity === 'warning').length;
  return (
    <>
      <h3>Diagnóstico del circuito</h3>
      <div className="muted">
        {circuit.components.length} componentes · {circuit.wires.length} cables
        {errors + warns > 0 && ` · ${errors} error${errors === 1 ? '' : 'es'}, ${warns} aviso${warns === 1 ? '' : 's'}`}
      </div>
      <div className="section">
        {issues.length === 0 ? (
          <div className="all-good">
            <IconCheck size={15} /> No se detectan problemas eléctricos.
          </div>
        ) : (
          <IssueList issues={issues} selectable />
        )}
      </div>
      <div className="section">
        <div className="section-title">Cómo se usa</div>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          • Arrastra componentes desde la izquierda.<br />
          • Haz clic en un pin y suéltalo sobre otro para crear un cable.<br />
          • Selecciona un elemento para ver y editar sus propiedades.<br />
          • Pulsa <b>Run</b>: el código controla el circuito en tiempo real.
        </div>
      </div>
    </>
  );
}

function IssueList({ issues, selectable }: { issues: Issue[]; selectable?: boolean }) {
  const order = { error: 0, warning: 1, info: 2 };
  const sorted = [...issues].sort((a, b) => order[a.severity] - order[b.severity]);
  return (
    <div>
      {sorted.map((is) => (
        <button
          key={is.id}
          className={`issue ${is.severity}`}
          onClick={selectable ? () => useApp.getState().select({ comps: is.comps, wires: [] }) : undefined}
        >
          {is.severity === 'error' ? <IconError size={15} /> : is.severity === 'warning' ? <IconAlert size={15} /> : <IconInfo size={15} />}
          <div>
            <div className="it">
              {selectable && <span style={{ fontFamily: 'var(--mono)', color: 'var(--fg-muted)', fontWeight: 500 }}>{is.comps[0]} · </span>}
              {is.title}
            </div>
            <div className="id">{is.detail}</div>
          </div>
        </button>
      ))}
    </div>
  );
}
