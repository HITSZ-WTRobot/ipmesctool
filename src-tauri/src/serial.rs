use crate::exit_signal::ExitSignal;
use crate::telemetry::{is_telemetry_line, parse_frame, TelemetrySample};
use log::{debug, error};
use std::collections::VecDeque;
use std::sync::atomic::{AtomicBool, Ordering};
use parking_lot::Mutex as QueueMutex;
use std::sync::Arc;
use std::time::Instant;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tokio_serial::{SerialPortBuilderExt, SerialStream};

/// Bound memory even if the UI stalls or a peer sends an unterminated line.
pub(crate) const TELEMETRY_CAPACITY: usize = 256;
const MAX_LINE_BYTES: usize = 8192;

#[derive(Debug)]
pub struct SerialDevice {
    pub port_name: String,
    pub baud_rate: u32,
    pub reader: Mutex<Option<tokio::io::ReadHalf<SerialStream>>>,
    pub writer: Mutex<Option<tokio::io::WriteHalf<SerialStream>>>,
    pub connected: AtomicBool,
    /// 串口接收事件广播
    pub recv_event_tx: broadcast::Sender<String>,
    recv_loop_handle: Mutex<Option<JoinHandle<()>>>,
    recv_loop_exit_signal: Arc<ExitSignal>,
    telemetry: QueueMutex<VecDeque<TelemetrySample>>,
}

impl SerialDevice {
    pub fn new(port_name: String, baud_rate: u32) -> Arc<Self> {
        let (recv_event_tx, _) = broadcast::channel(1024);

        Arc::new(Self {
            port_name,
            baud_rate,
            reader: Mutex::new(None),
            writer: Mutex::new(None),
            connected: AtomicBool::new(false),
            recv_event_tx,
            recv_loop_handle: Mutex::new(None),
            recv_loop_exit_signal: ExitSignal::new(),
            telemetry: QueueMutex::new(VecDeque::with_capacity(TELEMETRY_CAPACITY)),
        })
    }

    pub async fn connect(self: &Arc<Self>) -> Result<(), String> {
        let stream = tokio_serial::new(&self.port_name, self.baud_rate)
            .open_native_async()
            .map_err(|e| e.to_string())?;
        let started = Instant::now();
        let (reader, writer) = tokio::io::split(stream);
        *self.reader.lock().await = Some(reader);
        *self.writer.lock().await = Some(writer);
        self.connected.store(true, Ordering::Relaxed);
        // 启动读取任务
        let this = Arc::clone(self);
        let handle = tokio::spawn(async move {
            this.read_loop(started).await;
        });
        *self.recv_loop_handle.lock().await = Some(handle);
        Ok(())
    }

    async fn read_loop(self: Arc<Self>, started: Instant) {
        let mut buf = [0u8; 1024];
        let mut cache = Vec::with_capacity(MAX_LINE_BYTES);
        let mut discarding = false;

        loop {
            let mut guard = self.reader.lock().await;
            let port = match guard.as_mut() {
                Some(p) => p,
                None => {
                    // 串口未连接，中断 task
                    return;
                }
            };
            tokio::select! {
                result = port.read(&mut buf) => {
                    let n = match result {
                        Ok(n) if n >0 => n,
                        _ => {
                            drop(guard);
                            error!("Failed to read from serial port");
                            self.handle_disconnect().await;
                            return;
                        }
                    };
                    for &byte in &buf[..n] {
                        if byte == b'\n' {
                            if !discarding {
                                if cache.last() == Some(&b'\r') {
                                    cache.pop();
                                }
                                let line = String::from_utf8_lossy(&cache);
                                self.receive_line(&line, started.elapsed().as_secs_f64());
                            }
                            cache.clear();
                            discarding = false;
                        } else if !discarding {
                            if cache.len() == MAX_LINE_BYTES {
                                cache.clear();
                                discarding = true;
                            } else {
                                cache.push(byte);
                            }
                        }
                    }
                }
                _ = self.recv_loop_exit_signal.wait() => {
                    return;
                }
            }
        }
    }

