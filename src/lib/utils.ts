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
