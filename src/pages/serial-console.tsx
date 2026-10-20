import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useAtom, useSetAtom } from "jotai";
import { serialDataAtom } from "@/stores/serial.ts";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor.ts";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { motorConfigSchema, type MotorState } from "@/motor.ts";

export default function SerialConsole() {
  const [serialData, setSerialData] = useAtom(serialDataAtom);
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
    try {
      await invoke("send_serial_command", { command });
      setCommand("");
    } catch (e) {
      toast.error(`发送失败: ${e}`);
      return;
    }
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
