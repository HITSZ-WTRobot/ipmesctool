import { useEffect, useState } from "react";
import { useAtomValue, useStore } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { FirmwareConfigCard } from "@/components/firmware-config-card";
import { UnavailableConfigCard } from "@/components/config-unavailable-card";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  HFI_STATE_LABELS, RUNNING_STATES, describeFault, hfiConfigDraft,
  motorConfigSchema, observerFluxDraft, transitionDraft,
} from "@/motor";
import { motorConfigAtom, motorConnectedAtom, motorDiagnosticsAtom, motorStateAtom } from "@/stores/motor";
import { telemetryNativeSessionIdAtom } from "@/stores/telemetry";

type RuntimeAction = "backup_enable" | "backup_disable" | "hfi_enable" | "hfi_disable";
const ACTION_LABELS: Record<RuntimeAction, string> = {
  backup_enable: "启用运行时备份", backup_disable: "禁用运行时备份",
  hfi_enable: "请求启用 HFI", hfi_disable: "禁用 HFI",
};

export default function ObserverConfig() {
  const store = useStore();
  const config = useAtomValue(motorConfigAtom);
  const state = useAtomValue(motorStateAtom);
  const diagnostics = useAtomValue(motorDiagnosticsAtom);
  const connected = useAtomValue(motorConnectedAtom);
  const [action, setAction] = useState<RuntimeAction | null>(null);
  const [pending, setPending] = useState(false);
  useEffect(() => { if (!connected) setAction(null); }, [connected]);
  const ready = connected && state === "Ready";
  const runAction = async () => {
    const sessionId = store.get(telemetryNativeSessionIdAtom);
    if (!action || pending || !sessionId || !store.get(motorConnectedAtom)) return;
    const currentState = store.get(motorStateAtom);
    if (action.startsWith("backup_") && currentState !== "Ready") return;
    if (action === "hfi_enable" && !RUNNING_STATES.includes(currentState)) return;
    setPending(true);
    try {
      if (action.startsWith("backup_")) {
        await invoke("config_motor_backup", { enabled: action === "backup_enable" });
        if (!store.get(motorConnectedAtom) || store.get(telemetryNativeSessionIdAtom) !== sessionId) return;
        const result = motorConfigSchema.parse(await invoke("get_motor_config"));
        if (store.get(motorConnectedAtom) && store.get(telemetryNativeSessionIdAtom) === sessionId) store.set(motorConfigAtom, result);
      } else {
        await invoke(action === "hfi_enable" ? "motor_hfi_enable" : "motor_hfi_disable");
        toast.success("固件已确认 HFI 请求；实际状态以诊断上报为准，不代表已收敛。");
      }
    } catch (error) {
      toast.error(`运行时操作失败: ${error}`);
    } finally {
      setPending(false);
      setAction(null);
    }
  };
  if (!connected) return <div>电机未连接</div>;
  if (!config) return <div>电机配置未加载</div>;

  const backup = config.backup;
  const hfiCapability = config.capabilities.hfi;
  const observerFluxCapability = config.capabilities.observer_flux;
  const transitionCapability = config.capabilities.transition;

  return <div className="w-full p-4 space-y-4">
    <Card>
      <CardHeader><CardTitle className="text-base">观测器运行时状态</CardTitle></CardHeader>
      <CardContent className="text-sm space-y-3">
        <p>故障旗标：<span className="font-mono">{describeFault(diagnostics?.fault ?? config.fault)}</span></p>
        <p>HFI：<span className="font-mono">{diagnostics?.hfiState == null ? "尚未收到状态" : HFI_STATE_LABELS[diagnostics.hfiState]}</span></p>
        <p>运行时备份：{backup == null ? "固件未上报" : backup.enabled ? "已启用" : "已禁用"}（不写 Flash，重启后以固件读回为准）</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={!ready || pending || backup == null} onClick={() => setAction(backup?.enabled ? "backup_disable" : "backup_enable")}>{backup?.enabled ? "禁用" : "启用"}运行时备份</Button>
          <Button disabled={!connected || !RUNNING_STATES.includes(state) || pending} onClick={() => setAction("hfi_enable")}>请求启用 HFI</Button>
          <Button variant="outline" disabled={!connected || pending} onClick={() => setAction("hfi_disable")}>禁用 HFI</Button>
        </div>
        <p className="text-muted-foreground">备份开关仅 Ready 可改；启用 HFI 仅允许 CurrentControl / SpeedControl / PositionControl，禁用允许任意连接状态。备份及注入电压有效性由固件判定；命令确认不等于 HFI 收敛。</p>
      </CardContent>
    </Card>
    {config.hfi ? (
      <FirmwareConfigCard
        name="HFI 高频注入" description="注入电压 ≥ 0 V；电流与速度滤波频率必须在 (0, 2500) Hz；PLL Kp/Ki > 0。仅 Ready，成功写 Flash 并读回。"
        value={config.hfi} labels={{ voltage: "注入电压 (V)", current_filter: "电流滤波 (Hz)", kp: "PLL Kp", ki: "PLL Ki", speed_filter: "速度滤波 (Hz)" }}
        disabled={!ready || pending} command="config_motor_hfi"
        args={(v) => ({ voltage: v.voltage, currentFilter: v.current_filter, kp: v.kp, ki: v.ki, speedFilter: v.speed_filter })}
        validate={(v) => hfiConfigDraft.safeParse(v).success ? undefined : "HFI 参数必须有限：电压 ≥ 0，Kp/Ki > 0，两项滤波频率 0 < Hz < 2500"}
      />
    ) : (
      <UnavailableConfigCard name="HFI 高频注入" reason={hfiCapability.reason} />
    )}
    {config.observer_flux ? (
      <FirmwareConfigCard
        name="磁链观测器" description="Gamma ∈ (0, 10¹²]；PLL Kp ∈ (0, 10⁶]、Ki ∈ (0, 10⁸]。仅 Ready，成功写 Flash 并读回。"
        value={config.observer_flux} labels={{ gamma: "Gamma", kp: "PLL Kp", ki: "PLL Ki" }} disabled={!ready || pending}
        command="config_motor_observer_flux" args={(v) => v}
        validate={(v) => observerFluxDraft.safeParse(v).success ? undefined : "磁链观测器参数必须有限且满足 Gamma/Kp/Ki 的标示范围"}
      />
    ) : (
      <UnavailableConfigCard name="磁链观测器" reason={observerFluxCapability.reason} />
    )}
    {config.transition ? (
      <FirmwareConfigCard
        name="观测器过渡区" description="单位是电气 rpm（非机械 rpm），必须满足 0 ≤ Low < High ≤ 1000000。仅 Ready，成功写 Flash 并读回。"
        value={config.transition} labels={{ low: "Low (电气 rpm)", high: "High (电气 rpm)" }} disabled={!ready || pending}
        command="config_motor_observer_transition" args={(v) => v}
        validate={(v) => transitionDraft.safeParse(v).success ? undefined : "过渡区必须为有限数，且 0 ≤ Low < High ≤ 1000000 电气 rpm"}
      />
    ) : (
      <UnavailableConfigCard name="观测器过渡区" reason={transitionCapability.reason} />
    )}
    <AlertDialog open={action !== null} onOpenChange={(open) => { if (!open) setAction(null); }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认{action ? ACTION_LABELS[action] : "运行时操作"}</AlertDialogTitle>
          <AlertDialogDescription>此操作改变当前运行时行为，不保存 Flash。请确保电机已牢固固定并具备自由旋转空间；启用请求是否有效由固件决定。</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter><AlertDialogCancel>取消</AlertDialogCancel><AlertDialogAction disabled={pending} onClick={() => void runAction()}>确认操作</AlertDialogAction></AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>;
}
