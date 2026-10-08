import { atom, useAtom } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorConfigUnsavedAtom } from "@/stores/motor";
import { CurrentPI, PositionPID, SpeedPI } from "@/motor";
import { setPartValue, shallowEqual } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useSetAtom } from "jotai/index";
import { PidConfigCard } from "@/components/pid-config-card";
import { PidConfigLockedCard } from "@/components/pid-config-locked-card";

const speedPIAtom = atom<SpeedPI | null>(null);
const positionPIDAtom = atom<PositionPID | null>(null);
const currentIdPIAtom = atom<CurrentPI | null>(null);
const currentIqPIAtom = atom<CurrentPI | null>(null);

export default function PidConfig() {
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);
  const [speedPI, setSpeedPI] = useAtom(speedPIAtom);
  const [positionPID, setPositionPID] = useAtom(positionPIDAtom);
  const [currentIdPI, setCurrentIdPI] = useAtom(currentIdPIAtom);
  const [currentIqPI, setCurrentIqPI] = useAtom(currentIqPIAtom);

  useEffect(() => {
    if (motorConfig) {
      if (speedPI === null) setSpeedPI({ ...motorConfig.speed_pi });
      if (positionPID === null) setPositionPID({ ...motorConfig.position_pid });
      if (currentIdPI === null) setCurrentIdPI({ ...motorConfig.current_id_pi });
      if (currentIqPI === null) setCurrentIqPI({ ...motorConfig.current_iq_pi });
    }
  }, [motorConfig, speedPI, positionPID, currentIdPI, currentIqPI, setSpeedPI, setPositionPID, setCurrentIdPI, setCurrentIqPI]);

  if (!motorConfig || !speedPI || !positionPID || !currentIdPI || !currentIqPI) {
    return <div>电机配置未加载</div>;
  }

  return (
    <div className="w-full p-4 space-y-4">
      <PidConfigCard
        name="Position PID"
        value={positionPID}
        setValue={setPositionPID}
        labels={{ kp: "Kp", ki: "Ki", kd: "Kd", output_max: "OutputMax" }}
        hasDiff={!shallowEqual(positionPID, motorConfig.position_pid)}
        reload={() => setPositionPID({ ...motorConfig.position_pid })}
        save={async () => {
          try {
            await invoke("config_motor_position_pid", {
              kp: positionPID.kp,
              ki: positionPID.ki,
              kd: positionPID.kd,
              outputMax: positionPID.output_max,
            });
            setPartValue(setMotorConfig, motorConfig, "position_pid", positionPID);
            setUnsaved(true);
          } catch (e) {
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
      <PidConfigCard
        name="Speed PI"
        value={speedPI}
        setValue={setSpeedPI}
        labels={{ kp: "Kp", ki: "Ki", output_max: "OutputMax" }}
        hasDiff={!shallowEqual(speedPI, motorConfig.speed_pi)}
        reload={() => setSpeedPI({ ...motorConfig.speed_pi })}
        save={async () => {
          try {
            await invoke("config_motor_speed_pi", {
              kp: speedPI.kp,
              ki: speedPI.ki,
              outputMax: speedPI.output_max,
            });
            setPartValue(setMotorConfig, motorConfig, "speed_pi", speedPI);
            setUnsaved(true);
          } catch (e) {
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
      <PidConfigLockedCard
        name="Current Iq / Id PI"
        warning="电流环 PI 是最底层闭环，参数错误会导致电机严重抖动甚至烧毁。确定你真的要修改吗？"
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
        hasDiff={
          !shallowEqual(currentIdPI, motorConfig.current_id_pi) ||
          !shallowEqual(currentIqPI, motorConfig.current_iq_pi)
        }
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
            setPartValue(setMotorConfig, motorConfig, "current_id_pi", currentIdPI);
            setPartValue(setMotorConfig, motorConfig, "current_iq_pi", currentIqPI);
            setUnsaved(true);
          } catch (e) {
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
    </div>
  );
}
