// Protoboard grande de 830 puntos: 63 columnas (filas a–j) y dos pares de
// raíles de alimentación (+ rojo / − azul) arriba y abajo.
//
// Cada columna tiene dos tiras de 5 agujeros unidos (a–e y f–j), separadas por
// el canal central. Cada raíl es una fila de 50 agujeros unidos entre sí.
// Cualquier pata de un componente que caiga sobre un agujero queda enchufada.

import { memo } from 'react';
import { FONT } from './common';
import type { DeviceDef, TerminalDef } from './types';

export const BB_PITCH = 16;
export const BB_COLS = 63;
const X0 = 24;
const W = X0 * 2 + (BB_COLS - 1) * BB_PITCH; // 1040
const H = 320;

export const BB_ROWS: Record<string, number> = {
  a: 72, b: 88, c: 104, d: 120, e: 136,
  f: 184, g: 200, h: 216, i: 232, j: 248,
};
/** raíles: tp/tn = superior +/−, bn/bp = inferior −/+ */
export const BB_RAILS: Record<string, { y: number; sign: '+' | '-'; name: string }> = {
  tp: { y: 24, sign: '+', name: 'Raíl + superior' },
  tn: { y: 40, sign: '-', name: 'Raíl − superior' },
  bn: { y: 280, sign: '-', name: 'Raíl − inferior' },
  bp: { y: 296, sign: '+', name: 'Raíl + inferior' },
};

export const colX = (col: number) => X0 + (col - 1) * BB_PITCH;

/** columnas (1..63) que tienen agujero en los raíles: 10 grupos de 5 */
export const RAIL_COLS: number[] = [];
for (let g = 0; g < 10; g++) for (let k = 0; k < 5; k++) RAIL_COLS.push(2 + g * 6 + k);

const terminals: TerminalDef[] = [];
const bus: string[][] = [];

for (let col = 1; col <= BB_COLS; col++) {
  for (const half of [['a', 'b', 'c', 'd', 'e'], ['f', 'g', 'h', 'i', 'j']]) {
    const group: string[] = [];
    for (const r of half) {
      const id = `${r}${col}`;
      group.push(id);
      terminals.push({
        id,
        label: `${r}${col}`,
        x: colX(col),
        y: BB_ROWS[r],
        kind: 'passive',
        dir: 'none',
        desc: `Columna ${col}: los agujeros ${half[0]}${col}–${half[4]}${col} están unidos entre sí.`,
      });
    }
    bus.push(group);
  }
}
for (const [key, rail] of Object.entries(BB_RAILS)) {
  const group: string[] = [];
  for (const col of RAIL_COLS) {
    const id = `${key}${col}`;
    group.push(id);
    terminals.push({
      id,
      label: `${rail.name} (${col})`,
      x: colX(col),
      y: rail.y,
      kind: 'passive',
      dir: 'none',
      desc: `${rail.name}: toda la fila está unida. Úsalo para repartir ${rail.sign === '+' ? 'la alimentación (3V3)' : 'la masa (GND)'}.`,
    });
  }
  bus.push(group);
}

// todos los agujeros en un único path (mucho más rápido que 830 elementos)
const HOLES_PATH = terminals.map((t) => `M${t.x - 2.2} ${t.y - 2.2}h4.4v4.4h-4.4z`).join('');

const Board = memo(function Board() {
  const numbers = [1, 5, 10, 15, 20, 25, 30, 35, 40, 45, 50, 55, 60, 63];
  return (
    <g>
      <rect x={0} y={0} width={W} height={H} rx={8} fill="var(--bb-body)" stroke="var(--bb-edge)" strokeWidth={1.5} filter="url(#shadow)" />
      {/* canal central */}
      <rect x={6} y={150} width={W - 12} height={20} rx={3} fill="var(--bb-channel)" />
      <rect x={6} y={150} width={W - 12} height={3} fill="var(--bb-edge)" opacity={0.35} />
      {/* separación de raíles */}
      <rect x={6} y={54} width={W - 12} height={2} fill="var(--bb-edge)" opacity={0.35} />
      <rect x={6} y={264} width={W - 12} height={2} fill="var(--bb-edge)" opacity={0.35} />
      {/* líneas rojas y azules */}
      <path d={`M14 12 H${W - 14}`} stroke="#e03131" strokeWidth={2} />
      <path d={`M14 52 H${W - 14}`} stroke="#1c7ed6" strokeWidth={2} />
      <path d={`M14 268 H${W - 14}`} stroke="#1c7ed6" strokeWidth={2} />
      <path d={`M14 308 H${W - 14}`} stroke="#e03131" strokeWidth={2} />
      {[
        [24, '+', '#e03131'], [40, '−', '#1c7ed6'], [280, '−', '#1c7ed6'], [296, '+', '#e03131'],
      ].map(([y, s, c]) => (
        <g key={y as number} fontFamily={FONT} fontWeight={800} fontSize={11} fill={c as string} textAnchor="middle">
          <text x={10} y={(y as number) + 4}>{s}</text>
          <text x={W - 10} y={(y as number) + 4}>{s}</text>
        </g>
      ))}
      {/* letras de fila */}
      <g fontFamily={FONT} fontSize={8} fill="var(--bb-text)" textAnchor="middle">
        {Object.entries(BB_ROWS).map(([r, y]) => (
          <g key={r}>
            <text x={10} y={y + 3}>{r}</text>
            <text x={W - 10} y={y + 3}>{r}</text>
          </g>
        ))}
        {numbers.map((n) => (
          <g key={n}>
            <text x={colX(n)} y={64}>{n}</text>
            <text x={colX(n)} y={262}>{n}</text>
          </g>
        ))}
      </g>
      <path d={HOLES_PATH} fill="var(--bb-hole)" />
    </g>
  );
});

export const breadboard: DeviceDef = {
  type: 'breadboard',
  name: 'Protoboard',
  category: 'Placas',
  description:
    'Protoboard de 830 puntos. Cada columna tiene dos tiras de 5 agujeros unidos (a–e y f–j) separadas por el canal central; los raíles rojo (+) y azul (−) recorren toda la placa. Arrastra componentes encima: sus patas se enchufan solas.',
  width: W,
  height: H,
  prefix: 'BB',
  terminals,
  bus,
  socket: true,
  under: true,
  props: [],
  Render: () => <Board />,
};
