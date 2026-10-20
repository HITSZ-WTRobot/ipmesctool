import { useAtom, useAtomValue } from "jotai";
import {
  motorConfigAtom,
  motorConnectedAtom,
  motorStateAtom,
} from "@/stores/motor.ts";
import type { MotorState as MotorStateType } from "@/motor.ts";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { cn } from "@/lib/utils";

export function MotorState() {
  const [motorState, setMotorState] = useAtom(motorStateAtom);
  const motorConfig = useAtomValue(motorConfigAtom);
  const connect = useAtomValue(motorConnectedAtom);

  useEffect(() => {
    const l = listen("motor-state-change", (event) => {
      setMotorState(event.payload as MotorStateType);
    });

    return () => {
      l.then((unlisten) => unlisten());
    };
  }, [setMotorState]);

  return motorConfig && connect ? (
    <div className="w-full flex flex-col text-sm gap-2">
      <div className="w-full border rounded-md px-3 py-2 flex flex-col gap-1">
        <div className="flex items-center">
          <span className="text-muted-foreground w-20">ID</span>
          <span className="font-medium">{motorConfig.id}</span>
        </div>

        <div className="flex items-center">
          <span className="text-muted-foreground w-20">Encoder</span>
          <span className="font-medium">
            {motorConfig.encoder_config.encoder_type}
          </span>
        </div>
      </div>
      <div className="w-full border rounded-md px-3 py-2 flex">
        <span className="text-muted-foreground w-20">State</span>
        <span
          className={cn(
            "font-medium",
            motorState === "Fault" && "text-destructive",
            (motorState === "SpeedControl" ||
              motorState === "PositionControl") &&
              "text-primary",
            motorState === "CurrentControl" &&
              "text-blue-600 dark:text-blue-400",
            motorState === "Calibration" &&
              "text-amber-600 dark:text-amber-400",
          )}
        >
          {motorState}
        </span>
      </div>
    </div>
  ) : (
    <div></div>
  );
}
