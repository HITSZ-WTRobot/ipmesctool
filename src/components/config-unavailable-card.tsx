import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * 固件未上报（或读回格式非法）的配置单元占位卡。
 * 不渲染任何默认值，避免把“未知”伪装成可写配置。
 */
export function UnavailableConfigCard({
  name,
  reason,
}: {
  name: string;
  reason?: string | null;
}) {
  return (
    <Card className="border-dashed">
      <CardHeader>
        <CardTitle className="text-base">{name}</CardTitle>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground">
        该配置项在当前固件版本中不可用，已禁用写入。
        {reason && <span className="block mt-1 font-mono text-xs">{reason}</span>}
      </CardContent>
    </Card>
  );
}
