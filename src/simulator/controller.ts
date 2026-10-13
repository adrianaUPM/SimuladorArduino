// Orquesta la simulación: compila, ejecuta el programa, resuelve el circuito y
// publica el estado visual en cada frame.

import { ESP32_BOARD_INFO } from '../devices/esp32s3/pins';
import { compile, Runner, SimClock } from '../engine/runner';
import type { RuntimeError } from '../engine/values';
import { useApp } from '../state/store';
import { clearConsole, pushConsole, useSim, type ConsoleKind } from '../state/simStore';
import { BuzzerAudio } from './audio';
import { Esp32Board, type BoardHost } from './board';
import { evaluate, solve, type Evaluation, type Solution } from './solver';
import type { Circuit } from './types';
import { termKey } from './types';

/** componentes que responden en el bus I2C (su estado expone ready y addr) */
const I2C_DEVICES = new Set(['oled', 'lcd']);

class SimController {
  readonly clock = new SimClock();
  readonly board: Esp32Board;
  private runner: Runner | null = null;
  private circuit: Circuit;
  private solution: Solution | null = null;
  private evaluation: Evaluation | null = null;
  private dirtySolve = true;
  private dirtyEval = true;
  private pending: { kind: ConsoleKind; text: string; line?: number }[] = [];
  private inputs: Record<string, Record<string, any>> = {};
  private audio = new BuzzerAudio();
  private started = false;

  constructor() {
    const host: BoardHost = {
      clock: this.clock,
      pinVoltage: (gpio) => this.pinVoltage(gpio),
      i2cProbe: (addr) => this.i2cProbe(addr),
      keypadScan: (rows, cols) => this.keypadScan(rows, cols),
      pulseIn: (pin, level) => this.pulseIn(pin, level),
      serialOut: (text) => this.pending.push({ kind: 'out', text }),
      warn: (msg, line) => this.pending.push({ kind: 'warn', text: msg, line }),
      queueIsr: (fn) => this.runner?.queueIsr(fn),
      outputsChanged: () => this.invalidate(),
      displayChanged: () => {
        this.dirtyEval = true;
      },
    };
    this.board = new Esp32Board(host);
    this.circuit = useApp.getState().project.circuit;
  }

