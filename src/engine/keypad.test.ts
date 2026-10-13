import { describe, expect, it } from 'vitest';
import { ESP32_BOARD_INFO } from '../devices/esp32s3/pins';
import { EXAMPLES } from '../state/examples';
import { Interpreter, TICK } from './interpreter';
import { compile } from './runner';
import { Sleep, type Hal, type LcdFrame } from './values';

/** HAL de prueba con un teclado "pulsable" y un LCD que guarda su último contenido */
function lcdHal() {
  let t = 0;
  let out = '';
  const modes: string[] = [];
  let pressed: [number, number] | null = null;
  let lcd: LcdFrame | null = null;
  /** todo lo que ha mostrado la primera fila del LCD */
  const history: string[] = [];
  const hal: Hal = {
    millis: () => t,
    micros: () => t * 1000,
    pinMode: (p, m) => modes.push(`${p}:${m}`),
    digitalWrite: () => {},
    digitalRead: () => 0,
    analogMilliVolts: () => 0,
    pwm: () => {},
    pwmStop: () => {},
    tone: () => {},
    noTone: () => {},
    servo: () => {},
    serialWrite: (s) => (out += s),
    serialAvailable: () => 0,
    serialRead: () => -1,
    serialPeek: () => -1,
    i2cBegin: () => {},
    i2cProbe: (addr) => addr === 0x27,
    oledShow: () => {},
    lcdShow: (_addr, f) => {
      lcd = f;
      history.push(String.fromCharCode(...f.ddram[0].slice(0, 16)));
    },
    keypadScan: () => (pressed ? [pressed] : []),
    pulseIn: () => 0,
    attachInterrupt: () => {},
    detachInterrupt: () => {},
    warn: () => {},
  };
  const line = (r: number) => (lcd ? String.fromCharCode(...lcd.ddram[r].slice(lcd.shift, lcd.shift + 16)) : '');
  return {
    hal,
    modes,
    out: () => out,
    lcdText: () => [line(0), line(1)],
    history,
    press: (k: [number, number] | null) => (pressed = k),
    tick: (ms: number) => (t += ms),
    now: () => t,
  };
}

/** Ejecuta el programa hasta que el reloj simulado llegue a `until` ms */
function runUntil(g: Generator<unknown, void, void>, m: ReturnType<typeof lcdHal>, until: number) {
  while (m.now() < until) {
    const r = g.next();
    if (r.done) return;
    if (r.value instanceof Sleep) m.tick(Math.max(r.value.ms, 0.01));
    else if (r.value === TICK) m.tick(10);
  }
}

const KEYS: Record<string, [number, number]> = {
  '1': [0, 0], '2': [0, 1], '3': [0, 2], A: [0, 3],
  '4': [1, 0], '5': [1, 1], '6': [1, 2], B: [1, 3],
  '7': [2, 0], '8': [2, 1], '9': [2, 2], C: [2, 3],
  '*': [3, 0], '0': [3, 1], '#': [3, 2], D: [3, 3],
};

function start(src: string) {
  const res = compile(src, ESP32_BOARD_INFO);
  const errors = res.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
  const m = lcdHal();
  const g = new Interpreter(res.program!, m.hal).main();
  let t = 0;
  const type = (keys: string) => {
    for (const k of keys) {
      m.press(KEYS[k]);
      t = m.now() + 60;
      runUntil(g, m, t);
      m.press(null);
      t = m.now() + 60;
      runUntil(g, m, t);
    }
  };
  return { m, g, type, wait: (ms: number) => runUntil(g, m, m.now() + ms) };
}

