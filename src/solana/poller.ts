import { Connection, PublicKey } from "@solana/web3.js";
import type { ChainSample, PollHealth } from "../types";
import { percentile } from "../audio/mapping";

export const DEFAULT_RPC =
  import.meta.env.VITE_RPC_URL?.trim() || "https://api.mainnet-beta.solana.com";

// Busy programs so getRecentPrioritizationFees actually moves.
// Empty/unfiltered calls on public mainnet often come back as a pile of zeros.
const FEE_WATCH = [
  "11111111111111111111111111111111",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA",
  "ComputeBudget111111111111111111111111111111",
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4",
  "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
].map((k) => new PublicKey(k));

type PerfRow = {
  numTransactions: number;
  numSlots: number;
  samplePeriodSecs: number;
  numNonVoteTransactions?: number;
  numNonVoteTransaction?: number;
};

export type PollerHandlers = {
  onSample: (sample: ChainSample) => void;
  onHealth: (health: PollHealth, note: string) => void;
};

export class ChainPoller {
  readonly connection: Connection;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private delayMs = 1400;
  private lastSlot: number | null = null;
  private lastT = 0;
  private lastTps = 1800;
  private lastTxPerSlot = 500;

  constructor(
    readonly rpcUrl: string,
    private readonly handlers: PollerHandlers,
  ) {
    this.connection = new Connection(rpcUrl, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.delayMs = 1400;
    this.handlers.onHealth("listening", "asking mainnet for a pulse…");
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      void this.tick();
    }, this.delayMs);
  }

  private async tick(): Promise<void> {
    const started = performance.now();
    try {
      const [slot, fees, perf] = await Promise.all([
        this.connection.getSlot("confirmed"),
        this.connection.getRecentPrioritizationFees({
          lockedWritableAccounts: FEE_WATCH,
        }),
        this.connection.getRecentPerformanceSamples(4),
      ]);

      const now = Date.now();
      const lagMs = this.lastT === 0 ? performance.now() - started : now - this.lastT;
      const slotDelta = this.lastSlot === null ? 1 : Math.max(0, slot - this.lastSlot);
      const elapsedSec = Math.max(0.2, lagMs / 1000);
      const slotsPerSec = this.lastSlot === null ? 2.4 : slotDelta / elapsedSec;

      const feeValues = fees.map((f) => f.prioritizationFee);
      const feeP90 = percentile(feeValues, 0.9);
      const feePressure = feeValues.length
        ? feeValues.filter((n) => n > 0).length / feeValues.length
        : 0;

      const latest = (perf[0] ?? null) as PerfRow | null;
      if (latest && latest.samplePeriodSecs > 0 && latest.numSlots > 0) {
        const nonVote =
          latest.numNonVoteTransactions ??
          latest.numNonVoteTransaction ??
          latest.numTransactions;
        this.lastTps = nonVote / latest.samplePeriodSecs;
        this.lastTxPerSlot = nonVote / latest.numSlots;
      }

      this.lastSlot = slot;
      this.lastT = now;
      this.delayMs = 1400;
      this.handlers.onHealth("ok", this.rpcHost());
      this.handlers.onSample({
        t: now,
        slot,
        slotDelta,
        lagMs,
        slotsPerSec,
        tps: this.lastTps,
        txPerSlot: this.lastTxPerSlot,
        feeP90,
        feePressure,
      });
    } catch (err) {
      const limited = isRateLimited(err);
      this.delayMs = limited ? Math.min(this.delayMs * 2, 16000) : Math.min(this.delayMs + 800, 8000);
      this.handlers.onHealth(
        limited ? "waiting" : "error",
        limited
          ? `rpc asked us to wait (${Math.round(this.delayMs / 1000)}s)`
          : formatErr(err),
      );
    } finally {
      this.schedule();
    }
  }

  private rpcHost(): string {
    try {
      return new URL(this.rpcUrl).host;
    } catch {
      return "rpc";
    }
  }
}

function isRateLimited(err: unknown): boolean {
  const text = formatErr(err).toLowerCase();
  return text.includes("429") || text.includes("too many") || text.includes("rate limit");
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
