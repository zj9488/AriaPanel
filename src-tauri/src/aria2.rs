use crate::secret::{generate_secret, pick_free_port};
use crate::settings::Settings;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use tauri::Manager;

pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
}

pub fn new_config(dir: PathBuf, session: PathBuf, settings: &Settings) -> Aria2Config {
    Aria2Config {
        port: settings.port.unwrap_or_else(pick_free_port),
        secret: settings.secret.clone().unwrap_or_else(generate_secret),
        dir,
        session,
    }
}

pub fn build_args(cfg: &Aria2Config) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        "--rpc-listen-all=false".into(),
        "--rpc-allow-origin-all=true".into(),
        format!("--rpc-listen-port={}", cfg.port),
        format!("--rpc-secret={}", cfg.secret),
        format!("--dir={}", cfg.dir.display()),
        "--continue=true".into(),
        "--file-allocation=none".into(),
        "--auto-file-renaming=false".into(),
        "--allow-overwrite=true".into(),
        format!("--input-file={}", cfg.session.display()),
        format!("--save-session={}", cfg.session.display()),
        "--quiet=true".into(),
    ]
}

pub fn build_global_args(s: &Settings) -> Vec<String> {
    let mut args = vec![
        format!("--max-concurrent-downloads={}", s.max_concurrent_downloads),
        format!("--max-connection-per-server={}", s.max_connection_per_server),
        format!("--min-split-size={}", s.min_split_size),
        format!("--split={}", s.split),
        format!("--max-overall-download-limit={}", s.max_overall_download_limit),
        format!("--max-overall-upload-limit={}", s.max_overall_upload_limit),
    ];
    if !s.all_proxy.is_empty() {
        args.push(format!("--all-proxy={}", s.all_proxy));
    }
    args
}

pub fn rpc_http_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/jsonrpc")
}

pub fn binary_path(app: &tauri::AppHandle) -> tauri::Result<PathBuf> {
    let name = if cfg!(windows) { "resources/aria2c.exe" } else { "resources/aria2c" };
    app.path().resolve(name, tauri::path::BaseDirectory::Resource)
}

pub fn spawn(binary: &Path, cfg: &Aria2Config, settings: &Settings) -> std::io::Result<Child> {
    Command::new(binary)
        .args(build_args(cfg))
        .args(build_global_args(settings))
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
}

/// 轮询 aria2.getVersion（带 token），最多约 5 秒。
pub async fn health_check(port: u16, secret: &str) -> bool {
    let url = rpc_http_url(port);
    let client = match reqwest::Client::builder().build() {
        Ok(c) => c,
        Err(_) => return false,
    };
    let body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "aria2.getVersion",
        "params": [format!("token:{secret}")]
    });
    for _ in 0..50 {
        if let Ok(resp) = client.post(&url).json(&body).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
    }
    false
}

const MAX_RESTARTS: u32 = 3;

pub struct Supervisor {
    pub child: Option<Child>,
    pub restarts: u32,
    max_restarts: u32,
}

impl Supervisor {
    pub fn new() -> Self {
        Self { child: None, restarts: 0, max_restarts: MAX_RESTARTS }
    }
    pub fn restarts_count(&self) -> u32 { self.restarts }
    pub fn max_restarts(&self) -> u32 { self.max_restarts }
    pub fn can_restart(&self) -> bool { self.restarts < self.max_restarts }

    /// spawn 子进程并健康检查；失败返回 false。
    pub async fn start(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
        match spawn(binary, cfg, settings) {
            Ok(mut c) => {
                let stderr = c.stderr.take();
                self.child = Some(c);
                let ok = health_check(cfg.port, &cfg.secret).await;
                (ok, if ok { stderr } else { None })
            }
            Err(_) => (false, None),
        }
    }

    /// 若子进程已退出且未超上限，则重启。
    pub async fn ensure_alive(&mut self, binary: &Path, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
        let dead = match self.child.as_mut() {
            None => true,
            Some(c) => match c.try_wait() {
                Ok(None) => false,
                _ => true,
            },
        };
        if dead {
            if !self.can_restart() { return (false, None); }
            self.restarts += 1;
            return self.start(binary, cfg, settings).await;
        }
        (true, None)
    }

    pub async fn restart(&mut self, binary: &Path, old_port: u16, old_secret: &str, cfg: &Aria2Config, settings: &Settings) -> (bool, Option<std::process::ChildStderr>) {
        self.shutdown(old_port, old_secret).await;
        self.restarts = 0;
        self.start(binary, cfg, settings).await
    }

