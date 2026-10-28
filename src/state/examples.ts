// Proyectos de ejemplo, montados como en las prácticas: protoboard en vertical,
// ESP32-S3 en vertical a su derecha con la cabecera J1 mirando a la protoboard
// (cada pin queda a la altura de una tira de 5 agujeros) y componentes enchufados.
// El primero es el que se carga por defecto.

import { BB_RAILS, BB_ROWS, breadboard, colX } from '../devices/breadboard';
import { getDevice } from '../devices/registry';
import type { Circuit, ComponentInstance, Point, Rotation } from '../simulator/types';
import { localToWorld } from '../utils/geometry';
import type { Project } from './store';

/**
 * Protoboard girada 90°: ocupa x 0..320, y 0..1040. La columna 1 queda arriba,
 * las filas a–e a la derecha (junto a la ESP32) y f–j a la izquierda.
 * Raíles: tp (+) y tn (−) a la derecha, bn (−) y bp (+) a la izquierda.
 */
const BB: ComponentInstance = { id: 'bb1', type: 'breadboard', x: -360, y: 360, rotation: 90, props: {} };

/** coordenadas de un agujero: 'c12', 'tp8' (raíl + derecho), 'bn15' (raíl − izquierdo)... */
function hole(h: string): Point {
  const m = /^([a-j]|tp|tn|bn|bp)(\d+)$/.exec(h);
  if (!m) throw new Error(`Agujero no válido: ${h}`);
  const y = m[1].length === 1 ? BB_ROWS[m[1]] : BB_RAILS[m[1]].y;
  return localToWorld(BB, breadboard.width, breadboard.height, { x: colX(Number(m[2])), y });
}

class Builder {
  c: Circuit = { components: [], wires: [] };

  add(id: string, type: string, x: number, y: number, props: Record<string, any> = {}, rotation: Rotation = 0) {
    const def = getDevice(type)!;
    const p: Record<string, any> = {};
    def.props.forEach((pd) => (p[pd.key] = pd.default));
    const inst: ComponentInstance = { id, type, x, y, rotation, props: { ...p, ...props } };
    this.c.components.push(inst);
    return this;
  }

  /** enchufa un componente de modo que su terminal `term` quede en el agujero `h` */
  plug(id: string, type: string, term: string, h: string, props: Record<string, any> = {}, rotation: Rotation = 0) {
    const def = getDevice(type)!;
    const t = def.terminals.find((x) => x.id === term)!;
    const off = localToWorld({ id, type, x: 0, y: 0, rotation, props: {} }, def.width, def.height, t);
    const target = hole(h);
    return this.add(id, type, target.x - off.x, target.y - off.y, props, rotation);
  }

  wire(a: string, b: string, color: string, points: Point[] = []) {
    const [ac, at] = split(a);
    const [bc, bt] = split(b);
    this.c.wires.push({ id: `w${this.c.wires.length + 1}`, a: { comp: ac, term: at }, b: { comp: bc, term: bt }, color, points });
    return this;
  }
}

function split(s: string): [string, string] {
  const i = s.indexOf('.');
  return [s.slice(0, i), s.slice(i + 1)];
}

const GREEN = '#2f9e44';
const RED = '#e03131';
const BLACK = '#1c1c1c';
const BLUE = '#1971c2';
const ORANGE = '#f08c00';
const PURPLE = '#ae3ec9';
const YELLOW = '#fab005';
const WHITE = '#f5f5f5';

/**
 * Montaje base: protoboard vertical y ESP32-S3 en vertical a su derecha. Los
 * pines de J1 quedan a la altura de las tiras: 3V3 → fila 8, GPIO4 → 10,
 * GPIO5 → 11 … GPIO14 → 26, 5V → 27, GND → 28. 3V3 alimenta los raíles + y GND
 * los raíles − (los de la izquierda se unen con puentes por abajo).
 */