  /** arranca el bucle de refresco (una sola vez) */
  start() {
    if (this.started) return;
    this.started = true;
    useApp.subscribe((s, prev) => {
      if (s.project.circuit !== prev.project.circuit) {
        this.circuit = s.project.circuit;
        this.invalidate();
      }
      if (s.soundOn !== prev.soundOn && !s.soundOn) this.audio.stopAll();
    });
    const frame = () => {
      this.tick();
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  }

  get running() {
    return !!this.runner?.isRunning;
  }

  invalidate() {
    this.dirtySolve = true;
    this.dirtyEval = true;
  }

  private espId(): string | null {
    return this.circuit.components.find((c) => c.type === 'esp32s3')?.id ?? null;
  }

  private ensureSolved(): Solution {
    if (this.dirtySolve || !this.solution) {
      this.solution = solve({ circuit: this.circuit, board: this.board, inputs: this.inputs, pwm: this.board.pwmMap() });
      this.dirtySolve = false;
      this.dirtyEval = true;
    }
    return this.solution;
  }

  private ensureEvaluated(): Evaluation {
    const sol = this.ensureSolved();
    if (this.dirtyEval || !this.evaluation) {
      this.evaluation = evaluate(this.circuit, sol, this.board, this.inputs, this.espId());
      this.dirtyEval = false;
    }
    return this.evaluation;
  }

  private pinVoltage(gpio: number) {
    const sol = this.ensureSolved();
    const esp = this.espId();
    if (!esp) return { v: 0, driven: false, connected: false };
    const key = termKey(esp, `GPIO${gpio}`);
    const net = sol.netlist.netOf.get(key);
    if (net === undefined) return { v: 0, driven: false, connected: false };
    return { v: sol.vAvg[net], driven: sol.driven[net], connected: sol.netlist.connected.has(key) };
  }

  private i2cProbe(addr: number): boolean {
    const ev = this.ensureEvaluated();
    return this.circuit.components.some((c) => I2C_DEVICES.has(c.type) && ev.states[c.id]?.ready && ev.states[c.id]?.addr === addr);
  }

  private gpioNet(sol: Solution, gpio: number): number | undefined {
    const esp = this.espId();
    return esp ? sol.netlist.netOf.get(termKey(esp, `GPIO${gpio}`)) : undefined;
  }

  /**
   * Teclado matricial: una tecla pulsada une el net de su fila con el de su
   * columna. Se detecta si esos nets son los de un pin de rowPins y uno de
   * colPins (en cualquier orden, como en el hardware real).
   */
  private keypadScan(rows: number[], cols: number[]): [number, number][] {
    const sol = this.ensureSolved();
    const rowNets = rows.map((g) => this.gpioNet(sol, g));
    const colNets = cols.map((g) => this.gpioNet(sol, g));
    const hits: [number, number][] = [];
    for (const c of this.circuit.components) {
      if (c.type !== 'keypad') continue;
      const key = this.inputs[c.id]?.key as [number, number] | null | undefined;
      if (!key) continue;
      const a = sol.netlist.netOf.get(termKey(c.id, `R${key[0] + 1}`));
      const b = sol.netlist.netOf.get(termKey(c.id, `C${key[1] + 1}`));
      if (a === undefined || b === undefined || a === 0 || b === 0) continue;
      rowNets.forEach((rn, i) =>
        colNets.forEach((cn, j) => {
          if ((rn === a && cn === b) || (rn === b && cn === a)) hits.push([i, j]);
        }),
      );
    }
    return hits;
  }

  /** ECHO de un HC-SR04: duración del pulso en µs, 0 si no hay sensor y -1 si falta el disparo */
  private pulseIn(pin: number, level: number): number {
    const ev = this.ensureEvaluated();
    const sol = this.solution!;
    const net = this.gpioNet(sol, pin);
    if (net === undefined) return 0;
    for (const c of this.circuit.components) {
      if (c.type !== 'ultrasonic') continue;
      const st = ev.states[c.id];
      if (!st?.powered || sol.netlist.netOf.get(termKey(c.id, 'ECHO')) !== net) continue;
      const trig = sol.netlist.netOf.get(termKey(c.id, 'TRIG'));
      const esp = this.espId()!;
      const trigGpios = (sol.netlist.members[trig ?? -1] ?? [])
        .filter((m) => m.comp === esp && m.term.startsWith('GPIO'))
        .map((m) => Number(m.term.slice(4)));
      if (!trigGpios.some((g) => this.board.sincePulse(g) < 60)) return -1;
      if (!level) return 0;
      // ida y vuelta a 343 m/s: 58.3 µs por cm (con algo de ruido)
      return st.distance * 58.3 * (1 + (Math.random() - 0.5) * 0.01);
    }
    return 0;
  }

  private tick() {
    this.board.update();
    if (this.running) this.board.checkInterrupts();
    if (this.dirtySolve || this.dirtyEval) {
      try {
        const ev = this.ensureEvaluated();
        useSim.setState({ states: ev.states, issues: ev.issues, solution: this.solution });
        this.updateAudio(ev);
      } catch (e) {
        console.error(e);
      }
    }
    if (this.pending.length) {
      const p = this.pending;
      this.pending = [];
      pushConsole(p);
    }
  }

  private updateAudio(ev: Evaluation) {
    if (!useApp.getState().soundOn || !this.running) {
      this.audio.stopAll();
      return;
    }
    const tones = this.circuit.components
      .filter((c) => c.type === 'buzzer' && ev.states[c.id]?.on)
      .map((c) => ({ id: c.id, freq: ev.states[c.id].freq as number }));
    this.audio.update(tones);
  }

  // ------------------------------------------------------------------ control

  run(): boolean {
    this.stop(true);
    const code = useApp.getState().project.code;
    const res = compile(code, ESP32_BOARD_INFO);
    useSim.setState({ diagnostics: res.diagnostics, runtimeError: null });
    clearConsole();
    if (!res.program) {
      const errs = res.diagnostics.filter((d) => d.severity === 'error');
      pushConsole([
        { kind: 'error', text: `Error de compilación: ${errs.length} error${errs.length === 1 ? '' : 'es'}` },
        ...errs.slice(0, 8).map((d) => ({ kind: 'error' as const, text: `  línea ${d.line}: ${d.message}`, line: d.line })),
      ]);
      useSim.setState({ status: 'error' });
      return false;
    }
    const warns = res.diagnostics.filter((d) => d.severity === 'warning');
    pushConsole([
      { kind: 'sys', text: '▶ Programa cargado en la ESP32-S3. Ejecutando…' },
      ...warns.map((d) => ({ kind: 'warn' as const, text: `línea ${d.line}: ${d.message}`, line: d.line })),
    ]);
    if (!this.espId()) {
      pushConsole([{ kind: 'warn', text: 'No hay ninguna placa ESP32-S3 en el circuito: el código se ejecuta sin hardware conectado.' }]);
    }
    this.board.reset();
    this.board.running = true;
    this.audio.resume();
    this.runner = new Runner(res.program, this.board, this.clock, {
      onError: (err) => this.onRuntimeError(err),
      onExit: () => this.stop(),
    });
    this.runner.start();
    useSim.setState({ status: 'running' });
    this.invalidate();
    return true;
  }

  private onRuntimeError(err: RuntimeError) {
    this.pending.push({ kind: 'error', text: `Error en tiempo de ejecución (línea ${err.line}): ${err.message}`, line: err.line });
    this.runner = null;
    this.board.running = false;
    this.audio.stopAll();
    useSim.setState({ status: 'error', runtimeError: { message: err.message, line: err.line } });
    this.invalidate();
  }

  stop(silent = false) {
    const wasRunning = !!this.runner;
    this.runner?.stop();
    this.runner = null;
    this.board.running = false;
    this.board.reset();
    this.audio.stopAll();
    if (!silent) {
      useSim.setState({ status: 'stopped' });
      if (wasRunning) this.pending.push({ kind: 'sys', text: '■ Simulación detenida.' });
    }
    this.invalidate();
  }

  /** como pulsar el botón RST de la placa */
  reset() {
    if (this.runner) {
      this.run();
      pushConsole([{ kind: 'sys', text: '⟲ Reset: el programa se reinicia desde setup().' }]);
    } else {
      this.stop();
    }
  }

  setInput(compId: string, patch: Record<string, any>) {
    this.inputs = { ...this.inputs, [compId]: { ...(this.inputs[compId] ?? {}), ...patch } };
    useSim.setState({ inputs: this.inputs });
    this.invalidate();
    if (this.running) {
      this.ensureSolved();
      this.board.checkInterrupts();
    }
  }

  serialSend(text: string) {
    pushConsole([{ kind: 'in', text }]);
    if (this.running) this.board.serialInput(text);
  }

  /** valida el código sin ejecutarlo (para el editor) */
  check(code: string) {
    const res = compile(code, ESP32_BOARD_INFO);
    useSim.setState({ diagnostics: res.diagnostics });
    return res.diagnostics;
  }
}

export const sim = new SimController();
