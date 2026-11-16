import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { pageAtom, windowLockedAtom } from "@/stores/page.ts";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
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
import { FirmwareConfigCard } from "@/components/firmware-config-card";
import { UnavailableConfigCard } from "@/components/config-unavailable-card";

const FILTER_SETTINGS = [
  { field: "speed_filter", capability: "speed_filter", name: "编码器速度滤波", command: "config_motor_speed_filter" },
  { field: "current_filter", capability: "current_filter", name: "电流滤波", command: "config_motor_current_filter" },
  { field: "speed_pll", capability: "speed_pll", name: "编码器速度 PLL 自然频率", command: "config_motor_speed_pll" },
] as const;

const CALIBRATION_STAGES = [
  ["pole_pairs_alignment", "极对数对齐"],
  ["pole_pairs_detection", "极对数辨识"],
  ["offset_forward_scan", "编码器偏移正向扫描"],
  ["offset_reverse_scan", "编码器偏移反向扫描"],
  ["resistance_identification", "相电阻辨识"],
  ["d_axis_inductance_identification", "d 轴电感辨识"],
  ["q_axis_inductance_identification", "q 轴电感辨识"],
  ["speed_sweep", "速度环扫频辨识"],
  ["flux_forward", "磁链正转辨识：按设定机械速度正向旋转"],
  ["flux_reverse", "磁链反转辨识：反向旋转并核对双向结果"],
  ["flux_stopping", "磁链辨识停机：等待低速稳定后提交结果"],
  ["complete", "完成"],
] as const;

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
  const [config, setConfig] = useAtom(motorConfigAtom);
  const settings = useMemo(() => config ? {
    sweep: config.speed_sweep_current,
    flux: config.flux_speed,
    filters: FILTER_SETTINGS.map((setting) => ({ ...setting, value: config[setting.field] })),
  } : null, [config]);
  const setMotorState = useSetAtom(motorStateAtom);
  const [calibrating, setCalibrating] = useState<boolean>(false);
  const [calState, setCalState] = useState<CalibrationState | null>(null);
  const stageIndex = CALIBRATION_STAGES.findIndex(([stage]) => stage === calState?.stage);
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
    if (!connected || state !== "Ready" || calibrating) return;
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
      toast.success("校准完成；固件已请求自动保存（无独立 Flash 确认）");

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
  }, [connected, state, calibrating, setLocked, setPage, setConfig, setMotorState]);

  if (!connected) {
    return <div>电机未连接</div>;
  }

  return (
    <div className="w-full flex flex-col">
      <section className="m-4 space-y-3" aria-labelledby="calibration-settings-title">
        <h2 id="calibration-settings-title" className="font-semibold">校准参数</h2>
        {config && settings ? <>
          {settings.sweep != null ? (
            <FirmwareConfigCard
              name="Speed Sweep Current"
              description="速度环扫频的正弦 q 轴电流幅值，必须为有限正数；不是速度环 PI 输出限幅，校准过流仍会触发 Fault。仅 Ready，成功写 Flash 并读回。"
              value={{ iq_amplitude: settings.sweep }} labels={{ iq_amplitude: "Iq 幅值 (A)" }}
              disabled={calibrating || state !== "Ready"} command="config_motor_speed_sweep_current"
              args={(v) => ({ current: v.iq_amplitude })}
              validate={(v) => Number.isFinite(v.iq_amplitude) && v.iq_amplitude > 0 ? undefined : "校准电流幅值必须为有限正数"}
            />
          ) : (
            <UnavailableConfigCard name="Speed Sweep Current" reason={config.capabilities.speed_sweep_current.reason} />
          )}
          {settings.flux != null ? (
            <FirmwareConfigCard
              name="磁链辨识速度" description="机械速度幅值 100..3000 rpm。磁链辨识会以此速度双向旋转，必须确保电机固定且可自由旋转。仅 Ready，成功写 Flash 并读回。"
              value={{ speed: settings.flux }} labels={{ speed: "机械速度 (rpm)" }}
              disabled={calibrating || state !== "Ready"} command="config_motor_flux_speed" args={(v) => v}
              validate={(v) => Number.isFinite(v.speed) && v.speed >= 100 && v.speed <= 3000 ? undefined : "磁链辨识机械速度必须在 100..3000 rpm"}
            />
          ) : (
            <UnavailableConfigCard name="磁链辨识速度" reason={config.capabilities.flux_speed.reason} />
          )}
          {settings.filters.map(({ field, capability, name, command, value }) =>
            value != null ? <FirmwareConfigCard
              key={field} name={name} description="必须为有限正频率（Hz）；不接受导致固件单精度滤波或 PLL 系数溢出的数值。仅 Ready，成功写 Flash 并读回。"
              value={{ frequency: value }} labels={{ frequency: "频率 (Hz)" }}
              disabled={calibrating || state !== "Ready"} command={command} args={(v) => v}
              validate={(v) => {
                const frequency = Math.fround(v.frequency);
                const angular = Math.fround(Math.fround(2 * Math.PI) * frequency);
                return frequency > 0 && Number.isFinite(field === "speed_pll" ? Math.fround(angular * angular) : angular)
                  ? undefined : "频率必须为有限正数且不能使固件单精度系数溢出";
              }}
            /> : <UnavailableConfigCard key={field} name={name} reason={config.capabilities[capability].reason} />
          )}
        </> : <p className="text-sm text-muted-foreground">电机配置未加载</p>}
      </section>
      <Card className="m-4">
        <CardHeader>
          <CardTitle>电机校准</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2 m-2">
            <p>
              即将开始电机校准。校准包含磁链的正转与反转辨识，电机会双向旋转，请确保电机已牢固固定，同时具备自由旋转空间。
            </p>
            <p>
              请确保供电稳定并在整个校准过程中保持软件运行，以避免异常中断或设备损坏。
            </p>
            <p>
              校准成功后会识别 Rs / Ld / Lq 和永磁磁链 magnet_flux（Wb）等参数；固件随后请求保存 Flash，软件不会将校准完成视为独立的 Flash 写入确认。
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
                  {stageIndex >= 0 && <div className="mt-1 space-y-1">
                    <p>{CALIBRATION_STAGES[stageIndex][1]}（阶段 {stageIndex + 1}/{CALIBRATION_STAGES.length}，非时间百分比）</p>
                    <progress className="w-full" value={stageIndex + 1} max={CALIBRATION_STAGES.length} aria-label="校准阶段进度" />
                  </div>}
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
