import { useCallback, useState } from "react";
import { Button } from "@/components/ui/button.tsx";
import { Spinner } from "@/components/ui/spinner.tsx";
import { useSetAtom } from "jotai";
import { motorConfigAtom } from "@/stores/motor.ts";
import { toast } from "sonner";
import { invoke } from "@tauri-apps/api/core";
import { MotorConfig } from "@/motor.ts";

export default function RefreshConfigButton() {
  const [refreshing, setRefreshing] = useState(false);
  const setConfig = useSetAtom(motorConfigAtom);
  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const newConfig: MotorConfig = await invoke("refresh_motor_config");
      setConfig(newConfig);
      toast.success(`Motor Config Refreshed!`);
    } catch (e) {
      console.log(e);
      toast.error(`刷新失败 e: ${e}`);
    }
    setRefreshing(false);
  }, [setConfig]);
  return (
    <Button variant="outline" disabled={refreshing} onClick={refresh}>
      {refreshing && <Spinner />}
      Refresh Config
    </Button>
  );
}
