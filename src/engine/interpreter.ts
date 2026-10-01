// Intérprete basado en generadores: cada delay() suspende la ejecución
// (yield) sin bloquear el navegador.

import type { Declarator, Expr, FuncDecl, Program, Stmt, ValType, VarType } from './ast';
import { valTypeOf } from './checker';
import {
  CLASSES, CONSTANTS, createLibState, formatValue, FUNCTIONS, GLOBAL_OBJECTS, STRING_METHODS,
  type CallCtx, type LibState, type RT,
} from './library';
import {
  isArr, isObj, RuntimeError, Sleep, toNum, wrapInt, type ArrValue, type Hal, type ObjValue, type Value,
} from './values';

/** Señal de "fin de cuota": el runner devuelve el control al navegador */
export const TICK = Symbol('tick');
export type Signal = Sleep | typeof TICK;

interface Ref {
  v: Value;
  type: VarType | null;
}

class Scope {
  vars = new Map<string, Ref>();
  constructor(public parent: Scope | null) {}
  lookup(name: string): Ref | undefined {
    let s: Scope | null = this;
    while (s) {
      const r = s.vars.get(name);
      if (r) return r;
      s = s.parent;
    }
    return undefined;
  }
}

const BREAK = { k: 'break' } as const;
const CONTINUE = { k: 'continue' } as const;
interface Ret {
  k: 'return';
  v: Value;
}
type Completion = typeof BREAK | typeof CONTINUE | Ret | undefined;

type Gen<T> = Generator<Signal, T, void>;

const MAX_DEPTH = 120;

export function coerce(v: Value, type: VarType | null): Value {
  if (!type) return v;
  switch (type.base) {
    case 'int':
      return wrapInt(toNum(v), type.bits ?? 32, type.unsigned);
    case 'float':
      return toNum(v);
    case 'bool':
      return toNum(v) ? 1 : 0;
    case 'string':
      return typeof v === 'string' ? v : formatValue(v, Number.isInteger(v) ? 'int' : 'float');
    default:
      return v;
  }
}

function defaultValue(type: VarType): Value {
  if (type.base === 'string') return '';
  if (type.base === 'object') return 0;
  return 0;
}

function sizeOfType(t: VarType): number {
  if (t.base === 'int') return (t.bits ?? 32) / 8;
  if (t.base === 'float') return t.text.includes('double') ? 8 : 4;
  if (t.base === 'bool') return 1;
  if (t.base === 'string') return 12;
  return 4;
}

export class Interpreter {
  private globals = new Scope(null);
  private statics = new Map<Declarator, Ref>();
  private depth = 0;
  private steps = 0;
  /** número de sentencias entre cesiones de control */
  stepBudget = 2000;
  line = 0;
  readonly rt: RT;
  private warned = new Set<string>();
  /** se activa durante una interrupción (delay no permitido) */
  private inIsr = false;

  constructor(
    private prog: Program,
    hal: Hal,
  ) {
    const lib: LibState = createLibState();
    this.rt = {
      hal,
      lib,
      warnOnce: (key, msg) => {
        if (this.warned.has(key)) return;
        this.warned.add(key);
        hal.warn(msg, this.line);
      },
    };
    for (const [name, cls] of Object.entries(GLOBAL_OBJECTS)) {
      const def = CLASSES[cls];
      const obj: ObjValue = { __obj: true, cls, state: def.create(this.ctx([], [])) };
      this.globals.vars.set(name, { v: obj, type: null });
    }
  }

  private ctx(args: Value[], types: ValType[]): CallCtx {
    return { rt: this.rt, args, types, line: this.line };
  }

  /** Programa completo: globales, setup() y loop() infinito */
  *main(): Gen<void> {
    for (const g of this.prog.globals) yield* this.execDecl(g.decls, this.globals);
    yield* this.callUser(this.prog.functions.get('setup')!, []);
    const loop = this.prog.functions.get('loop')!;
    for (;;) {
      yield* this.callUser(loop, []);
      if (++this.steps >= this.stepBudget) {
        this.steps = 0;
        yield TICK;
      }
    }
  }

  /** Ejecuta una función de interrupción hasta el final (síncrona) */
  runIsr(name: string) {
    const fn = this.prog.functions.get(name);
    if (!fn) return;
    const saved = this.line;
    this.inIsr = true;
    try {
      const g = this.callUser(fn, []);
      for (let i = 0; i < 1e6; i++) {
        const r = g.next();
        if (r.done) break;
      }
    } finally {
      this.inIsr = false;
      this.line = saved;
    }
  }

