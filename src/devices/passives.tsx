// Resistencia, pulsador y potenciómetro.

import { useRef } from 'react';
import { clamp, formatOhms, MONO } from './common';
import type { DeviceDef, TerminalDef } from './types';

// ------------------------------------------------------------------ resistencia

const BAND = ['#111111', '#7a4a1e', '#e02020', '#ff8a00', '#f5d800', '#1e9e3a', '#2050e0', '#8a2be2', '#808080', '#ffffff'];

function bands(r: number): string[] {
  if (r <= 0) return [BAND[0], BAND[0], BAND[0]];
  let exp = Math.floor(Math.log10(r)) - 1;
  let digits = Math.round(r / 10 ** exp);
  if (digits >= 100) {
    digits = Math.round(digits / 10);
    exp++;
  }
  const d1 = Math.floor(digits / 10);
  const d2 = digits % 10;
  const mult = exp < 0 ? '#d4af37' : BAND[clamp(exp, 0, 9)];
  return [BAND[d1], BAND[d2], mult];
}

export const resistor: DeviceDef<{ current: number; power: number }> = {
  type: 'resistor',
  name: 'Resistencia',
  category: 'Pasivos',
  description: 'Limita la corriente. Imprescindible en serie con un LED.',
  width: 64,
  height: 16,
  prefix: 'R',
  terminals: [
    { id: '1', label: 'Terminal 1', x: 0, y: 8, desc: 'Terminal de la resistencia (sin polaridad).', kind: 'passive', dir: 'left' },
    { id: '2', label: 'Terminal 2', x: 64, y: 8, desc: 'Terminal de la resistencia (sin polaridad).', kind: 'passive', dir: 'right' },
  ],
  props: [
    {
      key: 'resistance', label: 'Resistencia', type: 'number', default: 220, min: 1, max: 10_000_000, unit: 'Ω',
      options: [100, 220, 330, 470, 1000, 2200, 4700, 10000, 47000, 100000].map((v) => ({ value: v, label: formatOhms(v) })),
    },
  ],
  Render: ({ inst }) => {
    const r = Number(inst.props.resistance) || 220;
    const [b1, b2, b3] = bands(r);
    return (
      <g>
        <path d="M0 8 H14 M50 8 H64" stroke="#9aa4ae" strokeWidth={2.2} />
        <path d="M14 2.5 Q14 1 17 1 H22 Q24 3 26 3 H38 Q40 3 42 1 H47 Q50 1 50 2.5 V13.5 Q50 15 47 15 H42 Q40 13 38 13 H26 Q24 13 22 15 H17 Q14 15 14 13.5 Z"
          fill="#e7c991" stroke="#a88a52" strokeWidth={0.8} />
        <rect x={19} y={1.3} width={3} height={13.4} fill={b1} />
        <rect x={27} y={3} width={3} height={10} fill={b2} />
        <rect x={33} y={3} width={3} height={10} fill={b3} />
        <rect x={43} y={1.3} width={3} height={13.4} fill="#d4af37" />
        <text className="hover-label" x={32} y={26} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="var(--fg-muted)">{formatOhms(r)}</text>
      </g>
    );
  },
  stamp(c) {
    c.resistor(c.n('1'), c.n('2'), Number(c.props.resistance) || 220, 'r');
  },
  evaluate(c) {
    const r = Number(c.props.resistance) || 220;
    const i = c.iPeak('r');
    const p = i * i * r;
    if (p > 0.25) {
      c.issue('warning', `La resistencia disipa ${p.toFixed(2)} W`, 'Una resistencia típica de 1/4 W se calentaría. Aumenta su valor o usa otra de más potencia.');
    }
    return { current: c.i('r'), power: p };
  },
};

// ------------------------------------------------------------------ pulsador

