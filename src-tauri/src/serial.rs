use log::debug;
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
    pub port: Mutex<Option<SerialStream>>,
    /// 串口接收事件广播
    pub recv_event_tx: broadcast::Sender<String>,
    recv_loop_running: AtomicBool,
    recv_loop_handle: Mutex<Option<JoinHandle<()>>>,
}

impl SerialDevice {
    pub fn new(port_name: String, baud_rate: u32) -> Arc<Self> {
        let (recv_event_tx, _) = broadcast::channel(1024);

        Arc::new(Self {
            port_name,
            baud_rate,
            port: Mutex::new(None),
            recv_event_tx,
            recv_loop_running: AtomicBool::new(false),
            recv_loop_handle: Mutex::new(None),
        })
    }

    pub async fn connect(self: &Arc<Self>) -> Result<(), String> {
        let stream = tokio_serial::new(&self.port_name, self.baud_rate)
            .open_native_async().map_err(|e| e.to_string())?;
        let mut port = self.port.lock().await;
        *port = Some(stream);
        drop(port);
        // 启动读取任务
        self.recv_loop_running.store(true, Ordering::Relaxed);
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
            if !self.recv_loop_running.load(Ordering::Relaxed) {
                break;
            }

            let mut guard = self.port.lock().await;
            let port = match guard.as_mut() {
                Some(p) => p,
                None => {
                    drop(guard);
                    tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                    continue;
                }
            };

            let n = match port.read(&mut buf).await {
                Ok(n) if n > 0 => n,
                _ => continue,
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
    }

    pub async fn send(&self, text: &str) -> Result<(), String> {
        let mut port = self.port.lock().await;
        debug!("serial send: {text}");

        if let Some(ref mut stream) = *port {
            stream.write_all(text.as_bytes())
                .await
                .map_err(|e| e.to_string())
        } else {
            Err("serial not connected".into())
        }
    }

    pub async fn disconnect(self: &Arc<Self>) -> Result<(), String> {
        self.recv_loop_running.store(false, Ordering::Relaxed);
        *self.port.lock().await = None;
        if let Some(handle) = self.recv_loop_handle.lock().await.take() {
            let _ = handle.await;
        }
        Ok(())
    }
}