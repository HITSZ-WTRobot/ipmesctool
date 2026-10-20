import { atom, useAtom, useAtomValue } from "jotai";
import { ENCODER_DIRECTIONS, ENCODER_TYPES } from "@/motor.ts";
import type {
  EncoderConfig as EncoderConfigType,
  WritableEncoderDirection,
  WritableEncoderType,
} from "@/motor.ts";
import { useCallback, useEffect } from "react";
import { motorConfigAtom, motorStateAtom } from "@/stores/motor.ts";
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
import { AngleUnit, useAngleConverter } from "@/components/unit.tsx";
import { useDegAtom } from "@/stores/angle.ts";
import { invoke } from "@tauri-apps/api/core";

const encoderConfigAtom = atom<EncoderConfigType | null>(null);

export default function EncoderConfig() {
  const [encoderConfig, setEncoderConfig] = useAtom(encoderConfigAtom);
  const [motorConfig, setMotorConfig] = useAtom(motorConfigAtom);
  const useDeg = useAtomValue(useDegAtom);
  const state = useAtomValue(motorStateAtom);
  const ready = state === "Ready";

  const refresh = useCallback(() => {
    if (!motorConfig) return;
    // 读取 encoder config，角度按当前显示单位换算
    setEncoderConfig({
      ...motorConfig.encoder_config,
      encoder_offset: useDeg
        ? rad2deg(motorConfig.encoder_config.encoder_offset)
        : motorConfig.encoder_config.encoder_offset,
    });
  }, [motorConfig, setEncoderConfig, useDeg]);

  useEffect(() => {
    if (motorConfig) {
      refresh();
    }
  }, [motorConfig, refresh]);

  useAngleConverter({
    value: encoderConfig?.encoder_offset ?? 0,
    setValue: (v: number) =>
      encoderConfig &&
      setPartValue(setEncoderConfig, encoderConfig, "encoder_offset", v),
  });

  if (!motorConfig || !encoderConfig) {
    return <div>电机配置未加载</div>;
  }

  const save = async () => {
    const polePairs = encoderConfig.pole_pairs;
    if (!Number.isInteger(polePairs) || polePairs < 1 || polePairs > 255) {
      toast.error("极对数必须为 1..255 的整数");
      return;
    }
    if (
      encoderConfig.encoder_direction !== "CW" &&
      encoderConfig.encoder_direction !== "CCW"
    ) {
      toast.error("请选择编码器方向 (CW/CCW)");
      return;
    }
    if (!(ENCODER_TYPES as readonly string[]).includes(encoderConfig.encoder_type)) {
      toast.error("请选择编码器类型");
      return;
    }
    const encoderOffset = useDeg
      ? deg2rad(encoderConfig.encoder_offset)
      : encoderConfig.encoder_offset;
    if (!Number.isFinite(encoderOffset)) {
      toast.error("偏移量必须为有限数值");
      return;
    }
    try {
      await invoke("config_motor_encoder", {
        polePairs,
        encoderOffset,
        encoderDirection: encoderConfig.encoder_direction,
        encoderType: encoderConfig.encoder_type,
      });
      setPartValue(setMotorConfig, motorConfig, "encoder_config", {
        pole_pairs: polePairs,
        encoder_offset: encoderOffset,
        encoder_direction: encoderConfig.encoder_direction,
        encoder_type: encoderConfig.encoder_type,
      });
    } catch (e) {
      toast.error(`保存失败, e: ${e}`);
    }
  };

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
              onClick={save}
              disabled={!ready}
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
              max={255}
              value={encoderConfig.pole_pairs}
              disabled={!ready}
              onChange={(e) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "pole_pairs",
                  e.target.valueAsNumber,
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
              disabled={!ready}
              onValueChange={(v) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "encoder_direction",
                  v as WritableEncoderDirection,
                )
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="select encoder direction" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ENCODER_DIRECTIONS.map((d) => (
                    <SelectItem value={d} key={d}>
                      {d === "CW" ? "CW (+1)" : "CCW (-1)"}
                    </SelectItem>
                  ))}
                  {encoderConfig.encoder_direction === "None" && (
                    <SelectItem value="None" disabled>
                      未配置 (None)
                    </SelectItem>
                  )}
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
              disabled={!ready}
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
              disabled={!ready}
              onValueChange={(v) =>
                setPartValue(
                  setEncoderConfig,
                  encoderConfig,
                  "encoder_type",
                  v as WritableEncoderType,
                )
              }
            >
              <SelectTrigger className="flex-1">
                <SelectValue placeholder="select encoder type" />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {ENCODER_TYPES.map((t) => (
                    <SelectItem value={t} key={t}>
                      {t}
                    </SelectItem>
                  ))}
                  {(encoderConfig.encoder_type === "None" ||
                    encoderConfig.encoder_type === "Unknown") && (
                    <SelectItem value={encoderConfig.encoder_type} disabled>
                      未配置 ({encoderConfig.encoder_type})
                    </SelectItem>
                  )}
                </SelectGroup>
              </SelectContent>
            </Select>
          </ButtonGroup>
        </CardContent>
      </Card>
    </div>
  );
}
