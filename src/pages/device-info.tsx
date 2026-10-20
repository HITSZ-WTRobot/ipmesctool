import { useAtom, useAtomValue } from "jotai";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor.ts";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { setPartValue } from "@/lib/utils.ts";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { IdInput } from "@/components/id-input.tsx";

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
  const ready = state === "Ready";

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
      <p className="text-xs text-muted-foreground px-1">
        Rs / Ld / Lq 由校准识别，UART 未提供直接写入命令。所有配置命令写入成功后
        会自动保存到 Flash，无需手动保存。UART CLI 不提供实时速度/位置/电流/母线电压
        遥测，实时数据仅通过 FDCAN 反馈帧输出。
      </p>
    </div>
  ) : (
    <div>设备未连接</div>
  );
}
