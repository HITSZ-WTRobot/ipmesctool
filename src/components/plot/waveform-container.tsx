import { useAtomValue } from "jotai";
import {
  feedbackPausedAtom,
  feedbackStateAtom,
  feedbackWindowMsAtom,
  motorFeedbackBuffer,
  Timestamped,
} from "@/stores/feedback.ts";
import { useEffect, useState } from "react";
import { WaveformPlot } from "@/components/plot/waveform-plot.tsx";

export function WaveformContainer() {
  const type = useAtomValue(feedbackStateAtom);
  const paused = useAtomValue(feedbackPausedAtom);
  const windowMs = useAtomValue(feedbackWindowMsAtom);

  const [scrollPos, setScrollPos] = useState(1); // 0-1，1=最新数据
  const [filteredData, setFilteredData] = useState<Timestamped<number[]>[]>([]);

  useEffect(() => {
    const interval = setInterval(() => {
      const arr = motorFeedbackBuffer[type] || [];
      if (arr.length === 0) return;

      const now = arr[arr.length - 1].timestamp;
      const totalDuration = arr[arr.length - 1].timestamp - arr[0].timestamp;

      // 当前窗口右端时间 = 最新时间 - (1 - scrollPos) * (totalDuration - windowMs)
      const rightTime =
        now - (1 - scrollPos) * Math.max(totalDuration - windowMs, 0);
      const leftTime = rightTime - windowMs;

      const startIndex = arr.findIndex((d) => d.timestamp >= leftTime);
      const endIndex = arr.findIndex((d) => d.timestamp > rightTime);
      setFilteredData(
        arr.slice(startIndex, endIndex > 0 ? endIndex : undefined),
      );
    }, 50);

    return () => clearInterval(interval);
  }, [type, windowMs, scrollPos]);

  return (
    <div>
      <WaveformPlot
        type={type}
        paused={paused}
        width={800}
        height={400}
        data={filteredData}
      />
      <div className="flex items-center mt-2">
        <label className="text-white mr-2">Scroll:</label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.01}
          value={scrollPos}
          onChange={(e) => setScrollPos(Number(e.target.value))}
          className="flex-1"
        />
      </div>
    </div>
  );
}
