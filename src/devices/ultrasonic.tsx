// Sensor de distancia por ultrasonidos HC-SR04: un pulso de 10 µs en TRIG
// hace que ECHO se ponga a HIGH durante el tiempo de ida y vuelta del eco.

import { checkSupply, clamp, FONT, MONO } from './common';
import { Slider } from './sensors';
import type { DeviceDef, TerminalDef } from './types';

const W = 144;
const H = 80;
const MIN_CM = 2;
const MAX_CM = 400;

const terminals: TerminalDef[] = [
  { id: 'VCC', label: 'VCC', x: 48, y: H, desc: 'Alimentación. El HC-SR04 clásico es de 5 V, pero su ECHO daría 5 V al GPIO: con el ESP32-S3 usa la versión de 3.3 V (HC-SR04P) y aliméntalo a 3V3.', kind: 'vcc', dir: 'down' },
  { id: 'TRIG', label: 'TRIG', x: 64, y: H, desc: 'Disparo: un pulso HIGH de 10 µs inicia la medida. Va a un GPIO configurado como OUTPUT.', kind: 'signal', dir: 'down' },
  { id: 'ECHO', label: 'ECHO', x: 80, y: H, desc: 'Eco: se pone a HIGH tanto tiempo como tarda el sonido en ir y volver. Mídelo con pulseIn(pin, HIGH); distancia (cm) = µs / 58.', kind: 'signal', dir: 'down' },
  { id: 'GND', label: 'GND', x: 96, y: H, desc: 'Masa.', kind: 'gnd', dir: 'down' },
];

const toPct = (cm: number) => ((clamp(cm, MIN_CM, MAX_CM) - MIN_CM) / (MAX_CM - MIN_CM)) * 100;
const toCm = (pct: number) => Math.round(MIN_CM + ((MAX_CM - MIN_CM) * pct) / 100);

function Transducer({ cx }: { cx: number }) {
  return (
    <g>
      <circle cx={cx} cy={26} r={21} fill="#c7ccd2" stroke="#8b929b" strokeWidth={1.5} />
      <circle cx={cx} cy={26} r={16} fill="#2a2e33" />
      {[-8, -3, 2, 7].map((d) => (
        <path key={d} d={`M${cx - 12} ${26 + d} H${cx + 12}`} stroke="#3c4148" strokeWidth={1.4} />
      ))}
    </g>
  );
}

export const ultrasonic: DeviceDef<{ powered: boolean; distance: number }> = {
  type: 'ultrasonic',
  name: 'Ultrasonidos HC-SR04',
  category: 'Entradas',
  description: 'Mide distancias de 2 a 400 cm. TRIG: pulso de 10 µs; ECHO: pulseIn(pin, HIGH) devuelve µs (cm = µs / 58). Ajusta la distancia con el deslizador.',
  width: W,
  height: H,
  prefix: 'US',
  terminals,
  props: [{ key: 'distance', label: 'Distancia al objeto', type: 'range', default: 50, min: MIN_CM, max: MAX_CM, step: 1, unit: 'cm', live: true }],
  Render: ({ inst, setLiveProp }) => {
    const cm = clamp(Number(inst.props.distance ?? 50), MIN_CM, MAX_CM);
    return (
      <g>
        {terminals.map((t) => (
          <path key={t.id} d={`M${t.x} ${H - 12} V${H}`} stroke="#9aa4ae" strokeWidth={2.2} />
        ))}
        <rect x={0} y={0} width={W} height={H - 10} rx={4} fill="#1f5fa8" stroke="#123a68" />
        <Transducer cx={30} />
        <Transducer cx={W - 30} />
        <rect x={58} y={8} width={28} height={12} rx={2} fill="#c7ccd2" stroke="#8b929b" />
        <text x={72} y={34} textAnchor="middle" fontSize={7} fontFamily={FONT} fontWeight={700} fill="#e4efff">HC-SR04</text>
        <text x={72} y={44} textAnchor="middle" fontSize={8} fontFamily={MONO} fill="#fff">{cm} cm</text>
        <Slider value={toPct(cm)} onChange={(p) => setLiveProp('distance', toCm(p))} color="#7fd1ff" x={20} y={49} w={104} />
        {terminals.map((t) => (
          <text key={t.id} x={t.x} y={H - 12} textAnchor="middle" fontSize={5} fontFamily={FONT} fontWeight={700} fill="#e4efff">{t.id}</text>
        ))}
      </g>
    );
  },
  stamp(c) {
    const vcc = c.n('VCC');
    const gnd = c.n('GND');
    c.resistor(vcc, gnd, 330, 'q');
    c.resistor(c.n('TRIG'), gnd, 100_000);
    // ECHO en reposo a nivel bajo (el pulso se mide con pulseIn)
    if (c.v(vcc) - c.v(gnd) > 2.5) c.source(c.n('ECHO'), gnd, 0, 1000, 'echo');
  },
  evaluate(c) {
    const { vcc, powered } = checkSupply(c, 'el HC-SR04', 'VCC', 'GND', { min: 3.0, max: 5.5, others: ['TRIG', 'ECHO'] });
    const echoPins = c.gpiosOnNet('ECHO');
    if (powered && vcc > 3.6 && echoPins.length) {
      c.issue(
        'error',
        `ECHO daría pulsos de ${vcc.toFixed(1)} V en GPIO${echoPins[0]}`,
        'Alimentado a 5 V, el HC-SR04 devuelve el eco a 5 V y los GPIO del ESP32-S3 no lo toleran. Aliméntalo a 3V3 (versión HC-SR04P) o pon un divisor de tensión en ECHO.',
        ['ECHO'],
      );
    }
    if (powered && c.board.running) {
      if (c.connected('TRIG') && c.gpiosOnNet('TRIG').length === 0) {
        c.issue('info', 'TRIG no llega a ningún GPIO', 'Conecta TRIG a un pin de salida de la placa.', ['TRIG']);
      }
      if (c.connected('ECHO') && echoPins.length === 0) {
        c.issue('info', 'ECHO no llega a ningún GPIO', 'Conecta ECHO directamente al pin en el que haces pulseIn().', ['ECHO']);
      }
    }
    return { powered, distance: clamp(Number(c.props.distance ?? 50), MIN_CM, MAX_CM) };
  },
};
