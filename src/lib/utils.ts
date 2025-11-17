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
