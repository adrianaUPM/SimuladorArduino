import type { DeviceDef, TerminalDef } from '../types';
import { gpioFunctions, HEADER_PINS } from './pins';

const W = 180; // cabeceras separadas 10 pasos de 2.54 mm (encajan en la protoboard)
const H = 470;
const PIN_X_L = 10;
const PIN_X_R = W - 10;
const PIN_Y0 = 92;
const PITCH = 16;

const terminals: TerminalDef[] = HEADER_PINS.map((p) => {
  let desc = '';
  let kind: TerminalDef['kind'] = 'gpio';
  switch (p.kind) {
    case '3v3':
      desc = 'Salida del regulador de 3.3 V (máx. ~500 mA). Alimenta sensores y módulos de 3.3 V.';
      kind = 'power';
      break;
    case '5v':
      desc = '5 V del USB. ¡No conectar nunca a un GPIO! (no toleran 5 V)';
      kind = 'power';
      break;
    case 'gnd':
      desc = 'Masa (0 V). Referencia común de todo el circuito.';
      kind = 'ground';
      break;
    case 'en':
      desc = 'EN / RST: a nivel bajo reinicia el chip.';
      kind = 'en';
      break;
    default:
      desc = `GPIO${p.gpio} · lógica 3.3 V · ${gpioFunctions(p.gpio!).join(' · ')}`;
  }
  return {
    id: p.id,
    label: p.kind === 'gpio' ? `GPIO${p.gpio}${p.gpio === 43 ? ' (TX)' : p.gpio === 44 ? ' (RX)' : ''}` : p.label,
    x: p.side === 'left' ? PIN_X_L : PIN_X_R,
    y: PIN_Y0 + p.row * PITCH,
    desc,
    kind,
    dir: p.side === 'left' ? 'left' : 'right',
  };
});

export interface Esp32State {
  pins: Record<number, { v: number; mode: string; level: number; duty: number }>;
}

function pinColor(kind: string): string {
  switch (kind) {
    case '3v3':
      return '#ef4444';
    case '5v':
      return '#f97316';
    case 'gnd':
      return '#64748b';
    case 'en':
      return '#a855f7';
    default:
      return '#d4a54a';
  }
}

