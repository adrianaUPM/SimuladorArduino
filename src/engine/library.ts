// Biblioteca de funciones, constantes y clases Arduino/ESP32 soportadas.
//
// Para añadir una función nueva basta con registrar una entrada en FUNCTIONS
// (o un método en CLASSES). El analizador semántico y el autocompletado del
// editor se alimentan automáticamente de estas tablas.

import type { ValType } from './ast';
import * as gfx from './gfx';
import { isArr, RuntimeError, Sleep, toNum, type Hal, type ObjValue, type Value } from './values';

export interface LibState {
  ledcChannels: Map<number, { freq: number; res: number; pins: Set<number> }>;
  ledcPins: Map<number, { freq: number; res: number }>;
  analogBits: number;
  analogWriteBits: number;
  analogWriteFreq: number;
  serialBegun: boolean;
  seed: number;
  i2c: { sda: number; scl: number; begun: boolean; txAddr: number };
}

export interface RT {
  hal: Hal;
  lib: LibState;
  warnOnce(key: string, msg: string): void;
}

export interface CallCtx {
  rt: RT;
  args: Value[];
  types: ValType[];
  line: number;
}

export interface FnDef {
  min: number;
  max: number;
  ret: ValType;
  sig: string;
  doc: string;
  call(c: CallCtx): Value | Sleep | void;
}

export interface MethodDef {
  min: number;
  max: number;
  ret: ValType;
  sig: string;
  doc: string;
  call(c: CallCtx & { self: ObjValue }): Value | Sleep | void;
}

export interface ClassDef {
  doc: string;
  include?: string;
  ctorMin: number;
  ctorMax: number;
  create(c: CallCtx): any;
  methods: Record<string, MethodDef>;
}

export function createLibState(): LibState {
  return {
    ledcChannels: new Map(),
    ledcPins: new Map(),
    analogBits: 12,
    analogWriteBits: 8,
    analogWriteFreq: 1000,
    serialBegun: false,
    seed: 12345,
    i2c: { sda: 8, scl: 9, begun: false, txAddr: -1 },
  };
}

// ------------------------------------------------------------------ constantes

const c = (value: number, t: ValType = 'int') => ({ value, t });

export const CONSTANTS: Record<string, { value: number; t: ValType }> = {
  HIGH: c(1), LOW: c(0),
  INPUT: c(0x01), OUTPUT: c(0x03), INPUT_PULLUP: c(0x05), INPUT_PULLDOWN: c(0x09), OUTPUT_OPEN_DRAIN: c(0x13),
  RISING: c(0x01), FALLING: c(0x02), CHANGE: c(0x03), ONLOW: c(0x04), ONHIGH: c(0x05),
  DEC: c(10), HEX: c(16), OCT: c(8), BIN: c(2),
  PI: c(Math.PI, 'float'), HALF_PI: c(Math.PI / 2, 'float'), TWO_PI: c(Math.PI * 2, 'float'),
  DEG_TO_RAD: c(Math.PI / 180, 'float'), RAD_TO_DEG: c(180 / Math.PI, 'float'),
  // pines por defecto del ESP32-S3 (variante esp32s3 del core Arduino)
  SDA: c(8), SCL: c(9), SS: c(10), MOSI: c(11), SCK: c(12), MISO: c(13), TX: c(43), RX: c(44),
  LED_BUILTIN: c(48), RGB_BUILTIN: c(48),
  A0: c(1), A1: c(2), A2: c(3), A3: c(4), A4: c(5), A5: c(6), A6: c(7), A7: c(8), A8: c(9), A9: c(10),
  A10: c(11), A11: c(12), A12: c(13), A13: c(14), A14: c(15), A15: c(16), A16: c(17), A17: c(18),
  A18: c(19), A19: c(20),
  // Adafruit SSD1306
  SSD1306_SWITCHCAPVCC: c(0x02), SSD1306_EXTERNALVCC: c(0x01),
  SSD1306_WHITE: c(1), SSD1306_BLACK: c(0), SSD1306_INVERSE: c(2),
  WHITE: c(1), BLACK: c(0), INVERSE: c(2),
  // atenuación ADC (se aceptan, sin efecto)
  ADC_0db: c(0), ADC_2_5db: c(1), ADC_6db: c(2), ADC_11db: c(3),
  NULL: c(0), nullptr: c(0),
};

export const GLOBAL_OBJECTS: Record<string, string> = {
  Serial: 'HardwareSerial',
  Serial0: 'HardwareSerial',
  Wire: 'TwoWire',
};

// ------------------------------------------------------------------ utilidades

export function formatValue(v: Value, t: ValType, fmt?: number): string {
  if (typeof v === 'string') return v;
  if (isArr(v)) {
    // array de char -> cadena
    return v.items.map((x) => (typeof x === 'number' && x ? String.fromCharCode(x) : '')).join('');
  }
  if (typeof v !== 'number') return '';
  if (t === 'char' && fmt === undefined) return String.fromCharCode(v);
  if (t === 'float') {
    if (Number.isNaN(v)) return 'nan';
    if (!Number.isFinite(v)) return v > 0 ? 'inf' : '-inf';
    return v.toFixed(fmt ?? 2);
  }
  const n = Math.trunc(v);
  if (fmt === 16 || fmt === 2 || fmt === 8) {
    const u = n < 0 ? n >>> 0 : n;
    return u.toString(fmt).toUpperCase();
  }
  return String(n);
}

