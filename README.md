# ESP32-S3 Lab · Simulador IoT

Simulador web educativo, al estilo de Wokwi pero simplificado, centrado en la placa **ESP32-S3-DevKitC-1**. El alumno puede:

1. Montar un circuito conectando componentes a la placa.
2. Escribir código Arduino/C++.
3. Ejecutarlo y ver cómo el código controla el circuito en tiempo real.
4. Trabajar con el editor, con el circuito o con los dos a la vez.

Es una aplicación 100 % estática (React + Vite + TypeScript). No necesita backend y se puede publicar en GitHub Pages.

> No es un compilador para ESP32. Incluye un **intérprete educativo** de un subconjunto de C++/Arduino y un **solver eléctrico** (análisis nodal) que calcula tensiones y corrientes del circuito.

## Funcionalidades

**Editor**
- CodeMirror 6 con resaltado C++, números de línea, indentación automática y autocompletado de la API soportada (incluidos los métodos de `Serial.`, `display.`, `servo.`…).
- Detección de errores mientras escribes: sintaxis, variables no declaradas, funciones inexistentes (con sugerencias), número de argumentos, pines que no existen, `analogRead` en pines sin ADC, `=` dentro de un `if`, etc.
- Los errores en tiempo de ejecución (índice fuera de rango, división por cero, recursión infinita…) marcan la línea que los produce.
- Monitor serie con salida y entrada (`Serial.read`, `readStringUntil`, `parseInt`…).

**Circuito**
- Placa ESP32-S3-DevKitC-1 con sus 44 pines reales (J1/J3) y un tooltip por pin con sus funciones (ADC, TOUCH, I2C, SPI, UART, strapping…) y su tensión en vivo.
- **Protoboard de 830 puntos** como en un kit real: columnas de 5 agujeros unidos (a–e y f–j), canal central y raíles rojo (+) y azul (−). Al arrastrar un componente encima, sus patas encajan en los agujeros y quedan conectadas; al mover la protoboard se mueve todo lo enchufado. Los ejemplos están montados como en las prácticas: protoboard en vertical y ESP32-S3 en vertical a su lado, con cables cortos de cada pin a su fila.
- Biblioteca de componentes con arrastrar y soltar: LED, LED RGB, resistencia, pulsador, potenciómetro, servo SG90, motor DC, buzzer activo/pasivo, sensor analógico y digital genéricos, OLED SSD1306 I2C, alimentación de 3,3 V y GND.
- Cableado: haces clic en un pin, arrastras y sueltas sobre otro terminal. Si sueltas en un punto vacío se añade un codo y puedes seguir haciendo clic. Puedes cambiar el color del cable, mover o añadir codos (doble clic) y borrar cables.
- Zoom y desplazamiento de la vista, selección múltiple (Shift + arrastrar), mover, girar (R) y borrar (Supr), deshacer y rehacer, y panel de propiedades.
- Al pasar el ratón por un pin o un cable se resalta todo lo que está conectado a él (el net).

**Simulación**
- El circuito se modela internamente como un grafo `terminal → cable → terminal`. A partir de él se construyen los nets y se resuelven con análisis nodal; los diodos se modelan como lineales a tramos.
- `digitalWrite`, `pinMode` (INPUT, OUTPUT, INPUT_PULLUP, INPUT_PULLDOWN), `digitalRead` y `analogRead` leen el valor real del circuito (12 bits, 0–3,3 V).
- PWM con `ledcAttach`/`ledcWrite` (core 3.x), `ledcSetup`/`ledcAttachPin` (core 2.x) y `analogWrite`. La tensión media se calcula de forma exacta, de modo que el brillo del LED o la velocidad del motor dependen del ciclo de trabajo.
- Servo con la librería ESP32Servo o con PWM de 50 Hz. OLED con Adafruit_SSD1306 y la fuente de texto real de 5×7. `tone()` con sonido (Web Audio). `attachInterrupt` y `millis()`.
- Diagnóstico eléctrico con una explicación de cada problema:
  - cortocircuitos (un GPIO a GND, 3V3 a GND, salidas enfrentadas) y sobrecorriente en los GPIO (más de 40 mA);
  - **5 V en un GPIO** (el ESP32-S3 no tolera 5 V), 5V unido a 3V3 y alimentación invertida;
  - circuito abierto, falta de GND y módulos sin alimentación;
  - LED sin resistencia o polarizado al revés, entrada flotante, SDA/SCL intercambiados, motor conectado directamente a un GPIO…

## Instalación

