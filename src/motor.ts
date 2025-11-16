import { z } from "zod";
import { invoke } from "@tauri-apps/api/core";

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
  outputMax: z.number().min(0),
});

type PositionPID = z.infer<typeof positionPID>;

const speedPI = z.object({
  kp: z.number(),
  ki: z.number(),
  outputMax: z.number().min(0),
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
  polePairs: z.uint32(),
  encoderDirection,
  encoder_offset: z.number(),
  encoderType,
});

const motorConfig = z.object({
  id: z.int().min(0).max(255),
  udc: z.number().min(0),
  positionPID,
  speedPI,
  currentIdPI: currentPI,
  currentIqPI: currentPI,
  fc: z.number().min(0),
  encoderConfig,
});

type MotorConfig = z.infer<typeof motorConfig>;

class Motor {
  serialName: string | null = null;
  config: MotorConfig = {
    id: 1,
    udc: 24,
    positionPID: {
      kp: 0,
      ki: 0,
      kd: 0,
      outputMax: 0,
    },
    speedPI: {
      kp: 0,
      ki: 0,
      outputMax: 0,
    },
    currentIdPI: {
      kp: 0,
      ki: 0,
    },
    currentIqPI: {
      kp: 0,
      ki: 0,
    },
    fc: 100,
    encoderConfig: {
      polePairs: 7,
      encoderDirection: EncoderDirection.Same,
      encoder_offset: 0,
      encoderType: EncoderType.MT6701,
    },
  };

  async setFeedback(feedback: MotorFeedbackType) {
    return await invoke("set_motor_feedback", { feedback });
  }

  async getState(): Promise<MotorState> {
    return await invoke("get_motor_state");
  }
}
