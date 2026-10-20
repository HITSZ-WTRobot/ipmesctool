import { useEffect, useMemo, useRef, useState } from "react";
import uPlot from "uplot";
import "uplot/dist/uPlot.min.css";
import type { TelemetrySample } from "@/stores/telemetry.ts";

interface TelemetryChartProps {
  samples: TelemetrySample[];
  labels: readonly string[];
  unit: string;
  factor: number;
  end: number;
  windowSeconds: number;
  visible: boolean;
}

export function TelemetryChart({ samples, labels, unit, factor, end, windowSeconds, visible }: TelemetryChartProps) {
  const container = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);
  const [dark, setDark] = useState(() => document.documentElement.classList.contains("dark"));
  const data = useMemo<uPlot.AlignedData>(() => {
    const columns: [number[], ...number[][]] = [[], ...labels.map((): number[] => [])];
    for (const sample of samples) {
      columns[0].push(sample.time);
      for (let index = 0; index < labels.length; index++) columns[index + 1].push(sample.values[index] * factor);
    }
    return columns;
  }, [samples, labels, factor]);

  useEffect(() => {
    const observer = new MutationObserver(() => setDark(document.documentElement.classList.contains("dark")));
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    setDark(document.documentElement.classList.contains("dark"));
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const styles = getComputedStyle(document.documentElement);
    const foreground = styles.getPropertyValue("--foreground").trim();
    const grid = dark ? "#383841" : "#e4e4e7";
    const colors = ["--chart-1", "--chart-2", "--chart-3"].map((name) => styles.getPropertyValue(name).trim());
    const chart = new uPlot({
      width: Math.max(240, element.clientWidth),
      height: 360,
      scales: { x: { time: false } },
      cursor: { drag: { x: false, y: false } },
      series: [
        { label: "主机接收时间", value: (_plot, value) => value == null ? "—" : `${value.toFixed(3)} s` },
        ...labels.map((label, index) => ({
          label,
          stroke: colors[index],
          width: 1.5,
          points: { show: false },
          value: (_plot: uPlot, value: number | null) => value == null ? "—" : `${value.toFixed(3)} ${unit}`,
        })),
      ],
      axes: [
        { stroke: foreground, grid: { stroke: grid }, ticks: { stroke: grid }, values: (_plot, ticks) => ticks.map((value) => `${Number(value.toFixed(3))}`) },
        { label: unit, stroke: foreground, grid: { stroke: grid }, ticks: { stroke: grid }, size: 72 },
      ],
      legend: { show: true },
    }, [[], ...labels.map((): number[] => [])], element);
    plotRef.current = chart;
    const resize = new ResizeObserver(() => {
      // Persistent pages use display:none. Do not resize to zero while hidden.
      if (element.clientWidth > 0) chart.setSize({ width: Math.max(240, element.clientWidth), height: 360 });
    });
    resize.observe(element);
    return () => {
      resize.disconnect();
      plotRef.current = null;
      chart.destroy();
    };
  }, [labels, unit, dark]);

  useEffect(() => {
    const chart = plotRef.current;
    if (!chart || !visible) return;
    chart.batch(() => {
      chart.setData(data);
      const max = Math.max(windowSeconds, end);
      chart.setScale("x", { min: max - windowSeconds, max });
    });
  }, [data, end, windowSeconds, visible, labels, unit, dark]);

  return <div ref={container} className="w-full min-w-0 text-xs" data-testid="telemetry-chart" aria-label={`波形：${labels.join("、")}，单位 ${unit}`} />;
}
