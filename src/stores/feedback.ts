import { atom } from "jotai";
import { listen } from "@tauri-apps/api/event";

export interface Timestamped<T> {
  timestamp: number;
  value: T;
}

const MAX_HISTORY = 100000;

export interface MotorFeedbackEvent {
  type: MotorFeedbackType;
  value: number[];
  timestamp: number;
}

export type MotorFeedbackType = "speed" | "position" | "iabc" | "udc";

export type MotorFeedbackState =
  | "None"
  | "Speed"
  | "Position"
  | "Current"
  | "Udc";

// ============================
// 1. 全局高性能 buffer（不在 jotai 内部）
// ============================

export const motorFeedbackBuffer: Record<
  MotorFeedbackType,
  Timestamped<number[]>[]
> = {
  speed: [],
  position: [],
  iabc: [],
  udc: [],
};

// 高性能 push（避免数组拷贝）
function pushData(type: MotorFeedbackType, entry: Timestamped<number[]>) {
  const arr = motorFeedbackBuffer[type];
  arr.push(entry);
  if (arr.length > MAX_HISTORY) arr.shift();
}

// ============================
// 2. Jotai 只负责 UI 状态，不存数据
// ============================

export const feedbackStateAtom = atom<MotorFeedbackType>("speed");

// 是否暂停
export const feedbackPausedAtom = atom(false);

// 显示窗口（例如最近多少 ms）
export const feedbackWindowMsAtom = atom(5000);

// ============================
// 3. 串口监听，只更新 buffer，不触发渲染
// ============================

export function useMotorFeedbackListener() {
  return () =>
    listen<MotorFeedbackEvent>("motor_feedback_update", (event) => {
      const { type, timestamp, value } = event.payload;

      pushData(type, {
        timestamp,
        value: (type === "iabc" ? value : [value]) as number[],
      });
    });
}