function kit(): Builder {
  const tn60 = hole('tn60');
  const bn60 = hole('bn60');
  const tp60 = hole('tp60');
  const bp60 = hole('bp60');
  return new Builder()
    .add('bb1', 'breadboard', BB.x, BB.y, {}, 90)
    .add('esp', 'esp32s3', 352, 28)
    .wire('esp.3V3.L1', 'bb1.tp8', RED)
    .wire('esp.GND.L21', 'bb1.tn28', BLACK)
    .wire('bb1.tn60', 'bb1.bn60', BLACK, [{ x: tn60.x, y: 1056 }, { x: bn60.x, y: 1056 }])
    .wire('bb1.tp60', 'bb1.bp60', RED, [{ x: tp60.x, y: 1072 }, { x: bp60.x, y: 1072 }]);
}

// piezas reutilizables (los componentes enchufados van girados 90° como la protoboard)

/** GPIO4 → a10 · resistencia c10–c14 · LED: ánodo a14, cátodo a15 · e15 → GND */
const withLed = (b: Builder, color = 'red') =>
  b
    .plug('r1', 'resistor', '1', 'c10', { resistance: 220 }, 90)
    .plug('led1', 'led', 'A', 'a14', { color }, 90)
    .wire('esp.GPIO4', 'bb1.a10', GREEN)
    .wire('bb1.e15', 'bb1.bn15', BLACK);

/** pulsador a caballo del canal (e11/e13 – f11/f13): GPIO5 → a11, j13 → GND */
const withButton = (b: Builder, color = 'blue') =>
  b
    .plug('btn1', 'button', '1', 'e11', { color }, 90)
    .wire('esp.GPIO5', 'bb1.a11', BLUE)
    .wire('bb1.j13', 'bb1.bn14', BLACK);

/** OLED a la izquierda de la protoboard: SCL = GPIO9 (fila 21), SDA = GPIO10 (fila 22) */
const withOled = (b: Builder) =>
  b
    .add('oled1', 'oled', -360, 380)
    .wire('esp.GPIO9', 'bb1.a21', YELLOW)
    .wire('esp.GPIO10', 'bb1.a22', PURPLE)
    .wire('bb1.e21', 'bb1.f21', YELLOW)
    .wire('bb1.e22', 'bb1.f22', PURPLE)
    .wire('bb1.bn18', 'oled1.GND', BLACK, [{ x: -312, y: hole('bn18').y }])
    .wire('bb1.bp20', 'oled1.VCC', RED, [{ x: -296, y: hole('bp20').y }])
    .wire('bb1.j21', 'oled1.SCL', YELLOW, [{ x: -280, y: hole('j21').y }])
    .wire('bb1.j22', 'oled1.SDA', PURPLE, [{ x: -264, y: hole('j22').y }]);

/** servo a la izquierda: señal GPIO14 (fila 26), V+ a 5V (fila 27), GND (raíl −) */
const withServo = (b: Builder) =>
  b
    .add('servo1', 'servo', -136, 412, {}, 180)
    .wire('esp.GPIO14', 'bb1.a26', ORANGE)
    .wire('bb1.e26', 'bb1.f26', ORANGE)
    .wire('esp.5V.L20', 'bb1.a27', RED)
    .wire('bb1.e27', 'bb1.f27', RED)
    .wire('bb1.j26', 'servo1.PWM', ORANGE)
    .wire('bb1.j27', 'servo1.V+', RED)
    .wire('bb1.bn28', 'servo1.GND', BLACK);

/** potenciómetro con el cursor en e21 (GPIO9, ADC1): extremos a GND (e20) y 3V3 (e22) */
const withPot9 = (b: Builder, value = 50) =>
  b
    .plug('pot1', 'potentiometer', 'W', 'e21', { value }, 90)
    .wire('esp.GPIO9', 'bb1.a21', YELLOW)
    .wire('bb1.a20', 'bb1.tn20', BLACK)
    .wire('bb1.a22', 'bb1.tp22', RED);

// ---------------------------------------------------------------- 1. LED GPIO4

const ledCode = `// LED en GPIO4
// Circuito: GPIO4 -> resistencia 220 Ω -> LED -> GND
// En la protoboard: cable GPIO4 -> a10, resistencia c10-c14,
// LED con el ánodo (pata larga) en a14 y el cátodo en a15, y cable e15 -> raíl −.
// El ESP32-S3 trabaja a 3.3 V: con 220 Ω circulan unos 6 mA.

const int LED_PIN = 4;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  Serial.println("LED listo en GPIO4");
}

void loop() {
  digitalWrite(LED_PIN, HIGH);   // enciende el LED
  Serial.println("ON");
  delay(500);
  digitalWrite(LED_PIN, LOW);    // apaga el LED
  Serial.println("OFF");
  delay(500);
}
`;

