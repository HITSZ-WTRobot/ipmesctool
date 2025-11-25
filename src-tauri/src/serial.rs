use crate::exit_signal::ExitSignal;
use log::{debug, error};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::sync::{broadcast, Mutex};
use tokio::task::JoinHandle;
use tokio_serial::{SerialPortBuilderExt, SerialStream};

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
        })
    }

    pub async fn connect(self: &Arc<Self>) -> Result<(), String> {
        let stream = tokio_serial::new(&self.port_name, self.baud_rate)
            .open_native_async().map_err(|e| e.to_string())?;
        let (reader, writer) = tokio::io::split(stream);
        *self.reader.lock().await = Some(reader);
        *self.writer.lock().await = Some(writer);
        self.connected.store(true, Ordering::Relaxed);
        // 启动读取任务
        let this = Arc::clone(self);
        let handle = tokio::spawn(async move {
            this.read_loop().await;
        });
        *self.recv_loop_handle.lock().await = Some(handle);
        Ok(())
    }

    async fn read_loop(self: Arc<Self>) {
        let mut buf = vec![0u8; 1024];
        let mut cache = String::new();

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
                    cache.push_str(&String::from_utf8_lossy(&buf[..n]));
                    // 分行（包含 get_speed、get_current、get_config 等所有返回）
                    while let Some(pos) = cache.find("\r\n") {
                        let line = cache[..pos].trim().to_string();
                        cache.drain(..pos + 2);

                        if !line.is_empty() {
                            // 广播给所有订阅者
                            let _ = self.recv_event_tx.send(line);
                        }
                    }
                }
                _ = self.recv_loop_exit_signal.wait() => {
                    return;
                }
            }
        }
    }

    pub async fn send(&self, text: &str) -> Result<(), String> {
        let mut writer = self.writer.lock().await;
        debug!("serial send: {text}");

        if let Some(ref mut writer) = *writer {
            writer.write_all(text.as_bytes())
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