  // --------------------------------------------------------------- sentencias

  private *execDecl(decls: Declarator[], scope: Scope): Gen<void> {
    for (const d of decls) {
      this.line = d.line;
      // static local: se inicializa solo la primera vez
      if (d.type.isStatic && scope !== this.globals) {
        const existing = this.statics.get(d);
        if (existing) {
          scope.vars.set(d.name, existing);
          continue;
        }
      }
      let v: Value;
      if (d.arraySize !== null) {
        let size: number;
        let initItems: Value[] = [];
        if (d.init?.kind === 'init') {
          for (const it of d.init.items) initItems.push(yield* this.eval(it, scope));
        } else if (d.init?.kind === 'str') {
          initItems = [...d.init.value].map((ch) => ch.charCodeAt(0)).concat([0]);
        }
        if (d.arraySize === -1) size = initItems.length;
        else size = Math.trunc(toNum(yield* this.eval(d.arraySize, scope)));
        if (size < 0 || size > 100000) throw new RuntimeError(`Tamaño de array no válido: ${size}`, d.line);
        if (initItems.length > size) throw new RuntimeError(`Demasiados valores para el array '${d.name}' (tamaño ${size})`, d.line);
        const items: Value[] = [];
        for (let i = 0; i < size; i++) {
          if (d.type.base === 'object') items.push(this.newObject(d.type.className!, [], []));
          else items.push(i < initItems.length ? coerce(initItems[i], d.type) : defaultValue(d.type));
        }
        const arr: ArrValue = { __arr: true, items, elem: d.type };
        v = arr;
      } else if (d.type.base === 'object') {
        const args: Value[] = [];
        const types: ValType[] = [];
        for (const a of d.ctorArgs ?? []) {
          args.push(yield* this.eval(a, scope));
          types.push(a.t ?? 'any');
        }
        v = this.newObject(d.type.className!, args, types);
      } else if (d.init) {
        v = coerce(yield* this.eval(d.init, scope), d.type);
      } else {
        v = defaultValue(d.type);
      }
      const ref: Ref = { v, type: d.arraySize !== null ? null : d.type };
      scope.vars.set(d.name, ref);
      if (d.type.isStatic && scope !== this.globals) this.statics.set(d, ref);
    }
  }

  private newObject(cls: string, args: Value[], types: ValType[]): ObjValue {
    const def = CLASSES[cls];
    if (!def) throw new RuntimeError(`Clase desconocida ${cls}`, this.line);
    return { __obj: true, cls, state: def.create(this.ctx(args, types)) };
  }

  private *exec(s: Stmt, scope: Scope): Gen<Completion> {
    this.line = s.line;
    if (++this.steps >= this.stepBudget) {
      this.steps = 0;
      yield TICK;
    }
    switch (s.kind) {
      case 'expr':
        yield* this.eval(s.expr, scope);
        return;
      case 'decl':
        yield* this.execDecl(s.decls, scope);
        return;
      case 'block': {
        const inner = new Scope(scope);
        for (const st of s.body) {
          const c = yield* this.exec(st, inner);
          if (c) return c;
        }
        return;
      }
      case 'if':
        if (toNum(yield* this.eval(s.test, scope))) return yield* this.exec(s.then, scope);
        if (s.else) return yield* this.exec(s.else, scope);
        return;
      case 'while':
        while (toNum(yield* this.eval(s.test, scope))) {
          const c = yield* this.exec(s.body, scope);
          if (c === BREAK) break;
          if (c && c.k === 'return') return c;
          if (++this.steps >= this.stepBudget) {
            this.steps = 0;
            yield TICK;
          }
        }
        return;
      case 'dowhile':
        do {
          const c = yield* this.exec(s.body, scope);
          if (c === BREAK) break;
          if (c && c.k === 'return') return c;
        } while (toNum(yield* this.eval(s.test, scope)));
        return;
      case 'for': {
        const fs = new Scope(scope);
        if (s.init) yield* this.exec(s.init, fs);
        while (!s.test || toNum(yield* this.eval(s.test, fs))) {
          const c = yield* this.exec(s.body, fs);
          if (c === BREAK) break;
          if (c && c.k === 'return') return c;
          if (s.update) yield* this.eval(s.update, fs);
          if (++this.steps >= this.stepBudget) {
            this.steps = 0;
            yield TICK;
          }
        }
        return;
      }
      case 'switch': {
        const v = toNum(yield* this.eval(s.disc, scope));
        const inner = new Scope(scope);
        let start = -1;
        for (let i = 0; i < s.cases.length && start < 0; i++) {
          const t = s.cases[i].test;
          if (t && toNum(yield* this.eval(t, inner)) === v) start = i;
        }
        if (start < 0) start = s.cases.findIndex((c) => c.test === null);
        if (start < 0) return;
        for (let i = start; i < s.cases.length; i++) {
          for (const st of s.cases[i].body) {
            const c = yield* this.exec(st, inner);
            if (c === BREAK) return;
            if (c) return c;
          }
        }
        return;
      }
      case 'break':
        return BREAK;
      case 'continue':
        return CONTINUE;
      case 'return':
        return { k: 'return', v: s.value ? yield* this.eval(s.value, scope) : 0 };
      case 'empty':
        return;
    }
  }

