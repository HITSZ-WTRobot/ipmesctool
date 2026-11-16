import { useEffect, useState } from "react";
import { useStore } from "jotai";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { PidConfigCard } from "@/components/pid-config-card";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { motorConfigSchema } from "@/motor";
import { shallowEqual } from "@/lib/utils";
import { motorConfigAtom, motorConnectedAtom, motorStateAtom } from "@/stores/motor";
import { telemetryNativeSessionIdAtom } from "@/stores/telemetry";

/** Numeric firmware settings retain drafts while their persistent page is hidden. */
export function FirmwareConfigCard<T extends Record<string, number>>({
  name, description, value, labels, command, args, validate, disabled = false,
}: {
  name: string;
  description: string;
  value: T;
  labels: Record<keyof T, string>;
  command: string;
  args: (draft: T) => Record<string, number>;
  validate: (draft: T) => string | undefined;
  disabled?: boolean;
}) {
  const store = useStore();
  const [draft, setDraft] = useState<T>({ ...value });
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    setDraft({ ...value });
    setConfirming(false);
  }, [value]);
  const validateDraft = () => {
    const error = validate(draft);
    if (error) return error;
    const rounded = Object.fromEntries(Object.entries(draft).map(([key, value]) => [key, Math.fround(value)])) as T;
    if (Object.values(rounded).some((value) => !Number.isFinite(value))) return "参数超出固件单精度浮点范围";
    return validate(rounded);
  };
  const save = async () => {
    const sessionId = store.get(telemetryNativeSessionIdAtom);
    if (disabled || saving || !sessionId || !store.get(motorConnectedAtom) || store.get(motorStateAtom) !== "Ready") return;
    const error = validateDraft();
    if (error) { toast.error(error); return; }
    setSaving(true);
    try {
      await invoke(command, args(draft));
      if (!store.get(motorConnectedAtom) || store.get(telemetryNativeSessionIdAtom) !== sessionId) return;
      const result = motorConfigSchema.parse(await invoke("get_motor_config"));
      if (store.get(motorConnectedAtom) && store.get(telemetryNativeSessionIdAtom) === sessionId) {
        store.set(motorConfigAtom, result);
      }
    } catch (error) {
      toast.error(`保存 ${name} 失败: ${error}`);
    } finally {
      setSaving(false);
    }
  };
  return <>
    <PidConfigCard
      name={name} description={description} value={draft} setValue={setDraft} labels={labels}
      hasDiff={!shallowEqual(draft, value)} reload={() => setDraft({ ...value })}
      disabled={disabled || saving}
      save={() => {
        const error = validateDraft();
        if (error) toast.error(error);
        else setConfirming(true);
      }}
    />
    <AlertDialog open={confirming} onOpenChange={setConfirming}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确认修改 {name}</AlertDialogTitle>
          <AlertDialogDescription>仅 Ready 状态可写入。固件确认后将重新读取配置；参数错误可能导致电机运行异常。{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={() => void save()} disabled={disabled || saving}>确认写入</AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </>;
}
