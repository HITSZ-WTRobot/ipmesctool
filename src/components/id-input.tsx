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

function formatHex(v: number) {
  return "0x" + v.toString(16).toUpperCase().padStart(2, "0");
}

function parseValue(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  if (s.toLowerCase().startsWith("0x")) {
    const hex = s.slice(2);
    if (/^[0-9a-fA-F]+$/.test(hex)) return parseInt(hex, 16);
    return null;
  }
  if (/^\d+$/.test(s)) return parseInt(s, 10);
  return null;
}

export function IdInput({
  value,
  onChange,
  confirmOnSave = false,
  confirmMessage,
}: {
  value: number;
  onChange: (v: number) => void;
  confirmOnSave?: boolean;
  confirmMessage?: string;
}) {
  const [internalValue, setInternalValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  useEffect(() => {
    if (!editing) setInternalValue(formatHex(value));
  }, [editing, value]);

  const doSave = () => {
    const parsed = parseValue(internalValue);
    if (parsed !== null) onChange(parsed);
    setInternalValue(parsed !== null ? formatHex(parsed) : formatHex(value));
    setEditing(false);
  };

  const handleSaveClick = () => {
    if (confirmOnSave) {
      setConfirmOpen(true);
    } else {
      doSave();
    }
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
    <>
      <ButtonGroup className="w-full">
        <ButtonGroupText asChild>
          <Label className="w-28" htmlFor="ID">
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

        <Button variant="outline" size="icon" onClick={handleSaveClick}>
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
