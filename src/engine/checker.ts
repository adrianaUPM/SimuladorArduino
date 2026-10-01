// Análisis semántico: tipos de las expresiones, variables no declaradas,
// funciones inexistentes, número de argumentos, pines inexistentes...

import type { Expr, FuncDecl, Program, Stmt, ValType, VarType } from './ast';
import { CompileError } from './lexer';
import { CLASSES, CONSTANTS, FUNCTIONS, GLOBAL_OBJECTS, STRING_METHODS } from './library';

export interface Diagnostic {
  message: string;
  line: number;
  from: number;
  to: number;
  severity: 'error' | 'warning';
}

/** Información de la placa que necesita el compilador para validar pines */
export interface BoardInfo {
  name: string;
  gpioExists(n: number): boolean;
  isAdc(n: number): boolean;
  pinWarning?(n: number, usage: 'output' | 'input' | 'analog'): string | null;
}

interface Sym {
  type: VarType | null;
  vt: ValType;
  isArray: boolean;
  isConst: boolean;
}

const KNOWN_INCLUDES: Record<string, string | null> = {
  'Arduino.h': null,
  'Wire.h': null,
  'SPI.h': null,
  'ESP32Servo.h': null,
  'Servo.h': 'En ESP32 se usa la librería ESP32Servo: #include <ESP32Servo.h>',
  'Adafruit_GFX.h': null,
  'Adafruit_SSD1306.h': null,
  'math.h': null,
  'stdio.h': null,
  'stdlib.h': null,
};

export function valTypeOf(t: VarType): ValType {
  switch (t.base) {
    case 'int':
      return t.bits === 8 && !t.unsigned && t.text.includes('char') ? 'char' : 'int';
    case 'float':
      return 'float';
    case 'bool':
      return 'bool';
    case 'string':
      return 'string';
    case 'object':
      return 'obj';
    default:
      return 'void';
  }
}

const numeric = (t: ValType) => t === 'int' || t === 'float' || t === 'bool' || t === 'char' || t === 'any';
const arith = (a: ValType, b: ValType): ValType => (a === 'float' || b === 'float' ? 'float' : a === 'any' || b === 'any' ? 'any' : 'int');

const PIN_FUNCS: Record<string, 'output' | 'input' | 'analog' | 'any'> = {
  pinMode: 'any',
  digitalWrite: 'output',
  digitalRead: 'input',
  analogRead: 'analog',
  analogReadMilliVolts: 'analog',
  analogWrite: 'output',
  ledcAttach: 'output',
  ledcAttachPin: 'output',
  tone: 'output',
  attachInterrupt: 'input',
};

