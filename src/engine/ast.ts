// Árbol sintáctico del subconjunto de C++ que interpreta el simulador.

/** Tipo "estático" inferido por el analizador semántico */
export type ValType = 'int' | 'char' | 'float' | 'bool' | 'string' | 'obj' | 'array' | 'void' | 'any';

export interface VarType {
  base: 'int' | 'float' | 'bool' | 'string' | 'void' | 'object';
  /** bits para enteros (8/16/32/64) */
  bits?: number;
  unsigned?: boolean;
  isConst?: boolean;
  /** variable local static: conserva su valor entre llamadas */
  isStatic?: boolean;
  /** nombre de clase para objetos (Servo, Adafruit_SSD1306...) */
  className?: string;
  /** texto original del tipo, para mensajes */
  text: string;
}

interface NodeBase {
  pos: number;
  end: number;
  line: number;
}

export type Expr =
  | (NodeBase & { kind: 'num'; value: number; isFloat: boolean; t?: ValType })
  | (NodeBase & { kind: 'str'; value: string; t?: ValType })
  | (NodeBase & { kind: 'ident'; name: string; t?: ValType })
  | (NodeBase & { kind: 'unary'; op: string; arg: Expr; t?: ValType })
  | (NodeBase & { kind: 'update'; op: '++' | '--'; prefix: boolean; arg: Expr; t?: ValType })
  | (NodeBase & { kind: 'binary'; op: string; left: Expr; right: Expr; t?: ValType })
  | (NodeBase & { kind: 'logical'; op: '&&' | '||'; left: Expr; right: Expr; t?: ValType })
  | (NodeBase & { kind: 'assign'; op: string; target: Expr; value: Expr; t?: ValType })
  | (NodeBase & { kind: 'cond'; test: Expr; a: Expr; b: Expr; t?: ValType })
  | (NodeBase & { kind: 'call'; callee: Expr; args: Expr[]; t?: ValType })
  | (NodeBase & { kind: 'member'; object: Expr; prop: string; t?: ValType })
  | (NodeBase & { kind: 'index'; object: Expr; index: Expr; t?: ValType })
  | (NodeBase & { kind: 'cast'; type: VarType; arg: Expr; t?: ValType })
  | (NodeBase & { kind: 'sizeof'; arg: Expr | null; type: VarType | null; t?: ValType })
  | (NodeBase & { kind: 'init'; items: Expr[]; t?: ValType });

export interface Declarator {
  name: string;
  type: VarType;
  /** null = escalar; número = tamaño de array; -1 = tamaño deducido del inicializador */
  arraySize: Expr | null | -1;
  init: Expr | null;
  ctorArgs: Expr[] | null;
  pos: number;
  end: number;
  line: number;
}

export type Stmt =
  | (NodeBase & { kind: 'decl'; decls: Declarator[] })
  | (NodeBase & { kind: 'expr'; expr: Expr })
  | (NodeBase & { kind: 'block'; body: Stmt[] })
  | (NodeBase & { kind: 'if'; test: Expr; then: Stmt; else: Stmt | null })
  | (NodeBase & { kind: 'while'; test: Expr; body: Stmt })
  | (NodeBase & { kind: 'dowhile'; test: Expr; body: Stmt })
  | (NodeBase & { kind: 'for'; init: Stmt | null; test: Expr | null; update: Expr | null; body: Stmt })
  | (NodeBase & { kind: 'switch'; disc: Expr; cases: { test: Expr | null; body: Stmt[] }[] })
  | (NodeBase & { kind: 'break' })
  | (NodeBase & { kind: 'continue' })
  | (NodeBase & { kind: 'return'; value: Expr | null })
  | (NodeBase & { kind: 'empty' });

export interface Param {
  name: string;
  type: VarType;
  isArray: boolean;
  isRef: boolean;
}

export interface FuncDecl extends NodeBase {
  name: string;
  ret: VarType;
  params: Param[];
  body: Stmt & { kind: 'block' };
}

export interface Program {
  globals: (Stmt & { kind: 'decl' })[];
  functions: Map<string, FuncDecl>;
  /** orden de aparición de la parte global (declaraciones) */
  includes: { name: string; line: number; pos: number; end: number }[];
}
