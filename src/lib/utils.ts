import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function setPartValue<T>(
  setter: (v: T) => void,
  prev: T,
  key: keyof T,
  value: T[keyof T],
) {
  setter({ ...prev, [key]: value });
}

export function rad2deg(radians: number) {
  return (radians * 180) / Math.PI;
}

export function deg2rad(degrees: number) {
  return (degrees * Math.PI) / 180;
}

// round/min to rad/s
export function rpm2rps(rpm: number) {
  return (rpm / 60) * 2 * Math.PI;
}

// rad/s to round/min
export function rps2rpm(rps: number) {
  return (rps * 60) / (2 * Math.PI);
}

// 允许数字、-、.
export function filterNumericExpression(input: string): string {
  // 去掉非法字符：只保留 数字 / - / . / + / * / / / ()
  return input.replace(/[^0-9+\-*/().]/g, "");
}

// 计算表达式（安全版本，不使用 eval）
export function safeEvalExpression(expr: string): number | null {
  try {
    // 基本安全检查
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;

    // Function 比 eval 更可控（仍然需用户输入受控）
    const fn = new Function(`return (${expr})`);
    const result = fn();
    return typeof result === "number" && !isNaN(result) ? result : null;
  } catch {
    return null;
  }
}
