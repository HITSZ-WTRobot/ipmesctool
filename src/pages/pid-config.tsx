import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor";
import type { CurrentPI, PositionPID, SpeedPI } from "@/motor";
import { setPartValue, shallowEqual } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { PidConfigCard } from "@/components/pid-config-card";
import { PidConfigLockedCard } from "@/components/pid-config-locked-card";

const speedPIAtom = atom<SpeedPI | null>(null);
const positionPIDAtom = atom<PositionPID | null>(null);
const currentSharedPIAtom = atom<CurrentPI | null>(null);

export default function PidConfig() {
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const state = useAtomValue(motorStateAtom);
  const [speedPI, setSpeedPI] = useAtom(speedPIAtom);
  const [positionPID, setPositionPID] = useAtom(positionPIDAtom);
  const [currentSharedPI, setCurrentSharedPI] = useAtom(currentSharedPIAtom);

  // 断开/未连接时清空草稿，避免重连到另一台设备沿用旧值
  useEffect(() => {
    if (!motorConfig) {
      setSpeedPI(null);
      setPositionPID(null);
      setCurrentSharedPI(null);
      return;
    }
    if (speedPI === null) setSpeedPI({ ...motorConfig.speed_pi });
    if (positionPID === null) setPositionPID({ ...motorConfig.position_pid });
    if (currentSharedPI === null) {
      setCurrentSharedPI({ ...motorConfig.current_id_pi });
    }
  }, [
    motorConfig,
    speedPI,
    positionPID,
    currentSharedPI,
    setSpeedPI,
    setPositionPID,
    setCurrentSharedPI,
  ]);

  if (!motorConfig || !speedPI || !positionPID || !currentSharedPI) {
    return <div>电机配置未加载</div>;
  }

  const ready = state === "Ready";

  return (
    <div className="w-full p-4 space-y-4">
      <PidConfigCard
        name="Position PID"
        value={positionPID}
        setValue={setPositionPID}
        labels={{ kp: "Kp", ki: "Ki", kd: "Kd", output_max: "OutputMax" }}
        hasDiff={!shallowEqual(positionPID, motorConfig.position_pid)}
        reload={() => setPositionPID({ ...motorConfig.position_pid })}
        disabled={!ready}
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
        disabled={!ready}
        save={async () => {
          try {
            await invoke("config_motor_speed_pi", {
              kp: speedPI.kp,
              ki: speedPI.ki,
              outputMax: speedPI.output_max,
            });
            setPartValue(setMotorConfig, motorConfig, "speed_pi", speedPI);
          } catch (e) {
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
      <PidConfigLockedCard
        name="Current PI"
        warning="电流环 PI 是最底层闭环，参数错误会导致电机严重抖动甚至烧毁。确定你真的要修改吗？"
        extra={
          <div className="text-sm flex flex-col gap-1 pb-2 border-b">
            <span className="text-muted-foreground">
              固件读回（只读，d/q 可能不同）：
            </span>
            <span className="font-mono">
              Id kp={motorConfig.current_id_pi.kp} ki=
              {motorConfig.current_id_pi.ki}
            </span>
            <span className="font-mono">
              Iq kp={motorConfig.current_iq_pi.kp} ki=
              {motorConfig.current_iq_pi.ki}
            </span>
            <span className="text-destructive">
              下方 kp/ki 为 d/q 共用值，写入将同时覆盖 d 轴与 q 轴。
            </span>
          </div>
        }
        pi={[
          {
            value: currentSharedPI,
            setValue: setCurrentSharedPI,
            labels: { kp: "Kp (d/q 共用)", ki: "Ki (d/q 共用)" },
          },
        ]}
        hasDiff={!shallowEqual(currentSharedPI, motorConfig.current_id_pi)}
        reload={() => setCurrentSharedPI({ ...motorConfig.current_id_pi })}
        disabled={!ready}
        save={async () => {
          try {
            await invoke("config_motor_current_pi", {
              kp: currentSharedPI.kp,
              ki: currentSharedPI.ki,
            });
            // 固件同一组 kp/ki 同时写入 d/q 两轴；用函数式更新一次性替换
            const shared = { ...currentSharedPI };
            setMotorConfig((prev) =>
              prev
                ? {
                    ...prev,
                    current_id_pi: { ...shared },
                    current_iq_pi: { ...shared },
                  }
                : prev,
            );
          } catch (e) {
            toast.error(`保存失败, e: ${e}`);
          }
        }}
      />
    </div>
  );
}
