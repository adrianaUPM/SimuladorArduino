// Analizador léxico para el subconjunto Arduino/C++ soportado.

export type TokenType = 'num' | 'str' | 'char' | 'id' | 'kw' | 'op' | 'eof';

export interface Token {
  type: TokenType;
  value: string;
  /** valor numérico para literales */
  num?: number;
  /** true si el literal numérico es de coma flotante */
  isFloat?: boolean;
  line: number;
  col: number;
  pos: number;
  end: number;
}

export class CompileError extends Error {
  constructor(
    message: string,
    public line: number,
    public col: number,
    public from: number,
    public to: number,
    public severity: 'error' | 'warning' = 'error',
  ) {
    super(message);
  }
}

export const KEYWORDS = new Set([
  'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'default', 'break', 'continue', 'return',
  'void', 'int', 'long', 'short', 'unsigned', 'signed', 'float', 'double', 'bool', 'boolean', 'char',
  'byte', 'word', 'String', 'const', 'static', 'volatile', 'true', 'false', 'sizeof', 'auto',
  'uint8_t', 'uint16_t', 'uint32_t', 'uint64_t', 'int8_t', 'int16_t', 'int32_t', 'int64_t', 'size_t',
]);

// ordenados de mayor a menor longitud
const OPERATORS = [
  '<<=', '>>=', '...',
  '++', '--', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '==', '!=', '<=', '>=', '&&', '||', '<<', '>>', '->', '::',
  '+', '-', '*', '/', '%', '=', '<', '>', '!', '~', '&', '|', '^', '?', ':', ';', ',', '.', '(', ')', '{', '}', '[', ']',
];

export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  let line = 1;
  let lineStart = 0;
  const n = src.length;

  const push = (type: TokenType, value: string, start: number, extra: Partial<Token> = {}) => {
    tokens.push({ type, value, line, col: start - lineStart + 1, pos: start, end: i, ...extra });
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') {
      i++;
      line++;
      lineStart = i;
      continue;
    }
    if (c === ' ' || c === '\t' || c === '\r') {
      i++;
      continue;
    }
    // comentarios
    if (c === '/' && src[i + 1] === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const start = i;
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) {
        if (src[i] === '\n') {
          line++;
          lineStart = i + 1;
        }
        i++;
      }
      if (i >= n) throw new CompileError('Comentario /* sin cerrar', line, start - lineStart + 1, start, n);
      i += 2;
      continue;
    }
    const start = i;
    // números
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] ?? ''))) {
      let text: string;
      let num: number;
      let isFloat = false;
      if (c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X')) {
        i += 2;
        while (i < n && /[0-9a-fA-F]/.test(src[i])) i++;
        text = src.slice(start, i);
        num = parseInt(text.slice(2), 16);
      } else if (c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B')) {
        i += 2;
        while (i < n && /[01]/.test(src[i])) i++;
        text = src.slice(start, i);
        num = parseInt(text.slice(2), 2);
      } else {
        while (i < n && /[0-9]/.test(src[i])) i++;
        if (src[i] === '.') {
          isFloat = true;
          i++;
          while (i < n && /[0-9]/.test(src[i])) i++;
        }
        if (src[i] === 'e' || src[i] === 'E') {
          isFloat = true;
          i++;
          if (src[i] === '+' || src[i] === '-') i++;
          while (i < n && /[0-9]/.test(src[i])) i++;
        }
        text = src.slice(start, i);
        num = parseFloat(text);
      }
      // sufijos (UL, f, ...)
      while (i < n && /[uUlLfF]/.test(src[i])) {
        if (src[i] === 'f' || src[i] === 'F') isFloat = true;
        i++;
      }
      if (Number.isNaN(num)) throw new CompileError(`Número no válido: ${text}`, line, start - lineStart + 1, start, i);
      push('num', src.slice(start, i), start, { num, isFloat });
      continue;
    }
    // identificadores
    if (/[A-Za-z_]/.test(c)) {
      while (i < n && /[A-Za-z0-9_]/.test(src[i])) i++;
      const word = src.slice(start, i);
      push(KEYWORDS.has(word) ? 'kw' : 'id', word, start);
      continue;
    }
    // cadenas
    if (c === '"') {
      i++;
      let out = '';
      while (i < n && src[i] !== '"') {
        if (src[i] === '\n') throw new CompileError('Cadena sin cerrar', line, start - lineStart + 1, start, i);
        if (src[i] === '\\') {
          out += readEscape();
        } else {
          out += src[i++];
        }
      }
      if (i >= n) throw new CompileError('Cadena sin cerrar', line, start - lineStart + 1, start, i);
      i++;
      push('str', out, start);
      continue;
    }
    if (c === "'") {
      i++;
      let ch = '';
      if (src[i] === '\\') ch = readEscape();
      else ch = src[i++] ?? '';
      if (src[i] !== "'") throw new CompileError('Carácter mal formado', line, start - lineStart + 1, start, i);
      i++;
      push('char', ch, start, { num: ch.charCodeAt(0) });
      continue;
    }
    // operadores
    let matched = '';
    for (const op of OPERATORS) {
      if (src.startsWith(op, i)) {
        matched = op;
        break;
      }
    }
    if (matched) {
      i += matched.length;
      push('op', matched, start);
      continue;
    }
    throw new CompileError(`Carácter inesperado '${c}'`, line, start - lineStart + 1, start, start + 1);
  }
  tokens.push({ type: 'eof', value: '<fin>', line, col: i - lineStart + 1, pos: n, end: n });
  return tokens;

  function readEscape(): string {
    i++; // '\'
    const e = src[i++];
    switch (e) {
      case 'n': return '\n';
      case 't': return '\t';
      case 'r': return '\r';
      case '0': return '\0';
      case '\\': return '\\';
      case '"': return '"';
      case "'": return "'";
      default: return e ?? '';
    }
  }
}
