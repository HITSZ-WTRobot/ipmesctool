import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorDiagnosticsAtom, motorStateAtom } from "@/stores/motor.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { setPartValue, shallowEqual } from "@/lib/utils.ts";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { IdInput } from "@/components/id-input.tsx";
import { PidConfigCard } from "@/components/pid-config-card";
import { UnavailableConfigCard } from "@/components/config-unavailable-card";
import { describeFault, HFI_STATE_LABELS, motorConfigSchema, type CurrentProtection } from "@/motor";

const protectionAtom = atom<CurrentProtection | null>(null);

function ReadOnlyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="w-full flex flex-row items-center">
      <span className="w-28 text-muted-foreground">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}

export default function DeviceInfo() {
  const [config, setConfig] = useAtom(motorConfigAtom);
  const state = useAtomValue(motorStateAtom);
  const diagnostics = useAtomValue(motorDiagnosticsAtom);
  const [protection, setProtection] = useAtom(protectionAtom);
  const ready = state === "Ready";

  useEffect(() => {
    setProtection(config?.protection ? { ...config.protection } : null);
  }, [config, setProtection]);

  if (!config) {
    return <div>设备未连接</div>;
  }

  const electrical = config.electrical;
  const protectionValue = config.protection;
  const protectionCapability = config.capabilities.current_limit;

  return (
    <div className="w-full p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">设备信息</CardTitle>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
          {config.id != null && config.capabilities.motor_id.available ? (
            <IdInput
              value={config.id}
              disabled={!ready}
              onChange={async (v) => {
                try {
                  await invoke("config_motor_id", { id: v });
                  setPartValue(setConfig, config, "id", v);
                } catch (e) {
                  toast.error(`id 设置失败: ${e}`);
                }
              }}
            />
          ) : (
            <ReadOnlyRow label="ID" value="未上报" />
          )}
          <ReadOnlyRow label="Rs" value={electrical ? `${electrical.rs} Ω` : "未上报"} />
          <ReadOnlyRow label="Ld" value={electrical ? `${electrical.ld} H` : "未上报"} />
          <ReadOnlyRow label="Lq" value={electrical ? `${electrical.lq} H` : "未上报"} />
          <ReadOnlyRow label="永磁磁链" value={electrical ? `${electrical.flux} Wb` : "未上报"} />
          <ReadOnlyRow label="辨识速度" value={config.flux_speed != null ? `${config.flux_speed} 机械 rpm` : "未上报"} />
          <ReadOnlyRow label="Fault" value={describeFault(diagnostics?.fault ?? config.fault)} />
          <ReadOnlyRow label="HFI" value={diagnostics?.hfiState == null ? "尚未收到状态" : HFI_STATE_LABELS[diagnostics.hfiState]} />
          <ReadOnlyRow label="State" value={state} />
        </CardContent>
      </Card>
      {protectionValue && protection ? (
        <PidConfigCard
          name="电流保护"
          description="任一相电流的绝对值 |i| 超过此阈值会触发过流保护并进入 Fault。这不是电流指令的软限幅，也不是 Speed PI 的 OutputMax。必须为有限正数，仅 Ready 状态可修改；保存成功后自动写入 Flash 并读回配置。"
          value={protection}
          setValue={setProtection}
          labels={{ current_limit: "单相绝对电流保护阈值 (A)" }}
          hasDiff={!shallowEqual(protection, protectionValue)}
          reload={() => setProtection({ ...protectionValue })}
          disabled={!ready}
          save={async () => {
            if (!ready) return;
            const currentLimit = protection.current_limit;
            if (!Number.isFinite(currentLimit) || currentLimit <= 0) {
              toast.error("单相绝对电流保护阈值必须为有限正数");
              return;
            }
            try {
              await invoke("config_motor_current_limit", { currentLimit });
              const raw = await invoke("get_motor_config");
              setConfig(motorConfigSchema.parse(raw));
            } catch (e) {
              toast.error(`保存电流保护阈值失败: ${e}`);
            }
          }}
        />
      ) : (
        <UnavailableConfigCard
          name="电流保护"
          reason={protectionCapability.reason}
        />
      )}
      <p className="text-xs text-muted-foreground px-1">
        Rs / Ld / Lq / 永磁磁链（Wb）由校准识别，辨识速度在校准页设置。
        持久配置写入成功后由固件保存 Flash；观测器页的备份开关仅影响运行时，不写 Flash。
        波形页支持相电流、d/q 电流、机械速度/位置、电角度与观测器电角度/电气速度共七种实时流，get_none 停止输出。
      </p>
    </div>
  );
}
