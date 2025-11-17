import { atom, useAtom } from "jotai";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";

import { useEffect, useMemo, useState } from "react";
import { motorConfigAtom } from "@/stores/motor";
import { CurrentPI, PositionPID, SpeedPI } from "@/motor";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Key, RefreshCcw, Save } from "lucide-react";
import { setPartValue } from "@/lib/utils.ts";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";

const speedPIAtom = atom<SpeedPI | null>(null);
const positionPIDAtom = atom<PositionPID | null>(null);
const currentIdPIAtom = atom<CurrentPI | null>(null);
const currentIqPIAtom = atom<CurrentPI | null>(null);

function SinglePIDConfig<T extends Record<string, number>>({
  name,
  value,
  setValue,
  labels,
  reload,
  save,
}: {
  name: string;
  value: T;
  setValue: (v: T) => void;
  labels: Record<keyof T, string>;
  reload: () => void;
  save: () => void;
}) {
  return useMemo(
    () => (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{name}</CardTitle>
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={() => reload()}>
              <RefreshCcw />
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={() => save()}>
              <Save />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
          {Object.entries(value as T).map(([k, v]) => (
            <ButtonGroup className="w-full" key={k}>
              <ButtonGroupText asChild>
                <Label className="w-28" htmlFor={`${name}.${k}`}>
                  {labels[k]}
                </Label>
              </ButtonGroupText>
              <Input
                id={`${name}.${k}`}
                type="number"
                value={v}
                onChange={(e) =>
                  setPartValue<T>(
                    setValue,
                    value,
                    k as keyof T,
                    e.target.valueAsNumber as T[keyof T],
                  )
                }
              />
            </ButtonGroup>
          ))}
        </CardContent>
      </Card>
    ),
    [labels, name, reload, save, setValue, value],
  );
}

function MultiPIConfigWithLock<T extends Record<string, number>>({
  name,
  pi,
  warning,
  reload,
  save,
}: {
  name: string;
  warning: string;
  pi: {
    value: T;
    setValue: (v: T) => void;
    labels: Record<keyof T, string>;
  }[];
  reload: () => void;
  save: () => void;
}) {
  const [unlock, setUnlock] = useState<boolean>(false);
  return useMemo(
    () => (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">{name}</CardTitle>
          <CardAction>
            <CardAction>
              {unlock ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => reload()}
                  >
                    <RefreshCcw />
                  </Button>
                  <Button variant="ghost" size="icon-sm" onClick={() => save()}>
                    <Save />
                  </Button>
                </>
              ) : (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button size="icon-sm" variant="destructive">
                      <Key />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>危险操作警告</AlertDialogTitle>
                      <AlertDialogDescription>{warning}</AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>取消</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => {
                          setUnlock(true);
                        }}
                      >
                        确认解锁
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </CardAction>
          </CardAction>
        </CardHeader>
        <CardContent className="flex flex-col gap-2">
          {pi.map(({ value, setValue, labels }, index) => (
            <div key={index} className="text-sm flex flex-col gap-2">
              {Object.entries(value).map(([k, v]) => (
                <ButtonGroup className="w-full" key={k}>
                  <ButtonGroupText asChild>
                    <Label className="w-28" htmlFor={`${name}.${k}`}>
                      {labels[k]}
                    </Label>
                  </ButtonGroupText>
                  <Input
                    id={`${name}.${k}`}
                    type="number"
                    value={v}
                    disabled={!unlock}
                    onChange={(e) =>
                      setPartValue<T>(
                        setValue,
                        value,
                        k as keyof T,
                        e.target.valueAsNumber as T[keyof T],
                      )
                    }
                  />
                </ButtonGroup>
              ))}
            </div>
          ))}
        </CardContent>
      </Card>
    ),
    [name, pi, reload, save, unlock, warning],
  );
}

