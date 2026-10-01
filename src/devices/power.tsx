// Símbolos de alimentación (3.3 V) y masa (GND).

import { FONT } from './common';
import type { DeviceDef } from './types';

export const vcc: DeviceDef<{ current: number }> = {
  type: 'vcc',
  name: 'Alimentación 3.3 V',
  category: 'Alimentación',
  description: 'Fuente de 3.3 V referida a GND (equivale al pin 3V3 de la placa).',
  width: 32,
  height: 40,
  prefix: 'VCC',
  terminals: [{ id: 'V', label: '+3.3 V', x: 16, y: 40, desc: 'Salida de alimentación.', kind: 'power', dir: 'down' }],
  props: [
    {
      key: 'voltage', label: 'Tensión', type: 'select', default: 3.3,
      options: [
        { value: 3.3, label: '3.3 V' },
        { value: 5, label: '5 V (¡cuidado con los GPIO!)' },
      ],
    },
  ],
  Render: ({ inst }) => {
    const v = Number(inst.props.voltage ?? 3.3);
    return (
      <g>
        <path d="M16 14 V40" stroke="#d33" strokeWidth={2.2} />
        <path d="M4 14 H28" stroke="#d33" strokeWidth={3} strokeLinecap="round" />
        <text x={16} y={9} textAnchor="middle" fontSize={9} fontWeight={700} fontFamily={FONT} fill="#e5484d">
          {v === 5 ? '5V' : '3V3'}
        </text>
      </g>
    );
  },
  stamp(c) {
    c.source(c.n('V'), 0, Number(c.props.voltage ?? 3.3), 0.3, 'src');
  },
  evaluate(c) {
    const i = c.iPeak('src');
    if (i > 0.6) {
      c.issue('error', 'Cortocircuito en la alimentación', `La fuente está conectada a GND sin carga (${i.toFixed(1)} A).`, ['V']);
    }
    const gp = c.gpiosOnNet('V');
    if (gp.length && Number(c.props.voltage) === 5) {
      c.issue('error', `5 V conectados a GPIO${gp[0]}`, 'Los GPIO del ESP32-S3 no toleran 5 V.', ['V']);
    }
    return { current: c.i('src') };
  },
};

export const gnd: DeviceDef = {
  type: 'gnd',
  name: 'GND',
  category: 'Alimentación',
  description: 'Masa (0 V). Todos los símbolos GND y los pines GND de la placa están unidos.',
  width: 32,
  height: 36,
  prefix: 'GND',
  terminals: [{ id: 'G', label: 'GND', x: 16, y: 0, desc: 'Masa común (0 V).', kind: 'ground', dir: 'up' }],
  props: [],
  Render: () => (
    <g>
      <path d="M16 0 V16" stroke="#555e69" strokeWidth={2.2} />
      <path d="M3 16 H29 M8 22 H24 M13 28 H19" stroke="#6b7684" strokeWidth={2.5} strokeLinecap="round" />
    </g>
  ),
};