describe('arrays 2D y Keypad', () => {
  it('declara, lee y escribe arrays de dos dimensiones', () => {
    const { m, wait } = start(`
      char t[2][3] = {{'a', 'b', 'c'}, {'d', 'e', 'f'}};
      int n[3][2];
      void setup() {
        Serial.begin(115200);
        n[2][1] = 7;
        t[1][2] = 'z';
        Serial.print(t[0][1]); Serial.print(t[1][2]); Serial.print(n[2][1]); Serial.print(sizeof(n));
      }
      void loop() { delay(1000); }`);
    wait(10);
    expect(m.out()).toBe('bz724');
  });

  it('acepta Keypad teclado = Keypad(...) y configura filas y columnas', () => {
    const { m, type } = start(`
      #include <Keypad.h>
      const byte F = 4, C = 4;
      char k[F][C] = {{'1','2','3','A'},{'4','5','6','B'},{'7','8','9','C'},{'*','0','#','D'}};
      byte fp[F] = {1, 2, 42, 41};
      byte cp[C] = {40, 39, 47, 21};
      Keypad kp = Keypad(makeKeymap(k), fp, cp, F, C);
      void setup() { Serial.begin(115200); }
      void loop() {
        char c = kp.getKey();
        if (c != NO_KEY) Serial.print(c);
      }`);
    type('19#D*');
    expect(m.out()).toBe('19#D*');
    // filas INPUT_PULLUP (0x05) y columnas OUTPUT (0x03)
    expect(m.modes).toContain('1:5');
    expect(m.modes).toContain('21:3');
  });

  it('una tecla mantenida solo se devuelve una vez', () => {
    const { m, wait } = start(`
      #include <Keypad.h>
      char k[1][2] = {{'x', 'y'}};
      byte fp[1] = {4};
      byte cp[2] = {5, 6};
      Keypad kp(makeKeymap(k), fp, cp, 1, 2);
      void setup() { Serial.begin(115200); }
      void loop() { char c = kp.getKey(); if (c) Serial.print(c); }`);
    m.press([0, 1]);
    wait(500);
    expect(m.out()).toBe('y');
  });
});

describe('ejemplo caja fuerte', () => {
  const safe = EXAMPLES.find((e) => e.id === 'safe')!;

  it('compila sin errores ni avisos', () => {
    const res = compile(safe.project.code, ESP32_BOARD_INFO);
    expect(res.diagnostics).toEqual([]);
  });

  it('muestra los dígitos, abre con el PIN correcto y vuelve a cerrar', () => {
    const { m, type, wait } = start(safe.project.code);
    wait(50);
    expect(m.lcdText()[0]).toMatch(/^Introduce PIN:/);
    type('12');
    expect(m.lcdText()[1]).toMatch(/^12 /);
    type('34#');
    expect(m.lcdText()[0]).toMatch(/ABIERTO/);
    type('*');
    expect(m.lcdText()[0]).toMatch(/^Introduce PIN:/);
    expect(m.lcdText()[1].trim()).toBe('');
  });

  it('muestra BLOQUEADO con un PIN incorrecto y * borra lo escrito', () => {
    const { m, type, wait } = start(safe.project.code);
    wait(50);
    type('99*');
    expect(m.lcdText()[1].trim()).toBe('');
    type('0000#');
    expect(m.history.some((l) => /BLOQUEADO/.test(l))).toBe(true);
    expect(m.out()).toMatch(/PIN incorrecto\. Fallos: 1/);
    wait(2100);
    expect(m.lcdText()[0]).toMatch(/^Introduce PIN:/);
  });

  it('tras 5 fallos pide esperar 1 minuto, ignora el teclado y luego se desbloquea', () => {
    const { m, type, wait } = start(safe.project.code);
    wait(50);
    for (let i = 0; i < 5; i++) {
      type('5#');
      wait(2100);
    }
    expect(m.lcdText()[0]).toMatch(/^Espere 1 min +\d+s$/);
    wait(3000);
    expect(m.lcdText()[1]).toMatch(/volverlo|intentar|para/);
    // durante el bloqueo ni siquiera el PIN correcto abre
    type('1234#');
    expect(m.lcdText()[0]).toMatch(/^Espere 1 min/);
    wait(60_000);
    expect(m.lcdText()[0]).toMatch(/^Introduce PIN:/);
    type('1234#');
    expect(m.lcdText()[0]).toMatch(/ABIERTO/);
  });
});
