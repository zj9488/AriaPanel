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

#[derive(Serialize)]
pub struct SaveResult {
    pub restarted: bool,
    pub endpoint: Option<RpcEndpoint>,
}

pub struct AppState {
    pub endpoint: Mutex<Option<RpcEndpoint>>,
    pub port: Mutex<Option<u16>>,
    pub secret: Mutex<Option<String>>,
    pub supervisor: Mutex<crate::aria2::Supervisor>,
    pub allow_exit: AtomicBool,
    pub logs: std::sync::Arc<crate::log_buffer::LogBuffer>,
    pub intentional_stop: std::sync::Arc<std::sync::atomic::AtomicBool>,
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

#[tauri::command]
pub fn get_settings(app: tauri::AppHandle) -> Settings {
    let dir = app.path().app_data_dir().unwrap_or_default();
    crate::settings::load_settings(&crate::settings::settings_path(&dir))
}

#[tauri::command]
pub async fn save_settings(
    state: State<'_, AppState>,
    app: tauri::AppHandle,
    settings: Settings,
) -> Result<SaveResult, String> {
    let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let path = crate::settings::settings_path(&data_dir);
    let old = crate::settings::load_settings(&path);
    let needs_restart = settings.port != old.port || settings.secret != old.secret;
    crate::settings::save_to_disk(&path, &settings);

    if !needs_restart {
        return Ok(SaveResult { restarted: false, endpoint: None });
    }

    let binary = crate::aria2::binary_path(&app).map_err(|e| e.to_string())?;
    let session = data_dir.join("aria2.session.gz");
    let dir = if settings.dir.is_empty() { data_dir.join("downloads") } else { std::path::PathBuf::from(&settings.dir) };
    let cfg = crate::aria2::new_config(dir, session, &settings);
    let new_port = cfg.port;
    let new_secret = cfg.secret.clone();
    let new_dir = cfg.dir.display().to_string();

    let (old_port, old_secret) = {
        let p = state.port.lock().unwrap().clone();
        let s = state.secret.lock().unwrap().clone();
        (p, s)
    };

    let (ok, _stderr) = {
        let mut sup = std::mem::replace(&mut *state.supervisor.lock().unwrap(), crate::aria2::Supervisor::new());
        let result = if let (Some(op), Some(os)) = (old_port, old_secret.as_ref()) {
            sup.restart(&binary, op, os, &cfg, &settings).await
        } else {
            sup.start(&binary, &cfg, &settings).await
        };
        let _ = std::mem::replace(&mut *state.supervisor.lock().unwrap(), sup);
        result
    };

    if ok {
        *state.port.lock().unwrap() = Some(new_port);
        *state.secret.lock().unwrap() = Some(new_secret.clone());
        let ep = RpcEndpoint {
            url: crate::aria2::rpc_http_url(new_port),
            secret: new_secret.clone(),
            dir: new_dir.clone(),
        };
        *state.endpoint.lock().unwrap() = Some(ep.clone());
        let _ = app.emit("aria2://restarted", ep.clone());
        Ok(SaveResult { restarted: true, endpoint: Some(ep) })
    } else {
        Err("aria2 restart failed".into())
    }
}

#[tauri::command]
pub fn open_folder(path: String) {
    let p = std::path::Path::new(&path);
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
}