  // --------------------------------------------------------------- funciones

  private *callUser(fn: FuncDecl, args: Expr[], callerScope?: Scope): Gen<Value> {
    if (this.depth >= MAX_DEPTH) {
      throw new RuntimeError(`Desbordamiento de pila: demasiadas llamadas anidadas (¿recursión infinita en '${fn.name}'?)`, this.line);
    }
    const scope = new Scope(this.globals);
    for (let i = 0; i < fn.params.length; i++) {
      const p = fn.params[i];
      const a = args[i];
      if (p.isRef) {
        scope.vars.set(p.name, this.refOf(a, callerScope!));
      } else {
        const v = yield* this.eval(a, callerScope!);
        scope.vars.set(p.name, { v: p.isArray ? v : coerce(v, p.type), type: p.isArray ? null : p.type });
      }
    }
    this.depth++;
    try {
      const c = yield* this.exec(fn.body, scope);
      if (c && c.k === 'return') return fn.ret.base === 'void' ? 0 : coerce(c.v, fn.ret);
      return fn.ret.base === 'string' ? '' : 0;
    } finally {
      this.depth--;
    }
  }

  private refOf(e: Expr, scope: Scope): Ref {
    if (e.kind === 'ident') {
      const r = scope.lookup(e.name);
      if (!r) throw new RuntimeError(`'${e.name}' no está declarado`, e.line);
      return r;
    }
    if (e.kind === 'index') {
      // la referencia a un elemento se evalúa de forma síncrona (índice sin llamadas)
      const arrRef = this.refOf(e.object, scope);
      const arr = arrRef.v;
      const g = this.eval(e.index, scope);
      let r = g.next();
      while (!r.done) r = g.next();
      const idx = Math.trunc(toNum(r.value));
      if (!isArr(arr)) throw new RuntimeError('Solo se pueden indexar arrays', e.line);
      this.checkIndex(arr, idx, e);
      return {
        get v() {
          return arr.items[idx];
        },
        set v(x: Value) {
          arr.items[idx] = x;
        },
        type: arr.elem,
      };
    }
    throw new RuntimeError('Se esperaba una variable', e.line);
  }

  private checkIndex(arr: ArrValue, idx: number, e: Expr) {
    if (idx < 0 || idx >= arr.items.length) {
      const name = e.kind === 'index' && e.object.kind === 'ident' ? `'${e.object.name}'` : 'el array';
      throw new RuntimeError(`Índice ${idx} fuera de rango: ${name} tiene ${arr.items.length} elementos (0..${arr.items.length - 1})`, e.line);
    }
  }

  // --------------------------------------------------------------- expresiones

  private lookupIdent(name: string, scope: Scope, e: Expr): Value {
    const r = scope.lookup(name);
    if (r) return r.v;
    const c = CONSTANTS[name];
    if (c) return c.value;
    if (this.prog.functions.has(name)) return { __fn: true, name };
    throw new RuntimeError(`'${name}' no está declarado`, e.line);
  }

