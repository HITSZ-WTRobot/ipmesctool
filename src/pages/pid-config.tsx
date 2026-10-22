import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor";
import { motorConfigSchema, type PositionPID, type SpeedPI } from "@/motor";
import { setPartValue, shallowEqual } from "@/lib/utils";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { PidConfigCard } from "@/components/pid-config-card";
import { PidConfigLockedCard } from "@/components/pid-config-locked-card";

const speedPIAtom = atom<SpeedPI | null>(null);
const positionPIDAtom = atom<PositionPID | null>(null);
type CurrentGains = { d_kp: number; d_ki: number; q_kp: number; q_ki: number };
const currentPIAtom = atom<CurrentGains | null>(null);

export default function PidConfig() {
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const state = useAtomValue(motorStateAtom);
  const [speedPI, setSpeedPI] = useAtom(speedPIAtom);
  const [positionPID, setPositionPID] = useAtom(positionPIDAtom);
  const [currentPI, setCurrentPI] = useAtom(currentPIAtom);

  // 页面切换保留草稿；断开时清空，新的固件配置读回后重新播种。
  useEffect(() => {
    setSpeedPI(motorConfig ? { ...motorConfig.speed_pi } : null);
    setPositionPID(motorConfig ? { ...motorConfig.position_pid } : null);
    setCurrentPI(motorConfig ? {
      d_kp: motorConfig.current_id_pi.kp,
      d_ki: motorConfig.current_id_pi.ki,
      q_kp: motorConfig.current_iq_pi.kp,
      q_ki: motorConfig.current_iq_pi.ki,
    } : null);
  }, [motorConfig, setSpeedPI, setPositionPID, setCurrentPI]);

  if (!motorConfig || !speedPI || !positionPID || !currentPI) {
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
            <span>下方分别设置 d 轴与 q 轴增益，保存后重新读取固件配置。</span>
          </div>
        }
        pi={[
          {
            value: currentPI,
            setValue: setCurrentPI,
            labels: { d_kp: "d 轴 Kp", d_ki: "d 轴 Ki", q_kp: "q 轴 Kp", q_ki: "q 轴 Ki" },
          },
        ]}
        hasDiff={
          currentPI.d_kp !== motorConfig.current_id_pi.kp ||
          currentPI.d_ki !== motorConfig.current_id_pi.ki ||
          currentPI.q_kp !== motorConfig.current_iq_pi.kp ||
          currentPI.q_ki !== motorConfig.current_iq_pi.ki
        }
        reload={() => setCurrentPI({
          d_kp: motorConfig.current_id_pi.kp,
          d_ki: motorConfig.current_id_pi.ki,
          q_kp: motorConfig.current_iq_pi.kp,
          q_ki: motorConfig.current_iq_pi.ki,
        })}
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
    </div>
  );
}
