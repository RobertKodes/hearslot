import type { AudioParams, BandId, MuteState } from "../types";

const MUTE_DEFAULT: MuteState = { fee: false, cu: false, timing: false };

function makeNoiseBuffer(ctx: BaseAudioContext, seconds = 1.5): AudioBuffer {
  const length = Math.floor(ctx.sampleRate * seconds);
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  let last = 0;
  for (let i = 0; i < length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.97 + white * 0.03;
    data[i] = last * 3.2;
  }
  return buffer;
}

function src(ctx: BaseAudioContext, buffer: AudioBuffer): AudioBufferSourceNode {
  const node = ctx.createBufferSource();
  node.buffer = buffer;
  node.loop = true;
  node.start();
  return node;
}

export class HearslotEngine {
  readonly ctx: AudioContext;
  readonly analyser: AnalyserNode;
  private readonly master: GainNode;
  private readonly compressor: DynamicsCompressorNode;
  private readonly feeFilter: BiquadFilterNode;
  private readonly feeGain: GainNode;
  private readonly feeOscA: OscillatorNode;
  private readonly feeOscB: OscillatorNode;
  private readonly cuFilter: BiquadFilterNode;
  private readonly cuGain: GainNode;
  private readonly cuOsc: OscillatorNode;
  private readonly timingFilter: BiquadFilterNode;
  private readonly timingGain: GainNode;
  private readonly pulseOsc: OscillatorNode;
  private readonly pulseGain: GainNode;
  private readonly clickGain: GainNode;
  private readonly clickOsc: OscillatorNode;
  private readonly muteGains: Record<BandId, GainNode>;
  private readonly noise: AudioBufferSourceNode;
  private params: AudioParams | null = null;
  private disposed = false;

  constructor() {
    const Ctor = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    this.ctx = new Ctor();

    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.72;

    this.master = this.ctx.createGain();
    this.master.gain.value = 0.72;

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -18;
    this.compressor.knee.value = 18;
    this.compressor.ratio.value = 3.2;
    this.compressor.attack.value = 0.01;
    this.compressor.release.value = 0.18;

    this.master.connect(this.compressor);
    this.compressor.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);

    this.muteGains = {
      fee: this.ctx.createGain(),
      cu: this.ctx.createGain(),
      timing: this.ctx.createGain(),
    };
    for (const g of Object.values(this.muteGains)) {
      g.gain.value = 1;
      g.connect(this.master);
    }

    this.feeFilter = this.ctx.createBiquadFilter();
    this.feeFilter.type = "lowpass";
    this.feeFilter.frequency.value = 900;
    this.feeFilter.Q.value = 0.9;
    this.feeGain = this.ctx.createGain();
    this.feeGain.gain.value = 0;
    const feePan = this.ctx.createStereoPanner();
    feePan.pan.value = -0.42;
    this.feeOscA = this.ctx.createOscillator();
    this.feeOscB = this.ctx.createOscillator();
    this.feeOscA.type = "sawtooth";
    this.feeOscB.type = "sawtooth";
    this.feeOscA.frequency.value = 110;
    this.feeOscB.frequency.value = 110;
    this.feeOscB.detune.value = 9;
    this.feeOscA.detune.value = -7;
    this.feeOscA.connect(this.feeFilter);
    this.feeOscB.connect(this.feeFilter);
    this.feeFilter.connect(this.feeGain);
    this.feeGain.connect(feePan);
    feePan.connect(this.muteGains.fee);
    this.feeOscA.start();
    this.feeOscB.start();

    this.cuFilter = this.ctx.createBiquadFilter();
    this.cuFilter.type = "lowpass";
    this.cuFilter.frequency.value = 400;
    this.cuFilter.Q.value = 1.1;
    this.cuGain = this.ctx.createGain();
    this.cuGain.gain.value = 0;
    this.cuOsc = this.ctx.createOscillator();
    this.cuOsc.type = "triangle";
    this.cuOsc.frequency.value = 48;
    const cuNoiseFilter = this.ctx.createBiquadFilter();
    cuNoiseFilter.type = "lowpass";
    cuNoiseFilter.frequency.value = 220;
    const noiseBuf = makeNoiseBuffer(this.ctx);
    this.noise = src(this.ctx, noiseBuf);
    const cuNoiseGain = this.ctx.createGain();
    cuNoiseGain.gain.value = 0.35;
    this.noise.connect(cuNoiseFilter);
    cuNoiseFilter.connect(cuNoiseGain);
    this.cuOsc.connect(this.cuFilter);
    cuNoiseGain.connect(this.cuFilter);
    this.cuFilter.connect(this.cuGain);
    this.cuGain.connect(this.muteGains.cu);
    this.cuOsc.start();