  *eval(e: Expr, scope: Scope): Gen<Value> {
    switch (e.kind) {
      case 'num':
        return e.value;
      case 'str':
        return e.value;
      case 'ident':
        return this.lookupIdent(e.name, scope, e);
      case 'unary': {
        const v = toNum(yield* this.eval(e.arg, scope));
        switch (e.op) {
          case '!': return v ? 0 : 1;
          case '-': return -v;
          case '+': return v;
          case '~': return ~v;
        }
        return v;
      }
      case 'update': {
        const ref = this.refOf(e.arg, scope);
        const old = toNum(ref.v);
        const nv = coerce(e.op === '++' ? old + 1 : old - 1, ref.type);
        ref.v = nv;
        return e.prefix ? nv : old;
      }
      case 'logical': {
        const a = toNum(yield* this.eval(e.left, scope));
        if (e.op === '&&') return a ? (toNum(yield* this.eval(e.right, scope)) ? 1 : 0) : 0;
        return a ? 1 : toNum(yield* this.eval(e.right, scope)) ? 1 : 0;
      }
      case 'binary': {
        const a = yield* this.eval(e.left, scope);
        const b = yield* this.eval(e.right, scope);
        return this.binop(e.op, a, b, e.left.t ?? 'any', e.right.t ?? 'any', e.t ?? 'any', e);
      }
      case 'assign': {
        const v = yield* this.eval(e.value, scope);
        const ref = this.refOf(e.target, scope);
        let nv: Value;
        if (e.op === '=') nv = v;
        else {
          const op = e.op.slice(0, -1);
          nv = this.binop(op, ref.v, v, e.target.t ?? 'any', e.value.t ?? 'any', e.t === 'string' ? 'string' : arithType(e.target.t, e.value.t, op), e);
        }
        ref.v = coerce(nv, ref.type);
        return ref.v;
      }
      case 'cond':
        return toNum(yield* this.eval(e.test, scope)) ? yield* this.eval(e.a, scope) : yield* this.eval(e.b, scope);
      case 'call':
        return yield* this.call(e, scope);
      case 'index': {
        const arr = yield* this.eval(e.object, scope);
        const idx = Math.trunc(toNum(yield* this.eval(e.index, scope)));
        if (typeof arr === 'string') return idx >= 0 && idx < arr.length ? arr.charCodeAt(idx) : 0;
        if (!isArr(arr)) throw new RuntimeError('Solo se pueden indexar arrays', e.line);
        this.checkIndex(arr, idx, e);
        return arr.items[idx];
      }
      case 'cast': {
        const v = yield* this.eval(e.arg, scope);
        return coerce(v, e.type);
      }
      case 'sizeof': {
        if (e.type) return sizeOfType(e.type);
        if (e.arg?.kind === 'ident') {
          const r = scope.lookup(e.arg.name);
          if (r && isArr(r.v)) return r.v.items.length * sizeOfType(r.v.elem);
          if (r?.type) return sizeOfType(r.type);
        }
        if (e.arg) {
          const v = yield* this.eval(e.arg, scope);
          if (isArr(v)) return v.items.length * sizeOfType(v.elem);
          return e.arg.t === 'float' ? 4 : e.arg.t === 'char' || e.arg.t === 'bool' ? 1 : 4;
        }
        return 4;
      }
      case 'member':
        throw new RuntimeError('Acceso a miembro no soportado', e.line);
      case 'init':
        throw new RuntimeError('Lista {..} no válida aquí', e.line);
    }
  }

  private binop(op: string, a: Value, b: Value, ta: ValType, tb: ValType, t: ValType, e: Expr): Value {
    if (op === ',') return b;
    if (op === '+' && (typeof a === 'string' || typeof b === 'string' || t === 'string')) {
      return formatValue(a, ta) + formatValue(b, tb);
    }
    if (typeof a === 'string' && typeof b === 'string') {
      switch (op) {
        case '==': return a === b ? 1 : 0;
        case '!=': return a !== b ? 1 : 0;
        case '<': return a < b ? 1 : 0;
        case '>': return a > b ? 1 : 0;
        case '<=': return a <= b ? 1 : 0;
        case '>=': return a >= b ? 1 : 0;
      }
    }
    const x = toNum(a);
    const y = toNum(b);
    const isInt = t === 'int' || t === 'char' || t === 'bool';
    switch (op) {
      case '+': return x + y;
      case '-': return x - y;
      case '*': return isInt ? Math.trunc(x * y) : x * y;
      case '/':
        if (isInt) {
          if (y === 0) throw new RuntimeError('División entera por cero: en el ESP32 real el programa se reiniciaría', e.line);
          return Math.trunc(x / y);
        }
        return x / y;
      case '%':
        if (y === 0) throw new RuntimeError('Módulo por cero (x % 0)', e.line);
        return Math.trunc(x) % Math.trunc(y);
      case '<': return x < y ? 1 : 0;
      case '>': return x > y ? 1 : 0;
      case '<=': return x <= y ? 1 : 0;
      case '>=': return x >= y ? 1 : 0;
      case '==': return x === y ? 1 : 0;
      case '!=': return x !== y ? 1 : 0;
      case '&': return x & y;
      case '|': return x | y;
      case '^': return x ^ y;
      case '<<': return x << y;
      case '>>': return x >> y;
    }
    throw new RuntimeError(`Operador '${op}' no soportado`, e.line);
  }

