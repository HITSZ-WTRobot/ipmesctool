import { useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { ButtonGroup, ButtonGroupText } from "@/components/ui/button-group";
import { Label } from "@/components/ui/label";
import { Key, RefreshCcw, Save } from "lucide-react";
import { setPartValue } from "@/lib/utils";

export function PidConfigLockedCard<T extends Record<string, number>>({
  name,
  warning,
  pi,
  extra,
  hasDiff,
  reload,
  save,
  disabled = false,
}: {
  name: string;
  warning: string;
  pi: {
    value: T;
    setValue: (v: T) => void;
    labels: Record<keyof T, string>;
  }[];
  extra?: ReactNode;
  hasDiff: boolean;
  reload: () => void;
  save: () => void;
  disabled?: boolean;
}) {
  const [unlock, setUnlock] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
        <CardAction>
          {unlock ? (
            <>
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
            </>
          ) : (
            <AlertDialog>
              <AlertDialogTrigger asChild>
                <Button size="icon-sm" variant="destructive">
                  <Key />
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>危险操作警告</AlertDialogTitle>
                  <AlertDialogDescription>{warning}</AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>取消</AlertDialogCancel>
                  <AlertDialogAction onClick={() => setUnlock(true)}>
                    确认解锁
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          )}
        </CardAction>
      </CardHeader>
      <CardContent className="flex flex-col gap-2">
        {extra}
        {pi.map(({ value, setValue, labels }, index) => (
          <div key={index} className="text-sm flex flex-col gap-2">
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
                  value={value[k]}
                  disabled={!unlock || disabled}
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
          </div>
        ))}
      </CardContent>
    </Card>
  );
}