function Render({ state, running, rotation }: { state: Esp32State | undefined; running: boolean; rotation: number }) {
  return (
    <g>
      {/* PCB */}
      <rect x={0} y={0} width={W} height={H} rx={8} fill="#1d2b3a" stroke="#0f1822" strokeWidth={2} />
      <rect x={3} y={3} width={W - 6} height={H - 6} rx={6} fill="none" stroke="#2c4157" strokeWidth={1} />
      {/* agujeros de montaje */}
      {[[14, 14], [W - 14, 14], [14, H - 14], [W - 14, H - 14]].map(([x, y], i) => (
        <circle key={i} cx={x} cy={y} r={4} fill="#0b1117" stroke="#9a7b3c" strokeWidth={1.5} />
      ))}
      {/* módulo ESP32-S3-WROOM-1 */}
      <g>
        <rect x={36} y={8} width={108} height={176} rx={3} fill="#2a2f36" stroke="#111" />
        {/* antena */}
        <rect x={40} y={12} width={100} height={40} rx={2} fill="#1b2027" />
        <path
          d="M48 44 V20 H60 V40 H72 V20 H84 V40 H96 V20 H108 V40 H120 V20 H132 V44"
          fill="none" stroke="#c9a24a" strokeWidth={2.5} strokeLinejoin="round"
        />
        {/* blindaje metálico */}
        <rect x={42} y={58} width={96} height={120} rx={3} fill="url(#esp-shield)" stroke="#8b9097" />
        <text x={90} y={92} textAnchor="middle" fontSize={11} fontWeight={700} fill="#30353b" fontFamily="Inter, sans-serif">ESP32-S3</text>
        <text x={90} y={106} textAnchor="middle" fontSize={7.5} fill="#40454b" fontFamily="Inter, sans-serif">WROOM-1</text>
        <text x={90} y={150} textAnchor="middle" fontSize={6} fill="#555b62" fontFamily="JetBrains Mono, monospace">Wi-Fi · BLE 5</text>
        <text x={90} y={160} textAnchor="middle" fontSize={6} fill="#555b62" fontFamily="JetBrains Mono, monospace">Xtensa LX7 ×2 · 240 MHz</text>
      </g>
      {/* nombre de la placa */}
      <text x={W / 2} y={208} textAnchor="middle" fontSize={8} fill="#c8d3df" fontFamily="Inter, sans-serif" fontWeight={600}>ESP32-S3-DevKitC-1</text>
      <text x={W / 2} y={219} textAnchor="middle" fontSize={6.5} fill="#7f93a8" fontFamily="Inter, sans-serif">3.3 V logic · NOT 5 V tolerant</text>
      {/* regulador y componentes */}
      <rect x={72} y={240} width={36} height={22} rx={2} fill="#111" />
      <text x={90} y={254} textAnchor="middle" fontSize={5.5} fill="#888" fontFamily="monospace">LDO 3V3</text>
      <rect x={68} y={300} width={44} height={44} rx={2} fill="#14191f" stroke="#2a3542" />
      <text x={90} y={325} textAnchor="middle" fontSize={5.5} fill="#7a8794" fontFamily="monospace">CP2102N</text>
      {/* LED RGB integrado y LED de power */}
      <rect x={110} y={370} width={10} height={10} rx={1.5} fill="#f5f5f5" stroke="#bbb" />
      <circle cx={115} cy={375} r={2.6} fill="#ddd" />
      <text x={115} y={390} textAnchor="middle" fontSize={5} fill="#9fb0c2" fontFamily="Inter, sans-serif">RGB</text>
      <rect x={56} y={370} width={8} height={5} rx={1} fill={'#ff3b3b'} filter="url(#led-glow)" opacity={0.95} />
      <text x={60} y={386} textAnchor="middle" fontSize={5} fill="#9fb0c2" fontFamily="Inter, sans-serif">PWR</text>
      {/* botones BOOT / RST */}
      {[[52, 'BOOT'], [128, 'RST']].map(([x, label]) => (
        <g key={label as string}>
          <rect x={(x as number) - 11} y={404} width={22} height={16} rx={2} fill="#c9ced6" stroke="#8d949e" />
          <circle cx={x as number} cy={412} r={5} fill="#3a3f46" />
          <text x={x as number} y={428} textAnchor="middle" fontSize={5.5} fill="#9fb0c2" fontFamily="Inter, sans-serif">{label}</text>
        </g>
      ))}
      {/* USB-C */}
      {[[58, 'UART'], [122, 'USB']].map(([x, label]) => (
        <g key={label as string}>
          <rect x={(x as number) - 15} y={H - 22} width={30} height={26} rx={4} fill="#b8bec7" stroke="#7a828c" />
          <rect x={(x as number) - 10} y={H - 14} width={20} height={6} rx={3} fill="#3b4148" />
          <text x={x as number} y={H - 26} textAnchor="middle" fontSize={5.5} fill="#9fb0c2" fontFamily="Inter, sans-serif">{label}</text>
        </g>
      ))}
      {/* pines */}
      {HEADER_PINS.map((p) => {
        const x = p.side === 'left' ? PIN_X_L : PIN_X_R;
        const y = PIN_Y0 + p.row * PITCH;
        const st = p.gpio !== undefined ? state?.pins[p.gpio] : undefined;
        const active = running && st && (st.mode === 'output' || st.mode === 'pwm' || st.mode === 'servo' || st.mode === 'tone') && (st.level || st.duty > 0);
        const label = p.kind === 'gpio' ? (p.gpio === 43 ? 'TX' : p.gpio === 44 ? 'RX' : String(p.gpio)) : p.label;
        return (
          <g key={p.id}>
            <rect x={x - 5} y={y - 5} width={10} height={10} rx={1.5} fill="#0e141b" />
            <circle cx={x} cy={y} r={3.2} fill={pinColor(p.kind)} />
            {active && <circle cx={x} cy={y} r={2} fill="#fff7c2" />}
            <text
              x={rotation ? (p.side === 'left' ? x + 15 : x - 15) : p.side === 'left' ? x + 9 : x - 9}
              y={rotation ? y + 2.6 : y + 2.8}
              textAnchor={rotation ? 'middle' : p.side === 'left' ? 'start' : 'end'}
              transform={rotation ? `rotate(${-rotation} ${p.side === 'left' ? x + 15 : x - 15} ${y})` : undefined}
              fontSize={rotation ? 7 : 7.5}
              fontFamily="JetBrains Mono, monospace"
              fill={p.kind === 'gpio' ? '#e5ecf3' : pinColor(p.kind)}
              fontWeight={p.kind === 'gpio' ? 500 : 700}
            >
              {label}
            </text>
          </g>
        );
      })}
      <defs>
        <linearGradient id="esp-shield" x1="0" x2="1" y1="0" y2="1">
          <stop offset="0" stopColor="#d7dbe0" />
          <stop offset="0.5" stopColor="#b9bec5" />
          <stop offset="1" stopColor="#a3a9b1" />
        </linearGradient>
      </defs>
    </g>
  );
}

