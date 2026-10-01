import type { EvalCtx, TerminalDef } from './types';

/** Avisa si un componente tiene unos terminales conectados y otros no */
export function checkOpen(c: EvalCtx, terms: TerminalDef[], name: string): boolean {
  const conn = terms.filter((t) => c.connected(t.id));
  if (conn.length > 0 && conn.length < terms.length) {
    const missing = terms.filter((t) => !c.connected(t.id));
    c.issue(
      'warning',
      `Circuito abierto en ${name}`,
      `Falta conectar: ${missing.map((t) => t.label).join(', ')}. Sin un camino cerrado hasta GND no circula corriente.`,
      missing.map((t) => t.id),
    );
    return true;
  }
  return false;
}

/** Comprueba la alimentación de un módulo (VCC/GND) */
export function checkSupply(
  c: EvalCtx,
  name: string,
  vccTerm: string,
  gndTerm: string,
  { min = 2.7, max = 5.5, others = [] as string[] } = {},
): { vcc: number; powered: boolean } {
  const vcc = c.v(vccTerm) - c.v(gndTerm);
  const anyUsed = c.connected(vccTerm) || c.connected(gndTerm) || others.some((t) => c.connected(t));
  if (!anyUsed) return { vcc, powered: vcc >= min };
  if (!c.connected(gndTerm)) {
    c.issue('warning', `Falta GND en ${name}`, `Conecta el pin GND del módulo a GND de la placa: sin masa común el circuito no funciona.`, [gndTerm]);
  } else if (!c.connected(vccTerm)) {
    c.issue('warning', `${name} sin alimentación`, `Conecta VCC a 3V3 (o a la alimentación adecuada).`, [vccTerm]);
  } else if (vcc < -0.5) {
    c.issue('error', `Alimentación invertida en ${name}`, `VCC está a menor tensión que GND (${vcc.toFixed(1)} V). Revisa la polaridad.`, [vccTerm, gndTerm]);
  } else if (vcc < min) {
    c.issue('warning', `${name} no recibe tensión suficiente`, `Tiene ${vcc.toFixed(2)} V entre VCC y GND (mín. ${min} V). ¿Está VCC conectado a 3V3 y GND a GND?`, [vccTerm]);
  } else if (vcc > max) {
    c.issue('error', `Sobretensión en ${name}`, `Recibe ${vcc.toFixed(1)} V (máx. ${max} V).`, [vccTerm]);
  }
  return { vcc, powered: vcc >= min && vcc <= max + 0.5 };
}

export const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

export function formatOhms(r: number): string {
  if (r >= 1e6) return `${+(r / 1e6).toFixed(2)} MΩ`;
  if (r >= 1e3) return `${+(r / 1e3).toFixed(2)} kΩ`;
  return `${+r.toFixed(1)} Ω`;
}

export const FONT = 'Inter, system-ui, sans-serif';
export const MONO = 'JetBrains Mono, ui-monospace, monospace';