export function check(prog: Program, board: BoardInfo): Diagnostic[] {
  const diags: Diagnostic[] = [];
  const err = (msg: string, n: { line: number; pos: number; end: number }, severity: 'error' | 'warning' = 'error') =>
    diags.push({ message: msg, line: n.line, from: n.pos, to: Math.max(n.end, n.pos + 1), severity });

  const included = new Set<string>();
  for (const inc of prog.includes) {
    included.add(inc.name);
    if (!(inc.name in KNOWN_INCLUDES)) {
      err(`La librería <${inc.name}> no está soportada por el simulador; se ignorará.`, inc, 'warning');
    } else if (KNOWN_INCLUDES[inc.name]) {
      err(KNOWN_INCLUDES[inc.name]!, inc, 'warning');
    }
  }

  const scopes: Map<string, Sym>[] = [new Map()];
  const lookup = (name: string): Sym | undefined => {
    for (let i = scopes.length - 1; i >= 0; i--) {
      const s = scopes[i].get(name);
      if (s) return s;
    }
    return undefined;
  };
  const declare = (name: string, sym: Sym, node: { line: number; pos: number; end: number }) => {
    const top = scopes[scopes.length - 1];
    if (top.has(name)) err(`'${name}' ya está declarada en este ámbito`, node);
    if (scopes.length === 1 && prog.functions.has(name)) err(`'${name}' ya es el nombre de una función`, node);
    top.set(name, sym);
  };

  let currentFn: FuncDecl | null = null;
  let loopDepth = 0;
  let switchDepth = 0;

  // ---------------------------------------------------------------- expr
  const checkPinArg = (fname: string, args: Expr[]) => {
    const usage = PIN_FUNCS[fname];
    if (!usage || args.length === 0) return;
    const a = args[0];
    const v = constValue(a);
    if (v === null) return;
    if (!board.gpioExists(v)) {
      err(`El pin GPIO${v} no existe en la ${board.name}`, a);
      return;
    }
    if (usage === 'analog' && !board.isAdc(v)) {
      err(`GPIO${v} no tiene ADC. En el ESP32-S3 las entradas analógicas son GPIO1..GPIO20`, a);
      return;
    }
    const w = board.pinWarning?.(v, usage === 'any' ? 'output' : usage);
    if (w) err(w, a, 'warning');
  };

  const constValue = (e: Expr): number | null => {
    if (e.kind === 'num') return e.value;
    if (e.kind === 'ident' && CONSTANTS[e.name] && !lookup(e.name)) return CONSTANTS[e.name].value;
    if (e.kind === 'ident') {
      // const int LED = 4;
      const g = globalConsts.get(e.name);
      if (g !== undefined && lookup(e.name)?.isConst) return g;
    }
    return null;
  };
  const globalConsts = new Map<string, number>();

  const expr = (e: Expr): ValType => {
    const t = exprInner(e);
    e.t = t;
    return t;
  };

  const exprInner = (e: Expr): ValType => {
    switch (e.kind) {
      case 'num':
        return e.t === 'bool' ? 'bool' : e.isFloat ? 'float' : 'int';
      case 'str':
        return 'string';
      case 'ident': {
        const s = lookup(e.name);
        if (s) return s.isArray ? 'array' : s.vt;
        if (CONSTANTS[e.name]) return CONSTANTS[e.name].t;
        if (GLOBAL_OBJECTS[e.name]) {
          const cls = GLOBAL_OBJECTS[e.name];
          if (cls === 'TwoWire' && !included.has('Wire.h') && !included.has('Adafruit_SSD1306.h')) {
            err(`'Wire' no está declarado: añade #include <Wire.h>`, e);
          }
          return 'obj';
        }
        if (prog.functions.has(e.name)) return 'any'; // referencia a función (attachInterrupt)
        if (FUNCTIONS[e.name]) {
          err(`'${e.name}' es una función: ¿olvidaste los paréntesis '()'?`, e);
          return 'any';
        }
        err(`'${e.name}' no está declarado`, e);
        return 'any';
      }
      case 'unary': {
        const t = expr(e.arg);
        if (e.op === '!') return 'bool';
        if (!numeric(t)) err(`El operador '${e.op}' no se puede aplicar a un valor de tipo ${t}`, e);
        if (e.op === '~') return 'int';
        return t === 'bool' || t === 'char' ? 'int' : t;
      }
      case 'update': {
        const t = expr(e.arg);
        lvalue(e.arg);
        if (!numeric(t)) err(`'${e.op}' solo se puede usar con números`, e);
        return t;
      }
      case 'binary': {
        const a = expr(e.left);
        const b = expr(e.right);
        const op = e.op;
        if (op === ',') return b;
        if (op === '+' && (a === 'string' || b === 'string')) return 'string';
        if (['==', '!=', '<', '>', '<=', '>='].includes(op)) {
          if ((a === 'string') !== (b === 'string') && a !== 'any' && b !== 'any') {
            err('No se puede comparar un String con un número', e);
          }
          return 'bool';
        }
        if (!numeric(a) || !numeric(b)) {
          err(`El operador '${op}' no se puede aplicar a ${a} y ${b}`, e);
          return 'any';
        }
        if (['&', '|', '^', '<<', '>>', '%'].includes(op)) {
          if (a === 'float' || b === 'float') err(`El operador '${op}' no se puede usar con números decimales (float)`, e);
          return 'int';
        }
        return arith(a, b);
      }
      case 'logical':
        expr(e.left);
        expr(e.right);
        return 'bool';
      case 'assign': {
        const tt = expr(e.target);
        const vt = expr(e.value);
        lvalue(e.target);
        if (tt === 'array') err('No se puede asignar un array completo; asigna sus elementos uno a uno', e);
        if (tt !== 'string' && tt !== 'any' && vt === 'string' && e.op === '=') {
          err('No se puede asignar un String a una variable numérica', e);
        }
        if (e.op !== '=' && e.op !== '+=' && tt === 'string') err(`'${e.op}' no es válido con String`, e);
        if (e.value.kind === 'init') err('Las listas {..} solo se pueden usar al declarar', e.value);
        return tt;
      }
      case 'cond': {
        expr(e.test);
        const a = expr(e.a);
        const b = expr(e.b);
        if (a === 'string' || b === 'string') return 'string';
        return a === b ? a : arith(a, b);
      }
      case 'call':
        return call(e);
      case 'member':
        expr(e.object);
        err(`Acceso a '${e.prop}' no soportado: solo se pueden llamar métodos, p. ej. objeto.${e.prop}()`, e);
        return 'any';
      case 'index': {
        const ot = expr(e.object);
        const it = expr(e.index);
        if (it === 'float') err('El índice de un array debe ser un entero', e.index);
        if (ot === 'string') return 'char';
        if (ot !== 'array' && ot !== 'any') {
          err('Solo se pueden indexar arrays y Strings', e);
          return 'any';
        }
        if (e.object.kind === 'ident') {
          const s = lookup(e.object.name);
          if (s?.type) {
            const constIdx = constValue(e.index);
            const size = arraySizes.get(s);
            if (constIdx !== null && size !== undefined && (constIdx < 0 || constIdx >= size)) {
              err(`Índice ${constIdx} fuera de rango: '${e.object.name}' tiene ${size} elementos (0..${size - 1})`, e.index, 'warning');
            }
            return valTypeOf(s.type);
          }
        }
        return 'any';
      }
      case 'cast':
        expr(e.arg);
        return valTypeOf(e.type);
      case 'sizeof':
        if (e.arg) expr(e.arg);
        return 'int';
      case 'init':
        e.items.forEach(expr);
        return 'array';
    }
  };

  const arraySizes = new Map<Sym, number>();

  const lvalue = (e: Expr) => {
    if (e.kind === 'ident') {
      const s = lookup(e.name);
      if (!s) {
        if (CONSTANTS[e.name]) err(`'${e.name}' es una constante y no se puede modificar`, e);
        return;
      }
      if (s.isConst) err(`'${e.name}' es const y no se puede modificar`, e);
    } else if (e.kind === 'index') {
      if (e.object.kind === 'ident') {
        const s = lookup(e.object.name);
        if (s?.isConst) err(`'${e.object.name}' es const y no se puede modificar`, e);
        if (s?.vt === 'string' && !s.isArray) err('Para modificar un carácter de un String usa setCharAt()', e);
      }
    } else {
      err('Esta expresión no se puede modificar', e);
    }
  };

  const argCount = (name: string, min: number, max: number, e: Expr & { kind: 'call' }) => {
    const n = e.args.length;
    if (n < min || n > max) {
      const exp = min === max ? `${min}` : max >= 16 ? `al menos ${min}` : `entre ${min} y ${max}`;
      err(`${name}() espera ${exp} argumento${min === 1 && max === 1 ? '' : 's'}, pero recibe ${n}`, e);
    }
  };

  const call = (e: Expr & { kind: 'call' }): ValType => {
    const types = e.args.map(expr);
    const callee = e.callee;
    if (callee.kind === 'ident') {
      const name = callee.name;
      if (lookup(name)) {
        err(`'${name}' es una variable, no una función`, callee);
        return 'any';
      }
      const user = prog.functions.get(name);
      if (user) {
        argCount(name, user.params.length, user.params.length, e);
        user.params.forEach((p, i) => {
          if (p.isRef && e.args[i] && e.args[i].kind !== 'ident' && e.args[i].kind !== 'index') {
            err(`El parámetro '${p.name}' es una referencia (&): hay que pasar una variable`, e.args[i]);
          }
        });
        return valTypeOf(user.ret);
      }
      if (name === 'String') {
        argCount('String', 0, 2, e);
        return 'string';
      }
      const fn = FUNCTIONS[name];
      if (fn) {
        argCount(name, fn.min, fn.max, e);
        checkPinArg(name, e.args);
        if (name === 'attachInterrupt' && e.args[1]) {
          const a = e.args[1];
          if (a.kind !== 'ident' || !prog.functions.has(a.name)) err('El segundo argumento de attachInterrupt debe ser el nombre de una función', a);
        }
        if (fn.ret === 'any') return types.some((t) => t === 'float') ? 'float' : 'int';
        return fn.ret;
      }
      if (CLASSES[name]) {
        err(`'${name}' es un tipo; declara un objeto: ${name} miObjeto;`, callee);
        return 'any';
      }
      const similar = suggest(name);
      err(`La función '${name}' no existe${similar ? `. ¿Quisiste decir '${similar}'?` : ''}`, callee);
      return 'any';
    }
    if (callee.kind === 'member') {
      const ot = expr(callee.object);
      callee.t = 'any';
      if (ot === 'string') {
        const sm = STRING_METHODS[callee.prop];
        if (!sm) {
          err(`String no tiene el método '${callee.prop}()'`, callee);
          return 'any';
        }
        argCount(callee.prop, sm.min, sm.max, e);
        if (sm.mutates) {
          if (callee.object.kind !== 'ident') err(`${callee.prop}() modifica el String: debe llamarse sobre una variable`, callee);
          else lvalue(callee.object);
        }
        return sm.ret;
      }
      if (ot === 'obj') {
        const cls = objClass(callee.object);
        if (!cls) return 'any';
        const md = CLASSES[cls]?.methods[callee.prop];
        if (!md) {
          err(`${cls} no tiene el método '${callee.prop}()'`, callee);
          return 'any';
        }
        argCount(callee.prop, md.min, md.max, e);
        return md.ret;
      }
      if (ot !== 'any') err(`No se pueden llamar métodos sobre un valor de tipo ${ot}`, callee);
      return 'any';
    }
    err('Llamada no válida', e);
    return 'any';
  };

  const objClass = (e: Expr): string | null => {
    if (e.kind === 'ident') {
      const s = lookup(e.name);
      if (s?.type?.className) return s.type.className;
      if (GLOBAL_OBJECTS[e.name]) return GLOBAL_OBJECTS[e.name];
    }
    if (e.kind === 'index' && e.object.kind === 'ident') {
      const s = lookup(e.object.name);
      if (s?.type?.className) return s.type.className;
    }
    return null;
  };

  const suggest = (name: string): string | null => {
    const lower = name.toLowerCase();
    const all = [...Object.keys(FUNCTIONS), ...prog.functions.keys()];
    return all.find((n) => n.toLowerCase() === lower) ?? all.find((n) => lev(n.toLowerCase(), lower) <= 2) ?? null;
  };

  // ---------------------------------------------------------------- stmt
  const decl = (s: Stmt & { kind: 'decl' }) => {
    for (const d of s.decls) {
      if (d.type.base === 'object') {
        const def = CLASSES[d.type.className!];
        if (def?.include && !included.has(def.include) && !(d.type.className === 'Servo' && included.has('Servo.h'))) {
          err(`'${d.type.className}' no está declarado: añade #include <${def.include}>`, d);
        }
        if (d.ctorArgs) {
          d.ctorArgs.forEach(expr);
          if (def && (d.ctorArgs.length < def.ctorMin || d.ctorArgs.length > def.ctorMax)) {
            err(`Número de argumentos incorrecto al crear ${d.type.className}`, d);
          }
        }
        if (d.init) err('Los objetos no se pueden inicializar con =', d);
      }
      if (d.arraySize !== null && d.arraySize !== -1) {
        const t = expr(d.arraySize);
        if (t === 'float') err('El tamaño de un array debe ser entero', d.arraySize);
      }
      if (d.init) {
        if (d.init.kind === 'init') {
          if (d.arraySize === null) err(`'${d.name}' no es un array: no puede inicializarse con {..}`, d.init);
          d.init.items.forEach((it) => {
            const t = expr(it);
            if (d.type.base !== 'string' && t === 'string') err('Valor String en un array numérico', it);
          });
          d.init.t = 'array';
        } else {
          const t = expr(d.init);
          if (d.arraySize !== null && !(t === 'string' && d.type.bits === 8)) err('Un array se inicializa con una lista {a, b, c}', d.init);
          if (d.arraySize === null && d.type.base !== 'string' && t === 'string') {
            err(`No se puede asignar un texto a '${d.name}' de tipo ${d.type.text}; usa String`, d.init);
          }
        }
      } else if (d.type.isConst) {
        err(`La constante '${d.name}' debe inicializarse`, d);
      }
      const sym: Sym = { type: d.type, vt: valTypeOf(d.type), isArray: d.arraySize !== null, isConst: !!d.type.isConst };
      declare(d.name, sym, d);
      if (sym.isArray) {
        let size: number | undefined;
        if (d.arraySize === -1) size = d.init?.kind === 'init' ? d.init.items.length : d.init?.kind === 'str' ? d.init.value.length + 1 : undefined;
        else if (d.arraySize) size = constValue(d.arraySize) ?? undefined;
        if (size !== undefined) arraySizes.set(sym, size);
      }
      if (sym.isConst && !sym.isArray && d.init && d.init.kind === 'num' && scopes.length === 1) globalConsts.set(d.name, d.init.value);
    }
  };

  const condCheck = (e: Expr) => {
    expr(e);
    if (e.kind === 'assign' && e.op === '=') err("Asignación '=' dentro de una condición. ¿Querías comparar con '=='?", e, 'warning');
  };

  const stmt = (s: Stmt) => {
    switch (s.kind) {
      case 'decl':
        decl(s);
        break;
      case 'expr':
        expr(s.expr);
        if (s.expr.kind === 'binary' && s.expr.op === '==' ) err("Comparación '==' sin efecto. ¿Querías asignar con '='?", s.expr, 'warning');
        break;
      case 'block':
        scopes.push(new Map());
        s.body.forEach(stmt);
        scopes.pop();
        break;
      case 'if':
        condCheck(s.test);
        stmt(s.then);
        if (s.else) stmt(s.else);
        if (s.then.kind === 'empty') err("';' justo después del if: el bloque siguiente se ejecutará siempre", s.then, 'warning');
        break;
      case 'while':
      case 'dowhile':
        condCheck(s.test);
        loopDepth++;
        stmt(s.body);
        loopDepth--;
        break;
      case 'for':
        scopes.push(new Map());
        if (s.init) stmt(s.init);
        if (s.test) condCheck(s.test);
        if (s.update) expr(s.update);
        loopDepth++;
        stmt(s.body);
        loopDepth--;
        scopes.pop();
        break;
      case 'switch': {
        const t = expr(s.disc);
        if (t === 'float' || t === 'string') err('switch solo admite valores enteros', s.disc);
        switchDepth++;
        scopes.push(new Map());
        for (const c of s.cases) {
          if (c.test) expr(c.test);
          c.body.forEach(stmt);
        }
        scopes.pop();
        switchDepth--;
        break;
      }
      case 'break':
        if (loopDepth === 0 && switchDepth === 0) err("'break' fuera de un bucle o switch", s);
        break;
      case 'continue':
        if (loopDepth === 0) err("'continue' fuera de un bucle", s);
        break;
      case 'return':
        if (s.value) {
          const t = expr(s.value);
          if (currentFn?.ret.base === 'void') err(`La función '${currentFn.name}' es void y no puede devolver un valor`, s);
          else if (t === 'string' && currentFn?.ret.base !== 'string') err('Se devuelve un String en una función numérica', s);
        } else if (currentFn && currentFn.ret.base !== 'void') {
          err(`La función '${currentFn.name}' debe devolver un valor de tipo ${currentFn.ret.text}`, s);
        }
        break;
      case 'empty':
        break;
    }
  };

  // ---------------------------------------------------------------- programa
  for (const g of prog.globals) decl(g);
  for (const fn of prog.functions.values()) {
    if (FUNCTIONS[fn.name]) err(`'${fn.name}' ya existe como función de Arduino; tu versión la sustituye. Mejor usa otro nombre`, fn, 'warning');
    currentFn = fn;
    scopes.push(new Map());
    for (const p of fn.params) {
      declare(p.name, { type: p.type, vt: valTypeOf(p.type), isArray: p.isArray, isConst: !!p.type.isConst }, fn);
    }
    fn.body.body.forEach(stmt);
    scopes.pop();
    if (fn.ret.base !== 'void' && !returnsAlways(fn.body)) {
      err(`La función '${fn.name}' puede terminar sin devolver un valor`, { line: fn.line, pos: fn.body.end - 1, end: fn.body.end }, 'warning');
    }
  }
  currentFn = null;

  const setup = prog.functions.get('setup');
  const loop = prog.functions.get('loop');
  const endNode = { line: 1, pos: 0, end: 1 };
  if (!setup) err('Falta la función void setup()', endNode);
  if (!loop) err('Falta la función void loop()', endNode);
  for (const f of [setup, loop]) {
    if (f && f.params.length) err(`${f.name}() no debe tener parámetros`, f);
  }
  return diags;
}

function returnsAlways(s: Stmt): boolean {
  switch (s.kind) {
    case 'return':
      return true;
    case 'block':
      return s.body.some(returnsAlways);
    case 'if':
      return !!s.else && returnsAlways(s.then) && returnsAlways(s.else);
    case 'while':
      return s.test.kind === 'num' && s.test.value !== 0;
    case 'for':
      return s.test === null;
    default:
      return false;
  }
}

function lev(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 2) return 99;
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function compileErrorToDiag(e: CompileError): Diagnostic {
  return { message: e.message, line: e.line, from: e.from, to: e.to, severity: e.severity };
}