const led = withLed(kit());

// ---------------------------------------------------------------- 2. pulsador

const buttonCode = `// Pulsador en GPIO5 controla el LED de GPIO4
// El pulsador está a caballo del canal central: un lado va a GPIO5 y el
// otro a GND. Usamos la resistencia pull-up interna, así que el pin lee
// HIGH en reposo y LOW al pulsar.

const int LED_PIN = 4;
const int BTN_PIN = 5;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
}

void loop() {
  int estado = digitalRead(BTN_PIN);
  if (estado == LOW) {
    digitalWrite(LED_PIN, HIGH);
  } else {
    digitalWrite(LED_PIN, LOW);
  }
  delay(10);
}
`;

const button = withButton(withLed(kit(), 'green'));

// ---------------------------------------------------------------- 3. pot + PWM

const potCode = `// El potenciómetro (GPIO9, ADC1) regula el brillo del LED (GPIO4, PWM)
// analogRead devuelve 0..4095 (12 bits) para 0..3.3 V.

const int POT_PIN = 9;
const int LED_PIN = 4;

void setup() {
  Serial.begin(115200);
  ledcAttach(LED_PIN, 5000, 8);   // PWM 5 kHz, 8 bits (0..255)
}

void loop() {
  int lectura = analogRead(POT_PIN);
  int brillo = map(lectura, 0, 4095, 0, 255);
  ledcWrite(LED_PIN, brillo);

  float voltios = lectura * 3.3 / 4095.0;
  Serial.print("ADC: ");
  Serial.print(lectura);
  Serial.print("  V: ");
  Serial.print(voltios);
  Serial.print("  PWM: ");
  Serial.println(brillo);
  delay(200);
}
`;

const pot = withPot9(withLed(kit(), 'yellow'), 30);

// ---------------------------------------------------------------- 4. servo

const servoCode = `// Servo controlado con un potenciómetro
// Servo: señal en GPIO14, V+ a 5V y GND a GND (cables desde la protoboard).
// Potenciómetro en GPIO9.
#include <ESP32Servo.h>

Servo miServo;
const int SERVO_PIN = 14;
const int POT_PIN = 9;

void setup() {
  Serial.begin(115200);
  miServo.attach(SERVO_PIN);   // 50 Hz, 500..2500 µs
}

void loop() {
  int lectura = analogRead(POT_PIN);
  int angulo = map(lectura, 0, 4095, 0, 180);
  miServo.write(angulo);
  Serial.printf("ADC=%4d  ángulo=%3d°\\n", lectura, angulo);
  delay(50);
}
`;

const servo = withServo(withPot9(kit()));

// ---------------------------------------------------------------- 5. OLED

const oledCode = `// Pantalla OLED SSD1306 por I2C
// En el ESP32-S3 se pueden elegir los pines del bus I2C con Wire.begin(SDA, SCL).
// Aquí usamos SDA = GPIO10 y SCL = GPIO9 (filas 22 y 21 de la protoboard).
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>

Adafruit_SSD1306 display(128, 64, &Wire, -1);
int contador = 0;

void setup() {
  Serial.begin(115200);
  Wire.begin(10, 9);   // SDA, SCL
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("No se encuentra la OLED");
    for (;;);
  }
  display.clearDisplay();
  display.setTextSize(2);
  display.setTextColor(SSD1306_WHITE);
  display.setCursor(10, 0);
  display.println("ESP32-S3");
  display.setTextSize(1);
  display.println("Hola, IoT!");
  display.display();
  delay(1500);
}

void loop() {
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("Contador:");
  display.setTextSize(3);
  display.setCursor(0, 20);
  display.println(contador);
  display.drawRect(0, 54, 128, 10, SSD1306_WHITE);
  display.fillRect(2, 56, (contador % 21) * 6, 6, SSD1306_WHITE);
  display.display();
  contador++;
  delay(500);
}
`;

