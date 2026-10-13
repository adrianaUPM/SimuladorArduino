// Teclado matricial de membrana 4×4: 8 pines (R1..R4 filas, C1..C4 columnas).
// Al pulsar una tecla se unen su fila y su columna.

import { useRef } from 'react';
import { FONT, MONO } from './common';
import type { DeviceDef, TerminalDef } from './types';

export const KEYPAD_KEYS = [
  ['1', '2', '3', 'A'],
  ['4', '5', '6', 'B'],
  ['7', '8', '9', 'C'],
  ['*', '0', '#', 'D'],
];

const W = 160;
const BODY_H = 150;
const H = 200;
const KEY_W = 28;
const KEY_H = 26;
const KEY_X0 = 12;
const KEY_Y0 = 14;
const KEY_DX = 36;
const KEY_DY = 33;
const PIN_X0 = 24;

const terminals: TerminalDef[] = [
  ...[1, 2, 3, 4].map((i, k): TerminalDef => ({
    id: `R${i}`, label: `R${i} (fila ${i})`, x: PIN_X0 + k * 16, y: H,
    desc: `Fila ${i} (${KEYPAD_KEYS[i - 1].join(' ')}). Va a uno de los pines de rowPins[]; la librería Keypad lo configura como INPUT_PULLUP.`,
    kind: 'passive', dir: 'down',
  })),
  ...[1, 2, 3, 4].map((i, k): TerminalDef => ({
    id: `C${i}`, label: `C${i} (columna ${i})`, x: PIN_X0 + (k + 4) * 16, y: H,
    desc: `Columna ${i} (${KEYPAD_KEYS.map((r) => r[i - 1]).join(' ')}). Va a uno de los pines de colPins[]; la librería la pone a LOW al barrer.`,
    kind: 'passive', dir: 'down',
  })),
];

export interface KeypadState {
  key: [number, number] | null;
}

function KeypadRender({ state, setInput }: { state: KeypadState | undefined; setInput(p: Record<string, any>): void }) {
  const down = useRef(false);
  const pressed = state?.key;
  const release = () => {
    if (down.current) setInput({ key: null });
    down.current = false;
  };
  return (
    <g>
      {/* cinta flexible y pines */}
      <path d={`M${PIN_X0 - 10} ${BODY_H - 2} H${PIN_X0 + 7 * 16 + 10} V${H - 14} H${PIN_X0 - 10} Z`} fill="#c9ccd1" stroke="#9aa0a8" />
      {terminals.map((t) => (
        <g key={t.id}>
          <path d={`M${t.x} ${H - 14} V${H}`} stroke="#9aa4ae" strokeWidth={2.2} />
          <rect x={t.x - 3} y={BODY_H + 4} width={6} height={H - BODY_H - 20} rx={1} fill="#e2b04a" opacity={0.85} />
          <text x={t.x} y={H - 17} textAnchor="middle" fontSize={5.5} fontFamily={MONO} fill="#3a3f46" fontWeight={700}>{t.id}</text>
        </g>
      ))}
      {/* membrana */}
      <rect x={0} y={0} width={W} height={BODY_H} rx={6} fill="#1f2328" stroke="#0c0e10" />
      <rect x={4} y={4} width={W - 8} height={BODY_H - 8} rx={4} fill="none" stroke="#33383f" />
      {KEYPAD_KEYS.map((row, r) =>
        row.map((label, c) => {
          const x = KEY_X0 + c * KEY_DX;
          const y = KEY_Y0 + r * KEY_DY;
          const isOn = !!pressed && pressed[0] === r && pressed[1] === c;
          const letter = c === 3;
          const fill = letter ? '#d93f3f' : r === 3 && c !== 1 ? '#2f6fe0' : '#eef1f4';
          return (
            <g
              key={label}
              className="interactive"
              onPointerDown={(e) => {
                e.stopPropagation();
                (e.currentTarget as Element).setPointerCapture?.(e.pointerId);
                down.current = true;
                setInput({ key: [r, c] });
              }}
              onPointerUp={(e) => {
                e.stopPropagation();
                release();
              }}
              onPointerCancel={release}
            >
              <rect x={x} y={y + (isOn ? 1.5 : 0)} width={KEY_W} height={KEY_H} rx={4} fill={fill} stroke="rgba(0,0,0,0.45)" opacity={isOn ? 0.75 : 1} />
              {!isOn && <rect x={x + 2} y={y + 2} width={KEY_W - 4} height={5} rx={2} fill="rgba(255,255,255,0.22)" />}
              <text
                x={x + KEY_W / 2}
                y={y + KEY_H / 2 + 5 + (isOn ? 1.5 : 0)}
                textAnchor="middle"
                fontSize={14}
                fontWeight={700}
                fontFamily={FONT}
                fill={letter || (r === 3 && c !== 1) ? '#fff' : '#22262b'}
                pointerEvents="none"
              >
                {label}
              </text>
            </g>
          );
        }),
      )}
    </g>
  );
}

export const keypad: DeviceDef<KeypadState> = {
  type: 'keypad',
  name: 'Teclado matricial 4×4',
  category: 'Entradas',
  description:
    'Teclado de membrana de 16 teclas (librería Keypad). 8 pines: R1–R4 (filas) y C1–C4 (columnas) a 8 GPIO. Haz clic en una tecla para pulsarla.',
  width: W,
  height: H,
  prefix: 'KP',
  terminals,
  props: [],
  Render: ({ state, setInput }) => <KeypadRender state={state} setInput={setInput} />,
  stamp(c) {
    const k = c.inputs.key as [number, number] | null | undefined;
    if (k) c.resistor(c.n(`R${k[0] + 1}`), c.n(`C${k[1] + 1}`), 10, 'sw');
  },
  evaluate(c) {
    const used = terminals.filter((t) => c.linked(t.id) && c.connected(t.id));
    if (used.length > 0 && used.length < terminals.length) {
      const missing = terminals.filter((t) => !used.includes(t));
      c.issue(
        'warning',
        'Teclado con pines sin conectar',
        `Faltan ${missing.map((t) => t.id).join(', ')}: las teclas de esas filas/columnas no se detectarán. Conecta los 8 pines a GPIO libres.`,
        missing.map((t) => t.id),
      );
    }
    for (const t of terminals) {
      const peers = c.netPeers(t.id);
      if (peers.some((p) => p.kind === 'power' || p.kind === 'ground')) {
        c.issue('warning', `${t.id} del teclado va a la alimentación`, 'Los pines del teclado no se alimentan: cada fila y cada columna va directamente a un GPIO.', [t.id]);
      } else if (c.board.running && c.connected(t.id) && c.linked(t.id) && c.gpiosOnNet(t.id).length === 0) {
        c.issue('info', `${t.id} del teclado no llega a ningún GPIO`, 'Cada fila y cada columna del teclado tiene que ir a un pin de la placa.', [t.id]);
      }
    }
    return { key: (c.inputs.key as [number, number] | null) ?? null };
  },
};
