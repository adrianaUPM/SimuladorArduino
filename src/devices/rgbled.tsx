import { checkOpen } from './common';
import { ledBrightness, ledIssues } from './led';
import type { DeviceDef, TerminalDef } from './types';

export interface RgbState {
  r: number;
  g: number;
  b: number;
}

const terminals: TerminalDef[] = [
  { id: 'R', label: 'R', x: 8, y: 80, desc: 'Rojo. Conéctalo a un GPIO a través de una resistencia.', kind: 'passive', dir: 'down' },
  { id: 'COM', label: 'COM', x: 24, y: 80, desc: 'Pata común (la más larga): GND si es cátodo común, 3V3 si es ánodo común.', kind: 'passive', dir: 'down' },
  { id: 'G', label: 'G', x: 40, y: 80, desc: 'Verde. Conéctalo a un GPIO a través de una resistencia.', kind: 'passive', dir: 'down' },
  { id: 'B', label: 'B', x: 56, y: 80, desc: 'Azul. Conéctalo a un GPIO a través de una resistencia.', kind: 'passive', dir: 'down' },
];

const VF = { R: 1.8, G: 2.4, B: 2.6 };

export const rgbled: DeviceDef<RgbState> = {
  type: 'rgbled',
  name: 'LED RGB',
  category: 'Salidas',
  description: 'LED con tres colores en un encapsulado (cátodo común o ánodo común). Mezcla colores con PWM.',
  width: 64,
  height: 80,
  terminals,
  prefix: 'RGB',
  props: [
    {
      key: 'common', label: 'Tipo', type: 'select', default: 'cathode',
      options: [
        { value: 'cathode', label: 'Cátodo común (COM a GND)' },
        { value: 'anode', label: 'Ánodo común (COM a 3V3)' },
      ],
    },
  ],
  Render: ({ state }) => {
    const r = state?.r ?? 0;
    const g = state?.g ?? 0;
    const b = state?.b ?? 0;
    const lum = Math.max(r, g, b);
    const mix = `rgb(${Math.round(80 + 175 * r)}, ${Math.round(80 + 175 * g)}, ${Math.round(80 + 175 * b)})`;
    return (
      <g>
        {[8, 24, 40, 56].map((x, i) => (
          <path key={x} d={`M${x} 46 V${i === 1 ? 80 : 80}`} stroke="#9aa4ae" strokeWidth={2.2} />
        ))}
        {lum > 0.02 && <circle cx={32} cy={24} r={14 + 16 * lum} fill={mix} opacity={0.6 * lum} filter="url(#led-glow-big)" />}
        <path d="M14 46 V24 A18 18 0 0 1 50 24 V44 H48 V46 Z" fill="#dfe6ee" stroke="rgba(0,0,0,0.3)" />
        <path d="M14 46 V24 A18 18 0 0 1 50 24 V44 H48 V46 Z" fill={mix} opacity={lum} />
        <rect x={11} y={43} width={42} height={5} rx={1} fill="#cfd8e2" stroke="rgba(0,0,0,0.3)" />
        <path d="M20 16 A13 13 0 0 1 32 9" stroke="rgba(255,255,255,0.8)" strokeWidth={2.5} fill="none" strokeLinecap="round" />
        {['R', 'C', 'G', 'B'].map((l, i) => (
          <text key={l} x={8 + i * 16} y={62} textAnchor="middle" fontSize={7} fontFamily="Inter, sans-serif" fill="var(--fg-muted)">
            {l === 'C' ? '' : l}
          </text>
        ))}
      </g>
    );
  },
  stamp(c) {
    const com = c.n('COM');
    const anode = c.props.common === 'anode';
    for (const ch of ['R', 'G', 'B'] as const) {
      const n = c.n(ch);
      if (anode) c.diode(com, n, VF[ch], 15, ch);
      else c.diode(n, com, VF[ch], 15, ch);
    }
  },
  evaluate(c) {
    checkOpen(c, terminals, 'el LED RGB');
    const anode = c.props.common === 'anode';
    for (const ch of ['R', 'G', 'B']) {
      ledIssues(c, ch, anode ? 'COM' : ch, anode ? ch : 'COM', `LED RGB (${ch})`);
    }
    return { r: ledBrightness(c.i('R')), g: ledBrightness(c.i('G')), b: ledBrightness(c.i('B')) };
  },
};
