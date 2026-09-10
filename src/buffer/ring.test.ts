import { describe, expect, it } from "vitest";
import { TimeRing } from "./ring";

describe("TimeRing", () => {
  it("drops samples older than the window", () => {
    const ring = new TimeRing<{ t: number; n: number }>(1_000);
    ring.push({ t: 1000, n: 1 });
    ring.push({ t: 1500, n: 2 });
    ring.push({ t: 2200, n: 3 });
    expect(ring.snapshot().map((x) => x.n)).toEqual([2, 3]);
  });

  it("picks the nearest sample for a scrub fraction", () => {
    const ring = new TimeRing<{ t: number; n: number }>(10_000);
    ring.push({ t: 0, n: 0 });
    ring.push({ t: 50, n: 1 });
    ring.push({ t: 100, n: 2 });
    expect(ring.atFraction(0)?.n).toBe(0);
    expect(ring.atFraction(1)?.n).toBe(2);
    expect(ring.atFraction(0.5)?.n).toBe(1);
  });
});
