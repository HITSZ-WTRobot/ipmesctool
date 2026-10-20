import { atom } from "jotai";
import type { MotorConfig, MotorState } from "@/motor.ts";

export const motorConnectedAtom = atom<boolean>(false);

export const motorStateAtom = atom<MotorState>("Unknown");

export const motorConfigAtom = atom<MotorConfig | undefined>(undefined);
