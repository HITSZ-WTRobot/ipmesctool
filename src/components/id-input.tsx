import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { RefreshCcw, Save } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// 固件 motor.hpp k_max_id=0x7FF：CLI wire 为 u32，但 set_id 拒绝 >2047
const MAX_ID = 2047;

function parseValue(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const hex = s.match(/^0x([0-9a-fA-F]+)$/);
  if (hex) {
    const v = parseInt(hex[1], 16);
    return Number.isSafeInteger(v) && v <= MAX_ID ? v : null;
  }
  if (/^\d+$/.test(s)) {
    const v = parseInt(s, 10);
    return v <= MAX_ID ? v : null;
  }
  return null;
}

export function IdInput({
  value,
  onChange,
  confirmOnSave = false,
  confirmMessage,
  disabled = false,
}: {
  value: number;
  onChange: (v: number) => void;
  confirmOnSave?: boolean;
  confirmMessage?: string;
  disabled?: boolean;
}) {
  const [internalValue, setInternalValue] = useState(String(value));
  const [confirmOpen, setConfirmOpen] = useState(false);

  // prop 变化时同步草稿；用户正在输入（internalValue 改变）不会触发本 effect
  useEffect(() => {
    setInternalValue(String(value));
  }, [value]);

  const parsed = parseValue(internalValue);

  const doSave = () => {
    const v = parseValue(internalValue);
    if (v === null) return; // 无效草稿绝不回退写入旧值
    onChange(v);
    setInternalValue(String(v));
  };

  const handleSaveClick = () => {
    if (confirmOnSave) {
      setConfirmOpen(true);
    } else {
      doSave();
    }
  };

  const handleReset = () => {
    setInternalValue(String(value));
  };

  const handleBlur = () => {
    // 仅规范化有效草稿；无效则保持原始输入，不重置为旧值
    const v = parseValue(internalValue);
    if (v !== null) setInternalValue(String(v));
  };

  return (
    <>
      <ButtonGroup className="w-full">
        <ButtonGroupText asChild>
          <Label className="w-28" htmlFor="ID">
            ID (0..2047)
          </Label>
        </ButtonGroupText>

        <Input
          id="ID"
          value={internalValue}
          disabled={disabled}
          onChange={(e) => setInternalValue(e.target.value)}
          onBlur={handleBlur}
        />

        <Button variant="outline" size="icon" onClick={handleReset}>
          <RefreshCcw />
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={handleSaveClick}
          disabled={disabled || parsed === null}
        >
          <Save />
        </Button>
      </ButtonGroup>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存？</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmMessage ?? "确定要保存此配置吗？"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction onClick={() => doSave()}>
              确认保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