Requiere [Node.js](https://nodejs.org/) 18 o superior.

```bash
npm install
npm run dev      # servidor de desarrollo en http://localhost:5173
npm run build    # compilación de producción en dist/
npm run preview  # sirve dist/ en local
npm test         # tests del intérprete
```

## Publicar en GitHub Pages

El repositorio incluye el workflow `.github/workflows/deploy.yml`:

1. Sube el proyecto a un repositorio de GitHub (rama `main`).
2. En **Settings → Pages → Build and deployment**, elige **Source: GitHub Actions**.
3. Cada `push` a `main` ejecuta los tests, compila y publica la aplicación en `https://<usuario>.github.io/<repositorio>/`.

`vite.config.ts` usa `base: './'`, así que la aplicación funciona en cualquier subruta sin tocar nada.

## Uso rápido

- Al abrir la aplicación se carga el ejemplo **LED en GPIO4** (`GPIO4 → 220 Ω → LED → GND`, montado en la protoboard). Pulsa **Ejecutar** (o `Ctrl+Enter`).
- En el menú **Ejemplos** hay más montajes: pulsador, potenciómetro con PWM, servo, OLED, LED RGB, buzzer y un proyecto completo con LED, pulsador, potenciómetro, servo y OLED.
- **Guardar** guarda el proyecto en el `localStorage` del navegador. **Abrir** lista los proyectos guardados y permite importar un `.json`. El botón de descarga exporta el proyecto a un `.json`. Además, el proyecto actual se guarda solo de forma automática.

| Atajo | Acción |
| --- | --- |
| `Ctrl+Enter` / `Ctrl+Shift+Enter` | Ejecutar / detener |
| `Ctrl+S` | Guardar en el navegador |
| `Ctrl+Z` / `Ctrl+Y` | Deshacer / rehacer (circuito) |
| `Supr` · `R` · `Esc` | Borrar · girar · cancelar |

## Subconjunto de C++ soportado

- Tipos: `int`, `long`, `unsigned`, `short`, `byte`, `char`, `bool`, `float`, `double`, `String`, `uint8_t`…`int64_t`, `size_t`.
- `const`, `static` (también en variables locales), `volatile`, `#define` sin parámetros e `#include` de las librerías soportadas.
- Arrays de una dimensión con inicializador, `sizeof`, funciones con parámetros por valor y por referencia (`&`), recursión.
- `if/else`, `for`, `while`, `do/while`, `switch/case`, `break`, `continue`, `return` y todos los operadores aritméticos, lógicos, de bits, ternario y de asignación compuesta.
- No se admiten punteros, `struct`, clases propias ni macros con parámetros (el editor lo indica).

La lista completa de funciones está en el botón de **Ayuda** de la aplicación.

## Arquitectura

```
src/
├── engine/       Intérprete: lexer, parser, análisis semántico, ejecución con generadores, librería Arduino/ESP32
├── simulator/    Grafo del circuito, solver nodal, placa simulada (HAL), controlador, lienzo SVG
├── devices/      Un archivo por componente: definición, terminales, propiedades, dibujo y comportamiento
├── editor/       Editor CodeMirror, panel de código y monitor serie
├── components/   Interfaz: barra superior, biblioteca, propiedades, diálogos, iconos
├── state/        Estado global (zustand), ejemplos y persistencia en localStorage
└── utils/        Geometría y enrutado de cables, fuente 5×7
```

**Flujo de ejecución:** `compile()` analiza el código y lo comprueba. `Runner` ejecuta `setup()` y luego `loop()` dentro de un generador. Cada `delay()` suspende la ejecución sin bloquear el navegador, y los bucles sin `delay` ceden el control periódicamente. Las llamadas de hardware pasan por `Esp32Board` (la HAL), que actualiza el estado de los pines. El `SimController` vuelve a resolver el circuito cuando algo cambia y publica en cada frame el estado visual de los componentes.

### Añadir un componente

Crea un `DeviceDef` en `src/devices/` y regístralo en `src/devices/registry.ts`:

```ts
export const miSensor: DeviceDef<{ valor: number }> = {
  type: 'miSensor', name: 'Mi sensor', category: 'Entradas', prefix: 'MS',
  description: '…', width: 48, height: 48,
  terminals: [{ id: 'OUT', label: 'OUT', x: 24, y: 48, kind: 'signal', dir: 'down', desc: '…' }, /* … */],
  props: [{ key: 'valor', label: 'Valor', type: 'range', default: 50, min: 0, max: 100, live: true }],
  Render: ({ inst, state }) => <g>{/* SVG */}</g>,
  stamp(c) { c.source(c.n('OUT'), c.n('GND'), 3.3 * c.props.valor / 100, 200); }, // modelo eléctrico
  evaluate(c) { return { valor: c.v('OUT') }; },                                     // estado visual + avisos
};
```

### Añadir una función de Arduino

Añade una entrada en `FUNCTIONS` (o un método en `CLASSES`) de `src/engine/library.ts`. El analizador semántico, el autocompletado y la ayuda la incluyen sin más cambios:

```ts
myFunc: f('myFunc(pin)', 'Descripción.', 'int', 1, 1, ({ rt, args }) => rt.hal.digitalRead(int(args, 0))),
```

## Limitaciones

- Es una simulación educativa: los tiempos son aproximados, el modelo eléctrico es de corriente continua (el PWM se promedia) y no hay Wi-Fi ni Bluetooth.
- El bus I2C se simula a nivel lógico: la OLED responde si está alimentada y conectada a los pines SDA/SCL configurados. El bus SPI todavía no tiene dispositivos.
