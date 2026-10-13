// Fotorresistencia (LDR, tipo GL5528): su resistencia baja cuanta más luz recibe.

import { useRef } from 'react';
import { checkOpen, clamp, formatOhms, MONO } from './common';
import type { DeviceDef, TerminalDef } from './types';

/** nivel 0..100 % -> lux (escala logarítmica 0.1 .. 10 000 lx) */
export const ldrLux = (level: number) => 10 ** (-1 + (5 * clamp(level, 0, 100)) / 100);
/** GL5528: ~10 kΩ a 10 lx, γ ≈ 0.7; a oscuras ~1 MΩ */
export const ldrOhms = (lux: number) => Math.min(1e6, 10_000 * (10 / lux) ** 0.7);

const terminals: TerminalDef[] = [
  { id: '1', label: 'Terminal 1', x: 0, y: 8, desc: 'Terminal de la LDR (sin polaridad). Monta un divisor con una resistencia fija (p. ej. 10 kΩ).', kind: 'passive', dir: 'left' },
  { id: '2', label: 'Terminal 2', x: 48, y: 8, desc: 'Terminal de la LDR (sin polaridad). El punto medio del divisor va a un pin ADC (GPIO1..20).', kind: 'passive', dir: 'right' },
];

export const ldr: DeviceDef<{ lux: number; r: number; current: number }> = {
  type: 'ldr',
  name: 'Fotorresistencia (LDR)',
  category: 'Entradas',
  description: 'Resistencia que depende de la luz. Arrastra en vertical sobre ella (o usa la rueda) para cambiar la luz. Úsala en un divisor de tensión con analogRead().',
  width: 48,
  height: 16,
  prefix: 'LDR',
  flexLegs: true,
  terminals,
  props: [{ key: 'light', label: 'Luz', type: 'range', default: 60, min: 0, max: 100, step: 1, unit: '%', live: true, help: '0 % ≈ oscuridad (0.1 lx) · 100 % ≈ sol directo (10 000 lx)' }],
  Render: ({ inst, setLiveProp }) => {
    const level = clamp(Number(inst.props.light ?? 60), 0, 100);
    const lux = ldrLux(level);
    const drag = useRef<{ y: number; v: number } | null>(null);
    const glow = level / 100;
    return (
      <g>
        <path d="M0 8 H15 M33 8 H48" stroke="#9aa4ae" strokeWidth={2.2} />
        <g
          className="interactive knob"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, v: level };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const nv = clamp(Math.round(drag.current.v + (drag.current.y - e.clientY) * 0.6), 0, 100);
            if (nv !== level) setLiveProp('light', nv);
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => {
            e.stopPropagation();
            setLiveProp('light', clamp(level + (e.deltaY < 0 ? 3 : -3), 0, 100));
          }}
        >
          <circle cx={24} cy={8} r={13} fill="#ffd84a" opacity={0.15 + 0.35 * glow} filter="url(#led-glow)" />
          <circle cx={24} cy={8} r={9.5} fill="#e7d6b2" stroke="#9c8a63" />
          <path d="M17.5 4.5 H30 V6.5 H18 V8.5 H30 V10.5 H18 V12" fill="none" stroke="#b5432f" strokeWidth={1.2} />
        </g>
        <text className="hover-label" x={24} y={-8} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="var(--fg-muted)">
          ☀ {lux >= 100 ? Math.round(lux) : lux.toFixed(1)} lx · {formatOhms(ldrOhms(lux))}
        </text>
      </g>
    );
  },
  stamp(c) {
    c.resistor(c.n('1'), c.n('2'), ldrOhms(ldrLux(Number(c.props.light ?? 60))), 'r');
  },
  evaluate(c) {
    checkOpen(c, terminals, 'la LDR');
    const lux = ldrLux(Number(c.props.light ?? 60));
    return { lux, r: ldrOhms(lux), current: c.i('r') };
  },
};
