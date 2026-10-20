import { memo, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { atom, useAtomValue, useSetAtom } from "jotai";
import { serialDataAtom } from "@/stores/serial.ts";
import type { SerialData } from "@/stores/serial.ts";
import { pageAtom } from "@/stores/page.ts";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor.ts";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { motorConfigSchema } from "@/motor.ts";
import type { MotorState } from "@/motor.ts";

// Hidden persistent consoles keep the bounded store, but do not reconcile 5000 rows per batch.
const visibleSerialDataAtom = atom((get) => get(pageAtom) === "Debug.Serial" ? get(serialDataAtom) : []);
const rowKeys = new WeakMap<SerialData, number>();
let nextRowKey = 0;
function rowKey(item: SerialData) {
  let key = rowKeys.get(item);
  if (key === undefined) {
    key = nextRowKey++;
    rowKeys.set(item, key);
  }
  return key;
}
const SerialRow = memo(function SerialRow({ item }: { item: SerialData }) {
  return (
    <div className={`rounded-md px-2 py-1 text-sm font-mono whitespace-pre-wrap ${item.type === "rx" ? "bg-blue-900/50 text-blue-200" : "bg-green-900/50 text-green-200"}`}>
      <span className="opacity-60 mr-2">{new Date(item.timestamp).toLocaleTimeString()}</span>
      <span className="font-bold mr-2">{item.type === "rx" ? "RX →" : "TX ←"}</span>
      {item.data}
    </div>
  );
});

export default function SerialConsole() {
  const serialData = useAtomValue(visibleSerialDataAtom);
  const setSerialData = useSetAtom(serialDataAtom);
  const setConfig = useSetAtom(motorConfigAtom);
  const setMotorState = useSetAtom(motorStateAtom);
  const [command, setCommand] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [serialData]);

  const send = async () => {
    if (/[\r\n]/.test(command)) {
      toast.error("一次只能发送一条命令，不能包含换行符");
      return;
    }
    if (command.length === 0) return;
    const telemetryMode = command.match(/^get_(none|iabc|idq|speed|position)$/)?.[1];
    try {
      if (telemetryMode) {
        await invoke("set_telemetry_mode", { mode: telemetryMode });
      } else {
        await invoke("send_serial_command", { command });
      }
      setCommand("");
    } catch (e) {
      toast.error(`发送失败: ${e}`);
      return;
    }
    // Stream controls only switch mode and never return ok or change motor configuration.
    if (telemetryMode) return;
    // raw 命令可能改变了设备状态/配置，刷新前端缓存以反映到其它页面；
    // 读取失败必须报出（命令本身已成功，但缓存可能已过期）
    try {
      const raw = await invoke("get_motor_config");
      setConfig(motorConfigSchema.parse(raw));
    } catch (e) {
      toast.error(`命令已发送，但读取配置失败: ${e}`);
    }
    try {
      const st = await invoke<string>("get_motor_state");
      setMotorState(st as MotorState);
    } catch (e) {
      toast.error(`命令已发送，但读取状态失败: ${e}`);
    }
  };

  return (
    <div className="w-full flex flex-col h-full border rounded-lg p-4 gap-3">
      {/* 日志显示区 */}
      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto bg-neutral-950 text-neutral-100 rounded-md p-3 space-y-2"
      >
        {serialData.map((item) => <SerialRow key={rowKey(item)} item={item} />)}
      </div>

      {/* 发送区 */}
      <div className="flex gap-2">
        <Input
          value={command}
          placeholder="输入一条命令（不含换行），回车发送"
          onChange={(e) => setCommand(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              void send();
            }
          }}
        />
        <Button variant="secondary" onClick={() => void send()}>
          发送
        </Button>
        <Button variant="secondary" onClick={() => setSerialData([])}>
          清空
        </Button>
      </div>
    </div>
  );
}
