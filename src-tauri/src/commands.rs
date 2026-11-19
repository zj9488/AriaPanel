use serde::Serialize;
use std::sync::atomic::AtomicBool;
use std::sync::Mutex;
use tauri::{Emitter, Manager, State};

use crate::settings::Settings;

#[derive(Serialize, Clone)]
pub struct RpcEndpoint {
    pub url: String,
    pub secret: String,
    pub dir: String,
}

pub struct AppState {
    pub endpoint: Mutex<Option<RpcEndpoint>>,
    pub port: Mutex<Option<u16>>,
    pub secret: Mutex<Option<String>>,
    pub cfg: Mutex<Option<crate::aria2::Aria2Config>>,
    pub supervisor: Mutex<crate::aria2::Supervisor>,
    pub allow_exit: AtomicBool,
    pub logs: std::sync::Arc<crate::log_buffer::LogBuffer>,
    pub intentional_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

/// 当前会话的 aria2 配置：优先用启动时生成的那份（端口/密钥每次启动随机生成，
/// 复用同一份才能保证崩溃恢复和手动重启不漂移）。
fn live_cfg(state: &AppState, app: &tauri::AppHandle) -> Option<crate::aria2::Aria2Config> {
    if let Some(c) = state.cfg.lock().ok().and_then(|g| g.clone()) {
        return Some(c);
    }
    let data_dir = app.path().app_data_dir().ok()?;
    let settings = crate::settings::load_settings(&crate::settings::settings_path(&data_dir));
    Some(crate::aria2::new_config(&data_dir, &settings))
}

/// 成功启动后把端点同步进 AppState，前端通过 get_rpc_endpoint 拿到的才是活配置。
fn publish_endpoint(state: &AppState, cfg: &crate::aria2::Aria2Config) {
    *state.cfg.lock().unwrap() = Some(cfg.clone());
    *state.port.lock().unwrap() = Some(cfg.port);
    *state.secret.lock().unwrap() = Some(cfg.secret.clone());
    *state.endpoint.lock().unwrap() = Some(RpcEndpoint {
        url: crate::aria2::rpc_http_url(cfg.port),
        secret: cfg.secret.clone(),
        dir: cfg.dir.display().to_string(),
    });
}

#[tauri::command]
pub fn get_rpc_endpoint(state: State<'_, AppState>) -> Option<RpcEndpoint> {
    state.endpoint.lock().ok().and_then(|g| g.clone())
}

#[tauri::command]
pub fn get_aria2_logs(state: State<'_, AppState>) -> Vec<String> {
    state.logs.snapshot()
}

#[tauri::command]
pub fn get_restarts_count(state: State<'_, AppState>) -> u32 {
    state.supervisor.lock().unwrap().restarts_count()
}

fn resolve_download_dir(app: &tauri::AppHandle) -> std::path::PathBuf {
    let data_dir = app.path().app_data_dir().unwrap_or_default();
    let settings = crate::settings::load_settings(&crate::settings::settings_path(&data_dir));
    crate::aria2::download_dir(&data_dir, &settings)
}

fn is_within(path: &std::path::Path, base: &std::path::Path) -> bool {
    match (path.canonicalize(), base.canonicalize()) {
        (Ok(p), Ok(b)) => p.starts_with(b),
        _ => false,
    }
}

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    let dir = app.path().app_data_dir().unwrap_or_default();
    crate::settings::load_settings(&crate::settings::settings_path(&dir))
}

#[tauri::command]
pub async fn save_settings(app: tauri::AppHandle, settings: Settings) -> Result<(), String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = crate::settings::settings_path(&data_dir);
    crate::settings::save_to_disk(&path, &settings);
    Ok(())
}

#[tauri::command]
pub async fn probe_url(url: String) -> Result<Option<u64>, String> {
    if !url.starts_with("http://") && !url.starts_with("https://") {
        return Err("not an http url".into());
    }
    // GitHub release 走 api.github.com 优先：github.com 主站在部分网络下不可达，
    // 而 API 域名通常可达且给出精确字节数。
    if let Some(rel) = crate::github::parse_release_url(&url) {
        if let Ok(Some(size)) = crate::github::api_asset_size(&rel).await {
            return Ok(Some(size));
        }
    }
    crate::aria2::probe_url_length(&url).await
}

