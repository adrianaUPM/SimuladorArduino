// Placa ESP32-S3 simulada: implementa la HAL que usa el intérprete y expone
// el estado de los pines al solver del circuito.

import { gpioExists, isAdc } from '../devices/esp32s3/pins';
import type { BoardView, OledFrame, PinState } from '../devices/types';
import type { SimClock } from '../engine/runner';
import { RuntimeError, type Hal } from '../engine/values';

export interface BoardHost {
  clock: SimClock;
  /** tensión del GPIO y si su net tiene un nivel definido */
  pinVoltage(gpio: number): { v: number; driven: boolean; connected: boolean };
  i2cProbe(addr: number): boolean;
  serialOut(text: string): void;
  warn(msg: string, line?: number): void;
  queueIsr(fn: string): void;
  /** el estado de las salidas ha cambiado */
  outputsChanged(): void;
  oledChanged(): void;
}

const MODES: Record<number, PinState['mode']> = {
  0x01: 'input',
  0x03: 'output',
  0x05: 'input_pullup',
  0x09: 'input_pulldown',
  0x13: 'open_drain',
};

const UNSET: PinState = { mode: 'unset', level: 0, duty: 0, freq: 0, servoUs: null };

export class Esp32Board implements Hal, BoardView {
  running = false;
  private pins = new Map<number, PinState>();
  i2c = { sda: 8, scl: 9, begun: false };
  private oled = new Map<number, OledFrame>();
  private serialIn: number[] = [];
  private interrupts = new Map<number, { mode: number; fn: string; last: number }>();
  private toneEnds = new Map<number, number>();
  private warned = new Set<string>();
  private frameCounter = 0;

  constructor(private host: BoardHost) {}

  reset() {
    this.pins.clear();
    this.oled.clear();
    this.serialIn = [];
    this.interrupts.clear();
    this.toneEnds.clear();
    this.warned.clear();
    this.i2c = { sda: 8, scl: 9, begun: false };
  }

  // ------------------------------------------------------------ BoardView
  pin(gpio: number): PinState {
    return this.pins.get(gpio) ?? UNSET;
  }
  oledFrame(addr: number): OledFrame | undefined {
    return this.oled.get(addr);
  }
  /** pines con PWM activo -> fracción del periodo en alto */
  pwmMap(): Map<number, number> {
    const m = new Map<number, number>();
    this.pins.forEach((st, g) => {
      if (st.mode === 'pwm' || st.mode === 'tone' || st.mode === 'servo') m.set(g, st.duty);
    });
    return m;
  }

  // ------------------------------------------------------------ helpers
  private warnOnce(key: string, msg: string) {
    if (this.warned.has(key)) return;
    this.warned.add(key);
    this.host.warn(msg);
  }

  private checkPin(pin: number, fn: string) {
    if (!gpioExists(pin)) {
      throw new RuntimeError(
        `${fn}(${pin}): el pin GPIO${pin} no existe en la ESP32-S3-DevKitC-1. Pines disponibles: 0-21 y 35-48.`,
      );
    }
  }

  private set(pin: number, patch: Partial<PinState>) {
    const prev = this.pin(pin);
    const next = { ...prev, ...patch };
    if (
      prev.mode === next.mode && prev.level === next.level && prev.duty === next.duty &&
      prev.freq === next.freq && prev.servoUs === next.servoUs
    ) return;
    this.pins.set(pin, next);
    this.host.outputsChanged();
  }

  /** tareas periódicas: fin de tone() con duración */
  update() {
    if (!this.toneEnds.size) return;
    const now = this.host.clock.now();
    this.toneEnds.forEach((end, pin) => {
      if (now >= end) {
        this.toneEnds.delete(pin);
        this.noTone(pin);
      }
    });
  }

  /** comprueba flancos en los pines con interrupción */
  checkInterrupts() {
    if (!this.interrupts.size) return;
    this.interrupts.forEach((it, pin) => {
      const lvl = this.readLevel(pin, false);
      if (lvl === it.last) return;
      const rising = lvl === 1;
      it.last = lvl;
      const fire = it.mode === 3 || (it.mode === 1 && rising) || (it.mode === 2 && !rising) ||
        (it.mode === 5 && rising) || (it.mode === 4 && !rising);
      if (fire) this.host.queueIsr(it.fn);
    });
  }

  private readLevel(pin: number, warn: boolean): number {
    const st = this.pin(pin);
    if (st.mode === 'output') return st.level;
    const { v, driven, connected } = this.host.pinVoltage(pin);
    if (!driven) {
      if (warn) {
        this.warnOnce(
          `float${pin}`,
          connected
            ? `GPIO${pin} está flotante: digitalRead() devuelve valores aleatorios. Usa INPUT_PULLUP/INPUT_PULLDOWN o una resistencia.`
            : `GPIO${pin} no está conectado a nada: digitalRead() devuelve valores aleatorios.`,
        );
      }
      return Math.random() < 0.5 ? 0 : 1;
    }
    if (v > 0.75 * 3.3) return 1;
    if (v < 0.25 * 3.3) return 0;
    if (warn) this.warnOnce(`undef${pin}`, `GPIO${pin} tiene ${v.toFixed(2)} V: nivel lógico indeterminado (entre 0.8 V y 2.5 V).`);
    return v > 1.65 ? 1 : 0;
  }

  // ------------------------------------------------------------ HAL
  millis() {
    return this.host.clock.now();
  }
  micros() {
    return this.host.clock.now() * 1000;
  }