  private *evalArgs(args: Expr[], scope: Scope): Gen<{ vals: Value[]; types: ValType[] }> {
    const vals: Value[] = [];
    const types: ValType[] = [];
    for (const a of args) {
      vals.push(yield* this.eval(a, scope));
      types.push(a.t ?? 'any');
    }
    return { vals, types };
  }

  private *handleResult(r: Value | Sleep | void): Gen<Value> {
    if (r instanceof Sleep) {
      if (this.inIsr) {
        this.rt.warnOnce('isr-delay', 'No uses delay() dentro de una interrupción (ISR): se ignora.');
        return 0;
      }
      yield r;
      return 0;
    }
    return r === undefined ? 0 : r;
  }

  private *call(e: Expr & { kind: 'call' }, scope: Scope): Gen<Value> {
    const callee = e.callee;
    const line = e.line;
    if (callee.kind === 'ident') {
      const user = this.prog.functions.get(callee.name);
      if (user) {
        const saved = this.line;
        const r = yield* this.callUser(user, e.args, scope);
        this.line = saved;
        return r;
      }
      const { vals, types } = yield* this.evalArgs(e.args, scope);
      this.line = line;
      if (callee.name === 'String') {
        if (vals.length === 0) return '';
        return formatValue(vals[0], types[0], vals.length > 1 ? Math.trunc(toNum(vals[1])) : undefined);
      }
      const fn = FUNCTIONS[callee.name];
      if (!fn) throw new RuntimeError(`La función '${callee.name}' no existe`, line);
      return yield* this.handleResult(wrapErr(() => fn.call({ rt: this.rt, args: vals, types, line }), line));
    }
    if (callee.kind === 'member') {
      const obj = yield* this.eval(callee.object, scope);
      const { vals, types } = yield* this.evalArgs(e.args, scope);
      this.line = line;
      if (typeof obj === 'string') {
        const sm = STRING_METHODS[callee.prop];
        if (!sm) throw new RuntimeError(`String no tiene el método ${callee.prop}()`, line);
        const res = sm.call(obj, vals);
        if (sm.mutates) {
          const ref = this.refOf(callee.object, scope);
          ref.v = res;
          return sm.ret === 'bool' ? 1 : 0;
        }
        return res;
      }
      if (isObj(obj)) {
        const md = CLASSES[obj.cls]?.methods[callee.prop];
        if (!md) throw new RuntimeError(`${obj.cls} no tiene el método ${callee.prop}()`, line);
        return yield* this.handleResult(wrapErr(() => md.call({ rt: this.rt, args: vals, types, line, self: obj }), line));
      }
      throw new RuntimeError(`No se puede llamar a ${callee.prop}() sobre este valor`, line);
    }
    throw new RuntimeError('Llamada no válida', line);
  }

  /** Valor de una variable global (para inspección / tests) */
  getGlobal(name: string): Value | undefined {
    return this.globals.vars.get(name)?.v;
  }
}

function arithType(a: ValType | undefined, b: ValType | undefined, op: string): ValType {
  if (['&', '|', '^', '<<', '>>', '%'].includes(op)) return 'int';
  if (a === 'float' || b === 'float') return 'float';
  return 'int';
}

function wrapErr<T>(fn: () => T, line: number): T {
  try {
    return fn();
  } catch (err) {
    if (err instanceof RuntimeError && !err.line) err.line = line;
    throw err;
  }
}

export { valTypeOf };
