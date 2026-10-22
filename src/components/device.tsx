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
import { motorConfigSchema, type MotorState } from "@/motor.ts";
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
  const [connecting, setConnecting] = useState(false);
  const [portList, setPortList] = useState<string[]>([]);
  const setMotorConfig = useSetAtom(motorConfigAtom);
  const setMotorState = useSetAtom(motorStateAtom);
  const [selected, setSelected] = useState("");

  const getConfigOrDisconnect = useCallback(async () => {
    try {
      const raw = await invoke("get_motor_config");
      setMotorConfig(motorConfigSchema.parse(raw));
      const state = await invoke<string>("get_motor_state");
      setMotorState(state as MotorState);
      setConnected(true);
    } catch (e) {
      toast.error(`get config failed!\n${e}`);
      setConnected(false);
      setMotorConfig(undefined);
      setMotorState("Unknown");
      await disconnect();
      setConnecting(false);
    }
  }, [setConnected, setMotorConfig, setMotorState]);

  // Telemetry owns session-tagged disconnect events. React only mirrors that
  // connection transition here, so an old event cannot tear down a new device.
  const wasConnected = useRef(connected);
  useEffect(() => {
    const disconnected = wasConnected.current && !connected;
    wasConnected.current = connected;
    if (!disconnected) return;
    setConnecting(false);
    setMotorConfig(undefined);
    setMotorState("Unknown");
    void disconnect();
  }, [connected, setMotorConfig, setMotorState]);

  // Device events and port monitoring
  useEffect(() => {
    invoke("list_serial_ports").then((ports) => setPortList(ports as string[]));
    const spc = listen<string[]>("serial-port-changed", (event) => {
      setPortList(event.payload as string[]);
    });
    return () => {
      spc.then((un) => un());
    };
  }, [setConnected, setMotorConfig, setMotorState]);

  // Clear selected port if it disappears from port list
  useEffect(() => {
    if (selected && !portList.includes(selected)) {
      setSelected("");
    }
  }, [portList, selected]);

  // Auto-reconnect after frontend reload
  const reconnectedRef = useRef(false);
  useEffect(() => {
    if (reconnectedRef.current) return;
    reconnectedRef.current = true;
    invoke("get_motor_port")
      .then((port) => {
        if (!port) return;
        setSelected(port as string);
        setConnecting(true);
        getConfigOrDisconnect().then(() => {
          setConnecting(false);
        });
      })
      .catch(() => {
        // 未连接时后端会 reject；启动阶段静默忽略
      });
  }, [getConfigOrDisconnect]);

  const connect = useCallback(async () => {
    setConnecting(true);
    try {
      await invoke("connect_motor", { portName: selected, baudRate: 460800 });
      await getConfigOrDisconnect();
    } catch (e) {
      console.error(e);
      toast.error(`connect error!\n${e}`);
    }
    setConnecting(false);
  }, [getConfigOrDisconnect, selected]);


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
          onClick={() => setConnected(false)}
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
