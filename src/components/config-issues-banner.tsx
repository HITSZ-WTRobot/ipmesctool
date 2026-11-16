import { useAtomValue } from "jotai";
import { motorConfigAtom } from "@/stores/motor.ts";
import type { Capabilities } from "@/motor.ts";

const CAPABILITY_LABELS: Record<keyof Capabilities, string> = {
  position_pid: "位置 PID",
  speed_pi: "速度 PI",
  current_pi: "电流 PI",
  speed_sweep_current: "校准扫频电流",
  flux_speed: "磁链辨识速度",
  speed_filter: "速度滤波",
  current_filter: "电流滤波",
  speed_pll: "速度 PLL",
  current_limit: "过流保护阈值",
  motor_id: "电机 ID",
  encoder_config: "编码器配置",
  hfi: "HFI 高频注入",
  observer_flux: "磁链观测器",
  transition: "观测器过渡区",
  backup: "运行时备份",
};

/**
 * 版本漂移的可见提示：不影响其它功能，只说明哪些配置项被禁用。
 * 由 Rust 的 capabilities/issues 驱动，前端不重复维护字段依赖。
 */
export function ConfigIssuesBanner() {
  const config = useAtomValue(motorConfigAtom);
  if (!config) return null;

  const keys = Object.keys(CAPABILITY_LABELS) as (keyof Capabilities)[];
  const unavailable = keys.filter((key) => !config.capabilities[key].available);
  const outOfRange = keys.filter(
    (key) => config.capabilities[key].available && !config.capabilities[key].writable,
  );
  if (unavailable.length === 0 && outOfRange.length === 0 && config.issues.length === 0) {
    return null;
  }

  return (
    <div className="mx-4 mt-4 rounded-md border border-amber-600/50 bg-amber-500/10 px-3 py-2 text-sm">
      <p className="font-medium">
        该电调固件未提供全部配置项，相关功能已禁用，其余页面不受影响。
      </p>
      {unavailable.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          未上报：{unavailable.map((key) => CAPABILITY_LABELS[key]).join("、")}
        </p>
      )}
      {outOfRange.length > 0 && (
        <p className="mt-1 text-muted-foreground">
          读回值不能直接回写（可编辑后保存新值，仍以固件读回确认）：
          {outOfRange.map((key) => CAPABILITY_LABELS[key]).join("、")}
        </p>
      )}
      {config.issues.length > 0 && (
        <ul className="mt-1 list-disc pl-5 font-mono text-xs text-muted-foreground">
          {config.issues.map((issue, index) => (
            <li key={`${issue.field}-${index}`}>{issue.message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
