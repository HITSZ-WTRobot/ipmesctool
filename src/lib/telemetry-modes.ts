import type { StreamMode, TelemetryMode } from "@/stores/telemetry.ts";

/** Protocol units are independent of mechanical display preferences and pole pairs. */
export const TELEMETRY_SOURCES = {
  iabc: {
    name: "三相电流", labels: ["Ia", "Ib", "Ic"], command: "get_iabc",
    unit: "A", csvColumns: ["ia_A", "ib_A", "ic_A"],
  },
  idq: {
    name: "DQ 轴电流", labels: ["Id", "Iq"], command: "get_idq",
    unit: "A", csvColumns: ["id_A", "iq_A"],
  },
  speed: {
    name: "机械速度", labels: ["速度给定", "速度反馈"], command: "get_speed",
    unit: "rpm", csvColumns: ["speed_setpoint_rpm", "speed_actual_rpm"],
  },
  position: {
    name: "累计机械位置", labels: ["位置给定", "位置反馈"], command: "get_position",
    unit: "deg", csvColumns: ["position_setpoint_deg", "position_actual_deg"],
  },
  angle: {
    name: "电角度", labels: ["编码器电角度", "观测器电角度"], command: "get_angle",
    unit: "电角度 deg", csvColumns: ["angle_encoder_electrical_deg", "angle_observer_electrical_deg"],
  },
  observer_pos: {
    name: "观测器电角度", labels: ["编码器电角度", "观测器电角度"], command: "get observer pos",
    unit: "电角度 deg", csvColumns: ["observer_pos_encoder_electrical_deg", "observer_pos_observer_electrical_deg"],
  },
  observer_speed: {
    name: "观测器电气速度", labels: ["编码器电气速度", "观测器电气速度"], command: "get observer speed",
    unit: "电气 rpm", csvColumns: ["observer_speed_encoder_electrical_rpm", "observer_speed_observer_electrical_rpm"],
  },
} as const satisfies Record<StreamMode, {
  name: string; labels: readonly string[]; command: string; unit: string; csvColumns: readonly string[];
}>;

export const STREAM_MODES = Object.keys(TELEMETRY_SOURCES) as StreamMode[];

/** Only exact no-ACK commands switch streams; lookalikes use the normal ACK path. */
export function telemetryModeFromCommand(command: string): TelemetryMode | undefined {
  if (command === "get_none") return "none";
  return STREAM_MODES.find((mode) => TELEMETRY_SOURCES[mode].command === command);
}
