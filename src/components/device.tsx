import React, { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAtom, useSetAtom } from "jotai";
import {
  motorConfigAtom,
  motorConnectedAtom,
  motorStateAtom,
} from "@/stores/motor.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Plug, Unplug } from "lucide-react";
import { MotorConfig } from "@/motor.ts";
import { Spinner } from "@/components/ui/spinner.tsx";
import { toast } from "sonner";

export async function disconnect() {
  try {
    await invoke("disconnect_motor");
  } catch (e) {
    console.error(e);
  }
}

export default function Device({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [connected, setConnected] = useAtom(motorConnectedAtom);
  const [connecting, setConnecting] = useState<boolean>(false);
  const [portList, setPortList] = useState<string[]>([]);
  const setMotorConfig = useSetAtom(motorConfigAtom);
  const setMotorState = useSetAtom(motorStateAtom);

  const [selected, setSelected] = useState<string>("");

  const getConfigOrDisconnect = useCallback(async () => {
    try {
      const r: MotorConfig = await invoke("get_motor_config");
      setMotorConfig(r);
      setConnected(true);
    } catch (e) {
      console.log(e);
      toast.error(`get config failed!\n${e}`);
      // 获取配置失败，不是我们的设备，关闭连接
      await disconnect();
      setConnecting(false);
    }
  }, [setConnected, setMotorConfig, setConnecting]);

  useEffect(() => {
    const md = listen("motor-disconnected", () => {
      setConnected(false);
      setConnecting(false);
      disconnect().then();
    });
    invoke("list_serial_ports").then((ports) => {
      setPortList(ports as string[]);
    });
    const spc = listen<string[]>("serial-port-changed", (event) => {
      const ports = event.payload as string[];
      setPortList(ports);
    });

    return () => {
      md.then((unlisten) => unlisten());
      spc.then((unlisten) => unlisten());
    };
  }, [setConnected, setConnecting, setPortList]);

  useEffect(() => {
    if (selected && !portList.includes(selected)) {
      setSelected("");
    }
  }, [portList, selected, setSelected]);

  const effectOnceRef = useRef(false);
  useEffect(() => {
    // 本函数作用是前端重新加载后进行一次数据交互
    if (effectOnceRef.current) return;
    effectOnceRef.current = true;
    invoke("get_motor_port").then((port) => {
      setSelected(port as string);
      setConnecting(true);
      getConfigOrDisconnect().then(() => {
        setConnecting(false);
        setConnected(true);
      });
    });
  }, [getConfigOrDisconnect, setConnected]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await invoke("connect_motor", { portName: selected, baudRate: 115200 });
      await getConfigOrDisconnect();
      // 默认 Stop
      setMotorState("Stop");
    } catch (e) {
      console.error(e);
      toast.error(`connect error!\n${e}`);
    }
    setConnecting(false);
  }, [getConfigOrDisconnect, selected, setMotorState]);
  return (
    <div
      className={cn(
        "w-full flex flex-row items-center rounded-md border overflow-hidden",
        className,
      )}
      {...props}
    >
      {connected ? (
        <Button
          className="border-0 rounded-none border-r"
          variant="outline"
          size="icon"
          onClick={() => disconnect()}
        >
          <Unplug />
        </Button>
      ) : (
        <Button
          className="border-0 rounded-none border-r"
          variant="outline"
          size="icon"
          onClick={() => connect()}
          disabled={!selected || connecting}
        >
          {connecting ? <Spinner /> : <Plug />}
        </Button>
      )}
      <div className="flex-1">
        {portList.length > 0 ? (
          <Select
            value={selected}
            onValueChange={setSelected}
            disabled={connected || connecting}
          >
            <SelectTrigger className="w-full border-0 rounded-none focus-visible:ring-0 focus-visible:ring-offset-0 focus:outline-none">
              <SelectValue placeholder="Select a port" />
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {portList.map((port) => (
                  <SelectItem key={port} value={port}>
                    {port}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        ) : (
          <Select
            value={selected}
            onValueChange={setSelected}
            disabled={connected}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="无串口设备" />
            </SelectTrigger>
          </Select>
        )}
      </div>
    </div>
  );
}
