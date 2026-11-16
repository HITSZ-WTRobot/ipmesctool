import { invoke } from "@tauri-apps/api/core";
import type { StreamMode, TelemetrySample } from "@/stores/telemetry.ts";
import { STREAM_MODES, TELEMETRY_SOURCES } from "@/lib/telemetry-modes.ts";

type ExportHistories = Partial<Record<StreamMode, Iterable<TelemetrySample>>>;
const columns = ["mode", "time_host_receive_s"];
const offsets = {} as Record<StreamMode, number>;
for (const mode of STREAM_MODES) {
  offsets[mode] = columns.length;
  columns.push(...TELEMETRY_SOURCES[mode].csvColumns);
}
const RAW_COLUMN = columns.length;
columns.push("raw");
const HEADER = columns.join(",");

/**
 * Export original protocol values, independently of the plot's display units.
 * Time is monotonic host receive seconds since the connection began. Column
 * names distinguish mechanical rpm/deg from electrical rpm/deg, without any
 * pole-pair or display-unit conversion. Each source must be time-ordered.
 * A multiway merge avoids sorting or copying all samples. Equal timestamps
 * retain source order, with ties between sources resolved in STREAM_MODES order.
 */
export function telemetryCsv(histories: ExportHistories): string {
  const cursors = STREAM_MODES.flatMap((mode) => {
    const source = histories[mode];
    if (!source) return [];
    const iterator = source[Symbol.iterator]();
    return [{ iterator, next: iterator.next() }];
  });
  // BOM lets Excel recognize UTF-8, including Chinese text in raw frames.
  const lines = [`\uFEFF${HEADER}\r\n`];
  while (true) {
    let earliest = -1;
    for (let index = 0; index < cursors.length; index++) {
      const current = cursors[index].next;
      if (!current.done && (earliest < 0 || current.value.time < cursors[earliest].next.value.time)) {
        earliest = index;
      }
    }
    if (earliest < 0) break;
    const cursor = cursors[earliest];
    const sample = cursor.next.value as TelemetrySample;
    const fields = new Array<string>(columns.length).fill("");
    fields[0] = sample.mode;
    fields[1] = Object.is(sample.time, -0) ? "-0" : String(sample.time);
    const offset = offsets[sample.mode];
    const count = TELEMETRY_SOURCES[sample.mode].csvColumns.length;
    for (let channel = 0; channel < count; channel++) {
      // Number -> string round-trips every stored IEEE-754 value: no toFixed.
      const value = sample.values[channel];
      fields[offset + channel] = Object.is(value, -0) ? "-0" : String(value);
    }
    fields[RAW_COLUMN] = /[",\r\n]/.test(sample.raw) ? `"${sample.raw.replace(/"/g, '""')}"` : sample.raw;
    lines.push(`${fields.join(",")}\r\n`);
    cursor.next = cursor.iterator.next();
  }
  return lines.join("");
}

/** Native save dialog; cancellation is false, while I/O errors reject. */
export function exportTelemetryCsv(histories: ExportHistories, filename: string): Promise<boolean> {
  return invoke<boolean>("export_telemetry_csv", { filename, csv: telemetryCsv(histories) });
}
