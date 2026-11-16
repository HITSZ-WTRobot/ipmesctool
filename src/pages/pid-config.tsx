import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor";
import {
  motorConfigSchema,
  type CurrentPiConfig,
  type PositionPID,
  type SpeedPI,
} from "@/motor";
import { setPartValue, shallowEqual } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { PidConfigCard } from "@/components/pid-config-card";
import { PidConfigLockedCard } from "@/components/pid-config-locked-card";
import { UnavailableConfigCard } from "@/components/config-unavailable-card";

const speedPIAtom = atom<SpeedPI | null>(null);
const positionPIDAtom = atom<PositionPID | null>(null);
const currentPIAtom = atom<CurrentPiConfig | null>(null);

export default function PidConfig() {
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const state = useAtomValue(motorStateAtom);
  const [speedPI, setSpeedPI] = useAtom(speedPIAtom);
  const [positionPID, setPositionPID] = useAtom(positionPIDAtom);
  const [currentPI, setCurrentPI] = useAtom(currentPIAtom);

  // 页面切换保留草稿；断开时清空，新的固件配置读回后重新播种。
  // 未上报的单元保持 null，绝不填默认值。
  useEffect(() => {
    setSpeedPI(motorConfig?.speed_pi ? { ...motorConfig.speed_pi } : null);
    setPositionPID(
      motorConfig?.position_pid ? { ...motorConfig.position_pid } : null,
    );
    setCurrentPI(motorConfig?.current_pi ? { ...motorConfig.current_pi } : null);
  }, [motorConfig, setSpeedPI, setPositionPID, setCurrentPI]);

  if (!motorConfig) {
    return <div>电机配置未加载</div>;
  }

  const ready = state === "Ready";
  const positionPIDValue = motorConfig.position_pid;
  const speedPIValue = motorConfig.speed_pi;
  const currentPIValue = motorConfig.current_pi;
  const positionPIDCapability = motorConfig.capabilities.position_pid;
  const speedPICapability = motorConfig.capabilities.speed_pi;
  const currentPICapability = motorConfig.capabilities.current_pi;

  return (
    <div className="w-full p-4 space-y-4">
      {positionPIDValue && positionPID ? (
        <PidConfigCard
          name="Position PID"
          value={positionPID}
          setValue={setPositionPID}
          labels={{ kp: "Kp", ki: "Ki", kd: "Kd", output_max: "OutputMax" }}
          hasDiff={!shallowEqual(positionPID, positionPIDValue)}
          reload={() => setPositionPID({ ...positionPIDValue })}
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
      ) : (
        <UnavailableConfigCard
          name="Position PID"
          reason={positionPIDCapability.reason}
        />
      )}
      {speedPIValue && speedPI ? (
        <PidConfigCard
          name="Speed PI"
          value={speedPI}
          setValue={setSpeedPI}
          labels={{ kp: "Kp", ki: "Ki", output_max: "OutputMax" }}
          hasDiff={!shallowEqual(speedPI, speedPIValue)}
          reload={() => setSpeedPI({ ...speedPIValue })}
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
      ) : (
        <UnavailableConfigCard
          name="Speed PI"
          reason={speedPICapability.reason}
        />
      )}
      {currentPIValue && currentPI ? (
        <PidConfigLockedCard
          name="Current PI"
          warning="电流环 PI 是最底层闭环，参数错误会导致电机严重抖动甚至烧毁。确定你真的要修改吗？"
          extra={
            <div className="text-sm flex flex-col gap-1 pb-2 border-b">
              <span className="text-muted-foreground">
                固件读回（只读，d/q 可能不同）：
              </span>
              <span className="font-mono">
                Id kp={currentPIValue.d_kp} ki=
                {currentPIValue.d_ki}
              </span>
              <span className="font-mono">
                Iq kp={currentPIValue.q_kp} ki=
                {currentPIValue.q_ki}
              </span>
              <span>下方分别设置 d 轴与 q 轴增益，保存后重新读取固件配置。</span>
            </div>
          }
          pi={[
            {
              value: currentPI,
              setValue: setCurrentPI,
              labels: {
                d_kp: "d 轴 Kp",
                d_ki: "d 轴 Ki",
                q_kp: "q 轴 Kp",
                q_ki: "q 轴 Ki",
              },
            },
          ]}
          hasDiff={!shallowEqual(currentPI, currentPIValue)}
          reload={() => setCurrentPI({ ...currentPIValue })}
          disabled={!ready}
          save={async () => {
            try {
              if (!ready) return;
              if (Object.values(currentPI).some((v) => !Number.isFinite(v) || v <= 0)) {
                toast.error("电流环 PI 增益必须为有限正数");
                return;
              }
              await invoke("config_motor_current_pi", {
                dKp: currentPI.d_kp,
                dKi: currentPI.d_ki,
                qKp: currentPI.q_kp,
                qKi: currentPI.q_ki,
              });
              const raw = await invoke("get_motor_config");
              setMotorConfig(motorConfigSchema.parse(raw));
            } catch (e) {
              toast.error(`保存失败, e: ${e}`);
            }
          }}
        />
      ) : (
        <UnavailableConfigCard
          name="Current PI"
          reason={currentPICapability.reason}
        />
      )}
    </div>
  );
}
