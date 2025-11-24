import { useEffect } from "react";
import "uplot/dist/uPlot.min.css";
import {
  MotorFeedbackState,
  useMotorFeedbackListener,
} from "@/stores/feedback.ts";
import { atom, useAtom } from "jotai";
import { Button } from "@/components/ui/button.tsx";
import { Label } from "@/components/ui/label.tsx";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { WaveformControlPanel } from "@/components/plot/waveform-control-panel.tsx";
import { WaveformContainer } from "@/components/plot/waveform-container.tsx";

const feedbackBtnMap: {
  label: string;
  state: MotorFeedbackState;
}[] = [
  {
    label: "无反馈",
    state: "None",
  },
  {
    label: "速度",
    state: "Speed",
  },
  {
    label: "位置",
    state: "Position",
  },
  {
    label: "电流",
    state: "Current",
  },
  {
    label: "电压",
    state: "Udc",
  },
];

const feedbackStateAtom = atom<MotorFeedbackState>("None");

export default function Chart() {
  const [state, setState] = useAtom(feedbackStateAtom);
  const listener = useMotorFeedbackListener();
  useEffect(() => {
    const ls = listener();
    return () => {
      ls.then((unlisten) => unlisten());
    };
  }, [listener]);

  return (
    <div className="w-full h-full flex flex-col items-stretch p-4 gap-2">
      <div id="chart" className="bg-blend-darken bg-purple-500 rounded-md">
        <div className="flex flex-col h-full w-full p-4 bg-gray-950 text-white gap-4">
          {/* control panel */}

          {/* waveform display */}
          <div className="flex-1 flex justify-center items-center">
            <WaveformContainer />
          </div>
        </div>
      </div>
      <WaveformControlPanel />
      <div className="flex flex-col gap-2 my-4">
        <Label>设置反馈类型</Label>
        <div className="w-full flex gap-2">
          {feedbackBtnMap.map(({ label, state }) => (
            <Button
              variant="outline"
              key={state}
              onClick={async () => {
                try {
                  await invoke("set_motor_feedback", { feedback: state });
                  setState(state);
                } catch (e) {
                  toast.error(`设置反馈类型失败: ${e}`);
                }
              }}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>
    </div>
  );
}
