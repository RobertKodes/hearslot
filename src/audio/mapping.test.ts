import { describe, expect, it } from "vitest";
import type { ChainSample } from "../types";
import { clamp, logNorm, percentile, sampleToParams } from "./mapping";

const base: ChainSample = {
  t: 1_000,
  slot: 100,
  slotDelta: 3,
  lagMs: 1400,
  slotsPerSec: 2.2,
  tps: 2100,
  txPerSlot: 540,
  feeP90: 80_000,
  feePressure: 0.3,
};

describe("mapping", () => {
  it("clamps and logs into 0..1", () => {
    expect(clamp(12, 0, 3)).toBe(3);
    expect(logNorm(0, 100)).toBe(0);
    expect(logNorm(100, 100)).toBe(1);
  });

  it("takes a percentile without exploding on shorts", () => {
    expect(percentile([], 0.9)).toBe(0);
    expect(percentile([4], 0.9)).toBe(4);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });

  it("maps a hotter fee into a higher oscillator", () => {
    const quiet = sampleToParams({ ...base, feeP90: 0, feePressure: 0 });
    const hot = sampleToParams({ ...base, feeP90: 1_800_000, feePressure: 0.8 });
    expect(hot.feeHz).toBeGreaterThan(quiet.feeHz);
    expect(hot.feeBrightHz).toBeGreaterThan(quiet.feeBrightHz);
  });

  it("opens the load filter when TPS climbs", () => {
    const slow = sampleToParams({ ...base, tps: 200 });
    const busy = sampleToParams({ ...base, tps: 4500 });
    expect(busy.cuCutoffHz).toBeGreaterThan(slow.cuCutoffHz);
    expect(busy.cuGain).toBeGreaterThan(slow.cuGain);
  });

  it("turns lag / stall into denser grit", () => {
    const tight = sampleToParams({ ...base, lagMs: 200, slotDelta: 4 });
    const late = sampleToParams({ ...base, lagMs: 5000, slotDelta: 0 });
    expect(late.noiseDensity).toBeGreaterThan(tight.noiseDensity);
  });
});
