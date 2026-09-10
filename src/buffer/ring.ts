export class TimeRing<T extends { t: number }> {
  private items: T[] = [];

  constructor(private readonly windowMs: number) {}

  push(item: T): T[] {
    this.items.push(item);
    const cutoff = item.t - this.windowMs;
    while (this.items.length > 0 && this.items[0].t < cutoff) {
      this.items.shift();
    }
    return this.snapshot();
  }

  snapshot(): T[] {
    return this.items.slice();
  }

  span(): { start: number; end: number } | null {
    if (this.items.length === 0) return null;
    return { start: this.items[0].t, end: this.items[this.items.length - 1].t };
  }

  atFraction(fraction: number): T | null {
    if (this.items.length === 0) return null;
    const span = this.span();
    if (!span) return null;
    const t = span.start + (span.end - span.start) * Math.min(1, Math.max(0, fraction));
    let best = this.items[0];
    let bestDist = Math.abs(best.t - t);
    for (const item of this.items) {
      const dist = Math.abs(item.t - t);
      if (dist < bestDist) {
        best = item;
        bestDist = dist;
      }
    }
    return best;
  }
}