    /// 优雅停：发 aria2.shutdown，等待 ≤5s，超时强杀。
    pub async fn shutdown(&mut self, port: u16, secret: &str) {
        let url = rpc_http_url(port);
        if let Ok(client) = reqwest::Client::builder().build() {
            let body = serde_json::json!({
                "jsonrpc":"2.0","id":1,"method":"aria2.shutdown",
                "params":[format!("token:{secret}")]
            });
            let _ = client.post(&url).json(&body).send().await;
        }
        if let Some(mut c) = self.child.take() {
            let start = std::time::Instant::now();
            while start.elapsed() < std::time::Duration::from_secs(5) {
                if c.try_wait().ok().flatten().is_some() { return; }
                tokio::time::sleep(std::time::Duration::from_millis(100)).await;
            }
            let _ = c.kill();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cfg() -> Aria2Config {
        Aria2Config {
            port: 50000,
            secret: "abc".into(),
            dir: PathBuf::from("/dl"),
            session: PathBuf::from("/s/session.gz"),
        }
    }

    #[test]
    fn build_args_enables_rpc_on_localhost() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--enable-rpc".to_string()));
        assert!(a.contains(&"--rpc-listen-all=false".to_string()));
        assert!(a.contains(&"--rpc-listen-port=50000".to_string()));
        assert!(a.contains(&"--rpc-allow-origin-all=true".to_string()));
    }

    #[test]
    fn build_args_sets_secret_dir_session() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--rpc-secret=abc".to_string()));
        assert!(a.contains(&"--dir=/dl".to_string()));
        assert!(a.contains(&"--continue=true".to_string()));
        assert!(a.contains(&"--input-file=/s/session.gz".to_string()));
        assert!(a.contains(&"--save-session=/s/session.gz".to_string()));
    }

    #[test]
    fn build_args_enables_resume_safety() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--auto-file-renaming=false".to_string()));
        assert!(a.contains(&"--allow-overwrite=true".to_string()));
    }

    #[tokio::test]
    #[ignore] // 需先运行 scripts/fetch-aria2.ps1
    async fn health_check_against_real_aria2() {
        let binary = concat!(env!("CARGO_MANIFEST_DIR"), "\\resources\\aria2c.exe");
        let cfg = Aria2Config {
            port: pick_free_port_for_test(),
            secret: "testsecret".into(),
            dir: std::env::temp_dir(),
            session: std::env::temp_dir().join("ap_test.session.gz"),
        };
        std::fs::write(&cfg.session, b"").expect("touch session");
        let _child = std::process::Command::new(binary)
            .args(build_args(&cfg))
            .spawn()
            .expect("spawn aria2c");
        let ok = tokio::time::timeout(
            std::time::Duration::from_secs(5),
            health_check(cfg.port, &cfg.secret),
        ).await.expect("health_check timed out");
        assert!(ok);
    }

    fn pick_free_port_for_test() -> u16 {
        std::net::TcpListener::bind("127.0.0.1:0")
            .unwrap().local_addr().unwrap().port()
    }

    #[test]
    fn supervisor_starts_with_zero_restarts() {
        let s = Supervisor::new();
        assert_eq!(s.restarts_count(), 0);
        assert_eq!(s.max_restarts(), 3);
    }

    #[test]
    fn supervisor_respects_max_restarts() {
        let mut s = Supervisor::new();
        s.restarts = 3; // 模拟已达上限
        assert!(!s.can_restart());
    }

    #[test]
    fn build_global_args_includes_concurrent_and_split() {
        use crate::settings::Settings;
        let s = Settings { max_concurrent_downloads: 3, split: 8, max_connection_per_server: 4, min_split_size: "10M".into(), max_overall_download_limit: "1M".into(), max_overall_upload_limit: "0".into(), all_proxy: "http://p:1".into(), ..Settings::default() };
        let a = build_global_args(&s);
        assert!(a.contains(&"--max-concurrent-downloads=3".to_string()));
        assert!(a.contains(&"--split=8".to_string()));
        assert!(a.contains(&"--max-connection-per-server=4".to_string()));
        assert!(a.contains(&"--min-split-size=10M".to_string()));
        assert!(a.contains(&"--max-overall-download-limit=1M".to_string()));
        assert!(a.contains(&"--all-proxy=http://p:1".to_string()));
    }

    #[test]
    fn build_global_args_omits_empty_proxy() {
        use crate::settings::Settings;
        let s = Settings::default();
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--all-proxy")));
    }
}
