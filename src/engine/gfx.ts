// Primitivas gráficas (subconjunto de Adafruit GFX) sobre un framebuffer 1 bit/píxel.

import { glyph } from '../utils/font5x7';

export interface GfxState {
  w: number;
  h: number;
  buf: Uint8Array; // 1 byte por píxel (0/1)
  cursorX: number;
  cursorY: number;
  textSize: number;
  textColor: number;
  textBg: number; // -1 = transparente
  wrap: boolean;
  inverted: boolean;
}

export function createGfx(w: number, h: number): GfxState {
  return {
    w, h, buf: new Uint8Array(w * h), cursorX: 0, cursorY: 0, textSize: 1,
    textColor: 1, textBg: -1, wrap: true, inverted: false,
  };
}

export function pixel(g: GfxState, x: number, y: number, c: number) {
  x = Math.trunc(x);
  y = Math.trunc(y);
  if (x < 0 || y < 0 || x >= g.w || y >= g.h) return;
  const i = y * g.w + x;
  if (c === 2) g.buf[i] ^= 1; // INVERSE
  else g.buf[i] = c ? 1 : 0;
}

export function fillRect(g: GfxState, x: number, y: number, w: number, h: number, c: number) {
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) pixel(g, x + i, y + j, c);
}

export function line(g: GfxState, x0: number, y0: number, x1: number, y1: number, c: number) {
  x0 = Math.trunc(x0); y0 = Math.trunc(y0); x1 = Math.trunc(x1); y1 = Math.trunc(y1);
  const dx = Math.abs(x1 - x0);
  const dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1;
  const sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (let guard = 0; guard < 4096; guard++) {
    pixel(g, x0, y0, c);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
}

export function rect(g: GfxState, x: number, y: number, w: number, h: number, c: number) {
  line(g, x, y, x + w - 1, y, c);
  line(g, x, y + h - 1, x + w - 1, y + h - 1, c);
  line(g, x, y, x, y + h - 1, c);
  line(g, x + w - 1, y, x + w - 1, y + h - 1, c);
}

export function circle(g: GfxState, cx: number, cy: number, r: number, c: number, fill: boolean) {
  r = Math.trunc(r);
  for (let y = -r; y <= r; y++) {
    for (let x = -r; x <= r; x++) {
      const d = x * x + y * y;
      if (fill ? d <= r * r + r : Math.abs(Math.sqrt(d) - r) < 0.5) pixel(g, cx + x, cy + y, c);
    }
  }
}

export function roundRect(g: GfxState, x: number, y: number, w: number, h: number, r: number, c: number, fill: boolean) {
  r = Math.max(0, Math.min(r, Math.floor(Math.min(w, h) / 2)));
  for (let j = 0; j < h; j++) {
    for (let i = 0; i < w; i++) {
      // distancia a la esquina redondeada más próxima
      const cx = i < r ? r : i >= w - r ? w - r - 1 : i;
      const cy = j < r ? r : j >= h - r ? h - r - 1 : j;
      const d = Math.hypot(i - cx, j - cy);
      const inside = d <= r + 0.3;
      const edge = i === 0 || j === 0 || i === w - 1 || j === h - 1 || (d > r - 0.7 && inside && (cx !== i || cy !== j));
      if (inside && (fill || edge)) pixel(g, x + i, y + j, c);
    }
  }
}

export function triangle(
  g: GfxState, x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, c: number, fill: boolean,
) {
  if (!fill) {
    line(g, x0, y0, x1, y1, c);
    line(g, x1, y1, x2, y2, c);
    line(g, x2, y2, x0, y0, c);
    return;
  }
  const minX = Math.floor(Math.min(x0, x1, x2));
  const maxX = Math.ceil(Math.max(x0, x1, x2));
  const minY = Math.floor(Math.min(y0, y1, y2));
  const maxY = Math.ceil(Math.max(y0, y1, y2));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return triangle(g, x0, y0, x1, y1, x2, y2, c, false);
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
      const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= -0.01 && w1 >= -0.01 && w2 >= -0.01) pixel(g, x, y, c);
    }
  }
}

export function drawChar(g: GfxState, x: number, y: number, code: number, color: number, bg: number, size: number) {
  const cols = glyph(code);
  for (let i = 0; i < 6; i++) {
    const bits = i < 5 ? cols[i] : 0;
    for (let j = 0; j < 8; j++) {
      const on = (bits >> j) & 1;
      if (on) fillRect(g, x + i * size, y + j * size, size, size, color);
      else if (bg >= 0) fillRect(g, x + i * size, y + j * size, size, size, bg);
    }
  }
}

export function writeText(g: GfxState, text: string) {
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (ch === '\n') {
      g.cursorX = 0;
      g.cursorY += 8 * g.textSize;
      continue;
    }
    if (ch === '\r') continue;
    if (g.wrap && g.cursorX + 6 * g.textSize > g.w) {
      g.cursorX = 0;
      g.cursorY += 8 * g.textSize;
    }
    drawChar(g, g.cursorX, g.cursorY, code, g.textColor, g.textBg, g.textSize);
    g.cursorX += 6 * g.textSize;
  }
}