    fn receive_line(&self, raw: &str, time: f64) {
        if is_telemetry_line(raw) {
            if let Some((mode, values)) = parse_frame(raw) {
                let mut queue = self.telemetry.lock();
                if queue.len() == TELEMETRY_CAPACITY {
                    queue.pop_front();
                }
                queue.push_back(TelemetrySample {
                    mode,
                    time,
                    values,
                    raw: raw.to_owned(),
                });
            }
            return;
        }
        let line = raw.trim();
        if !line.is_empty() {
            let _ = self.recv_event_tx.send(line.to_owned());
        }
    }

    pub fn drain_telemetry(&self, batch: &mut Vec<TelemetrySample>) {
        batch.extend(self.telemetry.lock().drain(..));
    }

    pub fn clear_telemetry(&self) {
        self.telemetry.lock().clear();
    }

    /// 逐字写入（调用方负责包含 CRLF）；由上层请求锁保证请求串行。
    pub async fn send(&self, text: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().await;
        debug!("serial send: {text}");

        if let Some(ref mut writer) = *writer {
            writer
                .write_all(text.as_bytes())
                .await
                .map_err(|e| e.to_string())
        } else {
            Err("serial not connected".into())
        }
    }

    pub async fn disconnect(self: &Arc<Self>) -> Result<(), String> {
        self.handle_disconnect().await;
        if let Some(handle) = self.recv_loop_handle.lock().await.take() {
            let _ = handle.await;
        }
        Ok(())
    }

    async fn handle_disconnect(&self) {
        self.connected.store(false, Ordering::Relaxed);
        self.recv_loop_exit_signal.trigger();
        // 清空 port
        *self.writer.lock().await = None;
        *self.reader.lock().await = None;
        // 通知上层事件
        let _ = self.recv_event_tx.send("__DISCONNECTED__".to_string());
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::telemetry::{TelemetryMode, TelemetryValues};

    #[test]
    fn telemetry_flood_cannot_lag_or_pollute_command_replies() {
        let serial = SerialDevice::new("unused".to_owned(), 115200);
        let mut replies = serial.recv_event_tx.subscribe();
        serial.receive_line("state Ready", 0.0);
        for i in 0..10_000 {
            serial.receive_line("iabc:1.000,-2.000,3.000", i as f64 / 1000.0);
            serial.receive_line("speed:NaN,2", i as f64 / 1000.0);
        }
        serial.receive_line("ok", 10.0);
        assert_eq!(replies.try_recv().unwrap(), "state Ready");
        assert_eq!(replies.try_recv().unwrap(), "ok");
        assert!(matches!(replies.try_recv(), Err(broadcast::error::TryRecvError::Empty)));

        let mut samples = Vec::new();
        serial.drain_telemetry(&mut samples);
        assert_eq!(samples.len(), TELEMETRY_CAPACITY);
        for (offset, sample) in samples.iter().enumerate() {
            assert_eq!(sample.mode, TelemetryMode::Iabc);
            assert_eq!(sample.time, (10_000 - TELEMETRY_CAPACITY + offset) as f64 / 1000.0);
            assert_eq!(sample.values, TelemetryValues::Three([1.0, -2.0, 3.0]));
            assert_eq!(sample.raw, "iabc:1.000,-2.000,3.000");
        }
    }

    #[test]
    fn draining_and_clearing_never_replays_old_samples() {
        let serial = SerialDevice::new("unused".to_owned(), 115200);
        serial.receive_line("position:1080.000,-720.500", 0.25);
        let mut batch = Vec::new();
        serial.drain_telemetry(&mut batch);
        assert_eq!(batch[0].values, TelemetryValues::Two([1080.0, -720.5]));
        batch.clear();
        serial.receive_line("idq:4.000,-5.000", 0.5);
        serial.clear_telemetry();
        serial.receive_line("speed:60.000,-59.000", 0.75);
        serial.drain_telemetry(&mut batch);
        assert_eq!(batch.len(), 1);
        assert_eq!(batch[0].mode, TelemetryMode::Speed);
        assert_eq!(batch[0].time, 0.75);
        assert_eq!(batch[0].raw, "speed:60.000,-59.000");
    }
}
