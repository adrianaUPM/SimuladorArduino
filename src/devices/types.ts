// Contrato que cumple cada componente electrónico: definición, terminales,
// propiedades, representación visual y comportamiento de simulación.

import type { ComponentType } from 'react';
import type { ComponentInstance, Issue, WireEnd } from '../simulator/types';

/**
 * power  = salida de alimentación (3V3/5V de la placa, símbolo VCC)
 * ground = referencia de masa (GND de la placa, símbolo GND): se une al nodo 0
 * vcc/gnd = entradas de alimentación de un módulo (no se unen automáticamente)
 */
export type TermKind = 'gpio' | 'power' | 'ground' | 'vcc' | 'gnd' | 'passive' | 'signal' | 'en';

export interface TerminalDef {
  id: string;
  label: string;
  /** posición en coordenadas locales del componente */
  x: number;
  y: number;
  desc: string;
  kind: TermKind;
  /** dirección por la que "sale" el cable (para dibujar el codo inicial); 'none' = sin tramo inicial */
  dir: 'up' | 'down' | 'left' | 'right' | 'none';
}

export interface PropOption {
  value: string | number;
  label: string;
}

export interface PropDef {
  key: string;
  label: string;
  type: 'number' | 'select' | 'boolean' | 'range' | 'text';
  default: any;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: PropOption[];
  /** valor que se cambia "en vivo" durante la simulación (no genera undo) */
  live?: boolean;
  help?: string;
}

/** Estado de un pin del microcontrolador visto desde el circuito */
export interface PinState {
  mode: 'unset' | 'input' | 'input_pullup' | 'input_pulldown' | 'output' | 'open_drain' | 'pwm' | 'tone' | 'servo';
  level: 0 | 1;
  duty: number;
  freq: number;
  servoUs: number | null;
}

export interface OledFrame {
  w: number;
  h: number;
  buf: Uint8Array;
  inverted: boolean;
  version: number;
}

export interface BoardView {
  running: boolean;
  pin(gpio: number): PinState;
  oledFrame(addr: number): OledFrame | undefined;
  i2c: { sda: number; scl: number; begun: boolean };
}

export interface StampCtx {
  inst: ComponentInstance;
  props: Record<string, any>;
  inputs: Record<string, any>;
  board: BoardView;
  /** nodo (net) del terminal indicado de este componente; 0 = GND */
  n(term: string): number;
  resistor(a: number, b: number, r: number, key?: string): void;
  /** fuente de tensión V(a)-V(b)=v con resistencia serie r (equivalente Norton) */
  source(a: number, b: number, v: number, r: number, key?: string): void;
  /** diodo lineal a tramos (ánodo a, cátodo k) */
  diode(a: number, k: number, vf: number, ron: number, key: string): void;
  /** tensión del nodo en la iteración anterior (para elementos no lineales) */
  v(node: number): number;
  /** ¿está a nivel alto este GPIO en la fase PWM que se está resolviendo? */
  phaseHigh(gpio: number): boolean;
}

export interface EvalCtx {
  inst: ComponentInstance;
  props: Record<string, any>;
  inputs: Record<string, any>;
  board: BoardView;
  /** tensión media del terminal */
  v(term: string): number;
  /** tensión máxima del terminal durante el ciclo PWM */
  vMax(term: string): number;
  /** corriente media de un elemento registrado con key */
  i(key: string): number;
  /** corriente de pico de un elemento */
  iPeak(key: string): number;
  connected(term: string): boolean;
  /** ¿hay algún otro componente o cable en el net de este terminal (no basta una tira vacía)? */
  linked(term: string): boolean;
  /** ¿hay camino conductor desde el terminal a alguna fuente/GND? */
  driven(term: string): boolean;
  /** terminales del mismo net (excluye el propio) */
  netPeers(term: string): (WireEnd & { kind: TermKind; type: string })[];
  /** GPIO del ESP32 en el mismo net que el terminal */
  gpiosOnNet(term: string): number[];
  issue(severity: Issue['severity'], title: string, detail: string, terminals?: string[]): void;
}

export interface RenderProps<S = any> {
  inst: ComponentInstance;
  state: S | undefined;
  selected: boolean;
  running: boolean;
  /** entradas momentáneas (pulsador presionado...) */
  setInput(patch: Record<string, any>): void;
  /** cambio de propiedad "en vivo" (potenciómetro...) */
  setLiveProp(key: string, value: any): void;
}

export interface DeviceDef<S = any> {
  type: string;
  name: string;
  category: 'Placas' | 'Salidas' | 'Entradas' | 'Pasivos' | 'Actuadores' | 'Pantallas' | 'Alimentación';
  description: string;
  width: number;
  height: number;
  terminals: TerminalDef[];
  props: PropDef[];
  /** nombre corto para etiquetas automáticas (LED1, R1...) */
  prefix: string;
  Render: ComponentType<RenderProps<S>>;
  stamp?(c: StampCtx): void;
  evaluate?(c: EvalCtx): S;
  /** máximo de instancias permitidas en el circuito */
  max?: number;
  /** grupos de terminales unidos internamente (tiras de la protoboard, patas del pulsador...) */
  bus?: string[][];
  /** sus terminales son agujeros: cualquier pata que caiga encima queda enchufada */
  socket?: boolean;
  /** se dibuja por debajo del resto de componentes */
  under?: boolean;
  /** sus patas se pueden doblar para enchufarlas en otros agujeros */
  flexLegs?: boolean;
}
