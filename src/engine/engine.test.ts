import { describe, expect, it } from 'vitest';
import { ESP32_BOARD_INFO } from '../devices/esp32s3/pins';
import { Interpreter, TICK } from './interpreter';
import { compile } from './runner';
import { Sleep, type Hal } from './values';

function mockHal() {
  const log: string[] = [];
  let out = '';
  let t = 0;
  const inputs = new Map<number, number>();
  const hal: Hal = {
    millis: () => t,
    micros: () => t * 1000,
    pinMode: (p, m) => log.push(`mode ${p} ${m}`),
    digitalWrite: (p, v) => log.push(`write ${p} ${v}`),
    digitalRead: (p) => inputs.get(p) ?? 0,
    analogMilliVolts: () => 1650,
    pwm: (p, d) => log.push(`pwm ${p} ${d.toFixed(3)}`),
    pwmStop: () => {},
    tone: () => {},
    noTone: () => {},
    servo: (p, us) => log.push(`servo ${p} ${us}`),
    serialWrite: (s) => (out += s),
    serialAvailable: () => 0,
    serialRead: () => -1,
    serialPeek: () => -1,
    i2cBegin: () => {},
    i2cProbe: () => true,
    oledShow: () => log.push('oled'),
    attachInterrupt: () => {},
    detachInterrupt: () => {},
    warn: (m) => log.push(`warn ${m}`),
  };
  return { hal, log, out: () => out, inputs, advance: (ms: number) => (t += ms) };
}

function run(src: string, maxSleeps = 10) {
  const res = compile(src, ESP32_BOARD_INFO);
  const errors = res.diagnostics.filter((d) => d.severity === 'error');
  if (errors.length) throw new Error(errors.map((e) => `${e.line}: ${e.message}`).join('\n'));
  const m = mockHal();
  const it = new Interpreter(res.program!, m.hal);
  const g = it.main();
  let sleeps = 0;
  for (let i = 0; i < 100000 && sleeps < maxSleeps; i++) {
    const r = g.next();
    if (r.done) break;
    if (r.value instanceof Sleep) {
      sleeps++;
      m.advance(r.value.ms);
    } else if (r.value !== TICK) break;
  }
  return { ...m, interp: it, diagnostics: res.diagnostics };
}

