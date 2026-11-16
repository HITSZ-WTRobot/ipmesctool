import assert from "node:assert/strict";
import { test } from "node:test";
import type { StreamMode, TelemetrySample } from "@/stores/telemetry.ts";
import { telemetryCsv } from "./telemetry-export.ts";

function sample(mode: StreamMode, time: number, values: number[], raw: string = mode): TelemetrySample {
  return { mode, time, values, raw };
}

test("CSV merges interleaved sources and keeps electrical quantities in their original unit columns", () => {
  const csv = telemetryCsv({
    observer_speed: [sample("observer_speed", 7, [8400.125, -8399.875])],
    observer_pos: [sample("observer_pos", 4, [179.75, -180.25])],
    angle: [sample("angle", 4, [359.999, -0.001])],
    position: [sample("position", 5, [1080.5, -720.25])],
    speed: [sample("speed", 3, [1200.25, -1199.5])],
    idq: [sample("idq", 2, [-0.125, 4.5])],
    iabc: [sample("iabc", 1, [1.25, -2.5, 3.75])],
  });
  const [header, ...lines] = csv.slice(1).trimEnd().split("\r\n");
  const columns = header.split(",");
  const rows = lines.map((line) => Object.fromEntries(line.split(",").map((value, index) => [columns[index], value])));
  assert.deepEqual(rows.map((row) => [row.mode, row.time_host_receive_s]), [
    ["iabc", "1"], ["idq", "2"], ["speed", "3"], ["angle", "4"],
    ["observer_pos", "4"], ["position", "5"], ["observer_speed", "7"],
  ]);
  const values = Object.fromEntries(rows.map((row) => [row.mode, Object.fromEntries(
    Object.entries(row).filter(([key, value]) => value !== "" && key !== "mode" && key !== "time_host_receive_s" && key !== "raw"),
  )]));
  assert.deepEqual(values, {
    iabc: { ia_A: "1.25", ib_A: "-2.5", ic_A: "3.75" },
    idq: { id_A: "-0.125", iq_A: "4.5" },
    speed: { speed_setpoint_rpm: "1200.25", speed_actual_rpm: "-1199.5" },
    angle: { angle_encoder_electrical_deg: "359.999", angle_observer_electrical_deg: "-0.001" },
    observer_pos: { observer_pos_encoder_electrical_deg: "179.75", observer_pos_observer_electrical_deg: "-180.25" },
    position: { position_setpoint_deg: "1080.5", position_actual_deg: "-720.25" },
    observer_speed: { observer_speed_encoder_electrical_rpm: "8400.125", observer_speed_observer_electrical_rpm: "-8399.875" },
  });
});

test("CSV preserves signed zero, floating-point precision, and escaped original frames", () => {
  const precise = 1.2345678901234567;
  const raw = 'observer_speed:0,1.2345678901234567,"原始"\r\n';
  const csv = telemetryCsv({ observer_speed: [sample("observer_speed", -0, [-0, precise], raw)] });
  assert.ok(csv.startsWith("\uFEFFmode,time_host_receive_s,"));
  const data = csv.slice(csv.indexOf("\r\n") + 2);
  const fields = data.split(",");
  assert.equal(fields[1], "-0");
  assert.equal(fields[15], "-0");
  assert.equal(Number(fields[16]), precise);
  assert.ok(data.endsWith('"observer_speed:0,1.2345678901234567,""原始""\r\n"\r\n'));
});
