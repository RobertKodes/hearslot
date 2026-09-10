import { Connection, PublicKey } from "@solana/web3.js";
import type { ChainSample, PollHealth } from "../types";
import { percentile } from "../audio/mapping";

// Official api.mainnet-beta.solana.com 403s browser Origins (GH Pages / localhost).
// PublicNode answers those and still speaks confirmed mainnet.
const BUILTIN_RPCS = [
  "https://solana-rpc.publicnode.com",
  "https://api.mainnet-beta.solana.com",
];

export const RPC_CANDIDATES = unique([
  import.meta.env.VITE_RPC_URL?.trim(),
  ...BUILTIN_RPCS,
]);

export const DEFAULT_RPC = RPC_CANDIDATES[0];

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
  readonly urls: string[];
  private index = 0;
  private connection: Connection;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = true;
  private delayMs = 1600;
  private lastSlot: number | null = null;
  private lastT = 0;
  private lastTps = 1800;
  private lastTxPerSlot = 500;

  constructor(urls: string | string[], private readonly handlers: PollerHandlers) {
    this.urls = Array.isArray(urls) ? urls.filter(Boolean) : [urls];
    this.connection = this.makeConnection(this.urls[0]);
  }

  get rpcUrl(): string {
    return this.urls[this.index] ?? this.urls[0];
  }

  rpcHost(): string {
    return hostOf(this.rpcUrl);
  }

  start(): void {
    if (!this.stopped) return;
    this.stopped = false;
    this.delayMs = 1600;
    this.handlers.onHealth("listening", `asking ${this.rpcHost()} for a pulse…`);
    void this.tick();
  }

  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private makeConnection(url: string): Connection {
    return new Connection(url, {
      commitment: "confirmed",
      disableRetryOnRateLimit: true,
    });
  }

  private schedule(): void {
    if (this.stopped) return;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.tick();
    }, this.delayMs);
  }

  private rotate(reason: string): boolean {
    if (this.index >= this.urls.length - 1) return false;
    this.index += 1;
    this.connection = this.makeConnection(this.rpcUrl);
    this.delayMs = 1600;
    this.handlers.onHealth("waiting", `${reason}; trying ${this.rpcHost()}`);
    return true;
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
      this.delayMs = 1600;
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
      const forbidden = isForbidden(err);
      if (forbidden && this.rotate("rpc blocked this origin")) {
        return;
      }
      const limited = isRateLimited(err);
      this.delayMs = limited || forbidden
        ? Math.min(this.delayMs * 2, 16000)
        : Math.min(this.delayMs + 800, 8000);
      this.handlers.onHealth(
        limited || forbidden ? "waiting" : "error",
        limited
          ? `rpc asked us to wait (${Math.round(this.delayMs / 1000)}s)`
          : forbidden
            ? `rpc blocked this origin (${this.rpcHost()})`
            : formatErr(err),
      );
    } finally {
      this.schedule();
    }
  }
}

function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((v): v is string => Boolean(v)))];
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "rpc";
  }
}

function isRateLimited(err: unknown): boolean {
  const text = formatErr(err).toLowerCase();
  return text.includes("429") || text.includes("too many") || text.includes("rate limit");
}

function isForbidden(err: unknown): boolean {
  const text = formatErr(err).toLowerCase();
  return text.includes("403") || text.includes("access forbidden") || text.includes("forbidden");
}

function formatErr(err: unknown): string {
  if (err instanceof Error) return err.message.slice(0, 180);
  return String(err).slice(0, 180);
}