#[tauri::command]
pub fn get_file_size(app: tauri::AppHandle, path: String) -> Result<u64, String> {
    let base = resolve_download_dir(&app);
    let p = std::path::Path::new(&path);
    if !is_within(p, &base) {
        return Err("path outside download dir".into());
    }
    std::fs::metadata(p).map(|m| m.len()).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn open_folder(app: tauri::AppHandle, path: String) {
    let p = std::path::Path::new(&path);
    if !p.exists() || !is_within(p, &resolve_download_dir(&app)) {
        return;
    }
    let dir = if p.is_dir() {
        p.to_path_buf()
    } else {
        p.parent().map(|parent| parent.to_path_buf()).unwrap_or_default()
    };
    if dir.as_os_str().is_empty() || !dir.is_dir() {
        return;
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        let dir_str = dir.display().to_string();
        if p.is_file() {
            let _ = std::process::Command::new("explorer.exe")
                .arg(format!("/select,{}", p.display()))
                .creation_flags(0x08000000)
                .spawn();
        } else {
            let _ = std::process::Command::new("explorer.exe")
                .arg(&dir_str)
                .creation_flags(0x08000000)
                .spawn();
        }
    }
    #[cfg(target_os = "macos")]
    {
        if p.is_file() {
            let _ = std::process::Command::new("open")
                .arg("-R")
                .arg(p)
                .spawn();
        } else {
            let _ = std::process::Command::new("open").arg(&dir).spawn();
        }
    }
    #[cfg(target_os = "linux")]
    {
        let _ = std::process::Command::new("xdg-open").arg(&dir).spawn();
    }
}

fn delete_task_files_impl(paths: &[String], base: &std::path::Path) -> Result<usize, String> {
    let mut deleted = 0;
    for path in paths {
        let p = std::path::Path::new(path);
        if !p.exists() {
            continue;
        }
        if !is_within(p, base) {
            continue;
        }
        if p.is_dir() {
            std::fs::remove_dir_all(p).map_err(|e| format!("{path}: {e}"))?;
        } else {
            std::fs::remove_file(p).map_err(|e| format!("{path}: {e}"))?;
        }
        deleted += 1;
    }
    Ok(deleted)
}

#[tauri::command]
pub fn delete_task_files(app: tauri::AppHandle, paths: Vec<String>) -> Result<usize, String> {
    let base = resolve_download_dir(&app);
    delete_task_files_impl(&paths, &base)
}

pub fn encode_file_base64(path: &str) -> Result<String, String> {
    let bytes = std::fs::read(path).map_err(|e| e.to_string())?;
    use base64::Engine;
    Ok(base64::engine::general_purpose::STANDARD.encode(&bytes))
}

#[tauri::command]
pub fn read_torrent_base64(path: String) -> Result<String, String> {
    if !path.to_ascii_lowercase().ends_with(".torrent") {
        return Err("not a .torrent file".into());
    }
    encode_file_base64(&path)
}

#[derive(serde::Deserialize)]
struct TorrentInfo {
    name: String,
    #[serde(default)]
    files: Option<Vec<RawTorrentFile>>,
    #[serde(default)]
    length: Option<u64>,
}

#[derive(serde::Deserialize)]
struct RawTorrentFile {
    path: Vec<String>,
    length: u64,
}

#[derive(serde::Deserialize)]
struct Torrent {
    info: TorrentInfo,
}

#[derive(serde::Serialize)]
pub struct ParsedTorrentFile {
    pub path: String,
    pub length: u64,
}

#[derive(serde::Serialize)]
pub struct ParsedTorrent {
    pub name: String,
    pub files: Vec<ParsedTorrentFile>,
}

#[tauri::command]
pub fn parse_torrent_files(b64: String) -> Result<ParsedTorrent, String> {
    use base64::Engine;
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(&b64)
        .map_err(|e| e.to_string())?;
    let torrent: Torrent = serde_bencode::from_bytes(&bytes).map_err(|e| format!("bencode: {e}"))?;
    let files = if let Some(raw_files) = torrent.info.files {
        raw_files
            .into_iter()
            .map(|f| ParsedTorrentFile {
                path: f.path.join("/"),
                length: f.length,
            })
            .collect()
    } else if let Some(length) = torrent.info.length {
        vec![ParsedTorrentFile {
            path: torrent.info.name.clone(),
            length,
        }]
    } else {
        return Err("missing file info".into());
    };
    Ok(ParsedTorrent {
        name: torrent.info.name,
        files,
    })
}

pub fn start_crash_recovery(handle: tauri::AppHandle) {
    let _ = handle.emit("aria2://crashed", ());
    tauri::async_runtime::spawn(async move {
        let st = match handle.try_state::<AppState>() {
            Some(s) => s,
            None => return,
        };
        let binary = match crate::aria2::binary_path(&handle) {
            Some(p) => p,
            None => {
                let _ = handle.emit("aria2://failed", ());
                return;
            }
        };
        let data_dir = match handle.path().app_data_dir() {
            Ok(d) => d,
            Err(_) => {
                let _ = handle.emit("aria2://failed", ());
                return;
            }
        };
        let settings_path = crate::settings::settings_path(&data_dir);
        let settings = crate::settings::load_settings(&settings_path);
        let cfg = match live_cfg(&st, &handle) {
            Some(c) => c,
            None => {
                let _ = handle.emit("aria2://failed", ());
                return;
            }
        };

        let (ok, stderr) = {
            let mut sup = std::mem::replace(
                &mut *st.supervisor.lock().unwrap(),
                crate::aria2::Supervisor::new(),
            );
            let result = sup.ensure_alive(&binary, &cfg, &settings).await;
            let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
            result
        };

        if ok {
            if let Some(stderr) = stderr {
                let logs = st.logs.clone();
                let is = st.intentional_stop.clone();
                let h = handle.clone();
                crate::aria2::spawn_stderr_reader(stderr, logs, is, move || {
                    start_crash_recovery(h);
                });
            }
            publish_endpoint(&st, &cfg);
            let _ = handle.emit("aria2://restarted", ());
        } else {
            let _ = handle.emit("aria2://failed", ());
        }
    });
}

#[tauri::command]
pub async fn restart_aria2(state: State<'_, AppState>, app: tauri::AppHandle) -> Result<(), String> {
    state.intentional_stop.store(true, std::sync::atomic::Ordering::Relaxed);

    let (old_port, old_secret) = {
        let p = state.port.lock().unwrap().clone();
        let s = state.secret.lock().unwrap().clone();
        (p, s)
    };

    {
        let mut sup = std::mem::replace(
            &mut *state.supervisor.lock().unwrap(),
            crate::aria2::Supervisor::new(),
        );
        if let (Some(p), Some(s)) = (old_port, old_secret.as_ref()) {
            sup.shutdown(p, s).await;
        }
        sup.restarts = 0;
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
    }

    let binary = crate::aria2::binary_path(&app).ok_or("aria2 binary not found")?;
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let settings_path = crate::settings::settings_path(&data_dir);
    let settings = crate::settings::load_settings(&settings_path);
    let cfg = live_cfg(&state, &app).ok_or("aria2 config unavailable")?;

    let (ok, stderr) = {
        let mut sup = std::mem::replace(
            &mut *state.supervisor.lock().unwrap(),
            crate::aria2::Supervisor::new(),
        );
        let result = sup.start(&binary, &cfg, &settings).await;
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
        result
    };

    state.intentional_stop.store(false, std::sync::atomic::Ordering::Relaxed);

    if ok {
        if let Some(stderr) = stderr {
            let logs = state.logs.clone();
            let is = state.intentional_stop.clone();
            let h = app.clone();
            crate::aria2::spawn_stderr_reader(stderr, logs, is, move || {
                start_crash_recovery(h);
            });
        }
        publish_endpoint(&state, &cfg);
        let _ = app.emit("aria2://restarted", ());
        Ok(())
    } else {
        let _ = app.emit("aria2://failed", ());
        Err("aria2 restart failed".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn encode_file_base64_reads_file() {
        let dir = std::env::temp_dir();
        let path = dir.join("ap_test.torrent");
        std::fs::write(&path, b"d6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:").unwrap();
        let result = encode_file_base64(path.to_str().unwrap());
        assert!(result.is_ok());
        let b64 = result.unwrap();
        use base64::Engine;
        let decoded = base64::engine::general_purpose::STANDARD.decode(&b64).unwrap();
        assert_eq!(decoded, b"d6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:");
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn encode_file_base64_missing_file_returns_err() {
        let result = encode_file_base64("/nonexistent/path/file.torrent");
        assert!(result.is_err());
    }

    #[test]
    fn parse_torrent_files_single_file() {
        let bencode = b"d4:infod6:lengthi100e4:name8:testfile12:piece lengthi16384e6:pieces20:AAAAAAAAAAAAAAAAAAAAee";
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bencode);
        let result = parse_torrent_files(b64);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.name, "testfile");
        assert_eq!(parsed.files.len(), 1);
        assert_eq!(parsed.files[0].path, "testfile");
        assert_eq!(parsed.files[0].length, 100);
    }

    #[test]
    fn parse_torrent_files_multi_file() {
        let bencode = b"d4:infod5:filesld6:lengthi100e4:pathl5:file1eed6:lengthi200e4:pathl3:sub5:file2eee4:name4:test12:piece lengthi16384e6:pieces20:AAAAAAAAAAAAAAAAAAAAee";
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(bencode);
        let result = parse_torrent_files(b64);
        assert!(result.is_ok());
        let parsed = result.unwrap();
        assert_eq!(parsed.name, "test");
        assert_eq!(parsed.files.len(), 2);
        assert_eq!(parsed.files[0].path, "file1");
        assert_eq!(parsed.files[0].length, 100);
        assert_eq!(parsed.files[1].path, "sub/file2");
        assert_eq!(parsed.files[1].length, 200);
    }

    #[test]
    fn parse_torrent_files_invalid_b64() {
        let result = parse_torrent_files("!!!not-base64!!!".to_string());
        assert!(result.is_err());
    }

    #[test]
    fn parse_torrent_files_invalid_bencode() {
        use base64::Engine;
        let b64 = base64::engine::general_purpose::STANDARD.encode(b"not valid bencode");
        let result = parse_torrent_files(b64);
        assert!(result.is_err());
    }

    #[test]
    fn delete_task_files_removes_existing_files() {
        let dir = std::env::temp_dir();
        let f1 = dir.join("ap_del_test1.bin");
        let f2 = dir.join("ap_del_test2.bin");
        std::fs::write(&f1, b"data1").unwrap();
        std::fs::write(&f2, b"data2").unwrap();
        let result = delete_task_files_impl(
            &[f1.to_string_lossy().to_string(), f2.to_string_lossy().to_string()],
            &dir,
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 2);
        assert!(!f1.exists());
        assert!(!f2.exists());
    }

    #[test]
    fn delete_task_files_skips_nonexistent() {
        let result = delete_task_files_impl(
            &["/nonexistent/ap_skip_test.bin".to_string()],
            &std::env::temp_dir(),
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 0);
    }

    #[test]
    fn delete_task_files_removes_directory() {
        let dir = std::env::temp_dir().join("ap_del_test_dir");
        std::fs::create_dir_all(&dir).unwrap();
        std::fs::write(dir.join("inner.bin"), b"data").unwrap();
        let result = delete_task_files_impl(&[dir.to_string_lossy().to_string()], &std::env::temp_dir());
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);
        assert!(!dir.exists());
    }

    #[test]
    fn delete_task_files_skips_paths_outside_base() {
        let base = std::env::temp_dir().join("ap_containment_base");
        std::fs::create_dir_all(&base).unwrap();
        let outside = std::env::temp_dir().join("ap_containment_outside.bin");
        let inside = base.join("inside.bin");
        std::fs::write(&outside, b"x").unwrap();
        std::fs::write(&inside, b"y").unwrap();
        let result = delete_task_files_impl(
            &[outside.to_string_lossy().to_string(), inside.to_string_lossy().to_string()],
            &base,
        );
        assert!(result.is_ok());
        assert_eq!(result.unwrap(), 1);
        assert!(outside.exists());
        assert!(!inside.exists());
        let _ = std::fs::remove_file(&outside);
        let _ = std::fs::remove_dir_all(&base);
    }
}
