// Modelo de datos del circuito: grafo terminal -> cable -> terminal.

export type Rotation = 0 | 90 | 180 | 270;

export interface ComponentInstance {
  id: string;
  type: string;
  x: number;
  y: number;
  rotation: Rotation;
  props: Record<string, any>;
  /** patas dobladas: desplazamiento del extremo de cada terminal (coordenadas locales) */
  legs?: Record<string, Point>;
}

export interface WireEnd {
  comp: string;
  term: string;
}

export interface Point {
  x: number;
  y: number;
}

export interface Wire {
  id: string;
  a: WireEnd;
  b: WireEnd;
  color: string;
  /** puntos intermedios (codos) en coordenadas del mundo */
  points: Point[];
}

export interface Circuit {
  components: ComponentInstance[];
  wires: Wire[];
}

export type IssueSeverity = 'error' | 'warning' | 'info';

export interface Issue {
  id: string;
  severity: IssueSeverity;
  title: string;
  detail: string;
  comps: string[];
  wires?: string[];
  terminals?: WireEnd[];
}

export const termKey = (comp: string, term: string) => `${comp}:${term}`;
