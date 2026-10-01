// Pinout de la ESP32-S3-DevKitC-1 (cabeceras J1 y J3, 22 pines cada una).
// Fuente: documentación oficial de Espressif (ESP32-S3-DevKitC-1 v1.1).

export type PinKind = 'gpio' | '3v3' | '5v' | 'gnd' | 'en';

export interface HeaderPin {
  id: string; // id del terminal
  label: string; // serigrafía
  kind: PinKind;
  gpio?: number;
  side: 'left' | 'right';
  row: number;
}

const J1: [string, PinKind, number?][] = [
  ['3V3', '3v3'], ['3V3', '3v3'], ['RST', 'en'], ['4', 'gpio', 4], ['5', 'gpio', 5], ['6', 'gpio', 6],
  ['7', 'gpio', 7], ['15', 'gpio', 15], ['16', 'gpio', 16], ['17', 'gpio', 17], ['18', 'gpio', 18],
  ['8', 'gpio', 8], ['3', 'gpio', 3], ['46', 'gpio', 46], ['9', 'gpio', 9], ['10', 'gpio', 10],
  ['11', 'gpio', 11], ['12', 'gpio', 12], ['13', 'gpio', 13], ['14', 'gpio', 14], ['5V', '5v'], ['GND', 'gnd'],
];
const J3: [string, PinKind, number?][] = [
  ['GND', 'gnd'], ['TX', 'gpio', 43], ['RX', 'gpio', 44], ['1', 'gpio', 1], ['2', 'gpio', 2], ['42', 'gpio', 42],
  ['41', 'gpio', 41], ['40', 'gpio', 40], ['39', 'gpio', 39], ['38', 'gpio', 38], ['37', 'gpio', 37],
  ['36', 'gpio', 36], ['35', 'gpio', 35], ['0', 'gpio', 0], ['45', 'gpio', 45], ['48', 'gpio', 48],
  ['47', 'gpio', 47], ['21', 'gpio', 21], ['20', 'gpio', 20], ['19', 'gpio', 19], ['GND', 'gnd'], ['GND', 'gnd'],
];

function build(list: [string, PinKind, number?][], side: 'left' | 'right'): HeaderPin[] {
  return list.map(([label, kind, gpio], row) => ({
    id: kind === 'gpio' ? `GPIO${gpio}` : `${label}.${side === 'left' ? 'L' : 'R'}${row}`,
    label,
    kind,
    gpio,
    side,
    row,
  }));
}

export const HEADER_PINS: HeaderPin[] = [...build(J1, 'left'), ...build(J3, 'right')];

export const GPIO_SET = new Set(HEADER_PINS.filter((p) => p.kind === 'gpio').map((p) => p.gpio!));

/** El SoC tiene GPIO0..21 y GPIO26..48; 26..32 los usa la flash SPI y no están en la placa */
export function gpioExists(n: number): boolean {
  return Number.isInteger(n) && GPIO_SET.has(n);
}

export function isAdc(n: number): boolean {
  return n >= 1 && n <= 20;
}

export function adcChannel(n: number): string | null {
  if (n >= 1 && n <= 10) return `ADC1_CH${n - 1}`;
  if (n >= 11 && n <= 20) return `ADC2_CH${n - 11}`;
  return null;
}

/** Funciones de cada GPIO relevantes para la asignatura */
export function gpioFunctions(n: number): string[] {
  const f: string[] = [];
  const adc = adcChannel(n);
  if (adc) f.push(adc);
  if (n >= 1 && n <= 14) f.push(`TOUCH${n}`);
  f.push('PWM (LEDC)');
  const extra: Record<number, string[]> = {
    0: ['Strapping (botón BOOT)'],
    3: ['Strapping (JTAG)'],
    8: ['I2C SDA (Wire por defecto)'],
    9: ['I2C SCL (Wire por defecto)'],
    10: ['SPI SS/CS (FSPI)'],
    11: ['SPI MOSI (FSPI)'],
    12: ['SPI SCK (FSPI)'],
    13: ['SPI MISO (FSPI)'],
    15: ['U0RTS', 'XTAL_32K_P'],
    16: ['U0CTS', 'XTAL_32K_N'],
    17: ['UART1 TX'],
    18: ['UART1 RX'],
    19: ['USB D−'],
    20: ['USB D+'],
    35: ['PSRAM octal (módulos R8)'],
    36: ['PSRAM octal (módulos R8)'],
    37: ['PSRAM octal (módulos R8)'],
    38: ['LED RGB integrado (v1.1)'],
    39: ['JTAG MTCK'],
    40: ['JTAG MTDO'],
    41: ['JTAG MTDI'],
    42: ['JTAG MTMS'],
    43: ['UART0 TX (Serial)'],
    44: ['UART0 RX (Serial)'],
    45: ['Strapping (VDD_SPI)'],
    46: ['Strapping (log ROM)'],
    48: ['LED RGB integrado (v1.0)'],
  };
  return [...f, ...(extra[n] ?? [])];
}

export function pinWarning(n: number, usage: 'output' | 'input' | 'analog'): string | null {
  if (n === 43 || n === 44) return `GPIO${n} es el UART0 (TX/RX) que usa Serial: evita usarlo como E/S general.`;
  if (n === 19 || n === 20) return `GPIO${n} son las líneas USB D−/D+: usarlo desconecta el USB nativo.`;
  if (n >= 35 && n <= 37) return `GPIO${n} lo usa la PSRAM octal en módulos N8R8/N16R8: puede no estar disponible.`;
  if ([0, 3, 45, 46].includes(n) && usage === 'output') return `GPIO${n} es un pin de strapping: su nivel en el arranque condiciona el modo de la placa.`;
  return null;
}

export const ESP32_BOARD_INFO = {
  name: 'ESP32-S3-DevKitC-1',
  gpioExists,
  isAdc,
  pinWarning,
};
