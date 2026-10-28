import { describe, expect, it } from 'vitest';
import type { BoardView, PinState } from '../devices/types';
import { EXAMPLES } from '../state/examples';
import { buildNetlist, evaluate, solve } from './solver';
import { termKey, type Circuit } from './types';

const UNSET: PinState = { mode: 'unset', level: 0, duty: 0, freq: 0, servoUs: null };

function board(pins: Record<number, Partial<PinState>> = {}, i2c = { sda: 10, scl: 9, begun: true }): BoardView {
  return {
    running: true,
    pin: (g) => ({ ...UNSET, ...(pins[g] ?? {}) }),
    oledFrame: () => undefined,
    lcdFrame: () => undefined,
    sincePulse: () => Infinity,
    i2c,
  };
}

function run(circuit: Circuit, b: BoardView, inputs: Record<string, Record<string, any>> = {}) {
  const sol = solve({ circuit, board: b, inputs, pwm: new Map() });
  return { sol, ev: evaluate(circuit, sol, b, inputs, 'esp') };
}

describe('montaje de la caja fuerte', () => {
  const circuit = EXAMPLES.find((e) => e.id === 'safe')!.project.circuit;
  const net = buildNetlist(circuit);
  const same = (a: string, b: string) => {
    const [ac, at] = a.split('.');
    const [bc, bt] = b.split('.');
    return net.netOf.get(termKey(ac, at)) === net.netOf.get(termKey(bc, bt));
  };

  it('cada pin del teclado va a su GPIO', () => {
    const map: Record<string, number> = { R1: 1, R2: 2, R3: 42, R4: 41, C1: 40, C2: 39, C3: 47, C4: 21 };
    for (const [t, g] of Object.entries(map)) expect(same(`kp1.${t}`, `esp.GPIO${g}`)).toBe(true);
  });

  it('el LCD está alimentado a 3V3 y en el bus I2C (SDA=10, SCL=9)', () => {
    expect(same('lcd1.SDA', 'esp.GPIO10')).toBe(true);
    expect(same('lcd1.SCL', 'esp.GPIO9')).toBe(true);
    const { ev, sol } = run(circuit, board());
    const vcc = sol.vAvg[net.netOf.get(termKey('lcd1', 'VCC'))!];
    expect(vcc).toBeGreaterThan(3.2);
    expect(ev.states.lcd1).toMatchObject({ powered: true, ready: true, addr: 0x27 });
  });

  it('no tiene errores ni avisos eléctricos con el programa en marcha', () => {
    const pins: Record<number, Partial<PinState>> = {};
    for (const g of [1, 2, 42, 41]) pins[g] = { mode: 'input_pullup' };
    for (const g of [40, 39, 47, 21]) pins[g] = { mode: 'output', level: 1 };
    const { ev } = run(circuit, board(pins), { kp1: { key: [1, 2] } });
    expect(ev.issues.filter((i) => i.severity !== 'info')).toEqual([]);
    expect(ev.states.kp1.key).toEqual([1, 2]);
  });

  it('al pulsar una tecla con su columna a LOW, la fila baja a 0 V', () => {
    const pins: Record<number, Partial<PinState>> = {};
    for (const g of [1, 2, 42, 41]) pins[g] = { mode: 'input_pullup' };
    for (const g of [40, 39, 47, 21]) pins[g] = { mode: 'output', level: g === 47 ? 0 : 1 };
    const row = (s: ReturnType<typeof run>, t: string) => s.sol.vAvg[net.netOf.get(termKey('kp1', t))!];
    const idle = run(circuit, board(pins));
    expect(row(idle, 'R2')).toBeGreaterThan(3);
    // tecla '6' = fila 2, columna 3 (GPIO47)
    const pressed = run(circuit, board(pins), { kp1: { key: [1, 2] } });
    expect(row(pressed, 'R2')).toBeLessThan(0.1);
    expect(row(pressed, 'R1')).toBeGreaterThan(3);
  });
});