    this.timingFilter = this.ctx.createBiquadFilter();
    this.timingFilter.type = "bandpass";
    this.timingFilter.frequency.value = 1800;
    this.timingFilter.Q.value = 0.7;
    this.timingGain = this.ctx.createGain();
    this.timingGain.gain.value = 0.12;
    this.pulseOsc = this.ctx.createOscillator();
    this.pulseOsc.type = "square";
    this.pulseOsc.frequency.value = 2.2;
    this.pulseGain = this.ctx.createGain();
    this.pulseGain.gain.value = 0.5;
    const pulseScale = this.ctx.createGain();
    pulseScale.gain.value = 0.5;
    const timingNoise = src(this.ctx, noiseBuf);
    const timingPan = this.ctx.createStereoPanner();
    timingPan.pan.value = 0.48;
    timingNoise.connect(this.timingFilter);
    this.timingFilter.connect(this.pulseGain);
    this.pulseOsc.connect(pulseScale);
    pulseScale.connect(this.pulseGain.gain);
    this.pulseGain.connect(this.timingGain);
    this.clickGain = this.ctx.createGain();
    this.clickGain.gain.value = 0;
    this.clickOsc = this.ctx.createOscillator();
    this.clickOsc.type = "square";
    this.clickOsc.frequency.value = 1480;
    this.clickOsc.connect(this.clickGain);
    this.clickGain.connect(this.timingGain);
    this.timingGain.connect(timingPan);
    timingPan.connect(this.muteGains.timing);
    this.pulseOsc.start();
    this.clickOsc.start();
  }

  async resume(): Promise<void> {
    if (this.ctx.state === "suspended") {
      await this.ctx.resume();
    }
  }

  applyParams(params: AudioParams, glide = 0.08): void {
    if (this.disposed) return;
    this.params = params;
    const t = this.ctx.currentTime + 0.01;
    const g = Math.max(0.02, glide);
    this.feeOscA.frequency.setTargetAtTime(params.feeHz, t, g);
    this.feeOscB.frequency.setTargetAtTime(params.feeHz * 1.003, t, g);
    this.feeFilter.frequency.setTargetAtTime(params.feeBrightHz, t, g);
    this.feeGain.gain.setTargetAtTime(params.feeGain, t, g);
    this.cuOsc.frequency.setTargetAtTime(params.cuHz, t, g);
    this.cuFilter.frequency.setTargetAtTime(params.cuCutoffHz, t, g);
    this.cuGain.gain.setTargetAtTime(params.cuGain, t, g);
    this.pulseOsc.frequency.setTargetAtTime(params.pulseHz, t, g * 1.4);
    this.timingFilter.frequency.setTargetAtTime(900 + params.noiseDensity * 2400, t, g);
    this.timingFilter.Q.setTargetAtTime(0.45 + params.noiseDensity * 1.8, t, g);
    this.timingGain.gain.setTargetAtTime(0.05 + params.noiseDensity * 0.22, t, g);
  }

  setMutes(mutes: MuteState): void {
    const t = this.ctx.currentTime + 0.01;
    (Object.keys(MUTE_DEFAULT) as BandId[]).forEach((band) => {
      this.muteGains[band].gain.setTargetAtTime(mutes[band] ? 0 : 1, t, 0.03);
    });
  }

  tick(count: number, intensity: number): void {
    if (this.disposed || this.ctx.state !== "running") return;
    const n = Math.min(6, Math.max(1, count));
    const now = this.ctx.currentTime;
    for (let i = 0; i < n; i += 1) {
      const at = now + i * 0.038;
      const peak = Math.min(0.42, intensity * (1 - i * 0.08));
      this.clickGain.gain.cancelScheduledValues(at);
      this.clickGain.gain.setValueAtTime(0.0001, at);
      this.clickGain.gain.exponentialRampToValueAtTime(peak, at + 0.006);
      this.clickGain.gain.exponentialRampToValueAtTime(0.0001, at + 0.07);
    }
  }

  currentParams(): AudioParams | null {
    return this.params;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    void this.ctx.close();
  }
}
