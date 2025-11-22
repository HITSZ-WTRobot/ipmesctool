import { atom } from "jotai";

export type PageID =
  | "Basic.DeviceInfo"
  | "Motor.PID"
  | "Motor.Encoder"
  | "Motor.Calibration"
  | "Debug.Serial";

export interface PageGroup {
  name: string;
  pages: Page[];
}

export interface Page {
  id: PageID;
  name: string;
}

export const pageAtom = atom<PageID>("Basic.DeviceInfo");

export const PageGroups: PageGroup[] = [
  {
    name: "Basic",
    pages: [
      {
        id: "Basic.DeviceInfo",
        name: "设备信息",
      },
    ],
  },
  {
    name: "Motor",
    pages: [
      {
        id: "Motor.PID",
        name: "PID 设置",
      },
      {
        id: "Motor.Encoder",
        name: "编码器设置",
      },
      {
        id: "Motor.Calibration",
        name: "校准",
      },
    ],
  },
  {
    name: "Debug",
    pages: [
      {
        name: "串口数据",
        id: "Debug.Serial",
      },
    ],
  },
];