const oledEx = withOled(kit());

// ---------------------------------------------------------------- 6. RGB

const rgbCode = `// LED RGB (cátodo común) con PWM: R = GPIO15, G = GPIO17, B = GPIO18
// Cada color lleva su propia resistencia de 220 Ω y la pata común va a GND.

const int PIN_R = 15, PIN_G = 17, PIN_B = 18;

void color(int r, int g, int b) {
  ledcWrite(PIN_R, r);
  ledcWrite(PIN_G, g);
  ledcWrite(PIN_B, b);
}

void setup() {
  ledcAttach(PIN_R, 5000, 8);
  ledcAttach(PIN_G, 5000, 8);
  ledcAttach(PIN_B, 5000, 8);
}

void loop() {
  color(255, 0, 0);   delay(700);   // rojo
  color(0, 255, 0);   delay(700);   // verde
  color(0, 0, 255);   delay(700);   // azul
  color(255, 160, 0); delay(700);   // naranja
  color(180, 0, 255); delay(700);   // violeta
  // arco iris suave
  for (int i = 0; i < 256; i += 4) { color(255 - i, i, 0); delay(15); }
  for (int i = 0; i < 256; i += 4) { color(0, 255 - i, i); delay(15); }
  for (int i = 0; i < 256; i += 4) { color(i, 0, 255 - i); delay(15); }
}
`;

const rgb = kit()
  .plug('rgb1', 'rgbled', 'R', 'a18', {}, 90)
  .plug('r1', 'resistor', '1', 'e14', { resistance: 220 }, 90)
  .plug('r2', 'resistor', '1', 'd16', { resistance: 220 }, 90)
  .plug('r3', 'resistor', '1', 'c17', { resistance: 220 }, 90)
  .wire('esp.GPIO15', 'bb1.a14', RED)
  .wire('esp.GPIO17', 'bb1.a16', GREEN)
  .wire('esp.GPIO18', 'bb1.a17', BLUE)
  .wire('bb1.e19', 'bb1.bn20', BLACK);

// ---------------------------------------------------------------- 7. MVP completo

const mvpCode = `// Proyecto completo: LED + pulsador + potenciómetro + servo + OLED
//  - LED en GPIO4 (con resistencia de 220 Ω)
//  - Pulsador en GPIO5 (INPUT_PULLUP): enciende/apaga el LED
//  - Potenciómetro en GPIO12: mueve el servo (GPIO14)
//  - OLED I2C con SDA = GPIO10 y SCL = GPIO9
#include <Wire.h>
#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP32Servo.h>

const int LED_PIN = 4;
const int BTN_PIN = 5;
const int POT_PIN = 12;
const int SERVO_PIN = 14;

Adafruit_SSD1306 display(128, 64, &Wire, -1);
Servo servo;
bool ledOn = false;
int anterior = HIGH;

void setup() {
  Serial.begin(115200);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BTN_PIN, INPUT_PULLUP);
  servo.attach(SERVO_PIN);
  Wire.begin(10, 9);   // SDA, SCL
  if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) {
    Serial.println("OLED no encontrada");
  }
  display.setTextColor(SSD1306_WHITE);
}

void loop() {
  // pulsador: detecta el flanco de bajada
  int boton = digitalRead(BTN_PIN);
  if (boton == LOW && anterior == HIGH) {
    ledOn = !ledOn;
    Serial.println(ledOn ? "LED encendido" : "LED apagado");
  }
  anterior = boton;
  digitalWrite(LED_PIN, ledOn ? HIGH : LOW);

  // potenciómetro -> servo
  int lectura = analogRead(POT_PIN);
  int angulo = map(lectura, 0, 4095, 0, 180);
  servo.write(angulo);

  // pantalla
  display.clearDisplay();
  display.setTextSize(1);
  display.setCursor(0, 0);
  display.println("ESP32-S3  IoT Lab");
  display.drawFastHLine(0, 10, 128, SSD1306_WHITE);
  display.setCursor(0, 16);
  display.print("LED:   ");
  display.println(ledOn ? "ON" : "OFF");
  display.print("ADC:   ");
  display.println(lectura);
  display.print("Servo: ");
  display.print(angulo);
  display.println(" grados");
  display.fillRect(0, 54, map(angulo, 0, 180, 0, 128), 8, SSD1306_WHITE);
  display.display();
  delay(30);
}
`;

