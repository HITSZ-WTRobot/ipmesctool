import { useAtom, useAtomValue } from "jotai";
import { motorDebugRunStateAtom } from "@/stores/motor.ts";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useCallback, useState } from "react";
import {
  AngleUnit,
  SpeedUnit,
  useAngleConverter,
  useSpeedConverter,
} from "@/components/unit.tsx";
import { Button } from "@/components/ui/button.tsx";
import { ArrowDownLeft } from "lucide-react";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { useDegAtom, useRpmAtom } from "@/stores/angle.ts";
import { deg2rad, rpm2rps } from "@/lib/utils.ts";
import { NumericExpressionInput } from "@/components/numeric-expression-input.tsx";

export default function DebugRunConsole() {
  const [runState, setRunState] = useAtom(motorDebugRunStateAtom);
  const useRpm = useAtomValue(useRpmAtom);
  const useDeg = useAtomValue(useDegAtom);

  const [speed, setSpeed] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);
  useAngleConverter({ value: position, setValue: setPosition });
  useSpeedConverter({ value: speed, setValue: setSpeed });

  const emitSpeed = useCallback(
    async (s: number) => {
      try {
        await invoke("motor_set_speed", {
          speed: useRpm ? rpm2rps(s) : s,
        });
        setRunState("Speed");
      } catch (e) {
        toast.error(`Error: ${e}`);
      }
    },
    [setRunState, useRpm],
  );

  const emitPosition = useCallback(
    async (p: number) => {
      try {
        await invoke("motor_set_position", {
          position: useDeg ? deg2rad(p) : p,
        });
        setRunState("Position");
      } catch (e) {
        toast.error(`Error: ${e}`);
      }
    },
    [setRunState, useDeg],
  );

  const stop = useCallback(async () => {
    try {
      await invoke("motor_stop");
      setRunState("Stop");
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  }, [setRunState]);

  return (
    <div className="flex h-full">
      <div className="h-full flex flex-col justify-evenly">
        <ButtonGroup>
          <ButtonGroupText asChild>
            <Label className="w-24" htmlFor="Speed">
              Speed
            </Label>
          </ButtonGroupText>
          <NumericExpressionInput
            id="Speed"
            value={speed}
            onValueChange={setSpeed}
            onEnter={emitSpeed}
          />
          <ButtonGroupText asChild>
            <Label className="w-18" htmlFor="Speed">
              <SpeedUnit />
            </Label>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="icon"
            onClick={() => emitSpeed(speed)}
          >
            <ArrowDownLeft />
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <ButtonGroupText asChild>
            <Label className="w-24" htmlFor="Position">
              Position
            </Label>
          </ButtonGroupText>
          <NumericExpressionInput
            id="Position"
            value={position}
            onValueChange={setPosition}
            onEnter={emitPosition}
          />
          <ButtonGroupText asChild>
            <Label className="w-18" htmlFor="Position">
              <AngleUnit />
            </Label>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="icon"
            onClick={() => emitPosition(position)}
          >
            <ArrowDownLeft />
          </Button>
        </ButtonGroup>
      </div>
      <div className="flex flex-col py-2 px-4 w-40">
        {runState === "Position" && (
          <>
            <Label>Position Ref</Label>
            <div className="flex-1 w-32 flex items-center">
              <span className="text-green-500 flex-1 text-center">
                {Number(position.toFixed(5))}
              </span>
              <AngleUnit />
            </div>
          </>
        )}
        {runState === "Speed" && (
          <>
            <Label>Speed Ref</Label>
            <div className="flex-1 w-32 flex items-center">
              <span className="text-green-500 flex-1 text-center">
                {Number(speed.toFixed(5))}
              </span>
              <SpeedUnit />
            </div>
          </>
        )}
      </div>
      <div className="h-full flex items-center justify-center p-4">
        <Button variant="outline" onClick={stop}>
          Stop
        </Button>
      </div>
    </div>
  );
}
