import type { TelemetrySample } from "@/stores/telemetry.ts";

const BLOCK_SIZE = 512;

interface HistoryBlock {
  samples: TelemetrySample[];
  shared: boolean;
}

function lowerBound(samples: readonly TelemetrySample[], time: number, start = 0): number {
  let low = start;
  let high = samples.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (samples[middle].time < time) low = middle + 1;
    else high = middle;
  }
  return low;
}

/** Time-ordered, full-resolution history. Append inputs must have nondecreasing times. */
export class TelemetryHistory {
  // Entries before head are cleared immediately; live entries are always present.
  private blocks: (HistoryBlock | undefined)[] = [];
  private head = 0;
  private headOffset = 0;
  private count = 0;
  private fixed = false;

  get length(): number {
    return this.count;
  }

  get firstTime(): number | undefined {
    return this.blocks[this.head]?.samples[this.headOffset]?.time;
  }

  get lastTime(): number | undefined {
    const samples = this.blocks[this.blocks.length - 1]?.samples;
    return samples?.[samples.length - 1]?.time;
  }

  /** Append without copying retained samples; only a shared partial tail needs a copy. */
  append(samples: readonly TelemetrySample[]): void {
    this.assertMutable();
    for (const sample of samples) {
      let tail = this.blocks[this.blocks.length - 1];
      if (!tail || tail.samples.length === BLOCK_SIZE) {
        tail = { samples: [], shared: false };
        this.blocks.push(tail);
      } else if (tail.shared) {
        tail = { samples: tail.samples.slice(), shared: false };
        this.blocks[this.blocks.length - 1] = tail;
      }
      tail.samples.push(sample);
      this.count++;
    }
  }

  /** Remove samples strictly before the cutoff, preserving every equal-time sample. */
  trimBefore(time: number): void {
    this.assertMutable();
    const blockIndex = this.findBlock(time);
    while (this.head < blockIndex) {
      this.count -= this.blocks[this.head]!.samples.length - this.headOffset;
      this.blocks[this.head] = undefined;
      this.head++;
      this.headOffset = 0;
    }
    if (this.head === this.blocks.length) {
      this.blocks = [];
      this.head = 0;
      this.headOffset = 0;
      return;
    }
    const offset = lowerBound(this.blocks[this.head]!.samples, time, this.headOffset);
    this.count -= offset - this.headOffset;
    this.headOffset = offset;
    // Amortized compaction copies block references, never the retained samples.
    if (this.head >= 64 && this.head * 2 >= this.blocks.length) {
      this.blocks = this.blocks.slice(this.head);
      this.head = 0;
    }
  }

  /** Inclusive time range, located by binary search rather than a full-history scan. */
  range(start = -Infinity, end = Infinity): TelemetrySample[] {
    const result: TelemetrySample[] = [];
    if (start > end) return result;
    let blockIndex = this.findBlock(start);
    for (; blockIndex < this.blocks.length; blockIndex++) {
      const samples = this.blocks[blockIndex]!.samples;
      const first = blockIndex === this.head ? this.headOffset : 0;
      const offset = lowerBound(samples, start, first);
      for (let index = offset; index < samples.length; index++) {
        const sample = samples[index];
        if (sample.time > end) return result;
        result.push(sample);
      }
    }
    return result;
  }

  /** Capture block references and the visible head; subsequent writes use copy-on-write. */
  snapshot(): TelemetryHistory {
    if (this.fixed) return this;
    const snapshot = new TelemetryHistory();
    snapshot.blocks = this.blocks.slice(this.head);
    snapshot.headOffset = this.headOffset;
    snapshot.count = this.count;
    snapshot.fixed = true;
    const tail = snapshot.blocks[snapshot.blocks.length - 1];
    if (tail) tail.shared = true;
    return snapshot;
  }

  *samples(): IterableIterator<TelemetrySample> {
    for (let blockIndex = this.head; blockIndex < this.blocks.length; blockIndex++) {
      const samples = this.blocks[blockIndex]!.samples;
      const first = blockIndex === this.head ? this.headOffset : 0;
      for (let index = first; index < samples.length; index++) yield samples[index];
    }
  }

  private findBlock(time: number): number {
    let low = this.head;
    let high = this.blocks.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      const samples = this.blocks[middle]!.samples;
      if (samples[samples.length - 1].time < time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  private assertMutable(): void {
    if (this.fixed) throw new Error("Cannot modify a telemetry history snapshot");
  }
}
