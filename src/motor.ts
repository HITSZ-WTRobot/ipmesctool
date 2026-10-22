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
});

export type SpeedSweep = z.infer<typeof speedSweep>;

export const currentPI = z.object({
  kp: z.number(),
  ki: z.number(),
});

export type CurrentPI = z.infer<typeof currentPI>;

/** 电机电气参数，由校准识别，无运行时写入命令（只读展示） */
export const motorElectricalConfig = z.object({
  rs: z.number(),
  ld: z.number(),
  lq: z.number(),
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

export const motorConfigSchema = z.object({
  state: motorState,
  id: z.number().int().min(0).max(4294967295),
  motor: motorElectricalConfig,
  position_pid: positionPID,
  speed_pi: speedPI,
  speed_sweep: speedSweep,
  current_id_pi: currentPI,
  current_iq_pi: currentPI,
  encoder_config: encoderConfig,
});

export type MotorConfig = z.infer<typeof motorConfigSchema>;