const btnTerms: TerminalDef[] = [
  { id: '1', label: 'Pata 1', x: 8, y: 0, desc: 'Unida siempre con la pata 1b. Al pulsar se conecta con 2/2b.', kind: 'passive', dir: 'up' },
  { id: '2', label: 'Pata 2', x: 40, y: 0, desc: 'Unida siempre con la pata 2b. Al pulsar se conecta con 1/1b.', kind: 'passive', dir: 'up' },
  { id: '1b', label: 'Pata 1b', x: 8, y: 48, desc: 'Unida siempre con la pata 1 (al otro lado del canal de la protoboard).', kind: 'passive', dir: 'down' },
  { id: '2b', label: 'Pata 2b', x: 40, y: 48, desc: 'Unida siempre con la pata 2 (al otro lado del canal de la protoboard).', kind: 'passive', dir: 'down' },
];

const CAP_COLORS: Record<string, string> = { red: '#e23b3b', blue: '#2f6fe0', green: '#25a35a', yellow: '#e6c21f', black: '#2a2f36', white: '#e8ecf0' };

export const button: DeviceDef<{ pressed: boolean }> = {
  type: 'button',
  name: 'Pulsador',
  category: 'Entradas',
  description: 'Pulsador de 4 patas: colócalo a caballo del canal central de la protoboard. Las patas 1–1b y 2–2b están unidas; al pulsar se conectan ambos lados. Mantén pulsado con el ratón.',
  width: 48,
  height: 48,
  prefix: 'BTN',
  terminals: btnTerms,
  props: [
    {
      key: 'color', label: 'Color', type: 'select', default: 'red',
      options: Object.keys(CAP_COLORS).map((k) => ({ value: k, label: k })),
    },
    { key: 'latch', label: 'Enclavado (clic = alterna)', type: 'boolean', default: false },
  ],
  Render: ({ inst, state, setInput }) => {
    const pressed = !!state?.pressed;
    const cap = CAP_COLORS[inst.props.color] ?? CAP_COLORS.red;
    const latch = !!inst.props.latch;
    const down = useRef(false);
    return (
      <g>
        <path d="M8 0 V8 M40 0 V8 M8 40 V48 M40 40 V48" stroke="#9aa4ae" strokeWidth={2.2} />
        <rect x={2} y={6} width={44} height={36} rx={4} fill="#2b3036" stroke="#15181c" />
        {[[7, 11], [41, 11], [7, 37], [41, 37]].map(([x, y]) => (
          <circle key={`${x}${y}`} cx={x} cy={y} r={2} fill="#4a5058" />
        ))}
        <g
          className="interactive"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.target as Element).setPointerCapture?.(e.pointerId);
            down.current = true;
            setInput({ pressed: latch ? !pressed : true });
          }}
          onPointerUp={(e) => {
            e.stopPropagation();
            if (down.current && !latch) setInput({ pressed: false });
            down.current = false;
          }}
          onPointerCancel={() => {
            if (!latch) setInput({ pressed: false });
            down.current = false;
          }}
        >
          <circle cx={24} cy={24} r={pressed ? 10.5 : 12} fill={cap} stroke="rgba(0,0,0,0.4)" strokeWidth={1.2} />
          <circle cx={24} cy={24} r={pressed ? 7 : 8.5} fill="rgba(255,255,255,0.12)" />
        </g>
      </g>
    );
  },
  bus: [['1', '1b'], ['2', '2b']],
  stamp(c) {
    if (c.inputs.pressed) c.resistor(c.n('1'), c.n('2'), 0.05, 'sw');
  },
  evaluate(c) {
    const side1 = c.connected('1') || c.connected('1b');
    const side2 = c.connected('2') || c.connected('2b');
    if (side1 !== side2) {
      c.issue('warning', 'Circuito abierto en el pulsador', `Solo está conectado el lado ${side1 ? '1' : '2'}: conecta también el otro lado (p. ej. a GND).`, side1 ? ['2', '2b'] : ['1', '1b']);
    }
    return { pressed: !!c.inputs.pressed };
  },
};

// ------------------------------------------------------------------ potenciómetro

