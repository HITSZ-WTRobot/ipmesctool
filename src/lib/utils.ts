import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function setPartValue<T>(
  setter: (_: T) => void,
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

// 计算表达式
export function evalExpression(expr: string): number | null {
  try {
    if (!/^[0-9+\-*/().\s]+$/.test(expr)) return null;
    const fn = new Function(`return (${expr})`);
    const result = fn();
    return typeof result === "number" && !isNaN(result) ? result : null;
  } catch {
    return null;
  }
}

export function shallowEqual<T extends Record<string, unknown>>(
  a: T,
  b: T,
): boolean {
  const keys = Object.keys(a) as (keyof T)[];
  return keys.length === Object.keys(b).length && keys.every((k) => a[k] === b[k]);
}