export const esp32s3: DeviceDef<Esp32State> = {
  type: 'esp32s3',
  name: 'ESP32-S3-DevKitC-1',
  category: 'Placas',
  description: 'Placa de desarrollo con ESP32-S3 (lógica 3.3 V, ADC 12 bits, PWM LEDC, UART, I2C, SPI).',
  width: W,
  height: H,
  terminals,
  props: [],
  prefix: 'ESP',
  max: 1,
  Render: ({ inst, state, running }) => <Render state={state} running={running} rotation={inst.rotation} />,
  stamp(c) {
    for (const p of HEADER_PINS) {
      const node = c.n(p.id);
      if (p.kind === '3v3') c.source(node, 0, 3.3, 0.3, p.id);
      else if (p.kind === '5v') c.source(node, 0, 5.0, 0.3, p.id);
      else if (p.kind === 'en') c.source(node, 0, 3.3, 10000);
      else if (p.kind === 'gpio') {
        const g = p.gpio!;
        const st = c.board.pin(g);
        switch (st.mode) {
          case 'output':
            c.source(node, 0, st.level ? 3.3 : 0, 30, p.id);
            break;
          case 'open_drain':
            if (!st.level) c.source(node, 0, 0, 30, p.id);
            break;
          case 'pwm':
          case 'tone':
          case 'servo':
            c.source(node, 0, c.phaseHigh(g) ? 3.3 : 0, 30, p.id);
            break;
          case 'input_pullup':
            c.source(node, 0, 3.3, 45000, p.id);
            break;
          case 'input_pulldown':
            c.resistor(node, 0, 45000, p.id);
            break;
        }
      }
    }
  },
  evaluate(c) {
    const pins: Esp32State['pins'] = {};
    for (const p of HEADER_PINS) {
      if (p.kind === 'gpio') {
        const g = p.gpio!;
        const st = c.board.pin(g);
        const v = c.v(p.id);
        pins[g] = { v, mode: st.mode, level: st.level, duty: st.duty };
        const vmax = c.vMax(p.id);
        if (vmax > 3.6) {
          c.issue(
            'error',
            `GPIO${g} recibe ${vmax.toFixed(1)} V`,
            'El ESP32-S3 trabaja a 3.3 V y sus GPIO NO son tolerantes a 5 V. Usa un divisor de tensión o un conversor de nivel.',
            [p.id],
          );
        }
        const drives = st.mode === 'output' || st.mode === 'pwm' || st.mode === 'servo' || st.mode === 'tone' || st.mode === 'open_drain';
        if (drives) {
          const ipk = Math.abs(c.iPeak(p.id));
          const peers = c.netPeers(p.id).filter((m) => c.connected(m.term) || m.comp !== c.inst.id);
          const toGnd = peers.some((m) => m.kind === 'ground' && (m.comp !== c.inst.id || c.connected(m.term)));
          const toPower = peers.some((m) => m.kind === 'power');
          if (ipk > 0.04) {
            const what = toGnd
              ? 'está conectado directamente a GND'
              : toPower
                ? 'está conectado directamente a una alimentación'
                : 'está conectado a otra salida o a una carga demasiado baja';
            c.issue(
              'error',
              `Cortocircuito / sobrecorriente en GPIO${g} (${(ipk * 1000).toFixed(0)} mA)`,
              `El pin ${what}. Un GPIO del ESP32-S3 soporta ~40 mA como máximo: añade una resistencia (p. ej. 220 Ω) o usa un transistor/driver.`,
              [p.id],
            );
          } else if (ipk > 0.025) {
            c.issue(
              'warning',
              `GPIO${g} entrega ${(ipk * 1000).toFixed(0)} mA`,
              'Es una corriente alta para un GPIO (recomendado < 20 mA). Revisa el valor de la resistencia.',
              [p.id],
            );
          }
        } else if (c.board.running && st.mode !== 'unset' && c.connected(p.id) && !c.driven(p.id)) {
          c.issue(
            'warning',
            `GPIO${g} está flotante`,
            'La entrada no está conectada a ningún nivel definido (lee valores aleatorios). Usa INPUT_PULLUP / INPUT_PULLDOWN o una resistencia de pull-up/pull-down.',
            [p.id],
          );
        }
      } else if (p.kind === '3v3' || p.kind === '5v') {
        const i = c.iPeak(p.id);
        const peers = c.netPeers(p.id);
        if (p.kind === '5v' && peers.some((m) => m.comp === c.inst.id && m.term.startsWith('3V3'))) {
          c.issue('error', '5V conectado a 3V3', 'Nunca unas las alimentaciones de 5 V y 3.3 V entre sí.', [p.id]);
        } else if (i > 0.6) {
          c.issue(
            'error',
            `Cortocircuito en ${p.label}`,
            `${p.label} está conectado a GND sin carga (${i.toFixed(1)} A). Esto dañaría el regulador o el USB.`,
            [p.id],
          );
        }
      }
    }
    return { pins };
  },
};