const mvp = withServo(withOled(withButton(withLed(kit()))))
  .plug('pot1', 'potentiometer', 'W', 'e24', { value: 50 }, 90)
  .wire('esp.GPIO12', 'bb1.a24', WHITE)
  .wire('bb1.a23', 'bb1.tn23', BLACK)
  .wire('bb1.a25', 'bb1.tp26', RED);

// ---------------------------------------------------------------- 8. buzzer

const buzzerCode = `// Melodía con un buzzer pasivo en GPIO16 (tone)
// Pulsa el botón (GPIO5) para reproducirla.

const int BUZZER = 16;
const int BTN = 5;

int notas[] = {262, 294, 330, 349, 392, 440, 494, 523};
int duracion = 200;

void setup() {
  pinMode(BTN, INPUT_PULLUP);
  Serial.begin(115200);
  Serial.println("Pulsa el botón para tocar la escala");
}

void loop() {
  if (digitalRead(BTN) == LOW) {
    for (int i = 0; i < 8; i++) {
      tone(BUZZER, notas[i]);
      delay(duracion);
    }
    noTone(BUZZER);
  }
  delay(20);
}
`;

const buzzerEx = withButton(kit(), 'yellow')
  .plug('bz1', 'buzzer', '+', 'j15', {}, 90)
  .wire('esp.GPIO16', 'bb1.a15', ORANGE)
  .wire('bb1.e15', 'bb1.f15', ORANGE)
  .wire('bb1.f16', 'bb1.e16', BLACK)
  .wire('bb1.a16', 'bb1.tn16', BLACK);

// ---------------------------------------------------------------- 9. caja fuerte