export function printf(fmt: string, args: Value[]): string {
  let ai = 0;
  return fmt.replace(/%([-+ 0#]*)(\d+|\*)?(?:\.(\d+))?(hh|h|ll|l|z)?([diufFeEgGxXoscp%])/g, (_m, flags: string, width: string, prec: string, _len, conv: string) => {
    if (conv === '%') return '%';
    const arg = args[ai++];
    let s: string;
    switch (conv) {
      case 'd':
      case 'i':
        s = String(Math.trunc(toNum(arg)));
        break;
      case 'u':
        s = String(Math.trunc(toNum(arg)) >>> 0);
        break;
      case 'f':
      case 'F':
        s = toNum(arg).toFixed(prec !== undefined ? Number(prec) : 6);
        break;
      case 'e':
      case 'E':
        s = toNum(arg).toExponential(prec !== undefined ? Number(prec) : 6);
        if (conv === 'E') s = s.toUpperCase();
        break;
      case 'g':
      case 'G':
        s = String(Number(toNum(arg).toPrecision(prec !== undefined ? Number(prec) || 1 : 6)));
        break;
      case 'x':
        s = (Math.trunc(toNum(arg)) >>> 0).toString(16);
        break;
      case 'X':
        s = (Math.trunc(toNum(arg)) >>> 0).toString(16).toUpperCase();
        break;
      case 'o':
        s = (Math.trunc(toNum(arg)) >>> 0).toString(8);
        break;
      case 'c':
        s = String.fromCharCode(toNum(arg));
        break;
      case 's':
        s = typeof arg === 'string' ? arg : formatValue(arg ?? '', 'any');
        if (prec !== undefined) s = s.slice(0, Number(prec));
        break;
      default:
        s = String(arg);
    }
    if (flags?.includes('+') && /[dif]/i.test(conv) && !s.startsWith('-')) s = '+' + s;
    const w = width && width !== '*' ? Number(width) : 0;
    if (s.length < w) {
      if (flags?.includes('-')) s = s.padEnd(w);
      else if (flags?.includes('0') && conv !== 's') {
        const neg = s.startsWith('-');
        s = (neg ? '-' : '') + s.slice(neg ? 1 : 0).padStart(w - (neg ? 1 : 0), '0');
      } else s = s.padStart(w);
    }
    return s;
  });
}

const n = (args: Value[], i: number, def = 0) => (i < args.length ? toNum(args[i]) : def);
const int = (args: Value[], i: number, def = 0) => Math.trunc(n(args, i, def));

function rand(rt: RT): number {
  // xorshift32 determinista (randomSeed reproducible)
  let x = rt.lib.seed | 0 || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  rt.lib.seed = x;
  return (x >>> 0) / 4294967296;
}

function ledcApply(rt: RT, pin: number, duty: number) {
  const cfg = rt.lib.ledcPins.get(pin);
  if (!cfg) return;
  const max = 2 ** cfg.res - 1;
  rt.hal.pwm(pin, Math.max(0, Math.min(1, duty / max)), cfg.freq);
}

// ------------------------------------------------------------------ funciones

const f = (sig: string, doc: string, ret: ValType, min: number, max: number, call: FnDef['call']): FnDef => ({
  sig, doc, ret, min, max, call,
});

export const FUNCTIONS: Record<string, FnDef> = {
  // --- E/S digital
  pinMode: f('pinMode(pin, modo)', 'Configura un pin como INPUT, OUTPUT, INPUT_PULLUP o INPUT_PULLDOWN.', 'void', 2, 2,
    ({ rt, args }) => rt.hal.pinMode(int(args, 0), int(args, 1))),
  digitalWrite: f('digitalWrite(pin, valor)', 'Pone un pin de salida a HIGH (3.3 V) o LOW (0 V).', 'void', 2, 2,
    ({ rt, args }) => rt.hal.digitalWrite(int(args, 0), int(args, 1) ? 1 : 0)),
  digitalRead: f('digitalRead(pin)', 'Lee el nivel lógico (HIGH/LOW) de un pin de entrada.', 'int', 1, 1,
    ({ rt, args }) => rt.hal.digitalRead(int(args, 0))),

  // --- E/S analógica
  analogRead: f('analogRead(pin)', 'Lee la tensión de un pin ADC (0..4095 con 12 bits, 0..3.3 V).', 'int', 1, 1,
    ({ rt, args }) => {
      const mv = rt.hal.analogMilliVolts(int(args, 0));
      const max = 2 ** rt.lib.analogBits - 1;
      return Math.round(Math.max(0, Math.min(1, mv / 3300)) * max);
    }),
  analogReadMilliVolts: f('analogReadMilliVolts(pin)', 'Lee la tensión de un pin ADC en milivoltios.', 'int', 1, 1,
    ({ rt, args }) => Math.round(Math.max(0, Math.min(3300, rt.hal.analogMilliVolts(int(args, 0)))))),
  analogReadResolution: f('analogReadResolution(bits)', 'Resolución del ADC (9..12 bits).', 'void', 1, 1,
    ({ rt, args }) => {
      rt.lib.analogBits = Math.max(1, Math.min(16, int(args, 0)));
    }),
  analogSetAttenuation: f('analogSetAttenuation(att)', 'Atenuación del ADC (sin efecto en el simulador).', 'void', 1, 1, () => {}),
  analogSetPinAttenuation: f('analogSetPinAttenuation(pin, att)', 'Atenuación del ADC (sin efecto en el simulador).', 'void', 2, 2, () => {}),
  analogWrite: f('analogWrite(pin, valor)', 'Salida PWM (0..255 por defecto).', 'void', 2, 2,
    ({ rt, args }) => {
      const max = 2 ** rt.lib.analogWriteBits - 1;
      rt.hal.pwm(int(args, 0), Math.max(0, Math.min(1, n(args, 1) / max)), rt.lib.analogWriteFreq);
    }),
  analogWriteResolution: f('analogWriteResolution(bits)', 'Resolución de analogWrite().', 'void', 1, 2,
    ({ rt, args }) => {
      rt.lib.analogWriteBits = int(args, args.length - 1);
    }),
  analogWriteFrequency: f('analogWriteFrequency(freq)', 'Frecuencia de analogWrite().', 'void', 1, 2,
    ({ rt, args }) => {
      rt.lib.analogWriteFreq = n(args, args.length - 1);
    }),

  // --- PWM LEDC (API core 3.x y core 2.x)
  ledcAttach: f('ledcAttach(pin, freq, resolución)', 'Core 3.x: asocia un pin al PWM LEDC.', 'bool', 3, 3,
    ({ rt, args }) => {
      const pin = int(args, 0);
      rt.hal.pinMode(pin, 0x03);
      rt.lib.ledcPins.set(pin, { freq: n(args, 1), res: int(args, 2) });
      rt.hal.pwm(pin, 0, n(args, 1));
      return 1;
    }),
  ledcAttachChannel: f('ledcAttachChannel(pin, freq, resolución, canal)', 'Core 3.x: asocia un pin a un canal LEDC concreto.', 'bool', 4, 4,
    ({ rt, args }) => {
      const pin = int(args, 0);
      rt.hal.pinMode(pin, 0x03);
      rt.lib.ledcPins.set(pin, { freq: n(args, 1), res: int(args, 2) });
      rt.hal.pwm(pin, 0, n(args, 1));
      return 1;
    }),
  ledcSetup: f('ledcSetup(canal, freq, resolución)', 'Core 2.x: configura un canal LEDC.', 'float', 3, 3,
    ({ rt, args }) => {
      const ch = int(args, 0);
      if (ch < 0 || ch > 7) throw new RuntimeError(`El ESP32-S3 tiene 8 canales LEDC (0..7); el canal ${ch} no existe`);
      const prev = rt.lib.ledcChannels.get(ch);
      rt.lib.ledcChannels.set(ch, { freq: n(args, 1), res: int(args, 2), pins: prev?.pins ?? new Set() });
      return n(args, 1);
    }),
  ledcAttachPin: f('ledcAttachPin(pin, canal)', 'Core 2.x: asocia un pin a un canal LEDC.', 'void', 2, 2,
    ({ rt, args }) => {
      const pin = int(args, 0);
      const ch = int(args, 1);
      const chan = rt.lib.ledcChannels.get(ch);
      if (!chan) throw new RuntimeError(`El canal LEDC ${ch} no está configurado: llama antes a ledcSetup()`);
      rt.hal.pinMode(pin, 0x03);
      chan.pins.add(pin);
      rt.lib.ledcPins.set(pin, { freq: chan.freq, res: chan.res });
      rt.hal.pwm(pin, 0, chan.freq);
    }),
  ledcWrite: f('ledcWrite(pin|canal, duty)', 'Fija el ciclo de trabajo PWM (0..2^resolución-1).', 'bool', 2, 2,
    ({ rt, args }) => {
      const id = int(args, 0);
      const duty = n(args, 1);
      // core 2.x: el primer argumento es el canal
      const chan = rt.lib.ledcChannels.get(id);
      if (chan && chan.pins.size > 0) {
        chan.pins.forEach((p) => ledcApply(rt, p, duty));
        return 1;
      }
      if (rt.lib.ledcPins.has(id)) {
        ledcApply(rt, id, duty);
        return 1;
      }
      throw new RuntimeError(
        `ledcWrite(${id}, ...): el pin/canal no está configurado. Usa ledcAttach(pin, freq, bits) (core 3.x) o ledcSetup + ledcAttachPin (core 2.x)`,
      );
    }),
  ledcWriteTone: f('ledcWriteTone(pin|canal, freq)', 'Genera un tono (50 % duty) en un pin LEDC.', 'float', 2, 2,
    ({ rt, args }) => {
      const id = int(args, 0);
      const chan = rt.lib.ledcChannels.get(id);
      const pins = chan && chan.pins.size ? [...chan.pins] : [id];
      pins.forEach((p) => (n(args, 1) > 0 ? rt.hal.tone(p, n(args, 1)) : rt.hal.noTone(p)));
      return n(args, 1);
    }),
  ledcDetach: f('ledcDetach(pin)', 'Libera el PWM de un pin.', 'bool', 1, 1,
    ({ rt, args }) => {
      rt.lib.ledcPins.delete(int(args, 0));
      rt.hal.pwmStop(int(args, 0));
      return 1;
    }),
  ledcDetachPin: f('ledcDetachPin(pin)', 'Core 2.x: libera el PWM de un pin.', 'void', 1, 1,
    ({ rt, args }) => {
      rt.lib.ledcPins.delete(int(args, 0));
      rt.lib.ledcChannels.forEach((ch) => ch.pins.delete(int(args, 0)));
      rt.hal.pwmStop(int(args, 0));
    }),
  tone: f('tone(pin, frecuencia[, duración])', 'Genera una onda cuadrada (buzzer pasivo).', 'void', 2, 3,
    ({ rt, args }) => rt.hal.tone(int(args, 0), n(args, 1), args.length > 2 ? n(args, 2) : undefined)),
  noTone: f('noTone(pin)', 'Detiene el tono.', 'void', 1, 1, ({ rt, args }) => rt.hal.noTone(int(args, 0))),

  // --- tiempo
  delay: f('delay(ms)', 'Pausa el programa los milisegundos indicados.', 'void', 1, 1,
    ({ args }) => new Sleep(Math.max(0, n(args, 0)))),
  delayMicroseconds: f('delayMicroseconds(us)', 'Pausa en microsegundos.', 'void', 1, 1,
    ({ args }) => new Sleep(Math.max(0, n(args, 0)) / 1000)),
  millis: f('millis()', 'Milisegundos desde el arranque.', 'int', 0, 0, ({ rt }) => Math.floor(rt.hal.millis())),
  micros: f('micros()', 'Microsegundos desde el arranque.', 'int', 0, 0, ({ rt }) => Math.floor(rt.hal.micros())),
  yield: f('yield()', 'Cede el control.', 'void', 0, 0, () => new Sleep(0)),

  // --- matemáticas
  map: f('map(x, inMin, inMax, outMin, outMax)', 'Reescala un valor de un rango a otro (aritmética entera).', 'int', 5, 5,
    ({ args }) => {
      const [x, a, b, cc, d] = [0, 1, 2, 3, 4].map((i) => Math.trunc(n(args, i)));
      if (b === a) throw new RuntimeError('map(): el rango de entrada no puede ser vacío (inMin == inMax)');
      return Math.trunc(((x - a) * (d - cc)) / (b - a)) + cc;
    }),
  constrain: f('constrain(x, min, max)', 'Limita un valor a un rango.', 'any', 3, 3,
    ({ args }) => Math.min(Math.max(n(args, 0), n(args, 1)), n(args, 2))),
  min: f('min(a, b)', 'Mínimo.', 'any', 2, 2, ({ args }) => Math.min(n(args, 0), n(args, 1))),
  max: f('max(a, b)', 'Máximo.', 'any', 2, 2, ({ args }) => Math.max(n(args, 0), n(args, 1))),
  abs: f('abs(x)', 'Valor absoluto.', 'any', 1, 1, ({ args }) => Math.abs(n(args, 0))),
  sq: f('sq(x)', 'Cuadrado.', 'any', 1, 1, ({ args }) => n(args, 0) ** 2),
  sqrt: f('sqrt(x)', 'Raíz cuadrada.', 'float', 1, 1, ({ args }) => Math.sqrt(n(args, 0))),
  pow: f('pow(base, exp)', 'Potencia.', 'float', 2, 2, ({ args }) => n(args, 0) ** n(args, 1)),
  sin: f('sin(rad)', 'Seno.', 'float', 1, 1, ({ args }) => Math.sin(n(args, 0))),
  cos: f('cos(rad)', 'Coseno.', 'float', 1, 1, ({ args }) => Math.cos(n(args, 0))),
  tan: f('tan(rad)', 'Tangente.', 'float', 1, 1, ({ args }) => Math.tan(n(args, 0))),
  atan2: f('atan2(y, x)', 'Arcotangente de y/x.', 'float', 2, 2, ({ args }) => Math.atan2(n(args, 0), n(args, 1))),
  log: f('log(x)', 'Logaritmo natural.', 'float', 1, 1, ({ args }) => Math.log(n(args, 0))),
  log10: f('log10(x)', 'Logaritmo en base 10.', 'float', 1, 1, ({ args }) => Math.log10(n(args, 0))),
  exp: f('exp(x)', 'Exponencial.', 'float', 1, 1, ({ args }) => Math.exp(n(args, 0))),
  floor: f('floor(x)', 'Redondeo hacia abajo.', 'float', 1, 1, ({ args }) => Math.floor(n(args, 0))),
  ceil: f('ceil(x)', 'Redondeo hacia arriba.', 'float', 1, 1, ({ args }) => Math.ceil(n(args, 0))),
  round: f('round(x)', 'Redondeo al entero más próximo.', 'int', 1, 1, ({ args }) => Math.round(n(args, 0))),
  fabs: f('fabs(x)', 'Valor absoluto (float).', 'float', 1, 1, ({ args }) => Math.abs(n(args, 0))),
  random: f('random([min,] max)', 'Número pseudoaleatorio en [min, max).', 'int', 1, 2,
    ({ rt, args }) => {
      const lo = args.length === 2 ? n(args, 0) : 0;
      const hi = args.length === 2 ? n(args, 1) : n(args, 0);
      if (hi <= lo) return lo;
      return Math.floor(lo + rand(rt) * (hi - lo));
    }),
  randomSeed: f('randomSeed(semilla)', 'Inicializa el generador aleatorio.', 'void', 1, 1,
    ({ rt, args }) => {
      rt.lib.seed = int(args, 0) || 1;
    }),
  bitRead: f('bitRead(x, n)', 'Lee el bit n de x.', 'int', 2, 2, ({ args }) => (int(args, 0) >> int(args, 1)) & 1),
  bit: f('bit(n)', 'Valor del bit n (1 << n).', 'int', 1, 1, ({ args }) => 2 ** int(args, 0)),
  lowByte: f('lowByte(x)', 'Byte bajo.', 'int', 1, 1, ({ args }) => int(args, 0) & 0xff),
  highByte: f('highByte(x)', 'Byte alto.', 'int', 1, 1, ({ args }) => (int(args, 0) >> 8) & 0xff),
  isDigit: f('isDigit(c)', '¿Es un dígito?', 'bool', 1, 1, ({ args }) => (/[0-9]/.test(String.fromCharCode(int(args, 0))) ? 1 : 0)),
  isAlpha: f('isAlpha(c)', '¿Es una letra?', 'bool', 1, 1, ({ args }) => (/[A-Za-z]/.test(String.fromCharCode(int(args, 0))) ? 1 : 0)),

  // --- interrupciones
  digitalPinToInterrupt: f('digitalPinToInterrupt(pin)', 'Número de interrupción de un pin (en ESP32 es el propio pin).', 'int', 1, 1,
    ({ args }) => int(args, 0)),
  attachInterrupt: f('attachInterrupt(pin, función, modo)', 'Ejecuta una función cuando cambia un pin (RISING, FALLING, CHANGE).', 'void', 3, 3,
    ({ rt, args, line }) => {
      const fn = args[1];
      if (typeof fn !== 'object' || !('__fn' in fn)) throw new RuntimeError('attachInterrupt: el segundo argumento debe ser el nombre de una función', line);
      rt.hal.attachInterrupt(int(args, 0), int(args, 2), fn.name);
    }),
  detachInterrupt: f('detachInterrupt(pin)', 'Desactiva la interrupción de un pin.', 'void', 1, 1,
    ({ rt, args }) => rt.hal.detachInterrupt(int(args, 0))),
  interrupts: f('interrupts()', 'Habilita interrupciones.', 'void', 0, 0, () => {}),
  noInterrupts: f('noInterrupts()', 'Deshabilita interrupciones.', 'void', 0, 0, () => {}),

  // --- varios
  F: f('F("texto")', 'Macro para guardar cadenas en flash (sin efecto).', 'string', 1, 1, ({ args }) => args[0]),
  temperatureRead: f('temperatureRead()', 'Temperatura interna del chip (°C, aproximada).', 'float', 0, 0, () => 42.5),
};

// ------------------------------------------------------------------ clases

const m = (sig: string, doc: string, ret: ValType, min: number, max: number, call: MethodDef['call']): MethodDef => ({
  sig, doc, ret, min, max, call,
});

function serialPrint(cx: CallCtx, newline: boolean) {
  const { rt, args, types } = cx;
  if (!rt.lib.serialBegun) rt.warnOnce('serial-begin', 'Usas Serial antes de Serial.begin(): en una placa real podrías no ver nada.');
  let text = args.length ? formatValue(args[0], types[0], args.length > 1 ? int(args, 1) : undefined) : '';
  if (newline) text += '\r\n';
  rt.hal.serialWrite(text);
}

function parseNumberFromSerial(rt: RT, float: boolean): number {
  let s = '';
  // salta caracteres no numéricos
  while (rt.hal.serialAvailable() > 0) {
    const ch = String.fromCharCode(rt.hal.serialPeek());
    if (/[0-9-]/.test(ch) || (float && ch === '.')) break;
    rt.hal.serialRead();
  }
  while (rt.hal.serialAvailable() > 0) {
    const ch = String.fromCharCode(rt.hal.serialPeek());
    if (!(/[0-9]/.test(ch) || (s === '' && ch === '-') || (float && ch === '.'))) break;
    s += ch;
    rt.hal.serialRead();
  }
  const v = float ? parseFloat(s) : parseInt(s, 10);
  return Number.isNaN(v) ? 0 : v;
}

const oled = (self: ObjValue) => self.state as gfx.GfxState & { addr: number; began: boolean };

function oledText(cx: CallCtx & { self: ObjValue }, newline: boolean) {
  const g = oled(cx.self);
  let text = cx.args.length ? formatValue(cx.args[0], cx.types[0], cx.args.length > 1 ? int(cx.args, 1) : undefined) : '';
  if (newline) text += '\n';
  gfx.writeText(g, text);
}

export const CLASSES: Record<string, ClassDef> = {
  HardwareSerial: {
    doc: 'Puerto serie (USB/UART0).',
    ctorMin: 0,
    ctorMax: 0,
    create: () => ({}),
    methods: {
      begin: m('Serial.begin(baudios)', 'Inicia el puerto serie (p. ej. 115200).', 'void', 1, 4,
        ({ rt }) => {
          rt.lib.serialBegun = true;
        }),
      end: m('Serial.end()', 'Cierra el puerto serie.', 'void', 0, 0, ({ rt }) => {
        rt.lib.serialBegun = false;
      }),
      print: m('Serial.print(valor[, formato])', 'Envía un valor por el puerto serie.', 'int', 0, 2, (cx) => serialPrint(cx, false)),
      println: m('Serial.println(valor[, formato])', 'Envía un valor y un salto de línea.', 'int', 0, 2, (cx) => serialPrint(cx, true)),
      printf: m('Serial.printf(formato, ...)', 'Salida con formato estilo C (%d, %f, %s...).', 'int', 1, 16,
        ({ rt, args }) => {
          if (!rt.lib.serialBegun) rt.warnOnce('serial-begin', 'Usas Serial antes de Serial.begin().');
          rt.hal.serialWrite(printf(String(args[0]), args.slice(1)));
        }),
      write: m('Serial.write(byte)', 'Envía un byte.', 'int', 1, 1,
        ({ rt, args }) => rt.hal.serialWrite(typeof args[0] === 'string' ? args[0] : String.fromCharCode(int(args, 0)))),
      available: m('Serial.available()', 'Bytes recibidos pendientes de leer.', 'int', 0, 0, ({ rt }) => rt.hal.serialAvailable()),
      read: m('Serial.read()', 'Lee un byte (-1 si no hay datos).', 'int', 0, 0, ({ rt }) => rt.hal.serialRead()),
      peek: m('Serial.peek()', 'Mira el siguiente byte sin consumirlo.', 'int', 0, 0, ({ rt }) => rt.hal.serialPeek()),
      readString: m('Serial.readString()', 'Lee todo lo recibido como String.', 'string', 0, 0,
        ({ rt }) => {
          let s = '';
          while (rt.hal.serialAvailable() > 0) s += String.fromCharCode(rt.hal.serialRead());
          return s;
        }),
      readStringUntil: m("Serial.readStringUntil('\\n')", 'Lee hasta el carácter indicado.', 'string', 1, 1,
        ({ rt, args }) => {
          const stop = int(args, 0);
          let s = '';
          while (rt.hal.serialAvailable() > 0) {
            const ch = rt.hal.serialRead();
            if (ch === stop) break;
            s += String.fromCharCode(ch);
          }
          return s;
        }),
      parseInt: m('Serial.parseInt()', 'Lee un entero de la entrada.', 'int', 0, 0, ({ rt }) => parseNumberFromSerial(rt, false)),
      parseFloat: m('Serial.parseFloat()', 'Lee un número decimal de la entrada.', 'float', 0, 0, ({ rt }) => parseNumberFromSerial(rt, true)),
      flush: m('Serial.flush()', 'Espera a que se envíe todo.', 'void', 0, 0, () => {}),
      setTimeout: m('Serial.setTimeout(ms)', 'Tiempo de espera de lectura.', 'void', 1, 1, () => {}),
    },
  },

  TwoWire: {
    doc: 'Bus I2C (Wire).',
    include: 'Wire.h',
    ctorMin: 0,
    ctorMax: 1,
    create: () => ({}),
    methods: {
      begin: m('Wire.begin([sda, scl])', 'Inicia el bus I2C (por defecto SDA=GPIO8, SCL=GPIO9).', 'bool', 0, 3,
        ({ rt, args }) => {
          const sda = args.length >= 2 ? int(args, 0) : 8;
          const scl = args.length >= 2 ? int(args, 1) : 9;
          rt.lib.i2c = { ...rt.lib.i2c, sda, scl, begun: true };
          rt.hal.i2cBegin(sda, scl);
          return 1;
        }),
      setClock: m('Wire.setClock(hz)', 'Frecuencia del bus I2C.', 'void', 1, 1, () => {}),
      beginTransmission: m('Wire.beginTransmission(dir)', 'Comienza una transmisión a un dispositivo.', 'void', 1, 1,
        ({ rt, args }) => {
          rt.lib.i2c.txAddr = int(args, 0);
        }),
      write: m('Wire.write(byte)', 'Escribe un byte en el bus.', 'int', 1, 2, () => 1),
      endTransmission: m('Wire.endTransmission()', 'Termina la transmisión. Devuelve 0 si el dispositivo respondió (ACK).', 'int', 0, 1,
        ({ rt }) => {
          if (!rt.lib.i2c.begun) throw new RuntimeError('Llama a Wire.begin() antes de usar el bus I2C');
          return rt.hal.i2cProbe(rt.lib.i2c.txAddr) ? 0 : 2;
        }),
      requestFrom: m('Wire.requestFrom(dir, n)', 'Solicita bytes a un dispositivo.', 'int', 2, 3, () => 0),
      available: m('Wire.available()', 'Bytes disponibles.', 'int', 0, 0, () => 0),
      read: m('Wire.read()', 'Lee un byte.', 'int', 0, 0, () => -1),
    },
  },

  Servo: {
    doc: 'Servomotor (librería ESP32Servo).',
    include: 'ESP32Servo.h',
    ctorMin: 0,
    ctorMax: 0,
    create: () => ({ pin: -1, min: 500, max: 2500, us: 1500 }),
    methods: {
      attach: m('servo.attach(pin[, minUs, maxUs])', 'Asocia el servo a un pin PWM.', 'int', 1, 3,
        ({ rt, args, self }) => {
          const s = self.state;
          s.pin = int(args, 0);
          if (args.length >= 3) {
            s.min = int(args, 1);
            s.max = int(args, 2);
          }
          rt.hal.pinMode(s.pin, 0x03);
          rt.hal.servo(s.pin, s.us);
          return 1;
        }),
      detach: m('servo.detach()', 'Libera el pin del servo.', 'void', 0, 0,
        ({ rt, self }) => {
          if (self.state.pin >= 0) rt.hal.servo(self.state.pin, null);
          self.state.pin = -1;
        }),
      write: m('servo.write(ángulo)', 'Mueve el servo a un ángulo (0..180°).', 'void', 1, 1,
        ({ rt, args, self }) => {
          const s = self.state;
          let v = n(args, 0);
          if (v < s.min) {
            v = Math.max(0, Math.min(180, v));
            s.us = s.min + ((s.max - s.min) * v) / 180;
          } else s.us = v;
          if (s.pin < 0) throw new RuntimeError('servo.write(): el servo no está asociado a ningún pin (falta attach)');
          rt.hal.servo(s.pin, s.us);
        }),
      writeMicroseconds: m('servo.writeMicroseconds(us)', 'Ancho de pulso en microsegundos (500..2500).', 'void', 1, 1,
        ({ rt, args, self }) => {
          self.state.us = n(args, 0);
          if (self.state.pin < 0) throw new RuntimeError('El servo no está asociado a ningún pin (falta attach)');
          rt.hal.servo(self.state.pin, self.state.us);
        }),
      read: m('servo.read()', 'Último ángulo escrito.', 'int', 0, 0,
        ({ self }) => Math.round(((self.state.us - self.state.min) * 180) / (self.state.max - self.state.min))),
      readMicroseconds: m('servo.readMicroseconds()', 'Último pulso escrito.', 'int', 0, 0, ({ self }) => self.state.us),
      attached: m('servo.attached()', '¿Está asociado a un pin?', 'bool', 0, 0, ({ self }) => (self.state.pin >= 0 ? 1 : 0)),
      setPeriodHertz: m('servo.setPeriodHertz(hz)', 'Frecuencia del servo (normalmente 50 Hz).', 'void', 1, 1, () => {}),
    },
  },

  Adafruit_SSD1306: {
    doc: 'Pantalla OLED SSD1306 por I2C (librería Adafruit).',
    include: 'Adafruit_SSD1306.h',
    ctorMin: 0,
    ctorMax: 4,
    create: ({ args }) => {
      const w = args.length >= 2 ? int(args, 0) : 128;
      const h = args.length >= 2 ? int(args, 1) : 64;
      return { ...gfx.createGfx(w, h), addr: 0x3c, began: false };
    },
    methods: {
      begin: m('display.begin(SSD1306_SWITCHCAPVCC, 0x3C)', 'Inicia la pantalla. Devuelve false si no responde en el bus I2C.', 'bool', 0, 4,
        ({ rt, args, self }) => {
          const g = oled(self);
          g.addr = args.length >= 2 ? int(args, 1) : 0x3c;
          if (!rt.lib.i2c.begun) {
            rt.lib.i2c.begun = true;
            rt.hal.i2cBegin(rt.lib.i2c.sda, rt.lib.i2c.scl);
          }
          g.began = rt.hal.i2cProbe(g.addr);
          if (!g.began) rt.warnOnce('oled-' + g.addr, `No hay ninguna pantalla respondiendo en 0x${g.addr.toString(16).toUpperCase()} (revisa SDA/SCL/VCC/GND y la dirección).`);
          return g.began ? 1 : 0;
        }),
      display: m('display.display()', 'Envía el buffer a la pantalla.', 'void', 0, 0,
        ({ rt, self }) => {
          const g = oled(self);
          if (!g.began) return;
          rt.hal.oledShow(g.addr, g.w, g.h, g.buf.slice(), g.inverted);
        }),
      clearDisplay: m('display.clearDisplay()', 'Borra el buffer.', 'void', 0, 0, ({ self }) => {
        oled(self).buf.fill(0);
        oled(self).cursorX = 0;
        oled(self).cursorY = 0;
      }),
      fillScreen: m('display.fillScreen(color)', 'Rellena toda la pantalla.', 'void', 1, 1, ({ self, args }) => {
        oled(self).buf.fill(int(args, 0) ? 1 : 0);
      }),
      invertDisplay: m('display.invertDisplay(bool)', 'Invierte los colores.', 'void', 1, 1,
        ({ rt, self, args }) => {
          const g = oled(self);
          g.inverted = !!int(args, 0);
          if (g.began) rt.hal.oledShow(g.addr, g.w, g.h, g.buf.slice(), g.inverted);
        }),
      drawPixel: m('display.drawPixel(x, y, color)', 'Dibuja un píxel.', 'void', 3, 3,
        ({ self, args }) => gfx.pixel(oled(self), n(args, 0), n(args, 1), int(args, 2))),
      drawLine: m('display.drawLine(x0, y0, x1, y1, color)', 'Dibuja una línea.', 'void', 5, 5,
        ({ self, args }) => gfx.line(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), int(args, 4))),
      drawFastHLine: m('display.drawFastHLine(x, y, w, color)', 'Línea horizontal.', 'void', 4, 4,
        ({ self, args }) => gfx.fillRect(oled(self), n(args, 0), n(args, 1), n(args, 2), 1, int(args, 3))),
      drawFastVLine: m('display.drawFastVLine(x, y, h, color)', 'Línea vertical.', 'void', 4, 4,
        ({ self, args }) => gfx.fillRect(oled(self), n(args, 0), n(args, 1), 1, n(args, 2), int(args, 3))),
      drawRect: m('display.drawRect(x, y, w, h, color)', 'Rectángulo.', 'void', 5, 5,
        ({ self, args }) => gfx.rect(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), int(args, 4))),
      fillRect: m('display.fillRect(x, y, w, h, color)', 'Rectángulo relleno.', 'void', 5, 5,
        ({ self, args }) => gfx.fillRect(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), int(args, 4))),
      drawRoundRect: m('display.drawRoundRect(x, y, w, h, r, color)', 'Rectángulo redondeado.', 'void', 6, 6,
        ({ self, args }) => gfx.roundRect(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), int(args, 5), false)),
      fillRoundRect: m('display.fillRoundRect(x, y, w, h, r, color)', 'Rectángulo redondeado relleno.', 'void', 6, 6,
        ({ self, args }) => gfx.roundRect(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), int(args, 5), true)),
      drawCircle: m('display.drawCircle(x, y, r, color)', 'Circunferencia.', 'void', 4, 4,
        ({ self, args }) => gfx.circle(oled(self), n(args, 0), n(args, 1), n(args, 2), int(args, 3), false)),
      fillCircle: m('display.fillCircle(x, y, r, color)', 'Círculo relleno.', 'void', 4, 4,
        ({ self, args }) => gfx.circle(oled(self), n(args, 0), n(args, 1), n(args, 2), int(args, 3), true)),
      drawTriangle: m('display.drawTriangle(x0, y0, x1, y1, x2, y2, color)', 'Triángulo.', 'void', 7, 7,
        ({ self, args }) => gfx.triangle(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), n(args, 5), int(args, 6), false)),
      fillTriangle: m('display.fillTriangle(x0, y0, x1, y1, x2, y2, color)', 'Triángulo relleno.', 'void', 7, 7,
        ({ self, args }) => gfx.triangle(oled(self), n(args, 0), n(args, 1), n(args, 2), n(args, 3), n(args, 4), n(args, 5), int(args, 6), true)),
      setTextSize: m('display.setTextSize(n)', 'Tamaño del texto (1 = 6x8 px).', 'void', 1, 2,
        ({ self, args }) => {
          oled(self).textSize = Math.max(1, int(args, 0));
        }),
      setTextColor: m('display.setTextColor(color[, fondo])', 'Color del texto.', 'void', 1, 2,
        ({ self, args }) => {
          oled(self).textColor = int(args, 0);
          oled(self).textBg = args.length > 1 ? int(args, 1) : -1;
        }),
      setCursor: m('display.setCursor(x, y)', 'Posición del cursor de texto.', 'void', 2, 2,
        ({ self, args }) => {
          oled(self).cursorX = int(args, 0);
          oled(self).cursorY = int(args, 1);
        }),
      setTextWrap: m('display.setTextWrap(bool)', 'Ajuste de línea automático.', 'void', 1, 1,
        ({ self, args }) => {
          oled(self).wrap = !!int(args, 0);
        }),
      print: m('display.print(valor)', 'Escribe texto en el buffer.', 'int', 1, 2, (cx) => oledText(cx, false)),
      println: m('display.println(valor)', 'Escribe texto y salto de línea.', 'int', 0, 2, (cx) => oledText(cx, true)),
      write: m('display.write(c)', 'Escribe un carácter.', 'int', 1, 1,
        ({ self, args }) => gfx.writeText(oled(self), typeof args[0] === 'string' ? args[0] : String.fromCharCode(int(args, 0)))),
      cp437: m('display.cp437(bool)', 'Juego de caracteres (sin efecto).', 'void', 0, 1, () => {}),
      dim: m('display.dim(bool)', 'Atenúa el brillo (sin efecto).', 'void', 1, 1, () => {}),
      setRotation: m('display.setRotation(r)', 'Rotación (solo 0 soportado).', 'void', 1, 1,
        ({ rt, args }) => {
          if (int(args, 0) !== 0) rt.warnOnce('oled-rot', 'setRotation() distinto de 0 no está soportado en el simulador.');
        }),
      width: m('display.width()', 'Ancho en píxeles.', 'int', 0, 0, ({ self }) => oled(self).w),
      height: m('display.height()', 'Alto en píxeles.', 'int', 0, 0, ({ self }) => oled(self).h),
      getCursorX: m('display.getCursorX()', 'Cursor X.', 'int', 0, 0, ({ self }) => oled(self).cursorX),
      getCursorY: m('display.getCursorY()', 'Cursor Y.', 'int', 0, 0, ({ self }) => oled(self).cursorY),
      startscrollright: m('display.startscrollright(a, b)', 'Scroll (sin efecto).', 'void', 2, 2, () => {}),
      startscrollleft: m('display.startscrollleft(a, b)', 'Scroll (sin efecto).', 'void', 2, 2, () => {}),
      stopscroll: m('display.stopscroll()', 'Detiene scroll.', 'void', 0, 0, () => {}),
    },
  },
};