describe('compilador', () => {
  it('detecta variables no declaradas', () => {
    const r = compile('void setup(){ x = 3; } void loop(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics[0].message).toMatch(/no está declarado/);
  });
  it('detecta falta de punto y coma', () => {
    const r = compile('void setup(){ int a = 3 } void loop(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics[0].message).toMatch(/Falta ';'/);
  });
  it('detecta pines inexistentes', () => {
    const r = compile('void setup(){ pinMode(30, OUTPUT); } void loop(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics[0].message).toMatch(/no existe/);
  });
  it('detecta analogRead en pin sin ADC', () => {
    const r = compile('void setup(){ analogRead(21); } void loop(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics[0].message).toMatch(/no tiene ADC/);
  });
  it('detecta falta de loop', () => {
    const r = compile('void setup(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics.some((d) => /loop/.test(d.message))).toBe(true);
  });
  it('sugiere nombres de funciones', () => {
    const r = compile('void setup(){ digitalwrite(4, HIGH); } void loop(){}', ESP32_BOARD_INFO);
    expect(r.diagnostics[0].message).toMatch(/digitalWrite/);
  });
});

describe('intérprete', () => {
  it('ejecuta el ejemplo del LED en GPIO4', () => {
    const r = run(`
      void setup() { pinMode(4, OUTPUT); }
      void loop() { digitalWrite(4, HIGH); delay(500); digitalWrite(4, LOW); delay(500); }
    `, 4);
    expect(r.log.slice(0, 4)).toEqual(['mode 4 3', 'write 4 1', 'write 4 0', 'write 4 1']);
  });

  it('aritmética entera y float', () => {
    const r = run(`
      int a = 7 / 2; float b = 7 / 2.0; int c = 7 % 3; byte d = 300; float e;
      String s = "v=" + String(a) + " " + b;
      void setup() { Serial.begin(115200); e = a * 1.5; Serial.println(s); Serial.println(e, 1); Serial.println(d); }
      void loop() { delay(10); }
    `, 1);
    expect(r.interp.getGlobal('a')).toBe(3);
    expect(r.interp.getGlobal('b')).toBe(3.5);
    expect(r.interp.getGlobal('c')).toBe(1);
    expect(r.interp.getGlobal('d')).toBe(44);
    expect(r.out()).toBe('v=3 3.50\r\n4.5\r\n44\r\n');
  });

  it('bucles, arrays, funciones y switch', () => {
    const r = run(`
      #define N 5
      const int pins[] = {4, 5, 6, 7, 15};
      int total = 0;
      int sq(int x) { return x * x; }
      void inc(int &v) { v++; }
      void setup() {
        for (int i = 0; i < N; i++) total += sq(pins[i]);
        int k = 0;
        while (true) { k++; if (k > 3) break; }
        inc(k);
        switch (k) { case 5: total += 1000; break; default: total = -1; }
        Serial.begin(9600);
        Serial.printf("%d|%05.1f|%x|%s\\n", total, 3.14159, 255, "ok");
        Serial.println(sizeof(pins) / sizeof(pins[0]));
      }
      void loop() { delay(1); }
    `, 1);
    expect(r.interp.getGlobal('total')).toBe(16 + 25 + 36 + 49 + 225 + 1000);
    expect(r.out()).toBe('1351|003.1|ff|ok\n5\r\n');
  });

  it('PWM con ledcAttach y ledcWrite', () => {
    const r = run(`
      void setup() { ledcAttach(4, 5000, 8); ledcWrite(4, 128); }
      void loop() { delay(100); }
    `, 1);
    expect(r.log).toContain('pwm 4 0.502');
  });

  it('PWM con API antigua (canales)', () => {
    const r = run(`
      void setup() { ledcSetup(0, 5000, 10); ledcAttachPin(5, 0); ledcWrite(0, 1023); }
      void loop() { delay(100); }
    `, 1);
    expect(r.log).toContain('pwm 5 1.000');
  });

  it('servo', () => {
    const r = run(`
      #include <ESP32Servo.h>
      Servo s;
      void setup() { s.attach(18); s.write(90); }
      void loop() { delay(100); }
    `, 1);
    expect(r.log).toContain('servo 18 1500');
  });

  it('OLED', () => {
    const r = run(`
      #include <Wire.h>
      #include <Adafruit_GFX.h>
      #include <Adafruit_SSD1306.h>
      Adafruit_SSD1306 display(128, 64, &Wire, -1);
      void setup() {
        if (!display.begin(SSD1306_SWITCHCAPVCC, 0x3C)) { for(;;); }
        display.clearDisplay(); display.setTextSize(1); display.setTextColor(SSD1306_WHITE);
        display.setCursor(0, 0); display.println("Hola"); display.display();
      }
      void loop() { delay(100); }
    `, 1);
    expect(r.log).toContain('oled');
  });

  it('error de índice fuera de rango', () => {
    expect(() => run(`int a[3]; void setup(){ int i = 3; a[i] = 1; } void loop(){}`)).toThrow(/fuera de rango/);
  });

  it('map y constrain', () => {
    const r = run(`int v; int w; void setup(){ v = map(2048, 0, 4095, 0, 180); w = constrain(300, 0, 255); } void loop(){ delay(1); }`, 1);
    expect(r.interp.getGlobal('v')).toBe(90);
    expect(r.interp.getGlobal('w')).toBe(255);
  });
});

describe('static locales', () => {
  it('conservan su valor entre llamadas', () => {
    const r = run(`int total; void f() { static int n = 0; n++; total = n; } void setup() { f(); f(); f(); } void loop() { delay(1); }`, 1);
    expect(r.interp.getGlobal('total')).toBe(3);
  });
});
