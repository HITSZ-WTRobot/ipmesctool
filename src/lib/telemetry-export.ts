import { invoke } from "@tauri-apps/api/core";
import type { StreamMode, TelemetrySample } from "@/stores/telemetry.ts";

type ExportHistories = Partial<Record<StreamMode, Iterable<TelemetrySample>>>;
const MODES: readonly StreamMode[] = ["iabc", "idq", "speed", "position"];
const HEADER = "mode,time_host_receive_s,ia_A,ib_A,ic_A,id_A,iq_A,speed_setpoint_rpm,speed_actual_rpm,position_setpoint_deg,position_actual_deg,raw";

/**
 * Export original protocol values, independently of the plot's display units.
 * Time is monotonic host receive seconds since the connection began; currents
 * are A, speed is rpm, and position is deg. Each source must be time-ordered.
 * A four-way merge avoids sorting or copying all samples. Equal timestamps
 * retain source order, with ties between sources resolved in MODES order.
 */
export function telemetryCsv(histories: ExportHistories): string {
  const cursors = MODES.flatMap((mode) => {
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
    const fields = new Array<string>(12).fill("");
    fields[0] = sample.mode;
    fields[1] = Object.is(sample.time, -0) ? "-0" : String(sample.time);
    const offset = sample.mode === "iabc" ? 2 : sample.mode === "idq" ? 5 : sample.mode === "speed" ? 7 : 9;
    const count = sample.mode === "iabc" ? 3 : 2;
    for (let channel = 0; channel < count; channel++) {
      // Number -> string round-trips every stored IEEE-754 value: no toFixed.
      const value = sample.values[channel];
      fields[offset + channel] = Object.is(value, -0) ? "-0" : String(value);
    }
    fields[11] = /[",\r\n]/.test(sample.raw) ? `"${sample.raw.replace(/"/g, '""')}"` : sample.raw;
    lines.push(`${fields.join(",")}\r\n`);
    cursor.next = cursor.iterator.next();
  }
  return lines.join("");
}

/** Native save dialog; cancellation is false, while I/O errors reject. */
export function exportTelemetryCsv(histories: ExportHistories, filename: string): Promise<boolean> {
  return invoke<boolean>("export_telemetry_csv", { filename, csv: telemetryCsv(histories) });
}
