export type BandId = "fee" | "cu" | "timing";

export type MuteState = Record<BandId, boolean>;

export type PollHealth = "idle" | "listening" | "ok" | "waiting" | "error";

export type ChainSample = {
  t: number;
  slot: number;
  slotDelta: number;
  lagMs: number;
  slotsPerSec: number;
  tps: number;
  txPerSlot: number;
  feeP90: number;
  feePressure: number;
};

export type AudioParams = {
  feeHz: number;
  feeBrightHz: number;
  feeGain: number;
  cuHz: number;
  cuCutoffHz: number;
  cuGain: number;
  pulseHz: number;
  noiseDensity: number;
  tickGain: number;
};
