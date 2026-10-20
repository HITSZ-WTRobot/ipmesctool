# ipmesctool

基于 Tauri 2、React 和 Rust 的电机配置与调试工具，串口协议对齐 GPMD_Code 的 `APP/uart_com.cpp`。

## 开发与验证

```sh
bun install
bun run dev          # 前端，端口 1420
bun run tauri dev    # 完整桌面应用
bun run build        # TypeScript 检查与前端构建
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## 串口交互

- 连接使用 115200 baud，先执行 `get_config` 校验设备与配置格式。命令以 CRLF 结束，必须收到 `ok` 才确认成功；`error parameter/state/flash/internal/command` 会显示具体原因。
- 配置快照包含固件状态、uint32 设备 ID、Rs/Ld/Lq、电流/速度/位置环参数及编码器配置。读取等待末尾 `ok`，缺字段不会被当作成功。
- 配置写入仅允许 `Ready` 状态，固件自动写 Flash，无需独立保存。设备 ID 写入范围为 **0–2047**（标准 FDCAN ID），不是整个 uint32 范围。电流 PI 写入只有一组共用 `kp/ki`，同时覆盖 d/q；校准后的 d/q 读回值可能不同。
- 编码器支持 `AS5600`、`MT6701_IIC`、`MT6701_SPI`、`AS5047P`，方向 `CW/CCW`，极对数 1–255，偏移为电角度 rad。
- 控制支持速度（rpm）、累计机械位置（度）、q 轴电流（A）、停止，以及 `Fault` 状态下清除故障。界面选择 rad/s 或 rad 时会换算为固件所需单位。
- 校准启动的 `ok` 不代表完成；工具持续读取阶段、结果及失败阶段，直到终态报告结束。成功后由固件主循环自动保存参数；协议没有独立的保存结果应答。
- 串口控制台可以发送单行原始命令，并显示完整 TX/RX。命令与应答串行处理；超时或接收丢行时关闭连接，避免迟到应答错配下一条命令。

当前固件 UART **不提供实时波形反馈、母线电压设置或电流滤波设置**，因此这些旧协议入口已移除。固件实时遥测走 FDCAN，不会用串口假数据代替。

协议回归测试覆盖配置字段/数值边界、校准终态与失败报告、控制状态限制及应答识别。PTY 模拟串口可以验证主机读写路径，但不能替代真实电机的控制与校准验收。
