import { JSX, useEffect, useState } from "react";
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

export function InputLine({
  label,
  value,
  onChange,
  confirmOnSave = false,
  confirmMessage,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;

  confirmOnSave?: boolean;
  confirmMessage?: (newValue: number) => JSX.Element; // ⭐ 返回 React 元素
}) {
  const [internalValue, setInternalValue] = useState("");
  const [editing, setEditing] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingValue, setPendingValue] = useState<number | null>(null);

  useEffect(() => {
    if (!editing) setInternalValue(String(value));
  }, [value]);

  const parseValue = (raw: string): number | null => {
    const s = raw.trim();
    if (s === "") return null;
    if (!/^-?\d+$/.test(s)) return null;
    return Number(s);
  };

  const doSave = (v: number) => {
    onChange(v);
    setInternalValue(String(v));
    setEditing(false);
  };

  const handleSaveClick = () => {
    const parsed = parseValue(internalValue);
    if (parsed === null) {
      setInternalValue(String(value));
      return;
    }

    if (!confirmOnSave) {
      doSave(parsed);
      return;
    }

    setPendingValue(parsed);
    setConfirmOpen(true);
  };

  const handleReset = () => {
    setInternalValue(String(value));
    setEditing(false);
  };

  const handleBlur = () => {
    setEditing(false);
    const parsed = parseValue(internalValue);
    setInternalValue(parsed === null ? String(value) : String(parsed));
  };

  return (
    <>
      <ButtonGroup className="w-full">
        <ButtonGroupText asChild>
          <Label className="w-28" htmlFor={label}>
            {label}
          </Label>
        </ButtonGroupText>

        <Input
          id={label}
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

      {/* 保存确认框 */}
      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认保存？</AlertDialogTitle>

            <AlertDialogDescription>
              {pendingValue !== null
                ? (confirmMessage?.(pendingValue) ?? (
                    <>确认要保存新值：{pendingValue}？</>
                  ))
                : null}
            </AlertDialogDescription>
          </AlertDialogHeader>

          <AlertDialogFooter>
            <AlertDialogCancel>取消</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingValue !== null) doSave(pendingValue);
              }}
            >
              确认保存
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