const safeCode = `// Caja fuerte con teclado matricial 4x4 y pantalla LCD 16x2 I2C
//
// Teclado (8 pines, cables directos a la cabecera J3 de la placa):
//   R1..R4 (filas)    -> GPIO1, GPIO2, GPIO42, GPIO41
//   C1..C4 (columnas) -> GPIO40, GPIO39, GPIO47, GPIO21
// LCD I2C (a través de la protoboard):
//   VCC -> raíl + (3V3) · GND -> raíl − · SDA -> GPIO10 · SCL -> GPIO9
//
// Uso:  0-9 escribe el PIN · # comprueba · * borra
//       Con la caja abierta, * (o A) la vuelve a cerrar.
// Tras 5 intentos fallidos el teclado se bloquea 1 minuto.

#include <Wire.h>
#include <Keypad.h>
#include <LiquidCrystal_I2C.h>

const byte FILAS = 4;
const byte COLUMNAS = 4;
char teclas[FILAS][COLUMNAS] = {
  {'1', '2', '3', 'A'},
  {'4', '5', '6', 'B'},
  {'7', '8', '9', 'C'},
  {'*', '0', '#', 'D'}
};
byte pinesFilas[FILAS] = {1, 2, 42, 41};
byte pinesColumnas[COLUMNAS] = {40, 39, 47, 21};
Keypad teclado = Keypad(makeKeymap(teclas), pinesFilas, pinesColumnas, FILAS, COLUMNAS);

LiquidCrystal_I2C lcd(0x27, 16, 2);   // dirección, columnas, filas

const String CLAVE = "1234";          // PIN correcto
const int MAX_INTENTOS = 5;            // fallos permitidos antes del bloqueo
const unsigned long ESPERA_MS = 60000; // 1 minuto
const int LONGITUD_MAX = 8;            // dígitos máximos del PIN
const String AVISO = "para volverlo a intentar";

String entrada = "";
int fallos = 0;
bool abierta = false;
bool bloqueada = false;
unsigned long inicioBloqueo = 0;

void pantallaPin() {
  lcd.clear();
  lcd.setCursor(0, 0);
  lcd.print("Introduce PIN:");
  lcd.setCursor(0, 1);
  lcd.print(entrada);   // los números que se van pulsando
}

void abrir() {
  abierta = true;
  fallos = 0;
  lcd.clear();
  lcd.setCursor(4, 0);
  lcd.print("ABIERTO");
  lcd.setCursor(0, 1);
  lcd.print("* para cerrar");
  Serial.println("PIN correcto: caja ABIERTA");
}

void cerrar() {
  abierta = false;
  entrada = "";
  Serial.println("Caja cerrada");
  pantallaPin();
}

void pinIncorrecto() {
  fallos++;
  Serial.print("PIN incorrecto. Fallos: ");
  Serial.println(fallos);
  lcd.clear();
  lcd.setCursor(3, 0);
  lcd.print("BLOQUEADO");
  lcd.setCursor(0, 1);
  lcd.print("Fallos: ");
  lcd.print(fallos);
  lcd.print("/");
  lcd.print(MAX_INTENTOS);
  delay(2000);
  if (fallos >= MAX_INTENTOS) {
    bloqueada = true;
    inicioBloqueo = millis();
    Serial.println("Demasiados fallos: espere 1 min");
    lcd.clear();
  } else {
    pantallaPin();
  }
}

void comprobar() {
  if (entrada.length() == 0) return;
  if (entrada == CLAVE) abrir();
  else pinIncorrecto();
  entrada = "";
}

// Cuenta atrás del bloqueo con el aviso desplazándose en la segunda fila
void mostrarBloqueo() {
  unsigned long pasado = millis() - inicioBloqueo;
  if (pasado >= ESPERA_MS) {
    bloqueada = false;
    fallos = 0;
    Serial.println("Fin del bloqueo");
    pantallaPin();
    return;
  }
  // la cuenta atrás solo se redibuja cuando cambia el segundo
  static int ultimoSegundo = -1;
  int segundos = (ESPERA_MS - pasado + 999) / 1000;
  if (segundos != ultimoSegundo) {
    ultimoSegundo = segundos;
    lcd.setCursor(0, 0);
    lcd.print("Espere 1 min ");
    if (segundos < 10) lcd.print(" ");
    lcd.print(segundos);
    lcd.print("s");
  }

  static unsigned long ultimoPaso = 0;
  static int pos = 0;
  if (millis() - ultimoPaso >= 300) {
    ultimoPaso = millis();
    String cinta = AVISO + "    " + AVISO;
    lcd.setCursor(0, 1);
    lcd.print(cinta.substring(pos, pos + 16));
    pos = (pos + 1) % (AVISO.length() + 4);
  }
}

void setup() {
  Serial.begin(115200);
  Wire.begin(10, 9);   // SDA, SCL
  lcd.init();
  lcd.backlight();
  pantallaPin();
  Serial.println("Caja fuerte lista. PIN de prueba: 1234");
}

void loop() {
  if (bloqueada) {
    mostrarBloqueo();   // durante el bloqueo se ignora el teclado
    return;
  }
  char tecla = teclado.getKey();
  if (!tecla) return;   // NO_KEY: no se ha pulsado nada

  if (abierta) {
    if (tecla == '*' || tecla == 'A') cerrar();
    return;
  }
  if (tecla == '#') {
    comprobar();
  } else if (tecla == '*') {
    entrada = "";
    pantallaPin();
  } else if (tecla >= '0' && tecla <= '9' && entrada.length() < LONGITUD_MAX) {
    entrada += tecla;
    lcd.setCursor(0, 1);
    lcd.print(entrada);
  }
}
`;

/**
 * Teclado a la derecha de la placa: cada fila/columna con un cable en L desde
 * J3. LCD encima de la protoboard: alimentación desde los raíles de la derecha
 * (por arriba) y SDA/SCL desde GPIO10/GPIO9 a través de las filas 22 y 21.
 */
