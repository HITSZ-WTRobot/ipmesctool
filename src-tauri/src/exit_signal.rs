use std::sync::Arc;
use tokio::sync::watch;

#[derive(Debug)]
pub struct ExitSignal {
    tx: watch::Sender<bool>,
    rx: watch::Receiver<bool>,
}

impl ExitSignal {
    pub fn new() -> Arc<Self> {
        let (tx, rx) = watch::channel(false);
        Arc::new(Self { tx, rx })
    }

    /// 触发退出
    pub fn trigger(&self) {
        let _ = self.tx.send(true);
    }

    /// 等待退出（不会丢信号）
    pub async fn wait(&self) {
        let mut rx = self.rx.clone();
        rx.changed().await.unwrap();
    }
}
