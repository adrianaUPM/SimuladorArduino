// LCD de caracteres 16×2 (HD44780) con adaptador I2C PCF8574.

import { useMemo } from 'react';
import type { LcdFrame } from '../engine/values';
import { glyph } from '../utils/font5x7';
import { checkI2cBus, checkSupply, FONT, MONO } from './common';
import type { DeviceDef, TerminalDef } from './types';

const W = 244;
const H = 104;
const COLS = 16;
const ROWS = 2;
/** píxeles del lienzo por punto de la matriz (3 encendido + 1 de separación) */
const U = 4;
const CHAR_W = 6; // 5 puntos + separación
const CHAR_H = 9; // 8 puntos + separación
const IMG_W = (COLS * CHAR_W - 1) * U;
const IMG_H = (ROWS * CHAR_H - 1) * U;
const SCR = { x: 44, y: 32, w: 188, h: (188 * IMG_H) / IMG_W };

const terms: TerminalDef[] = [
  { id: 'GND', label: 'GND', x: 0, y: 28, desc: 'Masa.', kind: 'gnd', dir: 'left' },
  {
    id: 'VCC', label: 'VCC', x: 0, y: 44, kind: 'vcc', dir: 'left',
    desc: 'Alimentación. El adaptador I2C lleva pull-ups a VCC en SDA/SCL: con 5 V llegarían 5 V a los GPIO del ESP32-S3, así que en el simulador aliméntalo con 3V3.',
  },
  { id: 'SDA', label: 'SDA', x: 0, y: 60, desc: 'Datos I2C. Por defecto GPIO8 (o el indicado en Wire.begin(sda, scl)).', kind: 'signal', dir: 'left' },
  { id: 'SCL', label: 'SCL', x: 0, y: 76, desc: 'Reloj I2C. Por defecto GPIO9 (o el indicado en Wire.begin(sda, scl)).', kind: 'signal', dir: 'left' },
];

const PALETTES: Record<string, { label: string; on: string; off: string; dark: string; ink: string; inkDim: string; ghost: string }> = {
  blue: { label: 'Azul (texto blanco)', on: '#2b58f0', off: '#16245e', dark: '#0d142e', ink: '#f2f6ff', inkDim: '#93a3d6', ghost: 'rgba(255,255,255,0.07)' },
  green: { label: 'Verde (texto negro)', on: '#9fcf3a', off: '#55691f', dark: '#262d14', ink: '#17220a', inkDim: '#2a3412', ghost: 'rgba(0,0,0,0.07)' },
};

export interface LcdDeviceState {
  powered: boolean;
  ready: boolean;
  addr: number;
  frame: LcdFrame | null;
}

/** filas (8) de 5 bits de un carácter: bit 4 = columna izquierda */
function charRows(code: number, cgram: number[][]): number[] {
  if (code < 16) return cgram[code & 7] ?? [];
  if (code === 0xff) return [31, 31, 31, 31, 31, 31, 31, 31];
  const cols = glyph(code);
  const rows: number[] = [];
  for (let y = 0; y < 8; y++) {
    let bits = 0;
    for (let x = 0; x < 5; x++) if ((cols[x] >> y) & 1) bits |= 1 << (4 - x);
    rows.push(bits);
  }
  return rows;
}

function renderFrame(frame: LcdFrame | null, pal: (typeof PALETTES)[string], backlight: boolean): string {
  const cv = document.createElement('canvas');
  cv.width = IMG_W;
  cv.height = IMG_H;
  const ctx = cv.getContext('2d')!;
  const ink = backlight ? pal.ink : pal.inkDim;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      let rows: number[];
      if (!frame) rows = r === 0 ? [31, 31, 31, 31, 31, 31, 31, 31] : []; // sin inicializar: fila de bloques
      else if (!frame.displayOn || r >= frame.ddram.length) rows = [];
      else rows = charRows(frame.ddram[r][(c + frame.shift) % 40], frame.cgram);
      const underline = !!frame?.displayOn && frame.cursor && frame.cursorY === r && (frame.cursorX - frame.shift + 40) % 40 === c;
      for (let y = 0; y < 8; y++) {
        const bits = (rows[y] ?? 0) | (underline && y === 7 ? 31 : 0);
        for (let x = 0; x < 5; x++) {
          const on = (bits >> (4 - x)) & 1;
          ctx.fillStyle = on ? ink : pal.ghost;
          ctx.fillRect((c * CHAR_W + x) * U, (r * CHAR_H + y) * U, U - 1, U - 1);
        }
      }
    }
  }
  return cv.toDataURL();
}

