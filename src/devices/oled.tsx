import { useMemo } from 'react';
import { checkSupply, FONT, MONO } from './common';
import type { DeviceDef, OledFrame, TerminalDef } from './types';

const terms: TerminalDef[] = [
  { id: 'GND', label: 'GND', x: 48, y: 0, desc: 'Masa.', kind: 'gnd', dir: 'up' },
  { id: 'VCC', label: 'VCC', x: 64, y: 0, desc: 'Alimentación 3.3 V. (El módulo lleva pull-ups a VCC en SDA/SCL: con 5 V llevarías 5 V a los GPIO).', kind: 'vcc', dir: 'up' },
  { id: 'SCL', label: 'SCL', x: 80, y: 0, desc: 'Reloj I2C. Por defecto GPIO9 en el ESP32-S3 (o el indicado en Wire.begin(sda, scl)).', kind: 'signal', dir: 'up' },
  { id: 'SDA', label: 'SDA', x: 96, y: 0, desc: 'Datos I2C. Por defecto GPIO8 en el ESP32-S3 (o el indicado en Wire.begin(sda, scl)).', kind: 'signal', dir: 'up' },
];

export interface OledState {
  powered: boolean;
  ready: boolean;
  addr: number;
  frame: OledFrame | null;
}

function frameToUrl(f: OledFrame): string {
  const cv = document.createElement('canvas');
  cv.width = f.w;
  cv.height = f.h;
  const ctx = cv.getContext('2d')!;
  const img = ctx.createImageData(f.w, f.h);
  for (let i = 0; i < f.w * f.h; i++) {
    const on = (f.buf[i] ? 1 : 0) ^ (f.inverted ? 1 : 0);
    img.data[i * 4] = on ? 120 : 6;
    img.data[i * 4 + 1] = on ? 220 : 10;
    img.data[i * 4 + 2] = on ? 255 : 16;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);
  return cv.toDataURL();
}

function Screen({ frame, powered }: { frame: OledFrame | null; powered: boolean }) {
  const url = useMemo(() => (frame && powered ? frameToUrl(frame) : null), [frame, frame?.version, powered]);
  return (
    <g>
      <rect x={8} y={26} width={128} height={64} fill="#05080c" />
      {url && <image href={url} x={8} y={26} width={128} height={64} style={{ imageRendering: 'pixelated' }} />}
      {!url && powered && <rect x={8} y={26} width={128} height={64} fill="#070b11" />}
    </g>
  );
}

export const oled: DeviceDef<OledState> = {
  type: 'oled',
  name: 'Pantalla OLED I2C',
  category: 'Pantallas',
  description: 'Pantalla OLED SSD1306 de 128×64 por I2C (librería Adafruit_SSD1306). SDA=GPIO8 y SCL=GPIO9 por defecto.',
  width: 144,
  height: 104,
  prefix: 'OLED',
  terminals: terms,
  max: 4,
  props: [
    {
      key: 'address', label: 'Dirección I2C', type: 'select', default: 0x3c,
      options: [
        { value: 0x3c, label: '0x3C' },
        { value: 0x3d, label: '0x3D' },
      ],
    },
  ],
  Render: ({ inst, state }) => (
    <g>
      <rect x={0} y={0} width={144} height={104} rx={6} fill="#1a3a8a" stroke="#0d2257" />
      {[[8, 8], [136, 8], [8, 96], [136, 96]].map(([x, y]) => (
        <circle key={`${x}${y}`} cx={x} cy={y} r={3.5} fill="#0b1a40" stroke="#c9a24a" />
      ))}
      <rect x={4} y={22} width={136} height={72} rx={2} fill="#111" />
      <Screen frame={state?.frame ?? null} powered={!!state?.powered} />
      {terms.map((t) => (
        <g key={t.id}>
          <rect x={t.x - 5} y={-1} width={10} height={9} rx={1} fill="#0b1a40" />
          <text x={t.x} y={17} textAnchor="middle" fontSize={6.5} fontFamily={FONT} fill="#dbe4ff" fontWeight={600}>{t.label}</text>
        </g>
      ))}
      <text x={140} y={102} textAnchor="end" fontSize={6} fontFamily={MONO} fill="#8fa5e0">
        0x{Number(inst.props.address ?? 0x3c).toString(16).toUpperCase()}
      </text>
    </g>
  ),
  stamp(c) {
    const vcc = c.n('VCC');
    const gnd = c.n('GND');
    c.resistor(vcc, gnd, 400, 'q');
    // resistencias de pull-up integradas en el módulo
    if (c.n('SDA') !== vcc) c.resistor(c.n('SDA'), vcc, 4700);
    if (c.n('SCL') !== vcc) c.resistor(c.n('SCL'), vcc, 4700);
  },
  evaluate(c) {
    const addr = Number(c.props.address ?? 0x3c);
    const { powered } = checkSupply(c, 'la OLED', 'VCC', 'GND', { min: 2.8, max: 5.5, others: ['SDA', 'SCL'] });
    const { sda, scl, begun } = c.board.i2c;
    const sdaPins = c.gpiosOnNet('SDA');
    const sclPins = c.gpiosOnNet('SCL');
    const wired = sdaPins.includes(sda) && sclPins.includes(scl);
    if (sdaPins.includes(scl) && sclPins.includes(sda)) {
      c.issue('error', 'SDA y SCL intercambiados en la OLED', `SDA debe ir a GPIO${sda} y SCL a GPIO${scl}.`, ['SDA', 'SCL']);
    } else if (begun && c.board.running && !wired && (c.connected('SDA') || c.connected('SCL'))) {
      c.issue(
        'warning',
        'La OLED no está en el bus I2C configurado',
        `El programa usa SDA=GPIO${sda} y SCL=GPIO${scl}. Conecta allí los pines del módulo o cambia Wire.begin(sda, scl).`,
        ['SDA', 'SCL'],
      );
    }
    const ready = powered && wired;
    const frame = ready ? c.board.oledFrame(addr) ?? null : null;
    return { powered, ready, addr, frame };
  },
};
