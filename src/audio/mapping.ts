import type { AudioParams, ChainSample } from "../types";

export function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const idx = (sorted.length - 1) * clamp(p, 0, 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

export function logNorm(value: number, max: number): number {
  if (value <= 0) return 0;
  return clamp(Math.log1p(value) / Math.log1p(max), 0, 1);
}

export function sampleToParams(sample: ChainSample): AudioParams {
  const feeNorm = clamp(
    0.62 * logNorm(sample.feeP90, 2_000_000) + 0.38 * sample.feePressure,
    0,
    1,
  );
  const loadNorm = clamp((sample.tps - 400) / 4200, 0, 1);
  const slotNorm = clamp((sample.slotsPerSec - 0.4) / 3.2, 0, 1);
  const lagNorm = clamp((sample.lagMs - 350) / 4500, 0, 1);
  const stall = sample.slotDelta === 0 ? 0.55 : 0;

  return {
    feeHz: lerp(64, 640, feeNorm),
    feeBrightHz: lerp(380, 4600, feeNorm),
    feeGain: lerp(0.045, 0.16, feeNorm),
    cuHz: lerp(38, 96, loadNorm),
    cuCutoffHz: lerp(160, 2600, loadNorm),
    cuGain: lerp(0.03, 0.2, loadNorm),
    pulseHz: lerp(0.7, 7.4, slotNorm),
    noiseDensity: clamp(0.08 + lagNorm * 0.62 + stall, 0, 0.95),
    tickGain: lerp(0.08, 0.28, clamp(sample.slotDelta / 8, 0, 1)),
  };
}

export function interpolateParams(a: AudioParams, b: AudioParams, t: number): AudioParams {
  const k = clamp(t, 0, 1);
  return {
    feeHz: lerp(a.feeHz, b.feeHz, k),
    feeBrightHz: lerp(a.feeBrightHz, b.feeBrightHz, k),
    feeGain: lerp(a.feeGain, b.feeGain, k),
    cuHz: lerp(a.cuHz, b.cuHz, k),
    cuCutoffHz: lerp(a.cuCutoffHz, b.cuCutoffHz, k),
    cuGain: lerp(a.cuGain, b.cuGain, k),
    pulseHz: lerp(a.pulseHz, b.pulseHz, k),
    noiseDensity: lerp(a.noiseDensity, b.noiseDensity, k),
    tickGain: lerp(a.tickGain, b.tickGain, k),
  };
}

export function nearestSample(samples: ChainSample[], t: number): ChainSample | null {
  if (samples.length === 0) return null;
  let best = samples[0];
  let bestDist = Math.abs(best.t - t);
  for (let i = 1; i < samples.length; i += 1) {
    const dist = Math.abs(samples[i].t - t);
    if (dist < bestDist) {
      best = samples[i];
      bestDist = dist;
    }
  }
  return best;
}

export function samplesInWindow(samples: ChainSample[], endT: number, windowMs: number): ChainSample[] {
  const start = endT - windowMs;
  return samples.filter((s) => s.t >= start && s.t <= endT);
}