function Screen({ state, color }: { state: LcdDeviceState | undefined; color: string }) {
  const pal = PALETTES[color] ?? PALETTES.blue;
  const powered = !!state?.powered;
  const frame = state?.ready ? state.frame : null;
  const backlight = powered && (frame ? frame.backlight : true);
  const url = useMemo(
    () => (powered ? renderFrame(frame, pal, backlight) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [powered, frame?.version, color, backlight, state?.ready],
  );
  const bg = !powered ? pal.dark : backlight ? pal.on : pal.off;
  const blink = frame && frame.displayOn && frame.blink ? frame : null;
  const cellW = SCR.w / (COLS * CHAR_W - 1);
  const cellH = SCR.h / (ROWS * CHAR_H - 1);
  const bc = blink ? (blink.cursorX - blink.shift + 40) % 40 : -1;
  return (
    <g>
      <rect x={SCR.x - 8} y={SCR.y - 8} width={SCR.w + 16} height={SCR.h + 16} rx={2} fill={bg} />
      {backlight && <rect x={SCR.x - 8} y={SCR.y - 8} width={SCR.w + 16} height={SCR.h + 16} rx={2} fill="url(#lcd-glow)" />}
      {url && <image href={url} x={SCR.x} y={SCR.y} width={SCR.w} height={SCR.h} />}
      {blink && bc < COLS && (
        <rect x={SCR.x + bc * CHAR_W * cellW} y={SCR.y + blink.cursorY * CHAR_H * cellH} width={5 * cellW} height={8 * cellH} fill={pal.ink}>
          <animate attributeName="opacity" values="0.85;0" dur="1s" calcMode="discrete" repeatCount="indefinite" />
        </rect>
      )}
    </g>
  );
}

export const lcd: DeviceDef<LcdDeviceState> = {
  type: 'lcd',
  name: 'LCD 16×2 I2C',
  category: 'Pantallas',
  description: 'Pantalla de caracteres 16×2 con adaptador I2C (librería LiquidCrystal_I2C). Dirección 0x27 o 0x3F. SDA=GPIO8 y SCL=GPIO9 por defecto.',
  width: W,
  height: H,
  prefix: 'LCD',
  terminals: terms,
  max: 4,
  props: [
    {
      key: 'address', label: 'Dirección I2C', type: 'select', default: 0x27,
      options: [
        { value: 0x27, label: '0x27 (PCF8574T)' },
        { value: 0x3f, label: '0x3F (PCF8574AT)' },
      ],
    },
    {
      key: 'color', label: 'Color', type: 'select', default: 'blue',
      options: Object.entries(PALETTES).map(([value, p]) => ({ value, label: p.label })),
    },
  ],
  Render: ({ inst, state }) => (
    <g>
      <defs>
        <radialGradient id="lcd-glow" cx="0.5" cy="0.5" r="0.7">
          <stop offset="0" stopColor="#fff" stopOpacity={0.12} />
          <stop offset="1" stopColor="#fff" stopOpacity={0} />
        </radialGradient>
      </defs>
      {/* PCB */}
      <rect x={0} y={0} width={W} height={H} rx={5} fill="#1d7a3a" stroke="#0e4520" />
      {[[8, 8], [W - 8, 8], [8, H - 8], [W - 8, H - 8]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={4} fill="#0c2e17" stroke="#c9a24a" />
      ))}
      {/* marco metálico */}
      <rect x={30} y={16} width={W - 38} height={H - 32} rx={2} fill="#2b2f35" stroke="#16191d" />
      <Screen state={state} color={inst.props.color ?? 'blue'} />
      {/* adaptador I2C (asoma por la izquierda) */}
      <rect x={-2} y={18} width={9} height={68} rx={1.5} fill="#111" />
      {terms.map((t) => (
        <g key={t.id}>
          <rect x={-1} y={t.y - 4} width={7} height={8} rx={1} fill="#2b2f35" />
          <text x={10} y={t.y + 2.2} fontSize={6} fontFamily={FONT} fill="#dff3e4" fontWeight={700}>{t.label}</text>
        </g>
      ))}
      <text x={W - 6} y={H - 4} textAnchor="end" fontSize={6} fontFamily={MONO} fill="#a6dcb6">
        0x{Number(inst.props.address ?? 0x27).toString(16).toUpperCase()}
      </text>
    </g>
  ),
  stamp(c) {
    const vcc = c.n('VCC');
    const gnd = c.n('GND');
    c.resistor(vcc, gnd, 150, 'q');
    // pull-ups del adaptador PCF8574
    if (c.n('SDA') !== vcc) c.resistor(c.n('SDA'), vcc, 4700);
    if (c.n('SCL') !== vcc) c.resistor(c.n('SCL'), vcc, 4700);
  },
  evaluate(c) {
    const addr = Number(c.props.address ?? 0x27);
    const { powered } = checkSupply(c, 'el LCD', 'VCC', 'GND', { min: 2.7, max: 5.5, others: ['SDA', 'SCL'] });
    const wired = checkI2cBus(c, 'el LCD');
    const ready = powered && wired;
    const frame = ready ? c.board.lcdFrame(addr) ?? null : null;
    if (frame && (frame.cols !== COLS || frame.rows !== ROWS)) {
      c.issue('info', `El programa usa un LCD ${frame.cols}×${frame.rows}`, `Este módulo es de ${COLS}×${ROWS}: declara LiquidCrystal_I2C lcd(0x${addr.toString(16).toUpperCase()}, 16, 2);`);
    }
    return { powered, ready, addr, frame };
  },
};
