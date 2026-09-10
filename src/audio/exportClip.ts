import type { AudioParams, ChainSample, MuteState } from "../types";
import { interpolateParams, sampleToParams, samplesInWindow } from "./mapping";
import { downloadBlob, encodeWav } from "./wav";

const CLIP_SEC = 10;

function applyAt(
  nodes: {
    feeA: OscillatorNode;
    feeB: OscillatorNode;
    feeFilter: BiquadFilterNode;
    feeGain: GainNode;
    cuOsc: OscillatorNode;
    cuFilter: BiquadFilterNode;
    cuGain: GainNode;
    pulse: OscillatorNode;
    timingFilter: BiquadFilterNode;
    timingGain: GainNode;
  },
  params: AudioParams,
  t: number,
): void {
  nodes.feeA.frequency.setValueAtTime(params.feeHz, t);
  nodes.feeB.frequency.setValueAtTime(params.feeHz * 1.003, t);
  nodes.feeFilter.frequency.setValueAtTime(params.feeBrightHz, t);
  nodes.feeGain.gain.setValueAtTime(params.feeGain, t);
  nodes.cuOsc.frequency.setValueAtTime(params.cuHz, t);
  nodes.cuFilter.frequency.setValueAtTime(params.cuCutoffHz, t);
  nodes.cuGain.gain.setValueAtTime(params.cuGain, t);
  nodes.pulse.frequency.setValueAtTime(params.pulseHz, t);
  nodes.timingFilter.frequency.setValueAtTime(900 + params.noiseDensity * 2400, t);
  nodes.timingGain.gain.setValueAtTime(0.05 + params.noiseDensity * 0.22, t);
}

export async function renderHistoryWav(
  history: ChainSample[],
  mutes: MuteState,
  slotHint?: number,
): Promise<void> {
  const endT = history.length ? history[history.length - 1].t : Date.now();
  const window = samplesInWindow(history, endT, CLIP_SEC * 1000);
  const fallback = history[history.length - 1];
  if (!fallback) {
    throw new Error("nothing in the ring yet — arm it and wait a few samples");
  }

  const ctx = new OfflineAudioContext(2, 44100 * CLIP_SEC, 44100);
  const master = ctx.createGain();
  master.gain.value = 0.7;
  const comp = ctx.createDynamicsCompressor();
  master.connect(comp);
  comp.connect(ctx.destination);

  const feeMute = ctx.createGain();
  const cuMute = ctx.createGain();
  const timeMute = ctx.createGain();
  feeMute.gain.value = mutes.fee ? 0 : 1;
  cuMute.gain.value = mutes.cu ? 0 : 1;
  timeMute.gain.value = mutes.timing ? 0 : 1;
  feeMute.connect(master);
  cuMute.connect(master);
  timeMute.connect(master);

  const feeA = ctx.createOscillator();
  const feeB = ctx.createOscillator();
  feeA.type = "sawtooth";
  feeB.type = "sawtooth";
  feeB.detune.value = 9;
  const feeFilter = ctx.createBiquadFilter();
  feeFilter.type = "lowpass";
  const feeGain = ctx.createGain();
  const feePan = ctx.createStereoPanner();
  feePan.pan.value = -0.42;
  feeA.connect(feeFilter);
  feeB.connect(feeFilter);
  feeFilter.connect(feeGain);
  feeGain.connect(feePan);
  feePan.connect(feeMute);

  const cuOsc = ctx.createOscillator();
  cuOsc.type = "triangle";
  const cuFilter = ctx.createBiquadFilter();
  cuFilter.type = "lowpass";
  const cuGain = ctx.createGain();
  cuOsc.connect(cuFilter);
  cuFilter.connect(cuGain);
  cuGain.connect(cuMute);

  const noise = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
  const nd = noise.getChannelData(0);
  let last = 0;
  for (let i = 0; i < nd.length; i += 1) {
    const white = Math.random() * 2 - 1;
    last = last * 0.97 + white * 0.03;
    nd[i] = last * 3.2;
  }
  const noiseSrc = ctx.createBufferSource();
  noiseSrc.buffer = noise;
  noiseSrc.loop = true;
  const timingFilter = ctx.createBiquadFilter();
  timingFilter.type = "bandpass";
  const pulse = ctx.createOscillator();
  pulse.type = "square";
  const pulseGain = ctx.createGain();
  pulseGain.gain.value = 0.5;
  const pulseScale = ctx.createGain();
  pulseScale.gain.value = 0.5;
  const timingGain = ctx.createGain();
  const timePan = ctx.createStereoPanner();
  timePan.pan.value = 0.48;
  noiseSrc.connect(timingFilter);
  timingFilter.connect(pulseGain);
  pulse.connect(pulseScale);
  pulseScale.connect(pulseGain.gain);
  pulseGain.connect(timingGain);
  timingGain.connect(timePan);
  timePan.connect(timeMute);

  const nodes = {
    feeA,
    feeB,
    feeFilter,
    feeGain,
    cuOsc,
    cuFilter,
    cuGain,
    pulse,
    timingFilter,
    timingGain,
  };

  const points = window.length ? window : [fallback];
  const startT = points[0].t;
  const span = Math.max(1, (points[points.length - 1].t - startT) || CLIP_SEC * 1000);

  for (let i = 0; i < points.length; i += 1) {
    const local = ((points[i].t - startT) / span) * CLIP_SEC;
    applyAt(nodes, sampleToParams(points[i]), Math.min(CLIP_SEC - 0.01, Math.max(0, local)));
  }

  if (points.length === 1) {
    applyAt(nodes, sampleToParams(points[0]), 0);
    applyAt(nodes, sampleToParams(points[0]), CLIP_SEC - 0.01);
  } else {
    const lastP = sampleToParams(points[points.length - 1]);
    const firstP = sampleToParams(points[0]);
    applyAt(nodes, interpolateParams(firstP, lastP, 0), 0);
  }

  feeA.start(0);
  feeB.start(0);
  cuOsc.start(0);
  pulse.start(0);
  noiseSrc.start(0);
  feeA.stop(CLIP_SEC);
  feeB.stop(CLIP_SEC);
  cuOsc.stop(CLIP_SEC);
  pulse.stop(CLIP_SEC);
  noiseSrc.stop(CLIP_SEC);

  const rendered = await ctx.startRendering();
  const blob = encodeWav(rendered);
  const tag = slotHint ?? fallback.slot;
  downloadBlob(blob, `hearslot-${tag}-${Math.round(endT / 1000)}.wav`);
}