describe('montaje del semáforo', () => {
  const circuit = EXAMPLES.find((e) => e.id === 'traffic')!.project.circuit;
  const net = buildNetlist(circuit);
  // corta solo en el primer punto: hay terminales como '3V3.L1'
  const key = (s: string) => termKey(s.slice(0, s.indexOf('.')), s.slice(s.indexOf('.') + 1));
  const same = (a: string, b: string) => net.netOf.get(key(a)) === net.netOf.get(key(b));
  const leds = { led1: 4, led2: 17, led3: 10 };

  it('el HC-SR04 va a GPIO1/GPIO2 y está alimentado a 3V3', () => {
    expect(same('us1.TRIG', 'esp.GPIO1')).toBe(true);
    expect(same('us1.ECHO', 'esp.GPIO2')).toBe(true);
    expect(same('us1.VCC', 'esp.3V3.L1')).toBe(true);
    expect(same('us1.GND', 'esp.GND.L21')).toBe(true);
  });

  it('cada LED enciende solo con su GPIO en alto y sin avisos', () => {
    for (const [id, gpio] of Object.entries(leds)) {
      const pins: Record<number, Partial<PinState>> = { 1: { mode: 'output' }, 2: { mode: 'input' } };
      for (const g of Object.values(leds)) pins[g] = { mode: 'output', level: g === gpio ? 1 : 0 };
      const { ev } = run(circuit, board(pins));
      expect(ev.issues.filter((i) => i.severity !== 'info')).toEqual([]);
      expect(ev.states.us1).toMatchObject({ powered: true, distance: 120 });
      for (const other of Object.keys(leds)) {
        if (other === id) expect(ev.states[other].brightness).toBeGreaterThan(0.5);
        else expect(ev.states[other].brightness).toBe(0);
      }
    }
  });
});

describe('nuevos componentes', () => {
  it('el display de 7 segmentos (cátodo común) enciende solo los segmentos en alto', () => {
    const circuit: Circuit = {
      components: [
        { id: 'esp', type: 'esp32s3', x: 0, y: 0, rotation: 0, props: {} },
        { id: 'd1', type: 'sevenseg', x: 400, y: 0, rotation: 0, props: { common: 'cathode', color: 'red' } },
        { id: 'r1', type: 'resistor', x: 300, y: 0, rotation: 0, props: { resistance: 330 } },
        { id: 'r2', type: 'resistor', x: 300, y: 40, rotation: 0, props: { resistance: 330 } },
      ],
      wires: [
        { id: 'w1', a: { comp: 'esp', term: 'GPIO4' }, b: { comp: 'r1', term: '1' }, color: '', points: [] },
        { id: 'w2', a: { comp: 'r1', term: '2' }, b: { comp: 'd1', term: 'A' }, color: '', points: [] },
        { id: 'w3', a: { comp: 'esp', term: 'GPIO5' }, b: { comp: 'r2', term: '1' }, color: '', points: [] },
        { id: 'w4', a: { comp: 'r2', term: '2' }, b: { comp: 'd1', term: 'B' }, color: '', points: [] },
        { id: 'w5', a: { comp: 'd1', term: 'COM2' }, b: { comp: 'esp', term: 'GND.L21' }, color: '', points: [] },
      ],
    };
    const { ev } = run(circuit, board({ 4: { mode: 'output', level: 1 }, 5: { mode: 'output', level: 0 } }));
    expect(ev.states.d1.seg.A).toBeGreaterThan(0.5);
    expect(ev.states.d1.seg.B).toBe(0);
    expect(ev.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('la LDR baja su resistencia con la luz', () => {
    const mk = (light: number): Circuit => ({
      components: [
        { id: 'esp', type: 'esp32s3', x: 0, y: 0, rotation: 0, props: {} },
        { id: 'l1', type: 'ldr', x: 300, y: 0, rotation: 0, props: { light } },
        { id: 'r1', type: 'resistor', x: 300, y: 60, rotation: 0, props: { resistance: 10000 } },
      ],
      wires: [
        { id: 'w1', a: { comp: 'esp', term: '3V3.L0' }, b: { comp: 'l1', term: '1' }, color: '', points: [] },
        { id: 'w2', a: { comp: 'l1', term: '2' }, b: { comp: 'esp', term: 'GPIO4' }, color: '', points: [] },
        { id: 'w3', a: { comp: 'esp', term: 'GPIO4' }, b: { comp: 'r1', term: '1' }, color: '', points: [] },
        { id: 'w4', a: { comp: 'r1', term: '2' }, b: { comp: 'esp', term: 'GND.L21' }, color: '', points: [] },
      ],
    });
    const v = (light: number) => {
      const c = mk(light);
      const { sol } = run(c, board({ 4: { mode: 'input' } }));
      return sol.vAvg[sol.netlist.netOf.get(termKey('esp', 'GPIO4'))!];
    };
    expect(v(10)).toBeLessThan(0.6);
    expect(v(90)).toBeGreaterThan(2.8);
  });
});
