// Converts mic audio to 16 kHz mono Float32 and posts ~100 ms chunks.
// Downsampling averages input samples per output sample (a simple low-pass).
class PcmDownsampler extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.n = 0;
    this.pos = 0;
    this.out = new Float32Array(1600);
    this.len = 0;
    this.peak = 0;
  }

  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      if (Math.abs(x) > this.peak) this.peak = Math.abs(x);
      this.acc += x;
      this.n++;
      this.pos++;
      if (this.pos >= this.ratio) {
        this.out[this.len++] = this.acc / this.n;
        this.acc = 0;
        this.n = 0;
        this.pos -= this.ratio;
        if (this.len === this.out.length) {
          this.port.postMessage({ samples: this.out.slice(0), peak: this.peak });
          this.len = 0;
          this.peak = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor("pcm-downsampler", PcmDownsampler);
