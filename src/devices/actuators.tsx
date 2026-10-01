// Servo, motor DC y buzzer.

import { checkOpen, checkSupply, clamp, FONT, MONO } from './common';
import type { BoardView, DeviceDef, TerminalDef } from './types';

/** ancho de pulso (µs) que genera un GPIO, o null si no es una señal de servo */
export function servoPulse(board: BoardView, gpio: number): number | null {
  const st = board.pin(gpio);
  if (st.mode === 'servo' && st.servoUs) return st.servoUs;
  if (st.mode === 'pwm' && st.freq >= 40 && st.freq <= 400 && st.duty > 0) return (st.duty * 1e6) / st.freq;
  return null;
}

// ------------------------------------------------------------------ servo

const servoTerms: TerminalDef[] = [
  { id: 'GND', label: 'GND (marrón)', x: 0, y: 12, desc: 'Masa del servo (cable marrón).', kind: 'gnd', dir: 'left' },
  { id: 'V+', label: 'V+ (rojo)', x: 0, y: 28, desc: 'Alimentación del servo (cable rojo). El SG90 funciona a 4.8–6 V: usa el pin 5V.', kind: 'vcc', dir: 'left' },
  { id: 'PWM', label: 'Señal (naranja)', x: 0, y: 44, desc: 'Señal PWM de 50 Hz (cable naranja). Pulso de 0.5 ms (0°) a 2.5 ms (180°).', kind: 'signal', dir: 'left' },
];

const lastAngle = new Map<string, number>();

export interface ServoState {
  angle: number;
  pulse: number | null;
  powered: boolean;
}

export const servo: DeviceDef<ServoState> = {
  type: 'servo',
  name: 'Servo SG90',
  category: 'Actuadores',
  description: 'Servomotor de 0–180°. Se controla con la librería ESP32Servo (servo.write) o con PWM de 50 Hz.',
  width: 112,
  height: 56,
  prefix: 'SERVO',
  terminals: servoTerms,
  props: [],
  Render: ({ inst, state }) => {
    const angle = state?.angle ?? 90;
    // con el servo girado 180° mantenemos los textos derechos
    const flip = inst.rotation === 180 ? (cx: number, cy: number) => `rotate(180 ${cx} ${cy})` : () => undefined;
    return (
      <g>
        {/* cables */}
        <path d="M0 12 C10 12 10 22 18 24" stroke="#7a4a1e" strokeWidth={3} fill="none" />
        <path d="M0 28 C8 28 10 28 18 28" stroke="#d62b2b" strokeWidth={3} fill="none" />
        <path d="M0 44 C10 44 10 34 18 32" stroke="#f08a1c" strokeWidth={3} fill="none" />
        {/* cuerpo */}
        <rect x={18} y={6} width={18} height={44} rx={2} fill="#2b5fbf" stroke="#1d4796" />
        <rect x={34} y={2} width={74} height={52} rx={4} fill="#3570d8" stroke="#1d4796" />
        <rect x={40} y={8} width={62} height={40} rx={3} fill="#2d63c4" />
        <text x={86} y={46} textAnchor="middle" fontSize={7} fontFamily={FONT} fontWeight={700} fill="#a9c4f5" transform={flip(86, 43.5)}>SG90</text>
        <circle cx={58} cy={28} r={11} fill="#e8ecf0" stroke="#b9c0c9" />
        {/* brazo */}
        <g style={{ transform: `rotate(${180 - angle}deg)`, transformOrigin: '58px 28px', transition: 'transform 0.35s ease-out' }}>
          <path d="M58 22 L20 25.5 A3 3 0 0 0 20 30.5 L58 34 Z" fill="#f8f9fb" stroke="#aab2bc" strokeWidth={1} />
          <circle cx={26} cy={28} r={1.3} fill="#aab2bc" />
          <circle cx={34} cy={28} r={1.3} fill="#aab2bc" />
          <circle cx={42} cy={28} r={1.3} fill="#aab2bc" />
        </g>
        <circle cx={58} cy={28} r={5} fill="#f8f9fb" stroke="#aab2bc" />
        <circle cx={58} cy={28} r={1.8} fill="#8a939e" />
        <text x={72} y={-3} fontSize={8} fontFamily={MONO} fill="var(--fg-muted)" transform={flip(90, -6)}>
          {Math.round(angle)}°{state?.pulse ? ` · ${Math.round(state.pulse)} µs` : ''}
        </text>
      </g>
    );
  },
  stamp(c) {
    c.resistor(c.n('V+'), c.n('GND'), 500, 'load');
  },
  evaluate(c) {
    const { vcc, powered } = checkSupply(c, 'el servo', 'V+', 'GND', { min: 3.0, max: 7, others: ['PWM'] });
    const prev = lastAngle.get(c.inst.id) ?? 90;
    let pulse: number | null = null;
    for (const g of c.gpiosOnNet('PWM')) {
      pulse = servoPulse(c.board, g) ?? pulse;
    }
    if (powered && vcc < 4.5 && c.connected('PWM')) {
      c.issue('info', 'Servo alimentado a 3.3 V', 'El SG90 está pensado para 4.8–6 V: con 3.3 V puede moverse sin fuerza. Mejor aliméntalo desde el pin 5V (la señal sí puede ser de 3.3 V).', ['V+']);
    }
    if (c.connected('PWM') && c.gpiosOnNet('PWM').length === 0) {
      c.issue('warning', 'La señal del servo no llega a ningún GPIO', 'Conecta el cable naranja (señal) a un GPIO de la placa.', ['PWM']);
    }
    let angle = prev;
    if (powered && pulse !== null) angle = clamp(((pulse - 500) / 2000) * 180, 0, 180);
    lastAngle.set(c.inst.id, angle);
    return { angle, pulse, powered };
  },
};

