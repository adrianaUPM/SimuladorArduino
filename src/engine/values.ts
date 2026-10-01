// Valores en tiempo de ejecución e interfaz con el hardware simulado (HAL).

import type { VarType } from './ast';

export interface ObjValue {
  __obj: true;
  cls: string;
  state: any;
}
export interface ArrValue {
  __arr: true;
  items: Value[];
  elem: VarType;
}
export interface FnRef {
  __fn: true;
  name: string;
}
export type Value = number | string | ObjValue | ArrValue | FnRef;

/** Petición de suspensión del programa (delay) */
export class Sleep {
  constructor(public ms: number) {}
}

export class RuntimeError extends Error {
  constructor(message: string, public line = 0) {
    super(message);
  }
}

export const isObj = (v: Value): v is ObjValue => typeof v === 'object' && v !== null && '__obj' in v;
export const isArr = (v: Value): v is ArrValue => typeof v === 'object' && v !== null && '__arr' in v;
export const isFn = (v: Value): v is FnRef => typeof v === 'object' && v !== null && '__fn' in v;

export function toNum(v: Value): number {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = parseFloat(v);
    return Number.isNaN(n) ? 0 : n;
  }
  return 0;
}

export function wrapInt(v: number, bits = 32, unsigned = false): number {
  if (!Number.isFinite(v)) return 0;
  v = Math.trunc(v);
  if (bits >= 64) return v;
  if (bits === 32) return unsigned ? v >>> 0 : v | 0;
  const m = 2 ** bits;
  let r = ((v % m) + m) % m;
  if (!unsigned && r >= m / 2) r -= m;
  return r;
}

/** Interfaz que el intérprete usa para hablar con el circuito simulado */
export interface Hal {
  millis(): number;
  micros(): number;
  pinMode(pin: number, mode: number): void;
  digitalWrite(pin: number, value: number): void;
  digitalRead(pin: number): number;
  /** devuelve la tensión del pin en milivoltios (valida que sea ADC) */
  analogMilliVolts(pin: number): number;
  /** salida PWM: duty 0..1 */
  pwm(pin: number, duty: number, freq: number): void;
  pwmStop(pin: number): void;
  tone(pin: number, freq: number, durationMs?: number): void;
  noTone(pin: number): void;
  servo(pin: number, pulseUs: number | null): void;
  serialWrite(text: string): void;
  serialAvailable(): number;
  serialRead(): number;
  serialPeek(): number;
  i2cBegin(sda: number, scl: number): void;
  /** ¿responde un dispositivo en esta dirección del bus I2C? */
  i2cProbe(addr: number): boolean;
  oledShow(addr: number, width: number, height: number, buffer: Uint8Array, inverted: boolean): void;
  attachInterrupt(pin: number, mode: number, fn: string): void;
  detachInterrupt(pin: number): void;
  warn(message: string, line?: number): void;
}
