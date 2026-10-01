// Sensor analógico genérico y sensor digital genérico.

import { useRef } from 'react';
import { checkSupply, clamp, FONT, MONO } from './common';
import type { DeviceDef, TerminalDef } from './types';

const sensorTerms = (outDesc: string): TerminalDef[] => [
  { id: 'VCC', label: 'VCC', x: 12, y: 64, desc: 'Alimentación del módulo (3V3).', kind: 'vcc', dir: 'down' },
  { id: 'GND', label: 'GND', x: 28, y: 64, desc: 'Masa del módulo.', kind: 'gnd', dir: 'down' },
  { id: 'OUT', label: 'OUT', x: 44, y: 64, desc: outDesc, kind: 'signal', dir: 'down' },
];

export const ANALOG_KINDS: Record<string, { label: string; unit: string; min: number; max: number; color: string; icon: string }> = {
  temp: { label: 'Temperatura', unit: '°C', min: -10, max: 50, color: '#e05a2f', icon: '🌡' },
  light: { label: 'Luz (LDR)', unit: 'lx', min: 0, max: 1000, color: '#e6b31f', icon: '☀' },
  humidity: { label: 'Humedad', unit: '%', min: 0, max: 100, color: '#2f8fe0', icon: '💧' },
  gas: { label: 'Gas', unit: 'ppm', min: 0, max: 1000, color: '#7a8a99', icon: '☁' },
  generic: { label: 'Genérico', unit: '%', min: 0, max: 100, color: '#22a37a', icon: '∿' },
};

const aTerms = sensorTerms('Salida analógica 0..VCC proporcional a la magnitud. Conéctala a un pin ADC (GPIO1..20).');

function Slider({ value, onChange, color }: { value: number; onChange: (v: number) => void; color: string }) {
  const ref = useRef<SVGRectElement>(null);
  const set = (clientX: number) => {
    const r = ref.current!.getBoundingClientRect();
    onChange(clamp(Math.round(((clientX - r.left) / r.width) * 100), 0, 100));
  };
  return (
    <g
      className="interactive"
      onPointerDown={(e) => {
        e.stopPropagation();
        (e.currentTarget as Element).setPointerCapture(e.pointerId);
        set(e.clientX);
      }}
      onPointerMove={(e) => {
        if (e.buttons & 1) set(e.clientX);
      }}
    >
      <rect ref={ref} x={6} y={34} width={44} height={10} rx={5} fill="#0e1a14" />
      <rect x={6} y={34} width={(44 * value) / 100} height={10} rx={5} fill={color} />
      <circle cx={6 + (44 * value) / 100} cy={39} r={5.5} fill="#f4f6f8" stroke="#555" />
    </g>
  );
}

export const analogSensor: DeviceDef<{ value: number; out: number }> = {
  type: 'analogSensor',
  name: 'Sensor analógico',
  category: 'Entradas',
  description: 'Sensor genérico con salida analógica (temperatura, luz, humedad...). Ajusta la magnitud con el deslizador.',
  width: 56,
  height: 64,
  prefix: 'SA',
  terminals: aTerms,
  props: [
    {
      key: 'kind', label: 'Magnitud', type: 'select', default: 'temp',
      options: Object.entries(ANALOG_KINDS).map(([value, k]) => ({ value, label: k.label })),
    },
    { key: 'value', label: 'Nivel', type: 'range', default: 50, min: 0, max: 100, step: 1, unit: '%', live: true },
  ],
  Render: ({ inst, state, setLiveProp }) => {
    const k = ANALOG_KINDS[inst.props.kind] ?? ANALOG_KINDS.generic;
    const v = Number(inst.props.value ?? 50);
    const phys = k.min + ((k.max - k.min) * v) / 100;
    return (
      <g>
        <path d="M12 50 V64 M28 50 V64 M44 50 V64" stroke="#9aa4ae" strokeWidth={2.2} />
        <rect x={0} y={0} width={56} height={52} rx={4} fill="#1d6b4a" stroke="#0f3f2b" />
        <circle cx={14} cy={15} r={9} fill="#0c2a1d" />
        <text x={14} y={19} textAnchor="middle" fontSize={11} fill={k.color}>{k.icon}</text>
        <text x={50} y={12} textAnchor="end" fontSize={7} fontFamily={FONT} fill="#cfe9dc" fontWeight={600}>{k.label.split(' ')[0]}</text>
        <text x={50} y={24} textAnchor="end" fontSize={8} fontFamily={MONO} fill="#fff">
          {phys.toFixed(k.max - k.min > 200 ? 0 : 1)}{k.unit}
        </text>
        <Slider value={v} onChange={(nv) => setLiveProp('value', nv)} color={k.color} />
        {['VCC', 'GND', 'OUT'].map((l, i) => (
          <text key={l} x={12 + i * 16} y={50} textAnchor="middle" fontSize={5.5} fontFamily={FONT} fill="#cfe9dc">{l}</text>
        ))}
        {state && <text x={28} y={-3} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="var(--fg-muted)">OUT {state.out.toFixed(2)} V</text>}
      </g>
    );
  },
  stamp(c) {
    const vcc = c.n('VCC');
    const gnd = c.n('GND');
    const supply = Math.max(0, c.v(vcc) - c.v(gnd));
    c.resistor(vcc, gnd, 20000, 'q');
    if (supply > 0.5) c.source(c.n('OUT'), gnd, (supply * clamp(Number(c.props.value ?? 50), 0, 100)) / 100, 200, 'out');
  },
  evaluate(c) {
    checkSupply(c, 'el sensor analógico', 'VCC', 'GND', { min: 2.7, max: 5.5, others: ['OUT'] });
    if (c.connected('OUT') && c.gpiosOnNet('OUT').length === 0 && c.connected('VCC')) {
      c.issue('info', 'La salida del sensor no va a ningún GPIO', 'Conecta OUT a un pin con ADC (GPIO1..20) y léelo con analogRead().', ['OUT']);
    }
    return { value: Number(c.props.value ?? 50), out: c.v('OUT') - c.v('GND') };
  },
};