// ------------------------------------------------------------------ motor DC

const motorTerms: TerminalDef[] = [
  { id: '+', label: 'Terminal +', x: 16, y: 72, desc: 'Terminal del motor. Un motor consume demasiado para un GPIO: usa un transistor o driver.', kind: 'passive', dir: 'down' },
  { id: '-', label: 'Terminal −', x: 48, y: 72, desc: 'Terminal del motor. Invertir la polaridad invierte el giro.', kind: 'passive', dir: 'down' },
];

export interface MotorState {
  speed: number; // -1..1
  current: number;
}

export const motor: DeviceDef<MotorState> = {
  type: 'motor',
  name: 'Motor DC',
  category: 'Actuadores',
  description: 'Motor de corriente continua (3–6 V). La velocidad depende de la tensión media (PWM).',
  width: 64,
  height: 72,
  prefix: 'M',
  terminals: motorTerms,
  props: [],
  Render: ({ state }) => {
    const s = state?.speed ?? 0;
    const spinning = Math.abs(s) > 0.03;
    const dur = spinning ? clamp(0.6 / Math.abs(s), 0.08, 3) : 0;
    return (
      <g>
        <path d="M16 58 V72 M48 58 V72" stroke="#9aa4ae" strokeWidth={2.2} />
        <rect x={6} y={14} width={52} height={46} rx={10} fill="#c3c9d1" stroke="#858e99" />
        <rect x={6} y={44} width={52} height={16} rx={4} fill="#a4acb6" />
        <circle cx={32} cy={30} r={6} fill="#6b7480" />
        <g
          style={{
            transformOrigin: '32px 30px',
            animation: spinning ? `spin ${dur}s linear infinite${s < 0 ? ' reverse' : ''}` : 'none',
          }}
        >
          <path d="M32 30 L32 4 Q40 6 36 28 Z M32 30 L54 42 Q48 48 34 34 Z M32 30 L10 42 Q14 48 30 34 Z" fill="#f2b632" stroke="#b9861a" strokeWidth={0.8} opacity={0.95} />
        </g>
        <circle cx={32} cy={30} r={3} fill="#333" />
        <text x={16} y={56} textAnchor="middle" fontSize={8} fontFamily={FONT} fill="#4a525c">+</text>
        <text x={48} y={56} textAnchor="middle" fontSize={8} fontFamily={FONT} fill="#4a525c">−</text>
      </g>
    );
  },
  stamp(c) {
    c.resistor(c.n('+'), c.n('-'), 10, 'm');
  },
  evaluate(c) {
    checkOpen(c, motorTerms, 'el motor');
    const v = c.v('+') - c.v('-');
    const i = c.iPeak('m');
    const direct = [...c.gpiosOnNet('+'), ...c.gpiosOnNet('-')];
    if (direct.length && Math.abs(i) > 0.04) {
      c.issue('error', 'Motor conectado directamente a un GPIO', `Necesita ${(Math.abs(i) * 1000).toFixed(0)} mA y un GPIO da ~40 mA como máximo. Usa un transistor (con diodo de protección) o un driver como el DRV8833 / L298N.`);
    }
    return { speed: clamp(v / 5, -1, 1), current: c.i('m') };
  },
};

