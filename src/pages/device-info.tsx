import { useAtomValue } from "jotai";
import { motorConfigAtom } from "@/stores/motor.ts";

export default function DeviceInfo() {
  const config = useAtomValue(motorConfigAtom);

  return config ? <div className="w-full space-y-4 p-4"></div> : <div></div>;
}
