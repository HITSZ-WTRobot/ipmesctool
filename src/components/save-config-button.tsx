import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { useAtom } from "jotai";
import { motorConfigUnsavedAtom } from "@/stores/motor.ts";

export default function SaveConfigButton() {
  const [saving, setSaving] = useState<boolean>(false);
  const [unsaved, setUnsaved] = useAtom(motorConfigUnsavedAtom);
  const save = useCallback(async () => {
    setSaving(true);
    try {
      await invoke("save_motor_config");
      setUnsaved(false);
      toast.success(`Motor Config Saved!`);
    } catch (e) {
      console.log(e);
      toast.error(`保存失败 e: ${e}`);
    }
    setSaving(false);
  }, [setUnsaved]);
  return (
    <Button
      variant={unsaved ? "destructive" : "outline"}
      disabled={saving}
      onClick={save}
    >
      {saving && <Spinner />}
      Save Config
    </Button>
  );
}
