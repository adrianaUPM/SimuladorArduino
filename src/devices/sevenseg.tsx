// Display de 7 segmentos de un dígito (tipo 5161AS / 5161BS): 8 LED con un
// terminal común (cátodo o ánodo). Cada segmento necesita su resistencia.

import { FONT } from './common';
import { LED_COLORS, ledBrightness, ledIssues } from './led';
import type { DeviceDef, TerminalDef } from './types';

const SEGS = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'DP'] as const;
const H = 96;

// patillaje real: arriba G F COM A B · abajo E D COM C DP (separación de 6 filas = 15.24 mm)
const top = ['G', 'F', 'COM1', 'A', 'B'];
const bottom = ['E', 'D', 'COM2', 'C', 'DP'];

const desc = (id: string) =>
  id.startsWith('COM')
    ? 'Terminal común de todos los segmentos: a GND si es de cátodo común, a 3V3 si es de ánodo común. COM1 y COM2 están unidos por dentro.'
    : `Segmento ${id}${id === 'DP' ? ' (punto decimal)' : ''}. Conéctalo a un GPIO a través de una resistencia (220 Ω – 1 kΩ).`;

const terminals: TerminalDef[] = [
  ...top.map((id, i): TerminalDef => ({ id, label: id, x: 8 + i * 16, y: 0, desc: desc(id), kind: 'passive', dir: 'up' })),
  ...bottom.map((id, i): TerminalDef => ({ id, label: id, x: 8 + i * 16, y: H, desc: desc(id), kind: 'passive', dir: 'down' })),
];

export interface SevenSegState {
  seg: Record<string, number>;
}

// geometría del dígito (ligeramente inclinado como los reales)
const X0 = 22;
const X1 = 56;
const Y0 = 20;
const YM = 48;
const Y1 = 76;
const T = 6;

function hSeg(x0: number, x1: number, y: number): string {
  const h = T / 2;
  return `M${x0 + h} ${y} L${x0 + T} ${y - h} H${x1 - T} L${x1 - h} ${y} L${x1 - T} ${y + h} H${x0 + T} Z`;
}
function vSeg(x: number, y0: number, y1: number): string {
  const h = T / 2;
  return `M${x} ${y0 + h} L${x + h} ${y0 + T} V${y1 - T} L${x} ${y1 - h} L${x - h} ${y1 - T} V${y0 + T} Z`;
}

const SHAPES: Record<string, string> = {
  A: hSeg(X0, X1, Y0),
  G: hSeg(X0, X1, YM),
  D: hSeg(X0, X1, Y1),
  F: vSeg(X0, Y0, YM),
  B: vSeg(X1, Y0, YM),
  E: vSeg(X0, YM, Y1),
  C: vSeg(X1, YM, Y1),
};

export const sevenSeg: DeviceDef<SevenSegState> = {
  type: 'sevenseg',
  name: 'Display 7 segmentos',
  category: 'Salidas',
  description:
    'Dígito de 7 segmentos + punto. Cada segmento es un LED: pon una resistencia en serie con cada uno. Cátodo común: COM a GND y segmento a HIGH para encenderlo.',
  width: 80,
  height: H,
  prefix: 'DISP',
  terminals,
  props: [
    {
      key: 'common', label: 'Tipo', type: 'select', default: 'cathode',
      options: [
        { value: 'cathode', label: 'Cátodo común (COM a GND)' },
        { value: 'anode', label: 'Ánodo común (COM a 3V3)' },
      ],
    },
    {
      key: 'color', label: 'Color', type: 'select', default: 'red',
      options: ['red', 'green', 'blue', 'yellow', 'white'].map((value) => ({ value, label: LED_COLORS[value].label })),
    },
  ],
  bus: [['COM1', 'COM2']],
  Render: ({ inst, state }) => {
    const col = LED_COLORS[inst.props.color] ?? LED_COLORS.red;
    const b = (s: string) => state?.seg[s] ?? 0;
    return (
      <g>
        {terminals.map((t) => (
          <path key={t.id} d={t.y === 0 ? `M${t.x} 0 V8` : `M${t.x} ${H - 8} V${H}`} stroke="#9aa4ae" strokeWidth={2.2} />
        ))}
        <rect x={1} y={6} width={78} height={H - 12} rx={3} fill="#1b1d21" stroke="#0a0b0d" />
        <g transform="skewX(-7) translate(7 0)">
          {Object.entries(SHAPES).map(([s, d]) => (
            <g key={s}>
              <path d={d} fill="#2a2d33" />
              {b(s) > 0.02 && <path d={d} fill={col.on} opacity={0.25 + 0.75 * b(s)} filter={b(s) > 0.3 ? 'url(#led-glow)' : undefined} />}
              {b(s) > 0.02 && <path d={d} fill={col.on} opacity={b(s)} />}
            </g>
          ))}
        </g>
        <circle cx={66} cy={Y1} r={3.6} fill="#2a2d33" />
        {b('DP') > 0.02 && <circle cx={66} cy={Y1} r={3.6} fill={col.on} opacity={b('DP')} />}
        {terminals.map((t) => (
          <text key={t.id} x={t.x} y={t.y === 0 ? 14 : H - 9} textAnchor="middle" fontSize={5} fontFamily={FONT} fill="#8a9099">
            {t.id.startsWith('COM') ? 'COM' : t.id}
          </text>
        ))}
      </g>
    );
  },
  stamp(c) {
    const col = LED_COLORS[c.props.color] ?? LED_COLORS.red;
    const com = c.n('COM1');
    const anode = c.props.common === 'anode';
    for (const s of SEGS) {
      if (anode) c.diode(com, c.n(s), col.vf, 15, s);
      else c.diode(c.n(s), com, col.vf, 15, s);
    }
  },
  evaluate(c) {
    const anode = c.props.common === 'anode';
    const seg: Record<string, number> = {};
    for (const s of SEGS) {
      seg[s] = ledBrightness(c.i(s));
      if (anode) ledIssues(c, s, 'COM1', s, `Segmento ${s}`);
      else ledIssues(c, s, s, 'COM1', `Segmento ${s}`);
    }
    const anySeg = SEGS.some((s) => c.linked(s));
    if (anySeg && !c.linked('COM1') && !c.linked('COM2')) {
      c.issue(
        'warning',
        'Falta el común del display',
        anode ? 'Conecta COM (cualquiera de los dos) a 3V3: es de ánodo común.' : 'Conecta COM (cualquiera de los dos) a GND: es de cátodo común.',
        ['COM1', 'COM2'],
      );
    }
    return { seg };
  },
};