  pinMode(pin: number, mode: number) {
    this.checkPin(pin, 'pinMode');
    const m = MODES[mode];
    if (!m) throw new RuntimeError(`pinMode(${pin}, ${mode}): modo no válido. Usa INPUT, OUTPUT, INPUT_PULLUP o INPUT_PULLDOWN.`);
    this.set(pin, { mode: m, level: 0, duty: 0, freq: 0, servoUs: null });
  }

  digitalWrite(pin: number, value: number) {
    this.checkPin(pin, 'digitalWrite');
    const st = this.pin(pin);
    if (st.mode === 'pwm' || st.mode === 'servo' || st.mode === 'tone') {
      this.warnOnce(`dw-pwm${pin}`, `digitalWrite(${pin}) en un pin configurado como PWM: deja de generar PWM.`);
      this.set(pin, { mode: 'output', level: value ? 1 : 0, duty: 0 });
      return;
    }
    if (st.mode !== 'output' && st.mode !== 'open_drain') {
      this.warnOnce(`dw${pin}`, `digitalWrite(${pin}, ...) sin pinMode(${pin}, OUTPUT): el pin no está configurado como salida y no cambia.`);
      return;
    }
    this.set(pin, { level: value ? 1 : 0 });
  }

  digitalRead(pin: number): number {
    this.checkPin(pin, 'digitalRead');
    const st = this.pin(pin);
    if (st.mode === 'unset') {
      this.warnOnce(`dr${pin}`, `digitalRead(${pin}) sin pinMode(${pin}, INPUT...). Configura el pin primero.`);
    }
    return this.readLevel(pin, true);
  }

  analogMilliVolts(pin: number): number {
    this.checkPin(pin, 'analogRead');
    if (!isAdc(pin)) {
      throw new RuntimeError(`analogRead(${pin}): GPIO${pin} no tiene ADC. En el ESP32-S3 los pines analógicos son GPIO1..GPIO20.`);
    }
    const st = this.pin(pin);
    if (st.mode === 'output' || st.mode === 'pwm') {
      this.warnOnce(`ar${pin}`, `analogRead(${pin}) en un pin configurado como salida.`);
    }
    const { v, driven } = this.host.pinVoltage(pin);
    if (!driven) {
      this.warnOnce(`afloat${pin}`, `analogRead(${pin}): la entrada está al aire, la lectura es ruido.`);
      return Math.random() * 3300;
    }
    // ruido de cuantización / ADC real (± ~10 mV)
    return Math.max(0, Math.min(3300, v * 1000 + (Math.random() - 0.5) * 12));
  }

  pwm(pin: number, duty: number, freq: number) {
    this.checkPin(pin, 'ledcWrite');
    this.set(pin, { mode: 'pwm', duty, freq, level: duty >= 1 ? 1 : 0, servoUs: null });
  }

  pwmStop(pin: number) {
    this.set(pin, { mode: 'unset', duty: 0, freq: 0 });
  }

  tone(pin: number, freq: number, durationMs?: number) {
    this.checkPin(pin, 'tone');
    if (freq <= 0) return this.noTone(pin);
    this.set(pin, { mode: 'tone', duty: 0.5, freq, servoUs: null });
    if (durationMs && durationMs > 0) this.toneEnds.set(pin, this.host.clock.now() + durationMs);
    else this.toneEnds.delete(pin);
  }

  noTone(pin: number) {
    this.checkPin(pin, 'noTone');
    this.toneEnds.delete(pin);
    if (this.pin(pin).mode === 'tone') this.set(pin, { mode: 'output', level: 0, duty: 0, freq: 0 });
  }

  servo(pin: number, us: number | null) {
    this.checkPin(pin, 'servo.attach');
    if (us === null) this.set(pin, { mode: 'unset', duty: 0, freq: 0, servoUs: null });
    else this.set(pin, { mode: 'servo', servoUs: us, duty: us / 20000, freq: 50 });
  }

  serialWrite(text: string) {
    this.host.serialOut(text);
  }
  serialAvailable() {
    return this.serialIn.length;
  }
  serialRead() {
    return this.serialIn.length ? this.serialIn.shift()! : -1;
  }
  serialPeek() {
    return this.serialIn.length ? this.serialIn[0] : -1;
  }
  /** texto que el usuario envía desde la consola */
  serialInput(text: string) {
    for (const ch of text) this.serialIn.push(ch.charCodeAt(0));
  }

  i2cBegin(sda: number, scl: number) {
    this.checkPin(sda, 'Wire.begin');
    this.checkPin(scl, 'Wire.begin');
    if (sda === scl) throw new RuntimeError('Wire.begin(sda, scl): SDA y SCL no pueden ser el mismo pin');
    this.i2c = { sda, scl, begun: true };
    this.host.outputsChanged();
  }

  i2cProbe(addr: number): boolean {
    return this.host.i2cProbe(addr);
  }

  oledShow(addr: number, w: number, h: number, buffer: Uint8Array, inverted: boolean) {
    this.oled.set(addr, { w, h, buf: buffer, inverted, version: ++this.frameCounter });
    this.host.oledChanged();
  }

  attachInterrupt(pin: number, mode: number, fn: string) {
    this.checkPin(pin, 'attachInterrupt');
    this.interrupts.set(pin, { mode, fn, last: this.readLevel(pin, false) });
  }

  detachInterrupt(pin: number) {
    this.interrupts.delete(pin);
  }

  warn(message: string, line?: number) {
    this.host.warn(message, line);
  }
}