export default function PidConfig() {
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);

  const [speedPI, setSpeedPI] = useAtom(speedPIAtom);
  const [positionPID, setPositionPID] = useAtom(positionPIDAtom);
  const [currentIdPI, setCurrentIdPI] = useAtom(currentIdPIAtom);
  const [currentIqPI, setCurrentIqPI] = useAtom(currentIqPIAtom);

  useEffect(() => {
    if (motorConfig) {
      if (speedPI === null && motorConfig) {
        setSpeedPI({ ...motorConfig.speed_pi });
      }
      if (positionPID === null && motorConfig) {
        setPositionPID({ ...motorConfig.position_pid });
      }
      if (currentIdPI === null && motorConfig) {
        setCurrentIdPI({ ...motorConfig.current_id_pi });
      }
      if (currentIqPI === null && motorConfig) {
        setCurrentIqPI({ ...motorConfig.current_iq_pi });
      }
    }
  }, [
    currentIdPI,
    currentIqPI,
    motorConfig,
    positionPID,
    setCurrentIdPI,
    setCurrentIqPI,
    setPositionPID,
    setSpeedPI,
    speedPI,
  ]);

  if (
    !motorConfig ||
    !speedPI ||
    !positionPID ||
    !currentIdPI ||
    !currentIqPI
  ) {
    return <div>电机配置未加载</div>;
  }

  return (
    <div className="w-full p-4 space-y-4">
      <SinglePIDConfig
        name="Position PID"
        value={positionPID}
        setValue={setPositionPID}
        labels={{ kp: "Kp", ki: "Ki", kd: "Kd", output_max: "OutputMax" }}
        reload={() => setPositionPID({ ...motorConfig.position_pid })}
        save={async () => {
          try {
            await invoke("config_motor_position_pid", {
              kp: positionPID.kp,
              ki: positionPID.ki,
              kd: positionPID.kd,
              outputMax: positionPID.output_max,
            });
            setPartValue(
              setMotorConfig,
              motorConfig,
              "position_pid",
              positionPID,
            );
          } catch (e) {
            console.log(e);
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
      <SinglePIDConfig
        name="Speed PI"
        value={speedPI}
        setValue={setSpeedPI}
        labels={{ kp: "Kp", ki: "Ki", output_max: "OutputMax" }}
        reload={() => setSpeedPI({ ...motorConfig.speed_pi })}
        save={async () => {
          try {
            await invoke("config_motor_speed_pi", {
              kp: speedPI.kp,
              ki: speedPI.ki,
              outputMax: speedPI.output_max,
            });
            setPartValue(setMotorConfig, motorConfig, "speed_pi", speedPI);
          } catch (e) {
            console.log(e);
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
      <MultiPIConfigWithLock
        name="Current Iq / Id PI"
        warning={
          "电流环 PI 是最底层闭环，参数错误会导致电机严重抖动甚至烧毁。确定你真的要修改吗？"
        }
        pi={[
          {
            value: currentIdPI,
            setValue: setCurrentIdPI,
            labels: { kp: "Id Kp", ki: "Id Ki" },
          },
          {
            value: currentIqPI,
            setValue: setCurrentIqPI,
            labels: { kp: "Iq Kp", ki: "Iq Ki" },
          },
        ]}
        reload={() => {
          setCurrentIdPI({ ...motorConfig.current_id_pi });
          setCurrentIqPI({ ...motorConfig.current_iq_pi });
        }}
        save={async () => {
          try {
            await invoke("config_motor_current_pi", {
              idKp: currentIdPI.kp,
              idKi: currentIdPI.ki,
              iqKp: currentIqPI.kp,
              iqKi: currentIqPI.ki,
            });
            setPartValue(
              setMotorConfig,
              motorConfig,
              "current_id_pi",
              currentIdPI,
            );
            setPartValue(
              setMotorConfig,
              motorConfig,
              "current_iq_pi",
              currentIqPI,
            );
          } catch (e) {
            console.log(e);
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
    </div>
  );
}
