import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Label } from "@/components/ui/label";
import { RefreshCcw, Save } from "lucide-react";
import { setPartValue } from "@/lib/utils";

export function PidConfigCard<T extends Record<string, number>>({
  name,
  value,
  setValue,
  labels,
  hasDiff,
  reload,
  save,
  disabled = false,
}: {
  name: string;
  value: T;
  setValue: (v: T) => void;
  labels: Record<keyof T, string>;
  hasDiff: boolean;
  reload: () => void;
  save: () => void;
  disabled?: boolean;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
        <CardAction>
          <Button
            variant={hasDiff ? "destructive" : "ghost"}
            size="icon-sm"
            onClick={reload}
          >
            <RefreshCcw />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={save}
            disabled={disabled}
          >
            <Save />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="text-sm flex flex-col gap-2">
        {(Object.keys(value) as (keyof T)[]).map((k) => (
          <ButtonGroup className="w-full" key={k as string}>
            <ButtonGroupText asChild>
              <Label className="w-28" htmlFor={`${name}.${k as string}`}>
                {labels[k]}
              </Label>
            </ButtonGroupText>
            <Input
              id={`${name}.${k as string}`}
              type="number"
              min={0}
              value={value[k]}
              disabled={disabled}
              onChange={(e) =>
                setPartValue<T>(
                  setValue,
                  value,
                  k as keyof T,
                  e.target.valueAsNumber as T[keyof T],
                )
              }
            />
          </ButtonGroup>
        ))}
      </CardContent>
    </Card>
  );
}