const potTerms: TerminalDef[] = [
  { id: '1', label: 'Extremo 1', x: 8, y: 64, desc: 'Extremo del potenciómetro: normalmente a GND.', kind: 'passive', dir: 'down' },
  { id: 'W', label: 'Cursor (SIG)', x: 24, y: 64, desc: 'Cursor: tensión variable entre los extremos. Conéctalo a un pin ADC (GPIO1..20).', kind: 'passive', dir: 'down' },
  { id: '2', label: 'Extremo 2', x: 40, y: 64, desc: 'Extremo del potenciómetro: normalmente a 3V3 (¡no a 5V!).', kind: 'passive', dir: 'down' },
];

export const potentiometer: DeviceDef<{ value: number; vw: number }> = {
  type: 'potentiometer',
  name: 'Potenciómetro',
  category: 'Entradas',
  description: 'Resistencia variable. Gira el mando (arrastra en vertical) para cambiar la tensión del cursor.',
  width: 48,
  height: 64,
  prefix: 'POT',
  terminals: potTerms,
  props: [
    { key: 'value', label: 'Posición', type: 'range', default: 50, min: 0, max: 100, step: 1, unit: '%', live: true },
    {
      key: 'resistance', label: 'Resistencia total', type: 'select', default: 10000,
      options: [1000, 5000, 10000, 50000, 100000].map((v) => ({ value: v, label: formatOhms(v) })),
    },
  ],
  Render: ({ inst, state, setLiveProp }) => {
    const value = clamp(Number(inst.props.value ?? 50), 0, 100);
    const angle = -135 + (value / 100) * 270;
    const drag = useRef<{ y: number; v: number } | null>(null);
    return (
      <g>
        <path d="M8 44 V64 M24 44 V64 M40 44 V64" stroke="#9aa4ae" strokeWidth={2.2} />
        <rect x={0} y={4} width={48} height={42} rx={5} fill="#2f6fe0" stroke="#1d4796" />
        <g
          className="interactive knob"
          onPointerDown={(e) => {
            e.stopPropagation();
            (e.currentTarget as Element).setPointerCapture(e.pointerId);
            drag.current = { y: e.clientY, v: value };
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const nv = clamp(Math.round(drag.current.v + (drag.current.y - e.clientY) * 0.6), 0, 100);
            if (nv !== value) setLiveProp('value', nv);
          }}
          onPointerUp={() => (drag.current = null)}
          onWheel={(e) => {
            e.stopPropagation();
            setLiveProp('value', clamp(value + (e.deltaY < 0 ? 2 : -2), 0, 100));
          }}
        >
          <circle cx={24} cy={25} r={16} fill="#d9dee5" stroke="#9097a1" />
          <g transform={`rotate(${angle} 24 25)`}>
            <circle cx={24} cy={25} r={11} fill="#eef1f5" stroke="#b5bcc6" />
            <rect x={22.5} y={13} width={3} height={10} rx={1.5} fill="#3a4049" />
          </g>
        </g>
        <text x={24} y={-2} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="var(--fg-muted)">
          {value}%{state ? ` · ${state.vw.toFixed(2)} V` : ''}
        </text>
      </g>
    );
  },
  stamp(c) {
    const r = Number(c.props.resistance) || 10000;
    const p = clamp(Number(c.props.value ?? 50) / 100, 0, 1);
    c.resistor(c.n('1'), c.n('W'), Math.max(r * p, 0.5), 'a');
    c.resistor(c.n('W'), c.n('2'), Math.max(r * (1 - p), 0.5), 'b');
  },
  evaluate(c) {
    if (c.connected('W') && !(c.connected('1') && c.connected('2'))) {
      c.issue('warning', 'Potenciómetro sin alimentar', 'Conecta un extremo a GND y el otro a 3V3 para que el cursor dé una tensión entre 0 y 3.3 V.', ['1', '2']);
    }
    return { value: Number(c.props.value ?? 50), vw: c.v('W') };
  },
};
