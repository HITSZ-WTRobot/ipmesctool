import { useAtom, useAtomValue } from "jotai";
import { useDegAtom, useRpmAtom } from "@/stores/angle.ts";
import { Switch } from "@/components/ui/switch.tsx";
import { Label } from "@/components/ui/label.tsx";
import { useEffect, useRef } from "react";
import { deg2rad, rad2deg, rpm2rps, rps2rpm } from "@/lib/utils.ts";

export function AngleDisplay({ rad }: { rad: number }) {
  const useDeg = useAtomValue(useDegAtom);
  return useDeg ? <>{(rad * 180) / Math.PI} °</> : <>{rad} rad</>;
}

export function useAngleConverter({
  value,
  setValue,
}: {
  value: number;
  setValue: (v: number) => void;
}) {
  const useDeg = useAtomValue(useDegAtom);
  const prevUseDeg = useRef(useDeg);
  useEffect(() => {
    if (prevUseDeg.current === useDeg) return;
    prevUseDeg.current = useDeg;
    setValue(useDeg ? rad2deg(value) : deg2rad(value));
  }, [setValue, useDeg, value]);
}

export function useSpeedConverter({
  value,
  setValue,
}: {
  value: number;
  setValue: (v: number) => void;
}) {
  const useRpm = useAtomValue(useRpmAtom);
  const prevUseRpm = useRef(useRpm);
  useEffect(() => {
    if (prevUseRpm.current === useRpm) return;
    prevUseRpm.current = useRpm;
    // rpm 或者 rad/s
    setValue(useRpm ? rps2rpm(value) : rpm2rps(value));
  });
}

export function AngleUnit() {
  const useDeg = useAtomValue(useDegAtom);
  return useDeg ? <span>deg</span> : <span>rad</span>;
}

export function SpeedUnit() {
  const useRpm = useAtomValue(useRpmAtom);
  return useRpm ? <span>rpm</span> : <span>rad/s</span>;
}

export function AngleDisplaySwitcher() {
  const [useDeg, setUseDeg] = useAtom(useDegAtom);
  return (
    <div className="flex items-center justify-center gap-2">
      <Switch id="UseDeg" checked={useDeg} onCheckedChange={setUseDeg} />
      <Label htmlFor="UseDeg">use deg</Label>
    </div>
  );
}

export function SpeedDisplaySwitcher() {
  const [useRpm, setUseRpm] = useAtom(useRpmAtom);
  return (
    <div className="flex items-center justify-center gap-2">
      <Switch id="UseRpm" checked={useRpm} onCheckedChange={setUseRpm} />
      <Label htmlFor="UseRpm">use rpm</Label>
    </div>
  );
}
