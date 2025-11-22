import { useAtom, useSetAtom } from "jotai";
import { motorConfigAtom, motorConfigUnsavedAtom } from "@/stores/motor.ts";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { RefreshCcw, Save } from "lucide-react";
import { setPartValue } from "@/lib/utils.ts";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";

export function IdInput({
  value,
  onChange,
}: {
  value: number;
  onChange: (v: number) => void;
}) {
  const [internalValue, setInternalValue] = useState("");
  const [editing, setEditing] = useState(false);

  const formatHex = (v: number) =>
    "0x" + v.toString(16).toUpperCase().padStart(2, "0");

  const parseValue = (raw: string): number | null => {
    const s = raw.trim();
    if (!s) return null;
    if (s.toLowerCase().startsWith("0x")) {
      const hex = s.slice(2);
      if (/^[0-9a-fA-F]+$/.test(hex)) return parseInt(hex, 16);
      return null;
    }
    if (/^\d+$/.test(s)) return parseInt(s, 10);
    return null;
  };

  // 初始化和外部 value 改变时更新 internalValue（不在编辑中）
  useEffect(() => {
    if (!editing) setInternalValue(formatHex(value));
  }, [value]);

  const handleSave = () => {
    const parsed = parseValue(internalValue);
    if (parsed !== null) onChange(parsed);
    setInternalValue(parsed !== null ? formatHex(parsed) : formatHex(value));
    setEditing(false);
  };

  const handleReset = () => {
    setInternalValue(formatHex(value));
    setEditing(false);
  };

  const handleBlur = () => {
    setEditing(false);
    const parsed = parseValue(internalValue);
    if (parsed !== null) {
      setInternalValue(formatHex(parsed > 0xff ? value : parsed));
    } else {
      setInternalValue(formatHex(value));
    }
  };

  return (
    <ButtonGroup className="w-full">
      <ButtonGroupText asChild>
        <Label className="w-16" htmlFor="ID">
          ID
        </Label>
      </ButtonGroupText>

      <Input
        id="ID"
        value={internalValue}
        onFocus={() => setEditing(true)}
        onChange={(e) => setInternalValue(e.target.value)}
        onBlur={handleBlur}
      />

      <Button variant="outline" size="icon" onClick={handleReset}>
        <RefreshCcw />
      </Button>
      <Button variant="outline" size="icon" onClick={handleSave}>
        <Save />
      </Button>
    </ButtonGroup>
  );
}

export default function DeviceInfo() {
  const [config, setConfig] = useAtom(motorConfigAtom);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);

  return config ? (
    <div className="w-full p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">设备信息</CardTitle>
          <CardAction></CardAction>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
          <IdInput
            value={config.id}
            onChange={async (v) => {
              try {
                await invoke("config_motor_id", { id: v });
                setUnsaved(true);
                setPartValue(setConfig, config, "id", v);
              } catch (e) {
                toast.error(`id 设置失败: ${e}`);
              }
            }}
          />
        </CardContent>
      </Card>
    </div>
  ) : (
    <div></div>
  );
}
