import { useAtom, useAtomValue } from "jotai";
import {
  motorConfigAtom,
  motorConnectedAtom,
  type MotorState as MotorStateType,
  motorStateAtom,
} from "@/stores/motor.ts";
import { useEffect } from "react";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";

export function MotorState() {
  const [motorState, setMotorState] = useAtom(motorStateAtom);
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const connect = useAtomValue(motorConnectedAtom);

  useEffect(() => {
    invoke("get_motor_state").then((state) => {
      setMotorState(state as MotorStateType);
    });

    const l = listen("motor-state-change", (event) => {
      setMotorState(event.payload as MotorStateType);
    });

    return () => {
      l.then((unlisten) => unlisten());
    };
  }, [setMotorState]);

  console.log(motorConfig);

  return motorConfig && connect ? (
    <div className="w-full flex flex-col text-sm gap-2">
      <div className="w-full border rounded-md px-3 py-2 flex flex-col gap-1">
        <div className="flex items-center">
          <span className="text-muted-foreground w-20">ID</span>
          <span className="font-medium">
            {`0x${motorConfig.id.toString(16).padStart(2, "0").toUpperCase()}`}
          </span>
        </div>

        <div className="flex items-center">
          <span className="text-muted-foreground w-20">Udc</span>
          <span className="font-medium">{motorConfig.udc} V</span>
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
            motorState === "Run" && "text-primary",
            motorState === "DebugRun" && "text-blue-600 dark:text-blue-400",
            motorState === "Test" && "text-amber-600 dark:text-amber-400",
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
