import { checkOpen, clamp } from './common';
import type { DeviceDef, EvalCtx, TerminalDef } from './types';

export const LED_COLORS: Record<string, { on: string; off: string; vf: number; label: string }> = {
  red: { on: '#ff2d2d', off: '#8f1d1d', vf: 1.8, label: 'Rojo' },
  green: { on: '#2dff6a', off: '#1d6b33', vf: 2.1, label: 'Verde' },
  blue: { on: '#3d8bff', off: '#1d3c7a', vf: 2.8, label: 'Azul' },
  yellow: { on: '#ffe62d', off: '#8a7a1a', vf: 2.0, label: 'Amarillo' },
  orange: { on: '#ff8c1a', off: '#8a4a12', vf: 2.0, label: 'Naranja' },
  white: { on: '#ffffff', off: '#9aa3ad', vf: 2.8, label: 'Blanco' },
};

/** brillo percibido a partir de la corriente media */
export function ledBrightness(i: number): number {
  return clamp(Math.sqrt(Math.max(0, i) / 0.008), 0, 1);
}

export interface LedState {
  brightness: number;
  current: number;
  burnt: boolean;
}

const terminals: TerminalDef[] = [
  { id: 'A', label: 'Ánodo (+)', x: 12, y: 72, desc: 'Ánodo (+), pata larga. Va hacia el lado positivo (GPIO o 3V3).', kind: 'passive', dir: 'down' },
  { id: 'C', label: 'Cátodo (−)', x: 28, y: 72, desc: 'Cátodo (−), pata corta y lado plano. Va hacia GND.', kind: 'passive', dir: 'down' },
];

export function ledIssues(c: EvalCtx, key: string, a: string, k: string, name: string) {
  const ipk = c.iPeak(key);
  if (ipk > 0.03) {
    c.issue(
      'error',
      `${name}: corriente excesiva (${(ipk * 1000).toFixed(0)} mA)`,
      'Un LED admite ~20 mA. Pon una resistencia limitadora en serie (220 Ω – 1 kΩ con 3.3 V).',
      [a],
    );
  } else if (ipk > 0.021) {
    c.issue('warning', `${name}: corriente alta (${(ipk * 1000).toFixed(0)} mA)`, 'Usa una resistencia algo mayor para no acortar su vida.', [a]);
  }
  if (c.connected(a) && c.connected(k) && c.v(k) - c.v(a) > 1.5) {
    c.issue('info', `${name} polarizado en inversa`, 'El ánodo (+, pata larga) debe ir al lado positivo y el cátodo (−) a GND. Así no se encenderá.', [a, k]);
  }
}

function Render({ inst, state }: { inst: { props: Record<string, any> }; state: LedState | undefined }) {
  const col = LED_COLORS[inst.props.color] ?? LED_COLORS.red;
  const b = state?.brightness ?? 0;
  return (
    <g>
      {/* patas */}
      <path d="M12 42 V72" stroke="#9aa4ae" strokeWidth={2.2} />
      <path d="M28 42 V58 L28 72" stroke="#9aa4ae" strokeWidth={2.2} />
      <path d="M12 52 l-3 4 l3 4" stroke="#9aa4ae" strokeWidth={1.4} fill="none" />
      {/* halo */}
      {b > 0.02 && <circle cx={20} cy={22} r={10 + 16 * b} fill={col.on} opacity={0.55 * b} filter="url(#led-glow-big)" />}
      {/* cuerpo */}
      <path d="M6 42 V22 A14 14 0 0 1 34 22 V40 H32 V42 Z" fill={col.off} stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
      <path d="M6 42 V22 A14 14 0 0 1 34 22 V40 H32 V42 Z" fill={col.on} opacity={b} />
      <rect x={4} y={40} width={32} height={5} rx={1} fill={col.off} stroke="rgba(0,0,0,0.35)" />
      <rect x={4} y={40} width={32} height={5} rx={1} fill={col.on} opacity={b * 0.8} />
      <path d="M11 16 A10 10 0 0 1 20 10" stroke="rgba(255,255,255,0.65)" strokeWidth={2.5} fill="none" strokeLinecap="round" />
      {state?.burnt && (
        <g>
          <path d="M14 18 L26 30 M26 18 L14 30" stroke="#111" strokeWidth={3} strokeLinecap="round" />
        </g>
      )}
      <text x={6} y={66} fontSize={8} fill="var(--fg-muted)" fontFamily="Inter, sans-serif">+</text>
    </g>
  );
}

export const led: DeviceDef<LedState> = {
  type: 'led',
  name: 'LED',
  category: 'Salidas',
  description: 'Diodo emisor de luz de 5 mm. Necesita una resistencia en serie.',
  width: 40,
  height: 72,
  terminals,
  prefix: 'LED',
  flexLegs: true,
  props: [
    {
      key: 'color', label: 'Color', type: 'select', default: 'red',
      options: Object.entries(LED_COLORS).map(([value, c]) => ({ value, label: `${c.label} (Vf ≈ ${c.vf} V)` })),
    },
  ],
  Render: ({ inst, state }) => <Render inst={inst} state={state} />,
  stamp(c) {
    const col = LED_COLORS[c.props.color] ?? LED_COLORS.red;
    c.diode(c.n('A'), c.n('C'), col.vf, 15, 'd');
  },
  evaluate(c) {
    const i = c.i('d');
    checkOpen(c, terminals, 'el LED');
    ledIssues(c, 'd', 'A', 'C', 'LED');
    return { brightness: ledBrightness(i), current: i, burnt: c.iPeak('d') > 0.06 };
  },
};
