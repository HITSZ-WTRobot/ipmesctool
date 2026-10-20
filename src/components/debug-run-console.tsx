import { useAtomValue } from "jotai";
import { motorStateAtom } from "@/stores/motor.ts";
import { RUNNING_STATES } from "@/motor.ts";
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
import { rad2deg, rps2rpm } from "@/lib/utils.ts";
import { NumericExpressionInput } from "@/components/numeric-expression-input.tsx";

export default function DebugRunConsole() {
  const state = useAtomValue(motorStateAtom);
  const useRpm = useAtomValue(useRpmAtom);
  const useDeg = useAtomValue(useDegAtom);

  const [speed, setSpeed] = useState<number>(0);
  const [position, setPosition] = useState<number>(0);
  const [current, setCurrent] = useState<number>(0);
  useAngleConverter({ value: position, setValue: setPosition });
  useSpeedConverter({ value: speed, setValue: setSpeed });

  const runnable = state === "Ready" || RUNNING_STATES.includes(state);

  const emitSpeed = useCallback(
    async (s: number) => {
      // UI 单位 rpm 直接发送；rad/s 时换算为 rpm (rps*60)
      const rpm = useRpm ? s : rps2rpm(s);
      try {
        await invoke("motor_set_speed", { speed: rpm });
      } catch (e) {
        toast.error(`Error: ${e}`);
      }
    },
    [useRpm],
  );

  const emitPosition = useCallback(
    async (p: number) => {
      // UI 单位 deg 直接发送；rad 时换算为度
      const deg = useDeg ? p : rad2deg(p);
      try {
        await invoke("motor_set_position", { position: deg });
      } catch (e) {
        toast.error(`Error: ${e}`);
      }
    },
    [useDeg],
  );

  const emitCurrent = useCallback(async (a: number) => {
    try {
      await invoke("motor_set_current", { current: a });
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  }, []);

  const stop = useCallback(async () => {
    try {
      await invoke("motor_stop");
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  }, []);

  const clearFault = useCallback(async () => {
    try {
      await invoke("motor_clear_fault");
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  }, []);

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
            disabled={!runnable}
          />
          <ButtonGroupText asChild>
            <Label className="w-18" htmlFor="Speed">
              <SpeedUnit />
            </Label>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="icon"
            disabled={!runnable}
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
            disabled={!runnable}
          />
          <ButtonGroupText asChild>
            <Label className="w-18" htmlFor="Position">
              <AngleUnit />
            </Label>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="icon"
            disabled={!runnable}
            onClick={() => emitPosition(position)}
          >
            <ArrowDownLeft />
          </Button>
        </ButtonGroup>
        <ButtonGroup>
          <ButtonGroupText asChild>
            <Label className="w-24" htmlFor="Current">
              Current
            </Label>
          </ButtonGroupText>
          <NumericExpressionInput
            id="Current"
            value={current}
            onValueChange={setCurrent}
            onEnter={emitCurrent}
            disabled={!runnable}
          />
          <ButtonGroupText asChild>
            <Label className="w-18" htmlFor="Current">
              A
            </Label>
          </ButtonGroupText>
          <Button
            variant="outline"
            size="icon"
            disabled={!runnable}
            onClick={() => emitCurrent(current)}
          >
            <ArrowDownLeft />
          </Button>
        </ButtonGroup>
      </div>
      <div className="flex flex-col py-2 px-4 w-40">
        <Label>State</Label>
        <div className="flex-1 w-32 flex items-center">
          <span className="text-primary flex-1 text-center">{state}</span>
        </div>
      </div>
      <div className="h-full flex items-center justify-center gap-2 p-4">
        <Button variant="outline" disabled={!runnable} onClick={stop}>
          Stop
        </Button>
        <Button
          variant="destructive"
          disabled={state !== "Fault"}
          onClick={clearFault}
        >
          Clear Fault
        </Button>
      </div>
    </div>
  );
}
