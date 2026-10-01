// Preprocesador + parser descendente recursivo para el subconjunto Arduino/C++.

import type { Declarator, Expr, FuncDecl, Param, Program, Stmt, VarType } from './ast';
import { CompileError, tokenize, type Token } from './lexer';
import { CLASSES } from './library';

const TYPE_WORDS = new Set([
  'void', 'int', 'long', 'short', 'unsigned', 'signed', 'float', 'double', 'bool', 'boolean', 'char',
  'byte', 'word', 'String', 'auto',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'size_t',
]);
const QUALIFIERS = new Set(['const', 'static', 'volatile']);

interface Preprocessed {
  source: string;
  defines: Map<string, { tokens: Token[]; line: number }>;
  includes: Program['includes'];
}

/** Elimina las directivas # (manteniendo números de línea) y recoge #define / #include */
function preprocess(src: string): Preprocessed {
  const lines = src.split('\n');
  const defines = new Map<string, { tokens: Token[]; line: number }>();
  const includes: Program['includes'] = [];
  let offset = 0;
  const out: string[] = [];
  lines.forEach((raw, idx) => {
    const trimmed = raw.trim();
    const lineNo = idx + 1;
    if (trimmed.startsWith('#')) {
      const m = /^#\s*(\w+)\s*(.*)$/.exec(trimmed);
      const directive = m?.[1] ?? '';
      const rest = (m?.[2] ?? '').replace(/\/\/.*$/, '').trim();
      const col = raw.indexOf('#');
      if (directive === 'include') {
        const inc = /^[<"]([^>"]+)[>"]/.exec(rest);
        includes.push({ name: inc ? inc[1] : rest, line: lineNo, pos: offset + col, end: offset + raw.length });
      } else if (directive === 'define') {
        const dm = /^([A-Za-z_]\w*)(\(?)\s*(.*)$/.exec(rest);
        if (!dm) throw new CompileError('#define mal formado', lineNo, col + 1, offset + col, offset + raw.length);
        if (dm[2] === '(') {
          throw new CompileError(
            'Las macros con parámetros no están soportadas; usa una función',
            lineNo, col + 1, offset + col, offset + raw.length,
          );
        }
        let toks: Token[] = [];
        try {
          toks = tokenize(dm[3]).filter((t) => t.type !== 'eof');
        } catch (e) {
          if (e instanceof CompileError) throw new CompileError(e.message, lineNo, col + 1, offset + col, offset + raw.length);
          throw e;
        }
        defines.set(dm[1], { tokens: toks, line: lineNo });
      } else if (!['ifndef', 'ifdef', 'endif', 'pragma', 'undef', 'if', 'else', 'elif'].includes(directive)) {
        throw new CompileError(`Directiva #${directive} no soportada`, lineNo, col + 1, offset + col, offset + raw.length);
      }
      out.push(' '.repeat(raw.length));
    } else {
      out.push(raw);
    }
    offset += raw.length + 1;
  });
  return { source: out.join('\n'), defines, includes };
}

function expandDefines(tokens: Token[], defines: Preprocessed['defines']): Token[] {
  if (defines.size === 0) return tokens;
  const out: Token[] = [];
  const expand = (t: Token, depth: number) => {
    const d = t.type === 'id' ? defines.get(t.value) : undefined;
    if (!d || depth > 16) {
      out.push(t);
      return;
    }
    for (const dt of d.tokens) expand({ ...dt, line: t.line, col: t.col, pos: t.pos, end: t.end }, depth + 1);
  };
  for (const t of tokens) expand(t, 0);
  return out;
}

export function parse(src: string): Program {
  const pp = preprocess(src);
  const tokens = expandDefines(tokenize(pp.source), pp.defines);
  const p = new Parser(tokens);
  const prog = p.parseProgram();
  prog.includes = pp.includes;
  return prog;
}

class Parser {
  private i = 0;
  constructor(private toks: Token[]) {}

  private get cur(): Token {
    return this.toks[this.i];
  }
  private peek(o = 1): Token {
    return this.toks[Math.min(this.i + o, this.toks.length - 1)];
  }
  private next(): Token {
    const t = this.toks[this.i];
    if (this.i < this.toks.length - 1) this.i++;
    return t;
  }
  private is(value: string, t: Token = this.cur): boolean {
    return (t.type === 'op' || t.type === 'kw') && t.value === value;
  }
  private accept(value: string): boolean {
    if (this.is(value)) {
      this.next();
      return true;
    }
    return false;
  }
  private error(msg: string, t: Token = this.cur): never {
    throw new CompileError(msg, t.line, t.col, t.pos, Math.max(t.end, t.pos + 1));
  }
  private expect(value: string, what?: string): Token {
    if (!this.is(value)) {
      // en caso de ';' olvidado, señalamos el final del token anterior
      if (value === ';' && this.i > 0) {
        const prev = this.toks[this.i - 1];
        throw new CompileError(`Falta ';' después de '${prev.value}'`, prev.line, prev.col, prev.pos, prev.end);
      }
      this.error(`Se esperaba '${value}'${what ? ` ${what}` : ''} pero se encontró '${this.cur.value}'`);
    }
    return this.next();
  }
  private expectId(what: string): Token {
    if (this.cur.type !== 'id') this.error(`Se esperaba ${what} pero se encontró '${this.cur.value}'`);
    return this.next();
  }

  // ---------------------------------------------------------------- tipos

  private isClassName(t: Token): boolean {
    return t.type === 'id' && Object.prototype.hasOwnProperty.call(CLASSES, t.value);
  }

  /** ¿empieza aquí una declaración? */
  private atTypeStart(): boolean {
    const t = this.cur;
    if (t.type === 'kw' && (TYPE_WORDS.has(t.value) || QUALIFIERS.has(t.value))) return true;
    // Clase conocida seguida de identificador: Servo s;
    if (this.isClassName(t) && this.peek().type === 'id') return true;
    return false;
  }

  private parseType(): VarType {
    const start = this.cur;
    let isConst = false;
    let isStatic = false;
    const words: string[] = [];
    while (this.cur.type === 'kw' && QUALIFIERS.has(this.cur.value)) {
      if (this.cur.value === 'const') isConst = true;
      if (this.cur.value === 'static') isStatic = true;
      this.next();
    }
    if (this.isClassName(this.cur)) {
      const name = this.next().value;
      return { base: 'object', className: name, isConst, isStatic, text: name };
    }
    while (this.cur.type === 'kw' && (TYPE_WORDS.has(this.cur.value) || QUALIFIERS.has(this.cur.value))) {
      const w = this.next().value;
      if (w === 'const') isConst = true;
      else if (w === 'static') isStatic = true;
      else if (!QUALIFIERS.has(w)) words.push(w);
    }
    if (words.length === 0) this.error('Se esperaba un tipo', start);
    const text = words.join(' ');
    const unsigned = words.includes('unsigned');
    const core = words.filter((w) => w !== 'unsigned' && w !== 'signed');
    const w0 = core[0] ?? 'int';
    const mk = (base: VarType['base'], bits?: number, uns = unsigned): VarType => ({ base, bits, unsigned: uns, isConst, isStatic, text });
    switch (w0) {
      case 'void': return mk('void');
      case 'float':
      case 'double': return mk('float');
      case 'bool':
      case 'boolean': return mk('bool');
      case 'String': return mk('string');
      case 'char': return mk('int', 8);
      case 'byte':
      case 'uint8_t': return mk('int', 8, true);
      case 'int8_t': return mk('int', 8, false);
      case 'short':
      case 'int16_t': return mk('int', 16);
      case 'word':
      case 'uint16_t': return mk('int', 16, true);
      case 'uint32_t':
      case 'size_t': return mk('int', 32, true);
      case 'int32_t': return mk('int', 32, false);
      case 'uint64_t': return mk('int', 64, true);
      case 'int64_t': return mk('int', 64, false);
      case 'auto': return mk('float'); // simplificación
      case 'long':
        return core.filter((w) => w === 'long').length > 1 ? mk('int', 64) : mk('int', 32);
      case 'int':
      default:
        return mk('int', 32);
    }
  }

  // ------------------------------------------------------------- programa

  parseProgram(): Program {
    const globals: Program['globals'] = [];
    const functions = new Map<string, FuncDecl>();
    while (this.cur.type !== 'eof') {
      if (this.accept(';')) continue;
      if (!this.atTypeStart()) {
        if (this.cur.type === 'id' && this.peek().type === 'id') {
          this.error(`Tipo desconocido '${this.cur.value}'. ¿Falta el #include de la librería o no está soportada?`);
        }
        this.error(`Se esperaba una declaración o una función, no '${this.cur.value}'`);
      }
      const startTok = this.cur;
      const type = this.parseType();
      const nameTok = this.expectId('un nombre');
      if (this.is('(') && type.base !== 'object') {
        const fn = this.parseFunction(type, nameTok, startTok);
        if (fn) {
          if (functions.has(fn.name)) {
            throw new CompileError(`La función '${fn.name}' está definida dos veces`, nameTok.line, nameTok.col, nameTok.pos, nameTok.end);
          }
          functions.set(fn.name, fn);
        }
        continue;
      }
      globals.push(this.finishDecl(type, nameTok, startTok));
    }
    return { globals, functions, includes: [] };
  }

  private parseFunction(ret: VarType, nameTok: Token, startTok: Token): FuncDecl | null {
    this.expect('(');
    const params: Param[] = [];
    if (!this.is(')')) {
      if (this.is('void') && this.is(')', this.peek())) {
        this.next();
      } else {
        do {
          const pt = this.parseType();
          const isRef = this.accept('&');
          if (this.is('*')) this.error('Los punteros no están soportados en este simulador');
          const pn = this.expectId('el nombre del parámetro');
          let isArray = false;
          if (this.accept('[')) {
            if (!this.is(']')) this.parseExpr();
            this.expect(']');
            isArray = true;
          }
          params.push({ name: pn.value, type: pt, isArray, isRef });
        } while (this.accept(','));
      }
    }
    this.expect(')', 'para cerrar los parámetros');
    if (this.accept(';')) return null; // prototipo
    if (!this.is('{')) this.error(`Se esperaba '{' para el cuerpo de '${nameTok.value}'`);
    const body = this.parseBlock();
    return {
      name: nameTok.value, ret, params, body,
      pos: startTok.pos, end: body.end, line: nameTok.line,
    };
  }

  private finishDecl(type: VarType, firstName: Token, startTok: Token): Stmt & { kind: 'decl' } {
    const decls: Declarator[] = [];
    let nameTok = firstName;
    for (;;) {
      if (type.base === 'void') this.error(`Una variable no puede ser de tipo void`, nameTok);
      const d: Declarator = {
        name: nameTok.value, type, arraySize: null, init: null, ctorArgs: null,
        pos: nameTok.pos, end: nameTok.end, line: nameTok.line,
      };
      if (this.accept('[')) {
        if (this.is(']')) d.arraySize = -1;
        else d.arraySize = this.parseExpr();
        this.expect(']');
        if (this.is('[')) this.error('Los arrays multidimensionales no están soportados');
      }
      if (this.is('(') && d.arraySize === null) {
        this.next();
        const args: Expr[] = [];
        if (!this.is(')')) {
          do args.push(this.parseAssign());
          while (this.accept(','));
        }
        this.expect(')');
        if (type.base === 'object') d.ctorArgs = args;
        else if (args.length === 1) d.init = args[0];
        else this.error('Inicialización no válida');
      } else if (this.accept('=')) {
        d.init = this.is('{') ? this.parseInitList() : this.parseAssign();
      } else if (this.is('{')) {
        d.init = this.parseInitList();
      }
      if (d.arraySize === -1 && !(d.init && d.init.kind === 'init') && !(d.init && d.init.kind === 'str')) {
        this.error(`El array '${d.name}' necesita un tamaño o un inicializador`, nameTok);
      }
      decls.push(d);
      if (!this.accept(',')) break;
      nameTok = this.expectId('un nombre de variable');
    }
    this.expect(';');
    const last = this.toks[this.i - 1];
    return { kind: 'decl', decls, pos: startTok.pos, end: last.end, line: startTok.line };
  }

  private parseInitList(): Expr {
    const start = this.expect('{');
    const items: Expr[] = [];
    if (!this.is('}')) {
      do {
        if (this.is('}')) break;
        items.push(this.is('{') ? this.parseInitList() : this.parseAssign());
      } while (this.accept(','));
    }
    const end = this.expect('}');
    return { kind: 'init', items, pos: start.pos, end: end.end, line: start.line };
  }

  // ---------------------------------------------------------- sentencias

  private parseBlock(): Stmt & { kind: 'block' } {
    const start = this.expect('{');
    const body: Stmt[] = [];
    while (!this.is('}')) {
      if (this.cur.type === 'eof') this.error("Falta '}' para cerrar el bloque", start);
      body.push(this.parseStatement());
    }
    const end = this.next();
    return { kind: 'block', body, pos: start.pos, end: end.end, line: start.line };
  }

  private parseStatement(): Stmt {
    const t = this.cur;
    const base = { pos: t.pos, line: t.line };
    if (this.is('{')) return this.parseBlock();
    if (this.accept(';')) return { kind: 'empty', ...base, end: t.end };
    if (t.type === 'kw') {
      switch (t.value) {
        case 'if': {
          this.next();
          this.expect('(', "después de 'if'");
          const test = this.parseExpr();
          this.expect(')', 'para cerrar la condición');
          const then = this.parseStatement();
          const els = this.accept('else') ? this.parseStatement() : null;
          return { kind: 'if', test, then, else: els, ...base, end: (els ?? then).end };
        }
        case 'while': {
          this.next();
          this.expect('(', "después de 'while'");
          const test = this.parseExpr();
          this.expect(')', 'para cerrar la condición');
          const body = this.parseStatement();
          return { kind: 'while', test, body, ...base, end: body.end };
        }
        case 'do': {
          this.next();
          const body = this.parseStatement();
          this.expect('while', "después del cuerpo de 'do'");
          this.expect('(');
          const test = this.parseExpr();
          this.expect(')');
          const e = this.expect(';');
          return { kind: 'dowhile', test, body, ...base, end: e.end };
        }
        case 'for': {
          this.next();
          this.expect('(', "después de 'for'");
          let init: Stmt | null = null;
          if (this.accept(';')) init = null;
          else if (this.atTypeStart()) {
            const st = this.cur;
            const ty = this.parseType();
            init = this.finishDecl(ty, this.expectId('un nombre de variable'), st);
          } else {
            const e = this.parseExpr();
            init = { kind: 'expr', expr: e, pos: e.pos, end: e.end, line: e.line };
            this.expect(';');
          }
          const test = this.is(';') ? null : this.parseExpr();
          this.expect(';');
          const update = this.is(')') ? null : this.parseExpr();
          this.expect(')', "para cerrar el 'for'");
          const body = this.parseStatement();
          return { kind: 'for', init, test, update, body, ...base, end: body.end };
        }
        case 'switch': {
          this.next();
          this.expect('(');
          const disc = this.parseExpr();
          this.expect(')');
          this.expect('{');
          const cases: { test: Expr | null; body: Stmt[] }[] = [];
          while (!this.is('}')) {
            if (this.accept('case')) {
              const test = this.parseTernary();
              this.expect(':');
              cases.push({ test, body: [] });
            } else if (this.accept('default')) {
              this.expect(':');
              cases.push({ test: null, body: [] });
            } else {
              if (cases.length === 0) this.error("Se esperaba 'case' o 'default'");
              if (this.cur.type === 'eof') this.error("Falta '}' en el switch");
              cases[cases.length - 1].body.push(this.parseStatement());
            }
          }
          const e = this.next();
          return { kind: 'switch', disc, cases, ...base, end: e.end };
        }
        case 'break': {
          this.next();
          const e = this.expect(';');
          return { kind: 'break', ...base, end: e.end };
        }
        case 'continue': {
          this.next();
          const e = this.expect(';');
          return { kind: 'continue', ...base, end: e.end };
        }
        case 'return': {
          this.next();
          const value = this.is(';') ? null : this.parseExpr();
          const e = this.expect(';');
          return { kind: 'return', value, ...base, end: e.end };
        }
        case 'else':
          this.error("'else' sin 'if' correspondiente");
      }
    }
    if (this.atTypeStart()) {
      const ty = this.parseType();
      return this.finishDecl(ty, this.expectId('un nombre de variable'), t);
    }
    if (t.type === 'id' && this.peek().type === 'id') {
      this.error(`Tipo desconocido '${t.value}'`);
    }
    const expr = this.parseExpr();
    const e = this.expect(';');
    return { kind: 'expr', expr, ...base, end: e.end };
  }

  // -------------------------------------------------------- expresiones

  parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.is(',')) {
      // operador coma: evaluamos ambos y devolvemos el último
      this.next();
      const r = this.parseAssign();
      e = { kind: 'binary', op: ',', left: e, right: r, pos: e.pos, end: r.end, line: e.line };
    }
    return e;
  }

  private parseAssign(): Expr {
    const left = this.parseTernary();
    const t = this.cur;
    if (t.type === 'op' && ['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>='].includes(t.value)) {
      this.next();
      const value = this.parseAssign();
      if (left.kind !== 'ident' && left.kind !== 'index') {
        throw new CompileError('Solo se puede asignar a una variable o a un elemento de un array', left.line, 1, left.pos, left.end);
      }
      return { kind: 'assign', op: t.value, target: left, value, pos: left.pos, end: value.end, line: left.line };
    }
    return left;
  }

  private parseTernary(): Expr {
    const test = this.parseBinary(0);
    if (this.accept('?')) {
      const a = this.parseAssign();
      this.expect(':', 'en el operador ternario');
      const b = this.parseAssign();
      return { kind: 'cond', test, a, b, pos: test.pos, end: b.end, line: test.line };
    }
    return test;
  }

  private static PREC: Record<string, number> = {
    '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
    '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
  };

  private parseBinary(minPrec: number): Expr {
    let left = this.parseUnary();
    for (;;) {
      const t = this.cur;
      const prec = t.type === 'op' ? Parser.PREC[t.value] : undefined;
      if (prec === undefined || prec <= minPrec) break;
      this.next();
      const right = this.parseBinary(prec);
      if (t.value === '&&' || t.value === '||') {
        left = { kind: 'logical', op: t.value, left, right, pos: left.pos, end: right.end, line: left.line };
      } else {
        left = { kind: 'binary', op: t.value, left, right, pos: left.pos, end: right.end, line: left.line };
      }
    }
    return left;
  }

  private parseUnary(): Expr {
    const t = this.cur;
    if (t.type === 'op') {
      if (t.value === '++' || t.value === '--') {
        this.next();
        const arg = this.parseUnary();
        return { kind: 'update', op: t.value, prefix: true, arg, pos: t.pos, end: arg.end, line: t.line };
      }
      if (['!', '-', '+', '~', '&'].includes(t.value)) {
        this.next();
        const arg = this.parseUnary();
        if (t.value === '&') return arg; // &Wire -> Wire (no hay punteros)
        return { kind: 'unary', op: t.value, arg, pos: t.pos, end: arg.end, line: t.line };
      }
      if (t.value === '*') this.error('Los punteros no están soportados en este simulador');
      // cast: (int) x
      if (t.value === '(' && this.peek().type === 'kw' && TYPE_WORDS.has(this.peek().value)) {
        this.next();
        const type = this.parseType();
        this.expect(')');
        const arg = this.parseUnary();
        return { kind: 'cast', type, arg, pos: t.pos, end: arg.end, line: t.line };
      }
    }
    if (this.is('sizeof')) {
      this.next();
      this.expect('(');
      let res: Expr;
      if (this.cur.type === 'kw' && TYPE_WORDS.has(this.cur.value)) {
        const type = this.parseType();
        res = { kind: 'sizeof', arg: null, type, pos: t.pos, end: this.cur.end, line: t.line };
      } else {
        const arg = this.parseExpr();
        res = { kind: 'sizeof', arg, type: null, pos: t.pos, end: this.cur.end, line: t.line };
      }
      this.expect(')');
      return res;
    }
    return this.parsePostfix();
  }

  private parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const t = this.cur;
      if (this.is('(')) {
        this.next();
        const args: Expr[] = [];
        if (!this.is(')')) {
          do args.push(this.parseAssign());
          while (this.accept(','));
        }
        const end = this.expect(')', 'para cerrar la llamada');
        e = { kind: 'call', callee: e, args, pos: e.pos, end: end.end, line: e.line };
      } else if (this.is('.') || this.is('->')) {
        this.next();
        const prop = this.expectId('un nombre de método');
        e = { kind: 'member', object: e, prop: prop.value, pos: e.pos, end: prop.end, line: e.line };
      } else if (this.is('[')) {
        this.next();
        const index = this.parseExpr();
        const end = this.expect(']');
        e = { kind: 'index', object: e, index, pos: e.pos, end: end.end, line: e.line };
      } else if (this.is('++') || this.is('--')) {
        this.next();
        e = { kind: 'update', op: t.value as '++' | '--', prefix: false, arg: e, pos: e.pos, end: t.end, line: e.line };
      } else if (this.is('::')) {
        // Clase::CONSTANTE -> tratamos como identificador
        this.next();
        const id = this.expectId('un identificador');
        if (e.kind !== 'ident') this.error("Uso de '::' no soportado");
        e = { kind: 'ident', name: id.value, pos: e.pos, end: id.end, line: e.line };
      } else break;
    }
    return e;
  }

  private parsePrimary(): Expr {
    const t = this.cur;
    const base = { pos: t.pos, end: t.end, line: t.line };
    switch (t.type) {
      case 'num':
        this.next();
        return { kind: 'num', value: t.num!, isFloat: !!t.isFloat, ...base };
      case 'char':
        this.next();
        return { kind: 'num', value: t.num!, isFloat: false, ...base };
      case 'str': {
        this.next();
        let value = t.value;
        // concatenación de literales adyacentes "a" "b"
        while (this.cur.type === 'str') value += this.next().value;
        return { kind: 'str', value, ...base, end: this.toks[this.i - 1].end };
      }
      case 'id':
        this.next();
        return { kind: 'ident', name: t.value, ...base };
      case 'kw':
        if (t.value === 'true' || t.value === 'false') {
          this.next();
          return { kind: 'num', value: t.value === 'true' ? 1 : 0, isFloat: false, ...base, t: 'bool' } as Expr;
        }
        if (t.value === 'String') {
          // String(x) como conversión
          this.next();
          return { kind: 'ident', name: 'String', ...base };
        }
        if (TYPE_WORDS.has(t.value) && this.is('(', this.peek())) {
          // int(x), float(x)... estilo función
          const type = this.parseType();
          this.expect('(');
          const arg = this.parseExpr();
          const end = this.expect(')');
          return { kind: 'cast', type, arg, pos: t.pos, end: end.end, line: t.line };
        }
        this.error(`Palabra reservada '${t.value}' inesperada`);
        break;
      case 'op':
        if (t.value === '(') {
          this.next();
          const e = this.parseExpr();
          this.expect(')', 'para cerrar el paréntesis');
          return e;
        }
        if (t.value === '{') return this.parseInitList();
        break;
      case 'eof':
        this.error('Fin del código inesperado. ¿Falta cerrar algún bloque?');
    }
    this.error(`Expresión no válida: '${t.value}'`);
  }
}