const safe = kit()
  .add('kp1', 'keypad', 600, -110)
  .add('lcd1', 'lcd', -40, -150)
  .wire('esp.GPIO1', 'kp1.R1', ORANGE)
  .wire('esp.GPIO2', 'kp1.R2', ORANGE)
  .wire('esp.GPIO42', 'kp1.R3', ORANGE)
  .wire('esp.GPIO41', 'kp1.R4', ORANGE)
  .wire('esp.GPIO40', 'kp1.C1', BLUE)
  .wire('esp.GPIO39', 'kp1.C2', BLUE)
  .wire('esp.GPIO47', 'kp1.C3', BLUE)
  .wire('esp.GPIO21', 'kp1.C4', BLUE)
  .wire('esp.GPIO10', 'bb1.a22', PURPLE)
  .wire('esp.GPIO9', 'bb1.a21', YELLOW)
  .wire('bb1.c22', 'lcd1.SDA', PURPLE, [{ x: 216, y: -24 }, { x: -72, y: -24 }, { x: -72, y: -90 }])
  .wire('bb1.b21', 'lcd1.SCL', YELLOW, [{ x: 232, y: -34 }, { x: -60, y: -34 }, { x: -60, y: -74 }])
  .wire('bb1.tn2', 'lcd1.GND', BLACK, [{ x: 280, y: -160 }, { x: -60, y: -160 }, { x: -60, y: -122 }])
  .wire('bb1.tp2', 'lcd1.VCC', RED, [{ x: 296, y: -172 }, { x: -72, y: -172 }, { x: -72, y: -106 }]);

// ---------------------------------------------------------------- 10. semáforo

const trafficCode = `// Semáforo de distancia con un HC-SR04 y tres LEDs
//
// HC-SR04 (a la derecha de la placa, alimentado a 3V3):
//   VCC -> raíl + (3V3) · TRIG -> GPIO1 · ECHO -> GPIO2 · GND -> GND
// LEDs en la protoboard, cada uno con su resistencia de 220 Ω:
//   rojo -> GPIO4 · ámbar -> GPIO17 · verde -> GPIO10
//
// Más de 90 cm: verde · entre 60 y 90 cm: ámbar · menos de 60 cm: rojo
// Mueve el deslizador del sensor para cambiar la distancia.

const int TRIG = 1;
const int ECHO = 2;
const int LED_ROJO = 4;
const int LED_AMBAR = 17;
const int LED_VERDE = 10;

const float DIST_VERDE = 90.0;   // por encima: verde
const float DIST_ROJO = 60.0;    // por debajo: rojo

// enciende solo uno de los tres LEDs
void semaforo(bool rojo, bool ambar, bool verde) {
  digitalWrite(LED_ROJO, rojo ? HIGH : LOW);
  digitalWrite(LED_AMBAR, ambar ? HIGH : LOW);
  digitalWrite(LED_VERDE, verde ? HIGH : LOW);
}

// devuelve la distancia en cm, o -1 si no llega el eco
float medirDistancia() {
  digitalWrite(TRIG, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG, HIGH);      // pulso de 10 µs para disparar
  delayMicroseconds(10);
  digitalWrite(TRIG, LOW);
  long duracion = pulseIn(ECHO, HIGH, 30000);   // µs (máx. ~5 m)
  if (duracion == 0) return -1;
  return duracion / 58.0;        // ida y vuelta a 343 m/s
}

void setup() {
  Serial.begin(115200);
  pinMode(TRIG, OUTPUT);
  pinMode(ECHO, INPUT);
  pinMode(LED_ROJO, OUTPUT);
  pinMode(LED_AMBAR, OUTPUT);
  pinMode(LED_VERDE, OUTPUT);
  semaforo(false, false, false);
}

void loop() {
  float distancia = medirDistancia();

  if (distancia < 0) {
    Serial.println("Sin eco");
    semaforo(false, false, false);
  } else {
    Serial.print("Distancia: ");
    Serial.print(distancia, 1);
    Serial.print(" cm -> ");
    if (distancia > DIST_VERDE) {
      Serial.println("VERDE");
      semaforo(false, false, true);
    } else if (distancia >= DIST_ROJO) {
      Serial.println("AMBAR");
      semaforo(false, true, false);
    } else {
      Serial.println("ROJO");
      semaforo(true, false, false);
    }
  }
  delay(200);
}
`;

/**
 * Tres veces el montaje del LED (GPIO → resistencia → LED → raíl −), de arriba
 * abajo rojo, ámbar y verde. El HC-SR04 va a la derecha de la placa: TRIG y
 * ECHO a GPIO1/GPIO2 de J3, GND a J3 y VCC al raíl + pasando por encima.
 */
