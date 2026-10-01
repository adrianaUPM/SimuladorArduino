import { memo, useMemo, useState } from 'react';
import { CATEGORY_ORDER, DEVICES } from '../devices/registry';
import type { DeviceDef } from '../devices/types';
import { useApp } from '../state/store';
import { IconSearch } from './Icons';

const noop = () => {};

const Preview = memo(function Preview({ def }: { def: DeviceDef }) {
  const props: Record<string, any> = {};
  def.props.forEach((p) => (props[p.key] = p.default));
  const { Render } = def;
  const pad = 6;
  return (
    <svg viewBox={`${-pad} ${-pad - 4} ${def.width + pad * 2} ${def.height + pad * 2 + 4}`} preserveAspectRatio="xMidYMid meet">
      <Render
        inst={{ id: 'preview', type: def.type, x: 0, y: 0, rotation: 0, props }}
        state={undefined}
        selected={false}
        running={false}
        setInput={noop}
        setLiveProp={noop}
      />
    </svg>
  );
});

export function ComponentLibrary({ onAdd }: { onAdd(type: string): void }) {
  const [q, setQ] = useState('');
  const components = useApp((s) => s.project.circuit.components);
  const groups = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const list = DEVICES.filter((d) => !ql || d.name.toLowerCase().includes(ql) || d.description.toLowerCase().includes(ql));
    return CATEGORY_ORDER.map((cat) => ({ cat, items: list.filter((d) => d.category === cat) })).filter((g) => g.items.length);
  }, [q]);

  return (
    <div className="library">
      <div className="library-search">
        <label>
          <IconSearch size={14} />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Buscar componente…" />
        </label>
      </div>
      <div className="library-list">
        {groups.map((g) => (
          <div key={g.cat}>
            <div className="lib-cat">{g.cat}</div>
            <div className="lib-grid">
              {g.items.map((d) => {
                const full = !!d.max && components.filter((c) => c.type === d.type).length >= d.max;
                return (
                  <div
                    key={d.type}
                    className={`lib-item${full ? ' disabled' : ''}`}
                    draggable={!full}
                    title={full ? `Solo se permite ${d.max} ${d.name} por circuito` : `${d.name}\n${d.description}\n\nArrastra al lienzo o haz doble clic.`}
                    onDragStart={(e) => {
                      e.dataTransfer.setData('application/x-esp32sim-device', d.type);
                      e.dataTransfer.effectAllowed = 'copy';
                    }}
                    onDoubleClick={() => !full && onAdd(d.type)}
                  >
                    <Preview def={d} />
                    <span>{d.name}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
