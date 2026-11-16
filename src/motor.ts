import { z } from "zod";

/**
 * 为了匹配 rust 端的 serde，这里我们统一采用 snake_case
 */

export const motorState = z.enum([
  "Initialization",
  "Calibration",
  "CurrentControl",
  "SpeedControl",
  "PositionControl",
  "Ready",
  "Fault",
  "Unknown",
]);

export type MotorState = z.infer<typeof motorState>;

/** 处于闭环运行中（可执行 set_speed/set_position/set_current/stop）的状态 */
export const RUNNING_STATES: MotorState[] = [
  "CurrentControl",
  "SpeedControl",
  "PositionControl",
];

export const positionPID = z.object({
  kp: z.number(),
  ki: z.number(),
  kd: z.number(),
  output_max: z.number(),
});

export type PositionPID = z.infer<typeof positionPID>;

export const speedPI = z.object({
  kp: z.number(),
  ki: z.number(),
  output_max: z.number(),
});

export type SpeedPI = z.infer<typeof speedPI>;

/** 速度环参数辨识正弦 q 轴电流幅值（A） */
export const speedSweep = z.object({
  iq_amplitude: z.number(),
  speed_filter: z.number().finite().positive(),
  current_filter: z.number().finite().positive(),
  pll_frequency: z.number().finite().positive(),
});

export type SpeedSweep = z.infer<typeof speedSweep>;

export const currentPI = z.object({
  kp: z.number(),
  ki: z.number(),
});

export type CurrentPI = z.infer<typeof currentPI>;

/** 任一相电流绝对值超过此阈值即触发 Fault，不是指令限幅。 */
export const currentProtection = z.object({
  current_limit: z.number().finite().positive(),
});

export type CurrentProtection = z.infer<typeof currentProtection>;

/** 电气参数由校准识别；flux_speed 为可配置的辨识机械速度幅值。 */
export const motorElectricalConfig = z.object({
  rs: z.number(),
  ld: z.number(),
  lq: z.number(),
  flux: z.number().finite().nonnegative(),
  flux_speed: z.number().finite().min(100).max(3000),
});

export type MotorElectricalConfig = z.infer<typeof motorElectricalConfig>;

/** 可写入的方向；读回允许 None */
export const ENCODER_DIRECTIONS = ["CW", "CCW"] as const;
export type WritableEncoderDirection = (typeof ENCODER_DIRECTIONS)[number];

const encoderDirection = z.enum(["CW", "CCW", "None"]);
export type EncoderDirection = z.infer<typeof encoderDirection>;

/** 可写入的编码器类型；读回允许 None / Unknown */
export const ENCODER_TYPES = [
  "AS5600",
  "MT6701_IIC",
  "MT6701_SPI",
  "AS5047P",
] as const;
export type WritableEncoderType = (typeof ENCODER_TYPES)[number];

const encoderType = z.enum([
  "AS5600",
  "MT6701_IIC",
  "MT6701_SPI",
  "AS5047P",
  "None",
  "Unknown",
]);
export type EncoderType = z.infer<typeof encoderType>;

export const encoderConfig = z.object({
  // 未配置时读回 0，写入范围 1..255
  pole_pairs: z.number().int().min(0).max(4294967295),
  encoder_direction: encoderDirection,
  encoder_offset: z.number(),
  encoder_type: encoderType,
});

export type EncoderConfig = z.infer<typeof encoderConfig>;

export const hfiConfigSchema = z.object({
  voltage: z.number().finite().nonnegative(),
  current_filter: z.number().finite().positive().lt(2500),
  kp: z.number().finite().positive(),
  ki: z.number().finite().positive(),
  speed_filter: z.number().finite().positive().lt(2500),
});

export const observerFluxSchema = z.object({
  gamma: z.number().finite().positive().max(1e12),
  kp: z.number().finite().positive().max(1e6),
  ki: z.number().finite().positive().max(1e8),
});

export const transitionSchema = z.object({
  low: z.number().finite().nonnegative(),
  high: z.number().finite().positive().max(1e6),
}).refine(({ low, high }) => low < high, "过渡区必须满足 0 ≤ low < high ≤ 1000000");

export const motorDiagnosticsSchema = z.object({
  sessionId: z.string(),
  fault: z.number().int().min(0).max(255),
  hfiState: z.number().int().min(0).max(4).nullable(),
});
export type MotorDiagnostics = z.infer<typeof motorDiagnosticsSchema>;

export const HFI_STATE_LABELS = ["Bypass（旁路）", "Starting（启动中）", "Observing（观测中）", "VoltageLimit（电压受限）", "Invalid（无效）"] as const;

export function describeFault(fault: number): string {
  const flags = [];
  if (fault & 1) flags.push("过流");
  if (fault & 2) flags.push("编码器");
  if (fault & ~3) flags.push(`未知位 0x${(fault & ~3).toString(16)}`);
  return `${fault} (${flags.join("、") || "无故障"})`;
}

export const motorConfigSchema = z.object({
  state: motorState,
  fault: z.number().int().min(0).max(255),
  id: z.number().int().min(0).max(4294967295),
  protection: currentProtection,
  motor: motorElectricalConfig,
  position_pid: positionPID,
  speed_pi: speedPI,
  speed_sweep: speedSweep,
  current_id_pi: currentPI,
  current_iq_pi: currentPI,
  encoder_config: encoderConfig,
  hfi: hfiConfigSchema,
  observer_flux: observerFluxSchema,
  transition: transitionSchema,
  backup: z.object({ enabled: z.boolean() }),
});

export type MotorConfig = z.infer<typeof motorConfigSchema>;
