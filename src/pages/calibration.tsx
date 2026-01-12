import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pageAtom, windowLockedAtom } from "@/stores/page.ts";
import { useAtomValue, useSetAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import {
  motorConfigAtom,
  motorConfigUnsavedAtom,
  motorConnectedAtom,
} from "@/stores/motor.ts";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { MotorConfig } from "@/motor.ts";

export default function Calibration() {
  const connected = useAtomValue(motorConnectedAtom);
  const setLocked = useSetAtom(windowLockedAtom);
  const setPage = useSetAtom(pageAtom);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);
  const setConfig = useSetAtom(motorConfigAtom);
  const [calibrating, setCalibrating] = useState<boolean>(false);

  const startCalibration = useCallback(async () => {
    try {
      setLocked(true);
      setCalibrating(true);
      setPage("Debug.Serial");
      setUnsaved(true);

      toast.loading("正在执行校准，具体情况请查看串口输出");

      await invoke("motor_calibration");

      setPage("Motor.Calibration");
      setLocked(false);
      setCalibrating(false);

      toast.dismiss();
      toast.loading("校准完成，正在刷新数据...");

      const newConfig: MotorConfig = await invoke("refresh_motor_config");
      setConfig(newConfig);

      toast.dismiss();
      toast.success("请点击左侧保存按钮将配置保存到 Flash");
    } catch (err) {
      setLocked(false);
      setCalibrating(false);

      toast.dismiss();
      toast.error("校准失败，请检查设备或串口输出");
      throw err;
    }
  }, [setLocked, setPage, setUnsaved, setConfig]);
  if (!connected) {
    return <div>电机未连接</div>;
  }

  return (
    <div className="w-full flex flex-col">
      <Card className="m-4">
        <CardHeader>
          <CardTitle>电机校准</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 m-2">
            <p>
              即将开始电机校准。校准过程中电机会自动旋转，请确保电机已牢固固定，同时具备自由旋转空间。
            </p>
            <p>
              请确保供电稳定并在整个校准过程中保持软件运行，以避免异常中断或设备损坏。
            </p>
            <p className="text-red-600 font-bold">
              不要手贱先右键再点击 “重新加载” 。
            </p>
            <p className="text-red-600 font-bold">
              确认已做好准备后点击 “开始校准”。
            </p>
          </div>
        </CardContent>
        <CardFooter>
          <Button
            variant="destructive"
            onClick={startCalibration}
            disabled={calibrating}
          >
            {calibrating && <Spinner className="mr-2" />}开始校准
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