const ledBlock = (b: Builder, n: string, gpio: number, row: number, color: string, wire: string) =>
  b
    .plug(`r${n}`, 'resistor', '1', `c${row}`, { resistance: 220 }, 90)
    .plug(`led${n}`, 'led', 'A', `a${row + 4}`, { color }, 90)
    .wire(`esp.GPIO${gpio}`, `bb1.a${row}`, wire)
    .wire(`bb1.e${row + 5}`, `bb1.bn${row + 5}`, BLACK);

const traffic = ledBlock(ledBlock(ledBlock(kit(), '1', 4, 10, 'red', RED), '2', 17, 16, 'orange', ORANGE), '3', 10, 22, 'green', GREEN)
  .add('us1', 'ultrasonic', 560, -40, { distance: 120 })
  .wire('esp.GPIO1', 'us1.TRIG', BLUE)
  .wire('esp.GPIO2', 'us1.ECHO', PURPLE)
  .wire('esp.GND.R20', 'us1.GND', BLACK)
  .wire('us1.VCC', 'bb1.tp2', RED, [{ x: 548, y: 52 }, { x: 548, y: 12 }, { x: 296, y: 12 }]);

export interface Example {
  id: string;
  title: string;
  description: string;
  project: Project;
}

export const EXAMPLES: Example[] = [
  { id: 'led', title: 'LED en GPIO4', description: 'GPIO4 → resistencia → LED → GND en la protoboard. Parpadeo básico.', project: { name: 'LED en GPIO4', code: ledCode, circuit: led.c } },
  { id: 'button', title: 'Pulsador y LED', description: 'digitalRead con INPUT_PULLUP y un pulsador a caballo del canal.', project: { name: 'Pulsador y LED', code: buttonCode, circuit: button.c } },
  { id: 'pot', title: 'Potenciómetro y PWM', description: 'analogRead + ledcWrite para regular el brillo.', project: { name: 'Potenciómetro y PWM', code: potCode, circuit: pot.c } },
  { id: 'servo', title: 'Servo con potenciómetro', description: 'ESP32Servo: el ángulo sigue al potenciómetro.', project: { name: 'Servo con potenciómetro', code: servoCode, circuit: servo.c } },
  { id: 'oled', title: 'Pantalla OLED I2C', description: 'Adafruit_SSD1306 por I2C, enchufada en la protoboard.', project: { name: 'Pantalla OLED', code: oledCode, circuit: oledEx.c } },
  { id: 'rgb', title: 'LED RGB', description: 'Mezcla de colores con tres canales PWM.', project: { name: 'LED RGB', code: rgbCode, circuit: rgb.c } },
  { id: 'buzzer', title: 'Buzzer y pulsador', description: 'tone() para tocar una escala musical.', project: { name: 'Buzzer', code: buzzerCode, circuit: buzzerEx.c } },
  { id: 'safe', title: 'Caja fuerte con teclado', description: 'Teclado 4×4 + LCD 16×2 I2C: PIN, ABIERTO/BLOQUEADO y bloqueo de 1 min tras 5 fallos.', project: { name: 'Caja fuerte', code: safeCode, circuit: safe.c } },
  { id: 'traffic', title: 'SEMÁFORO', description: 'HC-SR04 + 3 LEDs: verde a más de 90 cm, ámbar entre 60 y 90 cm y rojo a menos de 60 cm.', project: { name: 'Semáforo', code: trafficCode, circuit: traffic.c } },
  { id: 'mvp', title: 'Proyecto completo', description: 'LED, pulsador, potenciómetro, servo y OLED a la vez.', project: { name: 'Proyecto completo', code: mvpCode, circuit: mvp.c } },
];

export const BLANK_CODE = `void setup() {
  // se ejecuta una vez al arrancar
  Serial.begin(115200);
}

void loop() {
  // se ejecuta continuamente
}
`;

/** proyecto nuevo: protoboard vertical + ESP32-S3 con los raíles ya alimentados */
export function blankProject(): Project {
  return { name: 'Nuevo proyecto', code: BLANK_CODE, circuit: kit().c };
}
