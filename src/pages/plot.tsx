import { useEffect, useState } from "react";
import { useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { TelemetryChart } from "@/components/telemetry-chart.tsx";
import { useDegAtom, useRpmAtom } from "@/stores/angle.ts";
import { motorConnectedAtom } from "@/stores/motor.ts";
import { pageAtom } from "@/stores/page.ts";
import {
  clearTelemetryAtom,
  setTelemetryMode,
  telemetryHistoriesAtom,
  telemetryModeAtom,
  TELEMETRY_HISTORY_LIMIT,
} from "@/stores/telemetry.ts";
import type { StreamMode, TelemetryMode, TelemetrySample } from "@/stores/telemetry.ts";

const MODES: Record<StreamMode, { name: string; labels: readonly string[] }> = {
  iabc: { name: "三相电流", labels: ["Ia", "Ib", "Ic"] },
  idq: { name: "DQ 轴电流", labels: ["Id", "Iq"] },
  speed: { name: "机械速度", labels: ["速度给定", "速度反馈"] },
  position: { name: "累计机械位置", labels: ["位置给定", "位置反馈"] },
};
const EMPTY: TelemetrySample[] = [];
interface PausedView { mode: StreamMode; samples: TelemetrySample[]; end: number }

export default function Plot() {
  const connected = useAtomValue(motorConnectedAtom);
  const activeMode = useAtomValue(telemetryModeAtom);
  const histories = useAtomValue(telemetryHistoriesAtom);
  const page = useAtomValue(pageAtom);
  const useRpm = useAtomValue(useRpmAtom);
  const useDeg = useAtomValue(useDegAtom);
  const clearTelemetry = useSetAtom(clearTelemetryAtom);
  const [selectedMode, setSelectedMode] = useState<StreamMode>(activeMode === "none" ? "iabc" : activeMode);
  const [windowSeconds, setWindowSeconds] = useState(5);
  const [paused, setPaused] = useState<PausedView | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (activeMode !== "none") setSelectedMode(activeMode);
  }, [activeMode]);
  useEffect(() => { setPaused(null); }, [selectedMode, connected]);

  const frozen = paused?.mode === selectedMode ? paused : null;
  const samples = !connected ? EMPTY : frozen?.samples ?? histories[selectedMode];
  const first = samples[0]?.time ?? 0;
  const last = samples[samples.length - 1]?.time ?? 0;
  const minEnd = Math.min(last, first + windowSeconds);
  const end = frozen ? Math.max(minEnd, Math.min(last, frozen.end)) : last;
  const unit = selectedMode === "speed" ? (useRpm ? "rpm" : "rad/s")
    : selectedMode === "position" ? (useDeg ? "deg" : "rad") : "A";
  const factor = selectedMode === "speed" && !useRpm ? 2 * Math.PI / 60
    : selectedMode === "position" && !useDeg ? Math.PI / 180 : 1;

  const changeMode = async (mode: TelemetryMode) => {
    setBusy(true);
    try {
      await setTelemetryMode(mode);
      return true;
    } catch (error) {
      toast.error(`采集模式写入失败: ${error}`);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const selectMode = async (mode: StreamMode) => {
    if (activeMode !== "none" && !(await changeMode(mode))) return;
    setSelectedMode(mode);
  };

  return (
    <section className="w-full min-h-full min-w-0 flex flex-col border rounded-lg p-4 gap-4" data-testid="plot-page" data-mode={activeMode} data-selected-mode={selectedMode} data-sample-count={samples.length} data-paused={Boolean(frozen)}>
      <header>
        <h1 className="text-lg font-semibold">波形图</h1>
        <p className="text-sm text-muted-foreground">四种模式互斥，最高 1 kHz。停止采集仅发送 get_none，不会停止电机。</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="plot-mode">
          采集模式
          <select id="plot-mode" className="h-9 rounded-md border bg-background px-3" value={selectedMode} onChange={(event) => void selectMode(event.target.value as StreamMode)} disabled={!connected || busy}>
            {(Object.keys(MODES) as StreamMode[]).map((mode) => <option key={mode} value={mode}>{MODES[mode].name}</option>)}
          </select>
        </label>
        <Button data-testid="plot-start-stop" onClick={() => void changeMode(activeMode === "none" ? selectedMode : "none")} disabled={!connected || busy}>
          {busy ? "写入中…" : activeMode === "none" ? "开始采集" : "停止采集"}
        </Button>
        <Button variant="secondary" data-testid="plot-pause" disabled={!connected || (!frozen && samples.length === 0)} onClick={() => setPaused(frozen ? null : { mode: selectedMode, samples, end: last })}>
          {frozen ? "跟随最新" : "暂停查看"}
        </Button>
        <label className="flex flex-col gap-1 text-sm" htmlFor="plot-window">
          时间窗
          <select id="plot-window" className="h-9 rounded-md border bg-background px-3" value={windowSeconds} onChange={(event) => setWindowSeconds(Number(event.target.value))} disabled={!connected}>
            {[1, 5, 10].map((seconds) => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </label>
        <Button variant="outline" data-testid="plot-clear" disabled={!connected} onClick={() => { clearTelemetry(); setPaused(null); }}>清空全部波形</Button>
      </div>
      <p id="plot-status" role="status" className="text-sm text-muted-foreground">
        {!connected ? "设备未连接，波形已清空。" : activeMode === "none" ? "未采集；保留本次连接历史。" : `已写出 ${activeMode} 模式命令（无固件确认）。`}
        {connected && ` 当前${MODES[selectedMode].name}：${histories[selectedMode].length} / ${TELEMETRY_HISTORY_LIMIT} 点。`}
      </p>
      <TelemetryChart samples={samples} labels={MODES[selectedMode].labels} unit={unit} factor={factor} end={end} windowSeconds={windowSeconds} visible={page === "Debug.Plot"} />
      {connected && samples.length === 0 && <p className="text-sm text-muted-foreground">暂无此模式数据。开始采集后等待设备数据。</p>}
      <div className="flex flex-col gap-2">
        <label htmlFor="plot-history" className="text-sm">
          历史窗口结束时间：{end.toFixed(3)} s
          {frozen ? ` · 暂停快照 ${samples.length} 点（仅冻结视图，不受后台历史滚动覆盖）` : " · 跟随最新数据"}
        </label>
        <input id="plot-history" type="range" className="w-full accent-primary" min={minEnd} max={last} step="0.001" value={end} disabled={!connected || !frozen || minEnd >= last} onChange={(event) => { const nextEnd = Number(event.target.value); setPaused((previous) => previous ? { ...previous, end: nextEnd } : null); }} />
        <p className="text-xs text-muted-foreground">横轴为本次连接的主机单调接收时间（秒），并非设备时间戳；接收批次可能有抖动。每种模式最多保留 {TELEMETRY_HISTORY_LIMIT} 点，暂停后可滚动查看固定快照；切换模式或清空会退出暂停。</p>
      </div>
    </section>
  );
}
