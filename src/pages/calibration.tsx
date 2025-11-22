import { useCallback, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pageAtom, windowLockedAtom } from "@/stores/page.ts";
import { useSetAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { motorConfigUnsavedAtom } from "@/stores/motor.ts";

type CalibrationState =
  | "Idle"
  | "TestPolePairs"
  | "TestEncoderDirection"
  | "TestR"
  | "TestLd"
  | "TestLq"
  | "TestSpeedPI"
  | "Done";

const calibrationStateMap: Record<CalibrationState, string> = {
  Idle: "准备开始",
  TestPolePairs: "测试极对数",
  TestEncoderDirection: "测试编码器方向",
  TestR: "测试电阻",
  TestLd: "测试 Ld",
  TestLq: "测试 Lq",
  TestSpeedPI: "测试速度 PI",
  Done: "完成",
};

export function MotorCalibrationWarningDialog({
  open,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={() => onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>电机校准警告</DialogTitle>
          <div className="mt-2 space-y-2">
            <p>
              即将开始电机校准。校准过程中电机会自动旋转，请确保电机已牢固固定，同时具备自由旋转空间。
            </p>
            <p>
              请确保供电稳定并在整个校准过程中保持软件运行，以避免异常中断或设备损坏。
            </p>
            <p className="font-medium text-red-600">不要手贱点“重新加载”。</p>
            <p className="font-medium text-red-600">确认已做好准备后再继续。</p>
          </div>
        </DialogHeader>

        <div className="flex justify-end gap-2 mt-4">
          <Button variant="outline" onClick={onCancel}>
            取消
          </Button>
          <Button onClick={onConfirm}>开始校准</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function Calibration() {
  const setLocked = useSetAtom(windowLockedAtom);
  const setPage = useSetAtom(pageAtom);
  const [warningDialogOpen, setWarningDialogOpen] = useState<boolean>(false);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);

  const startCalibration = useCallback(async () => {
    try {
      // 锁定窗口 & 切换到串口页面
      setLocked(true);
      setCalibrating(true);
      setPage("Debug.Serial");
      setUnsaved(true);

      // 在校准过程中显示 loading toast
      const promise = invoke("motor_calibration");
      toast.loading("正在执行校准，具体情况请查看串口输出");

      // 等待校准完成
      await promise;

      // 校准成功：切回本页
      setPage("Motor.Calibration");

      // 解锁窗口
      setLocked(false);
      setCalibrating(false);

      // 关闭 loading
      toast.dismiss();
      // 显示成功消息
      toast.success("校准完成，请点击左侧保存按钮将配置保存到 Flash");
    } catch (err) {
      setLocked(false);
      setCalibrating(false);

      // 关闭 loading
      toast.dismiss();
      toast.error("校准失败，请检查设备或串口输出");
      throw err;
    }
  }, [setLocked, setPage, setUnsaved]);

  const dialog = MotorCalibrationWarningDialog({
    open: warningDialogOpen,
    onCancel: () => setWarningDialogOpen(false),
    onConfirm: () => {
      setWarningDialogOpen(false);
      startCalibration().then();
    },
  });
  return (
    <div>
      {dialog}
      <Button onClick={() => setWarningDialogOpen(true)} disabled={calibrating}>
        {calibrating && <Spinner />}校准
      </Button>
    </div>
  );
}
