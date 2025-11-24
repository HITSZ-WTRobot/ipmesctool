import { useAtom } from "jotai";
import {
  feedbackPausedAtom,
  feedbackStateAtom,
  feedbackWindowMsAtom,
} from "@/stores/feedback.ts";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";

export function WaveformControlPanel() {
  const [type, setType] = useAtom(feedbackStateAtom);
  const [paused, setPaused] = useAtom(feedbackPausedAtom);
  const [windowMs, setWindowMs] = useAtom(feedbackWindowMsAtom);

  const waveformTypes: { label: string; value: typeof type }[] = [
    { label: "Speed", value: "speed" },
    { label: "Position", value: "position" },
    { label: "Voltage", value: "udc" },
    { label: "Current (Iabc)", value: "iabc" },
  ];

  return (
    <div className="flex flex-col gap-4 p-4 bg-gray-900 text-white rounded-lg">
      {/* type selector as buttons */}
      <div className="flex items-center gap-2">
        <span>Type:</span>
        {waveformTypes.map((t) => (
          <Button
            key={t.value}
            size="sm"
            variant={type === t.value ? "default" : "outline"}
            onClick={() => setType(t.value)}
          >
            {t.label}
          </Button>
        ))}
      </div>

      {/* pause/resume button */}
      <div className="flex items-center gap-2">
        <span>Status:</span>
        <Button onClick={() => setPaused(!paused)} variant="outline">
          {paused ? "Resume" : "Pause"}
        </Button>
      </div>

      {/* window slider */}
      <div className="flex flex-col gap-1">
        <span>Window: {windowMs} ms</span>
        <Slider
          value={[windowMs]}
          onValueChange={(v) => setWindowMs(v[0])}
          min={1000}
          max={20000}
          step={500}
        />
      </div>
    </div>
  );
}
