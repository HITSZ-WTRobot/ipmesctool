import { z } from "zod";

/**
 * 为了匹配 rust 端的 serde，这里我们统一采用 snake_case
 */

const motorFeedbackType = z.enum([
  "None",
  "Speed",
  "Position",
  "Current",
  "Udc",
]);
const motorState = z.enum(["Stop", "DebugRun", "Run", "Test", "Fault"]);

type MotorState = z.infer<typeof motorState>;
type MotorFeedbackType = z.infer<typeof motorFeedbackType>;

const positionPID = z.object({
  kp: z.number(),
  ki: z.number(),
  kd: z.number(),
  output_max: z.number().min(0),
});

type PositionPID = z.infer<typeof positionPID>;

const speedPI = z.object({
  kp: z.number(),
  ki: z.number(),
  output_max: z.number().min(0),
});

type SpeedPI = z.infer<typeof speedPI>;

const currentPI = z.object({
  kp: z.number(),
  ki: z.number(),
});

type CurrentPI = z.infer<typeof currentPI>;

enum EncoderDirection {
  Same = 1,
  Reverse = -1,
}

export enum EncoderType {
  MT6701 = "MT6701",
}

const encoderDirection = z.enum(EncoderDirection);
const encoderType = z.enum(EncoderType);

const encoderConfig = z.object({
  pole_pairs: z.uint32(),
  encoder_direction: encoderDirection,
  encoder_offset: z.number(),
  encoder_type: encoderType,
});

const motorConfig = z.object({
  id: z.int().min(0).max(255),
  udc: z.number().min(0),
  position_pid: positionPID,
  speed_pi: speedPI,
  current_id_pi: currentPI,
  current_iq_pi: currentPI,
  fc: z.number().min(0),
  encoder_config: encoderConfig,
});

export type MotorConfig = z.infer<typeof motorConfig>;
