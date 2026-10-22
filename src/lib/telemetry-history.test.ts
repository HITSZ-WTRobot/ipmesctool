import assert from "node:assert/strict";
import { test } from "node:test";
import type { TelemetrySample } from "@/stores/telemetry.ts";
import { TelemetryHistory } from "./telemetry-history.ts";

function sample(time: number, value = time): TelemetrySample {
  return { mode: "speed", time, values: [value, value], raw: String(value) };
}

test("inclusive ranges preserve all equal-time samples across a block boundary", () => {
  const history = new TelemetryHistory();
  const duplicates = [sample(511, 10), sample(511, 20), sample(511, 30)];
  const before = sample(510);
  const after = sample(512);
  history.append([
    ...Array.from({ length: 510 }, (_, index) => sample(index)),
    before,
    ...duplicates,
    after,
  ]);

  assert.deepEqual(history.range(511, 511), duplicates);
  assert.deepEqual(history.range(510, 512), [before, ...duplicates, after]);
  assert.deepEqual(history.range(512, 511), []);
});

test("pruning across blocks and appending leave the captured history intact", () => {
  const history = new TelemetryHistory();
  const original = Array.from({ length: 515 }, (_, index) => sample(index));
  history.append(original);
  const captured = history.snapshot();

  history.trimBefore(513);
  const appended = [sample(515), sample(516)];
  history.append(appended);

  assert.deepEqual(history.range(), [...original.slice(513), ...appended]);
  assert.equal(history.length, 4);
  assert.equal(history.firstTime, 513);
  assert.equal(history.lastTime, 516);
  assert.deepEqual([...captured.samples()], original);
  assert.equal(captured.length, 515);
  assert.equal(captured.firstTime, 0);
  assert.equal(captured.lastTime, 514);
});

test("a snapshot preserves a partially trimmed tail through append, clear, and reuse", () => {
  const history = new TelemetryHistory();
  const original = [sample(1), sample(2, 20), sample(2, 21), sample(3, 30)];
  history.append(original);
  history.trimBefore(2);
  const captured = history.snapshot();

  const appended = [sample(3, 31), sample(4)];
  history.append(appended);
  history.trimBefore(3);
  assert.deepEqual(history.range(), [original[3], ...appended]);
  assert.deepEqual(captured.range(2, 2), original.slice(1, 3));
  assert.deepEqual(captured.range(), original.slice(1));
  assert.equal(captured.length, 3);
  assert.equal(captured.firstTime, 2);
  assert.equal(captured.lastTime, 3);

  history.trimBefore(5);
  assert.equal(history.length, 0);
  assert.equal(history.firstTime, undefined);
  assert.equal(history.lastTime, undefined);
  assert.deepEqual(history.range(), []);
  const next = sample(6);
  history.append([next]);
  assert.deepEqual([...history.samples()], [next]);
  assert.deepEqual([...captured.samples()], original.slice(1));
});
