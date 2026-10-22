import { useEffect, useMemo, useRef, useState } from "react";
import { useAtom, useAtomValue, useSetAtom } from "jotai";
import { toast } from "sonner";
import { Button } from "@/components/ui/button.tsx";
import { TelemetryChart } from "@/components/telemetry-chart.tsx";
import { exportTelemetryCsv } from "@/lib/telemetry-export.ts";
import type { TelemetryHistory } from "@/lib/telemetry-history.ts";
import { useDegAtom, useRpmAtom } from "@/stores/angle.ts";
import { motorConnectedAtom } from "@/stores/motor.ts";
import { pageAtom } from "@/stores/page.ts";
import {
  clearTelemetryAtom,
  setTelemetryMode,
  telemetryHistoriesAtom,
  telemetryModeAtom,
  telemetryRetentionSecondsAtom,
  telemetrySessionAtom,
} from "@/stores/telemetry.ts";
import type { StreamMode, TelemetryMode, TelemetrySample } from "@/stores/telemetry.ts";

const MODES: Record<StreamMode, { name: string; labels: readonly string[] }> = {
  iabc: { name: "三相电流", labels: ["Ia", "Ib", "Ic"] },
  idq: { name: "DQ 轴电流", labels: ["Id", "Iq"] },
  speed: { name: "机械速度", labels: ["速度给定", "速度反馈"] },
  position: { name: "累计机械位置", labels: ["位置给定", "位置反馈"] },
};
const STREAM_MODES = Object.keys(MODES) as StreamMode[];
const EMPTY: TelemetrySample[] = [];
interface PausedView { mode: StreamMode; history: TelemetryHistory; end: number }
type ExportScope = "current" | "window" | "all";
const SELECT_CLASS = "h-9 rounded-md border bg-background px-3";

