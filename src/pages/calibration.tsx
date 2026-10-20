import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pageAtom, windowLockedAtom } from "@/stores/page.ts";
import { useAtomValue, useSetAtom } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { toast } from "sonner";
import { motorConfigAtom, motorConnectedAtom, motorStateAtom } from "@/stores/motor.ts";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { motorConfigSchema, type MotorState } from "@/motor.ts";

type CalibrationStatus = "idle" | "running" | "success" | "failed";

interface CalibrationState {
  status: CalibrationStatus;
  stage: string | null;
  failed_stage: string | null;
  results: string[];
  motor_state: MotorState | null;
}

export default function Calibration() {
  const connected = useAtomValue(motorConnectedAtom);
  const state = useAtomValue(motorStateAtom);
  const setLocked = useSetAtom(windowLockedAtom);
  const setPage = useSetAtom(pageAtom);
  const setConfig = useSetAtom(motorConfigAtom);
  const setMotorState = useSetAtom(motorStateAtom);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [calState, setCalState] = useState<CalibrationState | null>(null);
  const calStateRef = useRef<CalibrationState | null>(null);
  // listen() 是异步的；发送命令前必须确保已订阅，避免丢失立即上报
  const listenReadyRef = useRef<Promise<void>>(Promise.resolve());

  // 始终监听校准进度/结果对象；组件卸载时正确清理
  useEffect(() => {
    const l = listen<CalibrationState>("calibration-state", (event) => {
      calStateRef.current = event.payload;
      setCalState(event.payload);
    });
    listenReadyRef.current = l.then(() => undefined);
    return () => {
      l.then((unlisten) => unlisten());
    };
  }, []);

  const startCalibration = useCallback(async () => {
    try {
      setLocked(true);
      setCalibrating(true);
      setPage("Debug.Serial");
      setCalState(null);
      calStateRef.current = null;

      toast.loading("正在执行校准，具体情况请查看串口输出");

      // 确保在发送命令前已订阅 calibration-state，随后固件先回 ok、再异步上报各阶段。
      // 契约：motor_calibration -> Result<CalibrationState, String>，成功时返回终态完整 payload。
      await listenReadyRef.current;
      const terminal = await invoke<CalibrationState>("motor_calibration");
      calStateRef.current = terminal;
      setCalState(terminal);
      if (terminal.status === "failed") {
        throw new Error(`校准失败：${terminal.failed_stage ?? "未知阶段"}`);
      }

      setPage("Motor.Calibration");
      setLocked(false);
      setCalibrating(false);

      toast.dismiss();
      // 固件在校准成功后才请求主循环写 Flash（无单独 flash ack），故不声称已确认保存
      toast.success("校准完成，固件将自动保存参数（无需手动保存）");

      // 校准本身已成功；刷新失败要单独报告，不能误标为校准失败
      try {
        const raw = await invoke("refresh_motor_config");
        setConfig(motorConfigSchema.parse(raw));
        const st = await invoke<string>("get_motor_state");
        setMotorState(st as MotorState);
      } catch (e) {
        toast.error(`校准完成，但刷新配置失败: ${e}`);
      }
    } catch (err) {
      setLocked(false);
      setCalibrating(false);
      setPage("Motor.Calibration");

      toast.dismiss();
      const failed = calStateRef.current as CalibrationState | null;
      if (failed?.status === "failed") {
        toast.error(`校准失败：${failed.failed_stage ?? "未知阶段"}`);
      } else {
        toast.error(`校准失败，请检查设备或串口输出：${err}`);
      }
    }
  }, [setLocked, setPage, setConfig, setMotorState]);

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
            <p>
              校准成功后会识别 Rs / Ld / Lq 等参数，并自动保存到 Flash，无需手动保存。
            </p>
            <p className="text-red-600 font-bold">
              不要手贱先右键再点击 “重新加载” 。
            </p>
            <p className="text-red-600 font-bold">
              确认已做好准备后点击 “开始校准”。
            </p>
          </div>

          {calState && (
            <div className="m-2 border rounded-md p-2 text-sm space-y-1">
              <div>
                <span className="text-muted-foreground mr-2">状态</span>
                <span className="font-mono">{calState.status}</span>
              </div>
              {calState.stage && (
                <div>
                  <span className="text-muted-foreground mr-2">当前阶段</span>
                  <span className="font-mono">{calState.stage}</span>
                </div>
              )}
              {calState.failed_stage && (
                <div className="text-destructive">
                  <span className="mr-2">失败阶段</span>
                  <span className="font-mono">{calState.failed_stage}</span>
                </div>
              )}
              {calState.results.length > 0 && (
                <div>
                  <span className="text-muted-foreground">结果</span>
                  <ul className="font-mono list-disc pl-6">
                    {calState.results.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </CardContent>
        <CardFooter className="flex-col items-start gap-2">
          <Button
            variant="destructive"
            onClick={startCalibration}
            disabled={calibrating || state !== "Ready"}
          >
            {calibrating && <Spinner className="mr-2" />}开始校准
          </Button>
          {state !== "Ready" && (
            <span className="text-xs text-muted-foreground">
              仅当电机处于 Ready 状态时才能开始校准（当前：{state}）
            </span>
          )}
        </CardFooter>
      </Card>
    </div>
  );
}