// ------------------------------------------------------------------ String

export interface StringMethod {
  min: number;
  max: number;
  ret: ValType;
  /** si es true, el resultado sustituye al contenido de la variable */
  mutates?: boolean;
  doc: string;
  call(s: string, args: Value[]): Value;
}

const sm = (doc: string, ret: ValType, min: number, max: number, call: StringMethod['call'], mutates = false): StringMethod => ({
  doc, ret, min, max, call, mutates,
});

export const STRING_METHODS: Record<string, StringMethod> = {
  length: sm('Longitud', 'int', 0, 0, (s) => s.length),
  toInt: sm('Convierte a entero', 'int', 0, 0, (s) => parseInt(s, 10) || 0),
  toFloat: sm('Convierte a float', 'float', 0, 0, (s) => parseFloat(s) || 0),
  charAt: sm('Carácter en la posición', 'char', 1, 1, (s, a) => s.charCodeAt(toNum(a[0])) || 0),
  indexOf: sm('Posición de una subcadena', 'int', 1, 2, (s, a) =>
    s.indexOf(typeof a[0] === 'string' ? a[0] : String.fromCharCode(toNum(a[0])), a.length > 1 ? toNum(a[1]) : 0)),
  substring: sm('Subcadena', 'string', 1, 2, (s, a) => s.substring(toNum(a[0]), a.length > 1 ? toNum(a[1]) : undefined)),
  startsWith: sm('¿Empieza por?', 'bool', 1, 1, (s, a) => (s.startsWith(String(a[0])) ? 1 : 0)),
  endsWith: sm('¿Termina en?', 'bool', 1, 1, (s, a) => (s.endsWith(String(a[0])) ? 1 : 0)),
  equals: sm('¿Es igual?', 'bool', 1, 1, (s, a) => (s === String(a[0]) ? 1 : 0)),
  equalsIgnoreCase: sm('¿Igual sin mayúsculas?', 'bool', 1, 1, (s, a) => (s.toLowerCase() === String(a[0]).toLowerCase() ? 1 : 0)),
  isEmpty: sm('¿Está vacía?', 'bool', 0, 0, (s) => (s.length === 0 ? 1 : 0)),
  c_str: sm('Cadena C', 'string', 0, 0, (s) => s),
  toUpperCase: sm('Pasa a mayúsculas', 'void', 0, 0, (s) => s.toUpperCase(), true),
  toLowerCase: sm('Pasa a minúsculas', 'void', 0, 0, (s) => s.toLowerCase(), true),
  trim: sm('Elimina espacios', 'void', 0, 0, (s) => s.trim(), true),
  replace: sm('Reemplaza', 'void', 2, 2, (s, a) => s.split(String(a[0])).join(String(a[1])), true),
  concat: sm('Concatena', 'bool', 1, 1, (s, a) => s + formatValue(a[0], 'any'), true),
};
