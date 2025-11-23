import { atom } from "jotai";
import { MotorConfig } from "@/motor.ts";

export const motorConnectedAtom = atom<boolean>(false);

export type MotorState = "Stop" | "DebugRun" | "Run" | "Test" | "Fault";

export type MotorDebugRunState = "Stop" | "Position" | "Speed";

export const motorStateAtom = atom<MotorState>("Stop");

export const motorDebugRunStateAtom = atom<MotorDebugRunState>("Stop");

export const motorConfigAtom = atom<MotorConfig>();

export const motorConfigUnsavedAtom = atom<boolean>(false);
