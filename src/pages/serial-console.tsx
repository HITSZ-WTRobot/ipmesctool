import { useEffect, useRef } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button } from "@/components/ui/button.tsx";
import { atom, useAtom } from "jotai";

interface SerialData {
  type: "rx" | "tx";
  data: string;
  timestamp: number;
}

const serialDataAtom = atom<SerialData[]>([]);

export default function SerialConsole() {
  const [serialData, setSerialData] = useAtom(serialDataAtom);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [serialData]);

  // 监听串口事件（只读）
  useEffect(() => {
    const lr = listen("serial-received", (event) => {
      setSerialData((prev) => [
        ...prev,
        { type: "rx", data: event.payload as string, timestamp: Date.now() },
      ]);
    });

    const lt = listen("serial-sent", (event) => {
      setSerialData((prev) => [
        ...prev,
        { type: "tx", data: event.payload as string, timestamp: Date.now() },
      ]);
    });

    return () => {
      lr.then((un) => un());
      lt.then((un) => un());
    };
  }, [setSerialData]);

  return (
    <div className="w-full flex flex-col h-full border rounded-lg p-4 gap-3">
      {/* 日志显示区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-neutral-950 text-neutral-100 rounded-md p-3 space-y-2"
      >
        {serialData.map((item, index) => (
          <div
            key={index}
            className={`rounded-md px-2 py-1 text-sm font-mono whitespace-pre-wrap
              ${
                item.type === "rx"
                  ? "bg-blue-900/50 text-blue-200"
                  : "bg-green-900/50 text-green-200"
              }`}
          >
            {/* 时间戳 */}
            <span className="opacity-60 mr-2">
              {new Date(item.timestamp).toLocaleTimeString()}
            </span>

            {/* 方向 */}
            <span className="font-bold mr-2">
              {item.type === "rx" ? "RX →" : "TX ←"}
            </span>

            {/* 内容 */}
            {item.data}
          </div>
        ))}
      </div>

      {/* 顶部工具条 */}
      <div className="flex justify-end">
        <Button variant="secondary" onClick={() => setSerialData([])}>
          清空
        </Button>
      </div>
    </div>
  );
}
