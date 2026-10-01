// Compilación y bucle de ejecución del programa del alumno.

import type { Program } from './ast';
import { check, compileErrorToDiag, type BoardInfo, type Diagnostic } from './checker';
import { Interpreter, TICK } from './interpreter';
import { CompileError } from './lexer';
import { parse } from './parser';
import { RuntimeError, Sleep, type Hal } from './values';

export interface CompileResult {
  program: Program | null;
  diagnostics: Diagnostic[];
}

export function compile(src: string, board: BoardInfo): CompileResult {
  try {
    const program = parse(src);
    const diagnostics = check(program, board);
    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    return { program: hasErrors ? null : program, diagnostics };
  } catch (e) {
    if (e instanceof CompileError) return { program: null, diagnostics: [compileErrorToDiag(e)] };
    throw e;
  }
}

/**
 * Reloj de la simulación. millis() avanza con el tiempo real, pero un delay()
 * corto puede adelantar el reloj virtual sin esperar (evita que bucles con
 * delay(1) o delayMicroseconds vayan mucho más lentos que en la placa).
 */
export class SimClock {
  private t0 = 0;
  private virt = 0;
  start() {
    this.t0 = performance.now();
    this.virt = 0;
  }
  real(): number {
    return performance.now() - this.t0;
  }
  now(): number {
    const r = this.real();
    if (r > this.virt) this.virt = r;
    return this.virt;
  }
  advanceTo(t: number) {
    if (t > this.virt) this.virt = t;
  }
}

export interface RunnerEvents {
  onError(err: RuntimeError): void;
  onExit(): void;
}

export class Runner {
  readonly interp: Interpreter;
  private gen: Generator<unknown, void, void> | null = null;
  private running = false;
  private wakeAt: number | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private isrQueue: string[] = [];

  constructor(
    program: Program,
    hal: Hal,
    private clock: SimClock,
    private events: RunnerEvents,
  ) {
    this.interp = new Interpreter(program, hal);
  }

  get isRunning() {
    return this.running;
  }

  start() {
    this.clock.start();
    this.gen = this.interp.main();
    this.running = true;
    this.schedule(0);
  }

  stop() {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.gen = null;
  }

  /** encola una rutina de interrupción y la ejecuta en cuanto sea posible */
  queueIsr(name: string) {
    if (!this.running) return;
    this.isrQueue.push(name);
    this.schedule(0);
  }

  private schedule(ms: number) {
    if (!this.running) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(this.step, ms);
  }

  private drainIsrs() {
    while (this.isrQueue.length && this.running) {
      const name = this.isrQueue.shift()!;
      this.interp.runIsr(name);
    }
  }

  private step = () => {
    this.timer = null;
    if (!this.running || !this.gen) return;
    const sliceStart = performance.now();
    try {
      this.drainIsrs();
      while (this.running) {
        if (this.wakeAt !== null) {
          const remaining = this.wakeAt - this.clock.real();
          if (remaining > 0.5) {
            this.schedule(Math.min(remaining, 25));
            return;
          }
          this.wakeAt = null;
        }
        const r = this.gen.next();
        if (r.done) {
          this.running = false;
          this.events.onExit();
          return;
        }
        if (r.value instanceof Sleep) {
          const target = this.clock.now() + r.value.ms;
          this.clock.advanceTo(target);
          if (target - this.clock.real() > 2) this.wakeAt = target;
        } else if (r.value === TICK) {
          if (performance.now() - sliceStart > 12) {
            this.schedule(0);
            return;
          }
        }
        this.drainIsrs();
      }
    } catch (err) {
      this.running = false;
      if (err instanceof RuntimeError) {
        if (!err.line) err.line = this.interp.line;
        this.events.onError(err);
      } else if (err instanceof RangeError) {
        this.events.onError(new RuntimeError('Desbordamiento de pila (recursión demasiado profunda)', this.interp.line));
      } else {
        this.events.onError(new RuntimeError(`Error interno: ${(err as Error).message}`, this.interp.line));
        console.error(err);
      }
    }
  };
}
