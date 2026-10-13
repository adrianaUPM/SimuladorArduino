// Registro de componentes. Para añadir uno nuevo: crea su DeviceDef y añádelo aquí.

import { buzzer, motor, servo } from './actuators';
import { breadboard } from './breadboard';
import { esp32s3 } from './esp32s3';
import { keypad } from './keypad';
import { lcd } from './lcd';
import { ldr } from './ldr';
import { led } from './led';
import { oled } from './oled';
import { button, potentiometer, resistor } from './passives';
import { gnd, vcc } from './power';
import { rgbled } from './rgbled';
import { analogSensor, digitalSensor } from './sensors';
import { sevenSeg } from './sevenseg';
import type { DeviceDef } from './types';
import { ultrasonic } from './ultrasonic';

export const DEVICES: DeviceDef[] = [
  esp32s3,
  breadboard,
  led,
  rgbled,
  sevenSeg,
  resistor,
  button,
  potentiometer,
  keypad,
  ldr,
  ultrasonic,
  buzzer,
  servo,
  motor,
  analogSensor,
  digitalSensor,
  oled,
  lcd,
  vcc,
  gnd,
];

const byType = new Map(DEVICES.map((d) => [d.type, d]));

export function getDevice(type: string): DeviceDef | undefined {
  return byType.get(type);
}

export const CATEGORY_ORDER: DeviceDef['category'][] = ['Placas', 'Salidas', 'Entradas', 'Pasivos', 'Actuadores', 'Pantallas', 'Alimentación'];
