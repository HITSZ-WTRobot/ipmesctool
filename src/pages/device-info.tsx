import { atom, useAtom, useAtomValue } from "jotai";
import { useEffect } from "react";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor.ts";
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
import { motorConfigSchema, type CurrentProtection } from "@/motor";

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
  const [protection, setProtection] = useAtom(protectionAtom);
  const ready = state === "Ready";

  useEffect(() => {
    setProtection(config ? { ...config.protection } : null);
  }, [config, setProtection]);

  return config ? (
    <div className="w-full p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">设备信息</CardTitle>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
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
          <ReadOnlyRow label="Rs" value={`${config.motor.rs} Ω`} />
          <ReadOnlyRow label="Ld" value={`${config.motor.ld} H`} />
          <ReadOnlyRow label="Lq" value={`${config.motor.lq} H`} />
          <ReadOnlyRow label="State" value={state} />
        </CardContent>
      </Card>
      {protection && (
        <PidConfigCard
          name="电流保护"
          description="任一相电流的绝对值 |i| 超过此阈值会触发过流保护并进入 Fault。这不是电流指令的软限幅，也不是 Speed PI 的 OutputMax。必须为有限正数，仅 Ready 状态可修改；保存成功后自动写入 Flash 并读回配置。"
          value={protection}
          setValue={setProtection}
          labels={{ current_limit: "单相绝对电流保护阈值 (A)" }}
          hasDiff={!shallowEqual(protection, config.protection)}
          reload={() => setProtection({ ...config.protection })}
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
      )}
      <p className="text-xs text-muted-foreground px-1">
        Rs / Ld / Lq 由校准识别，UART 未提供直接写入命令。所有配置命令写入成功后
        会自动保存到 Flash，无需手动保存。UART CLI 支持 get_iabc（三相电流）、
        get_idq（d/q 轴电流）、get_speed（速度）、get_position（位置）实时流，
        get_none 停止输出；可在波形页查看。
      </p>
    </div>
  ) : (
    <div>设备未连接</div>
  );
}
