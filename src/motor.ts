import { z } from "zod";

/**
 * 为了匹配 rust 端的 serde，这里我们统一采用 snake_case。
 *
 * `get_config` 是容错读取：任一配置单元都可能为 null（旧固件没上报、读数非法
 * 或超出可写范围）。读回 schema 只校验类型与有限性；写入校验使用 *Draft
 * schema，两者不能混用。
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
  kp: z.number().finite(),
  ki: z.number().finite(),
  kd: z.number().finite(),
  output_max: z.number().finite(),
});

export type PositionPID = z.infer<typeof positionPID>;

export const speedPI = z.object({
  kp: z.number().finite(),
  ki: z.number().finite(),
  output_max: z.number().finite(),
});

export type SpeedPI = z.infer<typeof speedPI>;

/** 电流环 d/q 轴独立增益（一个写入单元）。 */
export const currentPiConfig = z.object({
  d_kp: z.number().finite(),
  d_ki: z.number().finite(),
  q_kp: z.number().finite(),
  q_ki: z.number().finite(),
});

export type CurrentPiConfig = z.infer<typeof currentPiConfig>;

/** 任一相电流绝对值超过此阈值即触发 Fault，不是指令限幅。 */
export const currentProtection = z.object({
  current_limit: z.number().finite(),
});

export type CurrentProtection = z.infer<typeof currentProtection>;

/** 电气参数由校准识别，只读；flux_speed 是独立的可写辨识机械速度。 */
export const motorElectricalConfig = z.object({
  rs: z.number().finite(),
  ld: z.number().finite(),
  lq: z.number().finite(),
  flux: z.number().finite().nonnegative(),
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
  encoder_offset: z.number().finite(),
  encoder_type: encoderType,
});

export type EncoderConfig = z.infer<typeof encoderConfig>;

/** 读回 HFI 配置：值可能超出可写范围，因此只校验有限性。 */
export const hfiConfigSchema = z.object({
  voltage: z.number().finite(),
  current_filter: z.number().finite(),
  kp: z.number().finite(),
  ki: z.number().finite(),
  speed_filter: z.number().finite(),
});

export type HfiConfig = z.infer<typeof hfiConfigSchema>;

/** 写入 HFI 的固件范围校验。 */
export const hfiConfigDraft = z.object({
  voltage: z.number().finite().nonnegative(),
  current_filter: z.number().finite().positive().lt(2500),
  kp: z.number().finite().positive(),
  ki: z.number().finite().positive(),
  speed_filter: z.number().finite().positive().lt(2500),
});

export const observerFluxSchema = z.object({
  gamma: z.number().finite(),
  kp: z.number().finite(),
  ki: z.number().finite(),
});

export type ObserverFluxConfig = z.infer<typeof observerFluxSchema>;

export const observerFluxDraft = z.object({
  gamma: z.number().finite().positive().max(1e12),
  kp: z.number().finite().positive().max(1e6),
  ki: z.number().finite().positive().max(1e8),
});

export const transitionSchema = z.object({
  low: z.number().finite(),
  high: z.number().finite(),
});

export type TransitionConfig = z.infer<typeof transitionSchema>;

export const transitionDraft = transitionSchema.refine(
  ({ low, high }) => low >= 0 && low < high && high <= 1e6,
  "过渡区必须满足 0 ≤ low < high ≤ 1000000",
);

export const motorDiagnosticsSchema = z.object({
  sessionId: z.string(),
  fault: z.number().int().min(0).max(255),
  hfiState: z.number().int().min(0).max(4).nullable(),
});
export type MotorDiagnostics = z.infer<typeof motorDiagnosticsSchema>;

export const HFI_STATE_LABELS = ["Bypass（旁路）", "Starting（启动中）", "Observing（观测中）", "VoltageLimit（电压受限）", "Invalid（无效）"] as const;

export function describeFault(fault: number | null | undefined): string {
  if (fault == null) return "未知";
  const flags = [];
  if (fault & 1) flags.push("过流");
  if (fault & 2) flags.push("编码器");
  if (fault & ~3) flags.push(`未知位 0x${(fault & ~3).toString(16)}`);
  return `${fault} (${flags.join("、") || "无故障"})`;
}

/** 单个可写单元的读回能力；与 Rust `Capabilities` 键一致。 */
export const capabilitySchema = z.object({
  available: z.boolean(),
  writable: z.boolean(),
  reason: z.string().nullable(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const capabilitiesSchema = z.object({
  position_pid: capabilitySchema,
  speed_pi: capabilitySchema,
  current_pi: capabilitySchema,
  speed_sweep_current: capabilitySchema,
  flux_speed: capabilitySchema,
  speed_filter: capabilitySchema,
  current_filter: capabilitySchema,
  speed_pll: capabilitySchema,
  current_limit: capabilitySchema,
  motor_id: capabilitySchema,
  encoder_config: capabilitySchema,
  hfi: capabilitySchema,
  observer_flux: capabilitySchema,
  transition: capabilitySchema,
  backup: capabilitySchema,
});
export type Capabilities = z.infer<typeof capabilitiesSchema>;

export const configIssueSchema = z.object({
  unit: z.string(),
  field: z.string(),
  kind: z.enum(["Missing", "Malformed", "OutOfRange"]),
  message: z.string(),
});
export type ConfigIssue = z.infer<typeof configIssueSchema>;

export const motorConfigSchema = z.object({
  state: motorState.nullable(),
  fault: z.number().int().min(0).max(255).nullable(),
  id: z.number().int().min(0).max(4294967295).nullable(),
  protection: currentProtection.nullable(),
  electrical: motorElectricalConfig.nullable(),
  flux_speed: z.number().finite().nullable(),
  position_pid: positionPID.nullable(),
  speed_pi: speedPI.nullable(),
  current_pi: currentPiConfig.nullable(),
  speed_sweep_current: z.number().finite().nullable(),
  speed_filter: z.number().finite().nullable(),
  current_filter: z.number().finite().nullable(),
  speed_pll: z.number().finite().nullable(),
  encoder_config: encoderConfig.nullable(),
  hfi: hfiConfigSchema.nullable(),
  observer_flux: observerFluxSchema.nullable(),
  transition: transitionSchema.nullable(),
  backup: z.object({ enabled: z.boolean() }).nullable(),
  issues: z.array(configIssueSchema),
  capabilities: capabilitiesSchema,
});

export type MotorConfig = z.infer<typeof motorConfigSchema>;
