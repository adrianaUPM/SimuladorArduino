// Sonido de los buzzers con Web Audio (onda cuadrada a volumen bajo).

export class BuzzerAudio {
  private ctx: AudioContext | null = null;
  private voices = new Map<string, { osc: OscillatorNode; gain: GainNode }>();

  resume() {
    try {
      if (!this.ctx) this.ctx = new AudioContext();
      if (this.ctx.state === 'suspended') void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  update(tones: { id: string; freq: number }[]) {
    if (!this.ctx) return;
    const active = new Set(tones.map((t) => t.id));
    for (const [id, v] of this.voices) {
      if (!active.has(id)) {
        v.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.01);
        v.osc.stop(this.ctx.currentTime + 0.05);
        this.voices.delete(id);
      }
    }
    for (const t of tones) {
      const f = Math.max(20, Math.min(12000, t.freq));
      const v = this.voices.get(t.id);
      if (v) {
        v.osc.frequency.setTargetAtTime(f, this.ctx.currentTime, 0.005);
      } else {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = 'square';
        osc.frequency.value = f;
        gain.gain.value = 0;
        gain.gain.setTargetAtTime(0.035, this.ctx.currentTime, 0.01);
        osc.connect(gain).connect(this.ctx.destination);
        osc.start();
        this.voices.set(t.id, { osc, gain });
      }
    }
  }

  stopAll() {
    if (!this.ctx) return;
    for (const v of this.voices.values()) {
      try {
        v.osc.stop();
      } catch {
        /* ya parado */
      }
    }
    this.voices.clear();
  }
}
