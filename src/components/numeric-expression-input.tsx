import {
  cn,
  filterNumericExpression,
  safeEvalExpression,
} from "@/lib/utils.ts";
import React, { useCallback, useEffect, useState } from "react";
import { Input } from "@/components/ui/input.tsx";

export function NumericExpressionInput({
  value,
  onValueChange,
  onEnter,
  min,
  max,
  className,
  ...props
}: {
  value: number;
  onValueChange: (v: number) => void;
  onEnter?: (v: number) => void;
  min?: number;
  max?: number;
} & React.HTMLAttributes<HTMLInputElement>) {
  const [raw, setRaw] = useState(value.toString());

  // 外部 value 变化时，同步 raw，但不覆盖用户正在输入的内容
  useEffect(() => {
    setRaw(value.toString());
  }, [value]);

  // commit 不依赖 raw，而是接受一个字符串参数
  const commit = useCallback(
    (text: string): number | undefined => {
      const result = safeEvalExpression(text);
      if (result === null) {
        // 表达式无法计算，保持原样
        return undefined;
      }

      let final = result;

      if (min !== undefined) final = Math.max(min, final);
      if (max !== undefined) final = Math.min(max, final);

      onValueChange(final);
      return final;
    },
    [min, max, onValueChange],
  );

  const handleBlur = useCallback(() => {
    const result = commit(raw);
    if (result !== undefined) {
      setRaw(result.toString());
    }
  }, [raw, commit]);

  const handleEnter = useCallback(() => {
    const result = commit(raw);
    if (result !== undefined) {
      setRaw(result.toString());
      onEnter?.(result);
    }
  }, [raw, commit, onEnter]);

  return (
    <Input
      className={cn("w-32", className)}
      value={raw}
      {...props}
      onChange={(e) => setRaw(filterNumericExpression(e.target.value))}
      onBlur={handleBlur}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          handleEnter();
        }
      }}
    />
  );
}