// ------------------------------------------------------------------ buzzer

const buzTerms: TerminalDef[] = [
  { id: '+', label: '+', x: 16, y: 56, desc: 'Terminal positivo del buzzer (a un GPIO).', kind: 'passive', dir: 'down' },
  { id: '-', label: '−', x: 32, y: 56, desc: 'Terminal negativo del buzzer (a GND).', kind: 'passive', dir: 'down' },
];

export interface BuzzerState {
  on: boolean;
  freq: number;
}

export const buzzer: DeviceDef<BuzzerState> = {
  type: 'buzzer',
  name: 'Buzzer',
  category: 'Salidas',
  description: 'Zumbador. Activo: suena con HIGH. Pasivo: necesita tone(pin, frecuencia).',
  width: 48,
  height: 56,
  prefix: 'BZ',
  terminals: buzTerms,
  props: [
    {
      key: 'kind', label: 'Tipo', type: 'select', default: 'passive',
      options: [
        { value: 'passive', label: 'Pasivo (usa tone())' },
        { value: 'active', label: 'Activo (suena con HIGH)' },
      ],
    },
  ],
  Render: ({ state }) => {
    const on = !!state?.on;
    return (
      <g>
        <path d="M16 42 V56 M32 42 V56" stroke="#9aa4ae" strokeWidth={2.2} />
        <circle cx={24} cy={22} r={20} fill="#1f2328" stroke="#0b0d10" />
        <circle cx={24} cy={22} r={14} fill="#2a2f36" />
        <circle cx={24} cy={22} r={3} fill="#0b0d10" />
        <text x={8} y={10} fontSize={9} fontFamily={FONT} fill="#cfd6de">+</text>
        {on && (
          <g className="sound-waves" stroke="var(--accent)" fill="none" strokeWidth={1.8} strokeLinecap="round">
            <path d="M48 12 Q54 22 48 32" />
            <path d="M53 7 Q62 22 53 37" />
          </g>
        )}
        {on && state!.freq > 0 && (
          <text x={24} y={-4} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="var(--fg-muted)">{Math.round(state!.freq)} Hz</text>
        )}
      </g>
    );
  },
  stamp(c) {
    c.resistor(c.n('+'), c.n('-'), 300, 'b');
  },
  evaluate(c) {
    checkOpen(c, buzTerms, 'el buzzer');
    const vmax = c.vMax('+') - c.v('-');
    let on = false;
    let freq = 0;
    if (c.props.kind === 'active') {
      on = c.v('+') - c.v('-') > 2.0;
      freq = on ? 2300 : 0;
    } else {
      for (const g of c.gpiosOnNet('+')) {
        const st = c.board.pin(g);
        if ((st.mode === 'tone' || st.mode === 'pwm') && st.freq > 20 && st.duty > 0.02 && st.duty < 0.98 && vmax > 2) {
          on = true;
          freq = st.freq;
        }
      }
      if (!on && c.v('+') - c.v('-') > 2 && c.board.running) {
        c.issue('info', 'Buzzer pasivo con tensión continua', 'Un buzzer pasivo solo hace "clic" con HIGH: usa tone(pin, frecuencia) o cambia el tipo a "activo".');
      }
    }
    return { on, freq };
  },
};
