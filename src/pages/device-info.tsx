import { useAtom, useSetAtom } from "jotai";
import { motorConfigAtom, motorConfigUnsavedAtom } from "@/stores/motor.ts";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { setPartValue } from "@/lib/utils.ts";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { InputLine } from "@/components/input-line.tsx";
import { IdInput } from "@/components/id-input.tsx";

export default function DeviceInfo() {
  const [config, setConfig] = useAtom(motorConfigAtom);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);

  return config ? (
    <div className="w-full p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">设备信息</CardTitle>
          <CardAction></CardAction>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
          <IdInput
            value={config.id}
            onChange={async (v) => {
              try {
                await invoke("config_motor_id", { id: v });
                setUnsaved(true);
                setPartValue(setConfig, config, "id", v);
              } catch (e) {
                toast.error(`id 设置失败: ${e}`);
              }
            }}
          />
          <InputLine
            label="Udc"
            value={config.udc}
            confirmOnSave
            confirmMessage={(newValue) => (
              <p>
                确定要将 Udc 设置为{" "}
                <span className="text-red-500">{newValue}</span> V
                吗？该参数取决于你使用的分电板类型
              </p>
            )}
            onChange={async (v) => {
              try {
                await invoke("config_motor_udc", { udc: v });
                setUnsaved(true);
                setPartValue(setConfig, config, "udc", v);
              } catch (e) {
                toast.error(`Udc 设置失败: ${e}`);
              }
            }}
          />
          <InputLine
            label="Idq Filter"
            value={config.fc}
            confirmOnSave
            confirmMessage={(newValue) => (
              <p>
                确定要将 电流滤波器截止频率 设置为{" "}
                <span className="text-red-500">{newValue}</span> Hz
                吗？我也不知道这是干什么用的（）
              </p>
            )}
            onChange={async (v) => {
              try {
                await invoke("config_motor_idq_filter", { fc: v });
                setUnsaved(true);
                setPartValue(setConfig, config, "fc", v);
              } catch (e) {
                toast.error(`Idq Filter Fc 设置失败: ${e}`);
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  ) : (
    <div>设备未连接</div>
  );
}
