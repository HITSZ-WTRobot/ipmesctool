import { atom, useAtom, useAtomValue } from "jotai";
import {
  EncoderConfig as EncoderConfigType,
  EncoderDirection,
  EncoderType,
} from "@/motor.ts";
import React, { useCallback, useEffect } from "react";
import { motorConfigAtom, motorConfigUnsavedAtom } from "@/stores/motor.ts";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card.tsx";
import { Button } from "@/components/ui/button.tsx";
import { RefreshCcw, Save } from "lucide-react";
import { toast } from "sonner";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Input } from "@/components/ui/input.tsx";
import { deg2rad, rad2deg, setPartValue } from "@/lib/utils.ts";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx";
import { AngleUnit, useAngleConverter } from "@/components/angle.tsx";
import { useDegAtom } from "@/stores/angle.ts";
import { invoke } from "@tauri-apps/api/core";
import { useSetAtom } from "jotai/index";

const encoderConfigAtom = atom<EncoderConfigType | null>(null);

export default function EncoderConfig() {
  const [encoderConfig, setEncoderConfig] = useAtom(encoderConfigAtom);
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const setUnsaved = useSetAtom(motorConfigUnsavedAtom);
  const useDeg = useAtomValue(useDegAtom);

  const refresh = useCallback(() => {
    if (!motorConfig) return;
    // 读取 encoder config，角度保留 10 位小数
    setEncoderConfig({
      ...motorConfig.encoder_config,
      encoder_offset: useDeg
        ? rad2deg(motorConfig.encoder_config.encoder_offset)
        : motorConfig.encoder_config.encoder_offset,
    });
  }, [motorConfig, setEncoderConfig, useDeg]);

  useEffect(() => {
    if (encoderConfig === null && motorConfig) {
      refresh();
    }
  }, [encoderConfig, motorConfig, refresh]);

  useAngleConverter({
    value: encoderConfig?.encoder_offset ?? 0,
    setValue: (v: number) =>
      encoderConfig &&
      setPartValue(setEncoderConfig, encoderConfig, "encoder_offset", v),
  });

  if (!motorConfig || !encoderConfig) {
    return <div>电机配置未加载</div>;
  }

  console.log(encoderConfig);
  return (
    <div className="w-full p-4 space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">编码器配置</CardTitle>
          <CardAction>
            <Button variant="ghost" size="icon-sm" onClick={() => refresh()}>
              <RefreshCcw />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={async () => {
                try {
                  const c = {
                    polePairs: encoderConfig.pole_pairs,
                    encoderOffset: useDeg
                      ? deg2rad(encoderConfig.encoder_offset)
                      : encoderConfig.encoder_offset,
                    encoderDirection: encoderConfig.encoder_direction,
                    encoderType: encoderConfig.encoder_type,
                  };
                  await invoke("config_motor_encoder", c);
                  setPartValue(setMotorConfig, motorConfig, "encoder_config", {
                    pole_pairs: c.polePairs,
                    encoder_offset: c.encoderOffset,
                    encoder_direction: c.encoderDirection,
                    encoder_type: c.encoderType,
                  });
                  setUnsaved(true);
                } catch (e) {
                  console.log(e);
                  toast.error(`保存失败, e: ${e}`);
                }
              }}
            >
              <Save />
            </Button>
          </CardAction>
        </CardHeader>
        <CardContent className="text-sm flex flex-col gap-2">
          <ButtonGroup className="w-full">
            <ButtonGroupText asChild>
              <Label className="w-28" htmlFor="PolePairs">
                极对数
              </Label>
            </ButtonGroupText>
            <Input
              id="PolePairs"
              type="number"
              min={1}
              value={encoderConfig.pole_pairs}
              onChange={(e) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "pole_pairs",
                  Math.floor(e.target.valueAsNumber),
                )
              }
            />
          </ButtonGroup>
          <ButtonGroup className="w-full">
            <ButtonGroupText asChild>
              <Label className="w-28">方向</Label>
            </ButtonGroupText>
            <Select
              value={encoderConfig.encoder_direction}
              onValueChange={(v) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "encoder_direction",
                  v as EncoderDirection,
                )
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="select encoder direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  <SelectItem value="Same">与电角度方向相同 (Same)</SelectItem>
                  <SelectItem value="Reverse">
                    与电角度方向相反 (Reverse)
                  </SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </ButtonGroup>
          <ButtonGroup className="w-full">
            <ButtonGroupText asChild>
              <Label className="w-28" htmlFor="Offset">
                偏移 <AngleUnit />
              </Label>
            </ButtonGroupText>
            <Input
              id="Offset"
              type="number"
              value={encoderConfig.encoder_offset}
              onChange={(e) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "encoder_offset",
                  e.target.valueAsNumber,
                )
              }
            />
          </ButtonGroup>
          <ButtonGroup className="w-full">
            <ButtonGroupText asChild>
              <Label className="w-28">编码器类型</Label>
            </ButtonGroupText>
            <Select
              value={encoderConfig.encoder_type}
              onValueChange={(v) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "encoder_type",
                  v as EncoderType,
                )
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="select encoder type" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {Object.entries(EncoderType).map(([k, v]) => (
                    <SelectItem value={v} key={k}>
                      {k}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </ButtonGroup>
        </CardContent>
      </Card>
    </div>
  );
}
