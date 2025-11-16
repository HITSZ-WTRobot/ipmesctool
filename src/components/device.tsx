import React, { useCallback, useEffect, useState } from "react";
import { cn } from "@/lib/utils.ts";
import { listen } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { useAtom } from "jotai";
import { motorConnectedAtom } from "@/stores/motor.ts";
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

export default function Device({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  const [connected, setConnected] = useAtom(motorConnectedAtom);
  const [portList, setPortList] = useState<string[]>([]);

  const [selected, setSelected] = useState<string>("");

  const disconnect = useCallback(async () => {
    try {
      await invoke("disconnect_motor");
    } catch (e) {
      console.error(e);
    }
  }, []);

  useEffect(() => {
    const md = listen("motor-disconnected", () => {
      setConnected(false);
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
  }, [disconnect, setConnected, setPortList]);

  useEffect(() => {
    if (selected && !portList.includes(selected)) {
      setSelected("");
    }
  }, [portList, selected, setSelected]);

  const connect = useCallback(async () => {
    try {
      await invoke("connect_motor", { portName: selected, baudRate: 115200 });
      setConnected(true);
    } catch (e) {
      console.error(e);
    }
  }, [selected, setConnected]);
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
          disabled={!selected}
        >
          <Plug />
        </Button>
      )}
      <div className="flex-1">
        {portList.length > 0 ? (
          <Select
            value={selected}
            onValueChange={setSelected}
            disabled={connected}
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
