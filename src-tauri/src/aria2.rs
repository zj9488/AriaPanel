use crate::secret::{generate_secret, pick_free_port};
use crate::settings::Settings;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};

#[cfg(windows)]
use std::os::windows::process::CommandExt;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;
use tauri::Manager;

#[derive(Clone)]
pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
    pub dht_file_path: PathBuf,
}

pub fn download_dir(data_dir: &Path, settings: &Settings) -> PathBuf {
    if settings.dir.is_empty() {
        data_dir.join("downloads")
    } else {
        PathBuf::from(&settings.dir)
    }
}

pub fn new_config(data_dir: &Path, settings: &Settings) -> Aria2Config {
    Aria2Config {
        port: pick_free_port(),
        secret: generate_secret(),
        dir: download_dir(data_dir, settings),
        session: data_dir.join("aria2.session.gz"),
        dht_file_path: data_dir.join("dht.dat"),
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
        "--save-session-interval=60".into(),
        format!("--dht-file-path={}", cfg.dht_file_path.display()),
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
    args.push(format!("--bt-max-peers={}", s.bt_max_peers));
    if s.seed_ratio > 0.0 {
        args.push(format!("--seed-ratio={}", s.seed_ratio));
    }
    if s.seed_time > 0 {
        args.push(format!("--seed-time={}", s.seed_time));
    }
    args.push(format!("--enable-dht={}", s.enable_dht));
    args.push(format!("--listen-port={}", s.bt_listen_port));
    args.push(format!("--dht-listen-port={}", s.dht_listen_port));
    if !s.bt_tracker.is_empty() {
        args.push(format!("--bt-tracker={}", s.bt_tracker));
    }
    args.push(format!("--bt-save-metadata={}", s.bt_save_metadata));
    args
}

pub fn rpc_http_url(port: u16) -> String {
    format!("http://127.0.0.1:{port}/jsonrpc")
}

/// 从 Content-Range 头（如 "bytes 0-0/137946130"）解析资源总大小。
pub fn parse_content_range_total(header: &str) -> Option<u64> {
    header.rsplit('/').next()?.trim().parse().ok()
}

/// 从 Content-Length 头读取大小。reqwest 的 content_length() 对 HEAD 响应
/// 返回的是 body size hint（恒为 0），必须直接读头。
fn header_len(resp: &reqwest::Response) -> Option<u64> {
    resp.headers()
        .get(reqwest::header::CONTENT_LENGTH)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()
}

/// 探测 URL 的资源大小：HEAD 跟随重定向取 Content-Length；
/// 无则回退 GET + Range 解析 Content-Range。None = 服务器未提供长度。
/// 非 2xx 一律报错——错误页的 Content-Length 不是资源大小（签名过期类网盘直链常见）。
pub async fn probe_url_length(url: &str) -> Result<Option<u64>, String> {
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AriaPanel")
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_err = String::new();
    if let Ok(resp) = client.head(url).send().await {
        if resp.status().is_success() {
            if let Some(len) = header_len(&resp) {
                return Ok(Some(len));
            }
        } else {
            last_err = format!("HTTP {}", resp.status());
        }
    } else {
        last_err = "network error".into();
    }
    let resp = client
        .get(url)
        .header(reqwest::header::RANGE, "bytes=0-0")
        .send()
        .await
        .map_err(|e| if last_err.is_empty() { e.to_string() } else { last_err.clone() })?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    if resp.status() == reqwest::StatusCode::PARTIAL_CONTENT {
        if let Some(cr) = resp.headers().get(reqwest::header::CONTENT_RANGE) {
            if let Some(total) = cr.to_str().ok().and_then(parse_content_range_total) {
                return Ok(Some(total));
            }
        }
    }
    Ok(header_len(&resp))
}

pub fn binary_path(app: &tauri::AppHandle) -> Option<PathBuf> {
    let name = if cfg!(windows) {
        "resources/aria2c.exe"
    } else {
        "resources/aria2c"
    };
    match app
        .path()
        .resolve(name, tauri::path::BaseDirectory::Resource)
    {
        Ok(p) if p.exists() => Some(p),
        _ => find_system_aria2c(),
    }
}

fn find_system_aria2c() -> Option<PathBuf> {
    let cmd = if cfg!(windows) { "aria2c.exe" } else { "aria2c" };
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(cmd);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub fn spawn(binary: &Path, cfg: &Aria2Config, settings: &Settings) -> std::io::Result<Child> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(binary) {
            let mut perms = meta.permissions();
            if perms.mode() & 0o111 == 0 {
                perms.set_mode(0o755);
                let _ = std::fs::set_permissions(binary, perms);
            }
        }
    }
    let mut cmd = Command::new(binary);
    cmd.args(build_args(cfg))
        .args(build_global_args(settings))
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.spawn()
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
    // 冷启动后杀软扫描/大会话加载可能超过 5 秒，放宽到 15 秒。
    for _ in 0..30 {
        if let Ok(resp) = client.post(&url).json(&body).send().await {
            if resp.status().is_success() {
                return true;
            }
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    false
}

/// 移除 aria2 内存中所有已完成/出错/已删除的结果，使其不被写入 session 文件。
/// 这样下次启动不会重载它们、也就不会重建 .aria2 控制文件。尽力而为，失败静默。
async fn purge_stopped_results(client: &reqwest::Client, url: &str, secret: &str) {
    let token = format!("token:{secret}");
    let list_body = serde_json::json!({
        "jsonrpc": "2.0", "id": 1, "method": "aria2.tellStopped",
        "params": [&token, 0, 1000, ["gid"]]
    });
    let gids: Vec<String> = match client.post(url).json(&list_body).send().await {
        Ok(r) => {
            let v: serde_json::Value = match r.json().await {
                Ok(v) => v,
                Err(_) => return,
            };
            v["result"]
                .as_array()
                .map(|a| a.iter().filter_map(|t| t["gid"].as_str().map(String::from)).collect())
                .unwrap_or_default()
        }
        Err(_) => return,
    };
    for gid in gids {
        let body = serde_json::json!({
            "jsonrpc": "2.0", "id": 1, "method": "aria2.removeDownloadResult",
            "params": [&token, gid]
        });
        let _ = client.post(url).json(&body).send().await;
    }
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
            None => {
                eprintln!("[recovery] no child tracked, treating as dead");
                true
            }
            Some(c) => {
                // 进程终止是异步的：stderr EOF（管道关闭）可能先于进程对象变为
                // signaled，立即 try_wait 会误判为存活。EOF 触发的恢复必须等它真正退出。
                let mut status = c.try_wait().ok().flatten();
                if status.is_none() {
                    let start = std::time::Instant::now();
                    while status.is_none() && start.elapsed() < std::time::Duration::from_secs(2) {
                        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
                        status = c.try_wait().ok().flatten();
                    }
                }
                status.is_some()
            }
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

    /// 优雅停：先清除已完成结果（避免 session 重载时重建 .aria2），再发 aria2.shutdown，等待 ≤5s，超时强杀。
    pub async fn shutdown(&mut self, port: u16, secret: &str) {
        let url = rpc_http_url(port);
        if let Ok(client) = reqwest::Client::builder().build() {
            purge_stopped_results(&client, &url, secret).await;
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

pub fn spawn_stderr_reader(
    stderr: std::process::ChildStderr,
    buffer: std::sync::Arc<crate::log_buffer::LogBuffer>,
    intentional_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
    on_eof: impl FnOnce() + Send + 'static,
) {
    std::thread::spawn(move || {
        use std::io::BufRead;
        let reader = std::io::BufReader::new(stderr);
        for line in reader.lines() {
            match line {
                Ok(l) => buffer.push(l),
                Err(_) => break,
            }
        }
        if !intentional_stop.load(std::sync::atomic::Ordering::Relaxed) {
            on_eof();
        }
    });
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
            dht_file_path: PathBuf::from("/s/dht.dat"),
        }
    }

    #[test]
    fn new_config_ignores_settings_rpc_fields() {
        let s = Settings::default();
        let a = new_config(Path::new("dummy"), &s);
        let b = new_config(Path::new("dummy"), &s);
        assert_ne!(a.port, b.port);
        assert_ne!(a.secret, b.secret);
    }

    #[test]
    fn parse_content_range_total() {
        assert_eq!(super::parse_content_range_total("bytes 0-0/137946130"), Some(137946130));
        assert_eq!(super::parse_content_range_total("bytes 0-0/*"), None);
        assert_eq!(super::parse_content_range_total("garbage"), None);
    }

    /// 起一个对每个请求都返回固定响应的本地 HTTP 服务器，返回端口。
    fn serve(status: &'static str, content_length: &'static str) -> u16 {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        std::thread::spawn(move || {
            for stream in listener.incoming() {
                use std::io::Write;
                let mut s = match stream {
                    Ok(s) => s,
                    Err(_) => break,
                };
                let mut buf = [0u8; 4096];
                let _ = std::io::Read::read(&mut s, &mut buf);
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Length: {content_length}\r\nConnection: close\r\n\r\n{body_placeholder}",
                    status = status,
                    content_length = content_length,
                    body_placeholder = "",
                );
                let _ = s.write_all(resp.as_bytes());
            }
        });
        port
    }

    #[test]
    fn probe_rejects_error_responses_instead_of_trusting_error_page_length() {
        // 模拟签名过期的网盘直链：403 + Content-Length: 13（"Link expired."）
        let port = serve("403 Forbidden", "13");
        let r = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(super::probe_url_length(&format!("http://127.0.0.1:{port}/f.rar")));
        assert!(r.is_err(), "expected Err for 403, got {r:?}");
    }

    #[test]
    fn probe_accepts_length_from_success_head() {
        let port = serve("200 OK", "137946130");
        let r = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(super::probe_url_length(&format!("http://127.0.0.1:{port}/f.rar")));
        assert_eq!(r.unwrap(), Some(137946130));
    }

    #[tokio::test]
    #[ignore] // 依赖外网
    async fn probe_github_via_api() {
        let url = "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip";
        let r = crate::github::parse_release_url(url).unwrap();
        let size = crate::github::api_asset_size(&r).await.unwrap();
        println!("github api size: {size:?}");
        assert_eq!(size, Some(2475379));
    }

    #[tokio::test]
    #[ignore] // 依赖外网与签名链接有效期
    async fn probe_116pan_url() {        let url = "https://pt-n2.116pan.xyz/2026/10/06/5fa9ccd9cf4c01a1c6b7d8b5beb86b6d.rar?sig=QAPPvhrSKsfZGnCJSaMx4MdjPzc3FSEIy3wpQz9-JXs&expires=1794994070000&dlname=S34.rar";
        let client = reqwest::Client::builder()
            .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AriaPanel")
            .build()
            .unwrap();
        let head = client.head(url).send().await.unwrap();
        println!("HEAD status={} len={:?}", head.status(), head.content_length());
        let body = head.text().await.unwrap_or_default();
        println!("HEAD body: {body:?}");
        let get = client.get(url).send().await.unwrap();
        println!("GET status={} len={:?}", get.status(), get.content_length());
        let getbody = get.text().await.unwrap_or_default();
        println!("GET body: {getbody:?}");
        let r = super::probe_url_length(url).await;
        println!("probe result: {r:?}");
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

    #[test]
    fn build_args_enables_periodic_session_save() {
        let a = build_args(&cfg());
        assert!(a.contains(&"--save-session-interval=60".to_string()));
        assert!(!a.iter().any(|x| x.starts_with("--force-save")));
    }

    #[tokio::test]
    #[ignore] // 需先运行 scripts/fetch-aria2.ps1
    async fn health_check_against_real_aria2() {
        let binary = if cfg!(windows) {
            concat!(env!("CARGO_MANIFEST_DIR"), "\\resources\\aria2c.exe")
        } else {
            concat!(env!("CARGO_MANIFEST_DIR"), "/resources/aria2c")
        };
        let cfg = Aria2Config {
            port: pick_free_port_for_test(),
            secret: "testsecret".into(),
            dir: std::env::temp_dir(),
            session: std::env::temp_dir().join("ap_test.session.gz"),
            dht_file_path: std::env::temp_dir().join("ap_test.dht.dat"),
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

    #[test]
    fn build_global_args_includes_bt_settings() {
        use crate::settings::Settings;
        let s = Settings {
            bt_max_peers: 100,
            seed_ratio: 1.5,
            seed_time: 60,
            enable_dht: true,
            bt_listen_port: "6881-6999".into(),
            dht_listen_port: "7000-7999".into(),
            bt_tracker: "http://t.example.com".into(),
            bt_save_metadata: true,
            ..Settings::default()
        };
        let a = build_global_args(&s);
        assert!(a.contains(&"--bt-max-peers=100".to_string()));
        assert!(a.contains(&"--seed-ratio=1.5".to_string()));
        assert!(a.contains(&"--seed-time=60".to_string()));
        assert!(a.contains(&"--enable-dht=true".to_string()));
        assert!(a.contains(&"--listen-port=6881-6999".to_string()));
        assert!(a.contains(&"--dht-listen-port=7000-7999".to_string()));
        assert!(a.contains(&"--bt-tracker=http://t.example.com".to_string()));
        assert!(a.contains(&"--bt-save-metadata=true".to_string()));
    }

    #[test]
    fn build_global_args_omits_zero_seed_time_and_ratio() {
        use crate::settings::Settings;
        let s = Settings {
            seed_ratio: 0.0,
            seed_time: 0,
            ..Settings::default()
        };
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--seed-ratio")));
        assert!(!a.iter().any(|x| x.starts_with("--seed-time")));
    }

    #[test]
    fn build_global_args_omits_empty_bt_tracker() {
        use crate::settings::Settings;
        let s = Settings::default();
        let a = build_global_args(&s);
        assert!(!a.iter().any(|x| x.starts_with("--bt-tracker")));
    }
}
