import { atom } from "jotai";
import { MotorConfig } from "@/motor.ts";

export const motorConnectedAtom = atom<boolean>(false);

export type MotorState = "Stop" | "DebugRun" | "Run" | "Test" | "Fault";

export const motorStateAtom = atom<MotorState>("Stop");

export const motorConfigAtom = atom<MotorConfig>();