// ------------------------------------------------------------------ digital

export const DIGITAL_KINDS: Record<string, { label: string; on: string; off: string }> = {
  pir: { label: 'PIR movimiento', on: 'Movimiento', off: 'Reposo' },
  ir: { label: 'Obstáculo IR', on: 'Obstáculo', off: 'Libre' },
  tilt: { label: 'Inclinación', on: 'Inclinado', off: 'Horizontal' },
  sound: { label: 'Sonido', on: 'Ruido', off: 'Silencio' },
  generic: { label: 'Genérico', on: 'Activo', off: 'Inactivo' },
};

const dTerms = sensorTerms('Salida digital (HIGH/LOW). Conéctala a cualquier GPIO y léela con digitalRead().');

export const digitalSensor: DeviceDef<{ active: boolean; out: number }> = {
  type: 'digitalSensor',
  name: 'Sensor digital',
  category: 'Entradas',
  description: 'Sensor con salida digital (PIR, obstáculo IR, inclinación...). Haz clic sobre él para activarlo/desactivarlo.',
  width: 56,
  height: 64,
  prefix: 'SD',
  terminals: dTerms,
  props: [
    {
      key: 'kind', label: 'Tipo', type: 'select', default: 'pir',
      options: Object.entries(DIGITAL_KINDS).map(([value, k]) => ({ value, label: k.label })),
    },
    { key: 'active', label: 'Detectando', type: 'boolean', default: false, live: true },
    { key: 'activeLow', label: 'Salida activa a nivel bajo', type: 'boolean', default: false },
  ],
  Render: ({ inst, setLiveProp }) => {
    const k = DIGITAL_KINDS[inst.props.kind] ?? DIGITAL_KINDS.generic;
    const active = !!inst.props.active;
    return (
      <g>
        <path d="M12 50 V64 M28 50 V64 M44 50 V64" stroke="#9aa4ae" strokeWidth={2.2} />
        <rect x={0} y={0} width={56} height={52} rx={4} fill="#244a8a" stroke="#132a52" />
        <g
          className="interactive"
          onPointerDown={(e) => {
            e.stopPropagation();
            setLiveProp('active', !active);
          }}
        >
          {inst.props.kind === 'pir' ? (
            <>
              <circle cx={28} cy={20} r={15} fill="#f1f3f5" stroke="#c4cad1" />
              <path d="M17 20 h22 M28 9 v22 M20 12 l16 16 M36 12 l-16 16" stroke="#dde2e7" strokeWidth={1} />
            </>
          ) : (
            <rect x={10} y={6} width={36} height={26} rx={4} fill="#13284d" stroke="#0a1730" />
          )}
          <circle cx={46} cy={40} r={4} fill={active ? '#ff3b3b' : '#4a1515'} filter={active ? 'url(#led-glow)' : undefined} />
        </g>
        <text x={6} y={44} fontSize={6.5} fontFamily={FONT} fill="#dbe6f7">{active ? k.on : k.off}</text>
        {['VCC', 'GND', 'OUT'].map((l, i) => (
          <text key={l} x={12 + i * 16} y={50} textAnchor="middle" fontSize={5.5} fontFamily={FONT} fill="#dbe6f7">{l}</text>
        ))}
      </g>
    );
  },
  stamp(c) {
    const vcc = c.n('VCC');
    const gnd = c.n('GND');
    const supply = Math.max(0, c.v(vcc) - c.v(gnd));
    c.resistor(vcc, gnd, 10000, 'q');
    if (supply > 2) {
      const high = !!c.props.active !== !!c.props.activeLow;
      c.source(c.n('OUT'), gnd, high ? supply : 0, 100, 'out');
    }
  },
  evaluate(c) {
    checkSupply(c, 'el sensor digital', 'VCC', 'GND', { min: 2.7, max: 5.5, others: ['OUT'] });
    return { active: !!c.props.active, out: c.v('OUT') - c.v('GND') };
  },
};