export default function Plot() {
  const connected = useAtomValue(motorConnectedAtom);
  const activeMode = useAtomValue(telemetryModeAtom);
  const histories = useAtomValue(telemetryHistoriesAtom);
  const session = useAtomValue(telemetrySessionAtom);
  const [retentionSeconds, setRetentionSeconds] = useAtom(telemetryRetentionSecondsAtom);
  const page = useAtomValue(pageAtom);
  const useRpm = useAtomValue(useRpmAtom);
  const useDeg = useAtomValue(useDegAtom);
  const clearTelemetry = useSetAtom(clearTelemetryAtom);
  const [selectedMode, setSelectedMode] = useState<StreamMode>(activeMode === "none" ? "iabc" : activeMode);
  const [windowSeconds, setWindowSeconds] = useState(5);
  const [paused, setPaused] = useState<PausedView | null>(null);
  const [busy, setBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [exportScope, setExportScope] = useState<ExportScope>("current");
  const [clearRevision, setClearRevision] = useState(0);
  const writing = useRef(false);
  const connectionRef = useRef({ connected, session });
  connectionRef.current = { connected, session };

  useEffect(() => {
    if (activeMode !== "none") setSelectedMode(activeMode);
  }, [activeMode]);
  useEffect(() => { setPaused(null); }, [selectedMode, session]);

  const frozen = paused?.mode === selectedMode ? paused : null;
  const history = frozen?.history ?? histories[selectedMode];
  const first = history.firstTime ?? 0;
  const last = history.lastTime ?? 0;
  const minEnd = Math.min(last, first + windowSeconds);
  const end = frozen ? Math.max(minEnd, Math.min(last, frozen.end)) : last;
  const windowEnd = Math.max(windowSeconds, end);
  const windowStart = windowEnd - windowSeconds;
  const samples = useMemo(() => {
    const source = frozen?.history ?? histories[selectedMode];
    return page === "Debug.Plot" ? source.range(windowStart, windowEnd) : EMPTY;
  }, [frozen, histories, selectedMode, windowStart, windowEnd, page]);
  const anyHistory = STREAM_MODES.some((mode) => histories[mode].length > 0);
  const canExport = exportScope === "all" ? anyHistory : exportScope === "window" ? samples.length > 0 : history.length > 0;
  const unit = selectedMode === "speed" ? (useRpm ? "rpm" : "rad/s")
    : selectedMode === "position" ? (useDeg ? "deg" : "rad") : "A";
  const factor = selectedMode === "speed" && !useRpm ? 2 * Math.PI / 60
    : selectedMode === "position" && !useDeg ? Math.PI / 180 : 1;

  const changeMode = async (mode: TelemetryMode) => {
    if (writing.current || !connected) return false;
    writing.current = true;
    setBusy(true);
    try {
      await setTelemetryMode(mode);
      return connectionRef.current.connected && connectionRef.current.session === session;
    } catch (error) {
      toast.error(`采集模式写入失败: ${error}`);
      return false;
    } finally {
      writing.current = false;
      setBusy(false);
    }
  };
  const selectMode = async (mode: StreamMode) => {
    if (mode === selectedMode || writing.current) return;
    if (connected && activeMode !== "none" && !(await changeMode(mode))) return;
    setSelectedMode(mode);
  };
  const exportHistory = async () => {
    if (exportBusy || !canExport) return;
    const sources: Partial<Record<StreamMode, Iterable<TelemetrySample>>> = {};
    if (exportScope === "all") {
      for (const mode of STREAM_MODES) sources[mode] = histories[mode].snapshot().samples();
    } else {
      sources[selectedMode] = exportScope === "window" ? samples : history.snapshot().samples();
    }
    const stamp = new Date().toISOString().replace(/:/g, "-");
    setExportBusy(true);
    try {
      const saved = await exportTelemetryCsv(sources, `ipmesc-${exportScope === "all" ? "all" : selectedMode}-${exportScope}-${stamp}.csv`);
      if (saved) toast.success("历史数据已导出");
    } catch (error) {
      toast.error(`导出失败: ${error}`);
    } finally {
      setExportBusy(false);
    }
  };

  return (
    <section className="w-full min-h-full min-w-0 flex flex-col border rounded-lg p-4 gap-4" data-testid="plot-page" data-mode={activeMode} data-selected-mode={selectedMode} data-sample-count={history.length} data-visible-count={samples.length} data-paused={Boolean(frozen)} data-session={session}>
      <header>
        <h1 className="text-lg font-semibold">波形图</h1>
        <p className="text-sm text-muted-foreground">四种数据源互斥；点击直接切换，停止时只选择。停止采集仅发送 get_none，不会停止电机。</p>
      </header>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-1 text-sm">
          <span id="plot-source-label">数据源</span>
          <div role="group" aria-labelledby="plot-source-label" className="flex flex-wrap gap-1">
            {STREAM_MODES.map((mode) => <Button key={mode} variant={selectedMode === mode ? "default" : "outline"} aria-pressed={selectedMode === mode} data-testid={`plot-source-${mode}`} onClick={() => void selectMode(mode)} disabled={busy}>{MODES[mode].name}</Button>)}
          </div>
        </div>
        <Button data-testid="plot-start-stop" onClick={() => void changeMode(activeMode === "none" ? selectedMode : "none")} disabled={!connected || busy}>
          {busy ? "写入中…" : activeMode === "none" ? "开始采集" : "停止采集"}
        </Button>
        <Button variant="secondary" data-testid="plot-pause" disabled={history.length === 0} onClick={() => setPaused(frozen ? null : { mode: selectedMode, history: history.snapshot(), end: last })}>
          {frozen ? "跟随最新" : "暂停查看"}
        </Button>
        <label className="flex flex-col gap-1 text-sm" htmlFor="plot-window">
          显示时间窗
          <select id="plot-window" className={SELECT_CLASS} value={windowSeconds} onChange={(event) => setWindowSeconds(Number(event.target.value))}>
            {[1, 5, 10].map((seconds) => <option key={seconds} value={seconds}>{seconds} s</option>)}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-sm" htmlFor="plot-retention">
          历史保留
          <select id="plot-retention" className={SELECT_CLASS} value={retentionSeconds} onChange={(event) => setRetentionSeconds(Number(event.target.value))}>
            {[1, 5, 10, 15].map((minutes) => <option key={minutes} value={minutes * 60}>{minutes} min{minutes === 5 ? "（默认）" : ""}</option>)}
          </select>
        </label>
        <Button variant="outline" data-testid="plot-clear" disabled={!anyHistory && !frozen} onClick={() => { clearTelemetry(); setPaused(null); setClearRevision((previous) => previous + 1); }}>清空全部波形</Button>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-sm" htmlFor="plot-export-scope">
          CSV 导出范围
          <select id="plot-export-scope" className={SELECT_CLASS} value={exportScope} onChange={(event) => setExportScope(event.target.value as ExportScope)} disabled={exportBusy}>
            <option value="current">当前源全部历史{frozen ? "（暂停快照）" : ""}</option>
            <option value="window">当前可见窗口</option>
            <option value="all">所有源历史</option>
          </select>
        </label>
        <Button variant="outline" data-testid="plot-export" disabled={!canExport || exportBusy} onClick={() => void exportHistory()}>{exportBusy ? "正在导出…" : "导出 CSV…"}</Button>
        <p className="text-xs text-muted-foreground">CSV 使用协议原始单位（A / rpm / deg）和主机接收秒，不随显示单位切换。所有源导出实时历史，不使用单源暂停快照。</p>
      </div>
      <p id="plot-status" role="status" className="text-sm text-muted-foreground">
        {!connected ? (anyHistory ? "设备已断开；保留上次连接历史，可回放和导出。" : "设备未连接。") : activeMode === "none" ? "未采集；保留本次连接历史。" : `已写出 ${activeMode} 模式命令（无固件确认）。`}
        {` 当前${MODES[selectedMode].name}：${histories[selectedMode].length} 点，跨度 ${Math.max(0, (histories[selectedMode].lastTime ?? 0) - (histories[selectedMode].firstTime ?? 0)).toFixed(1)} s；历史上限 ${retentionSeconds / 60} min。`}
      </p>
      <TelemetryChart samples={samples} labels={MODES[selectedMode].labels} unit={unit} factor={factor} end={end} windowSeconds={windowSeconds} visible={page === "Debug.Plot"} resetKey={`${session}:${selectedMode}:${clearRevision}`} />
      {history.length === 0 && <p className="text-sm text-muted-foreground">暂无此数据源历史。连接设备并开始采集后等待数据。</p>}
      <div className="flex flex-col gap-2">
        <label htmlFor="plot-history" className="text-sm">
          历史窗口结束时间：{end.toFixed(3)} s
          {frozen ? ` · 暂停快照 ${history.length} 点（仅冻结视图，后台继续采集）` : " · 跟随最新数据"}
        </label>
        <input id="plot-history" type="range" className="w-full accent-primary" min={minEnd} max={last} step="0.001" value={end} disabled={!frozen || minEnd >= last} onChange={(event) => { const nextEnd = Number(event.target.value); setPaused((previous) => previous ? { ...previous, end: nextEnd } : null); }} />
        <p className="text-xs text-muted-foreground">横轴为本次连接的主机单调接收时间（秒），并非设备时间戳。默认保留 5 分钟，可延长至 15 分钟；以最新接收时间滚动淘汰旧点。延长不会恢复已淘汰数据，暂停快照不受后台淘汰影响。断连保留历史，新连接清空旧会话；切换源或清空会退出暂停。</p>
      </div>
    </section>
  );
}
