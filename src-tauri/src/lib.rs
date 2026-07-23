pub mod aria2;
pub mod settings;
pub mod commands;
pub mod secret;

use aria2::{binary_path, new_config, rpc_http_url};
use commands::{AppState, RpcEndpoint};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
            allow_exit: std::sync::atomic::AtomicBool::new(false),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let binary = match binary_path(&handle) {
                    Ok(p) => p,
                    Err(e) => { eprintln!("aria2 binary not found: {e}"); return; }
                };
                let data_dir = handle.path().app_data_dir().unwrap_or_default();
                let _ = std::fs::create_dir_all(&data_dir);
                let session = data_dir.join("aria2.session.gz");
                let _ = std::fs::write(&session, b"");
                let settings_path = settings::settings_path(&data_dir);
                let mut settings = settings::load_settings(&settings_path);
                let dir = if settings.dir.is_empty() { data_dir.join("downloads") } else { std::path::PathBuf::from(&settings.dir) };
                let _ = std::fs::create_dir_all(&dir);
                let cfg = new_config(dir, session, &settings);
                if settings.port.is_none() || settings.secret.is_none() {
                    settings.port = Some(cfg.port);
                    settings.secret = Some(cfg.secret.clone());
                    settings::save_to_disk(&settings_path, &settings);
                }
                let port = cfg.port;
                let secret = cfg.secret.clone();
                let st = match handle.try_state::<AppState>() { Some(s) => s, None => return };
                let ok = {
                    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
                    let result = sup.start(&binary, &cfg, &settings).await;
                    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
                    result
                };
                if ok {
                    if let Ok(mut g) = st.endpoint.lock() {
                        *g = Some(RpcEndpoint { url: rpc_http_url(port), secret: secret.clone(), dir: cfg.dir.display().to_string() });
                    }
                    if let Ok(mut p) = st.port.lock() { *p = Some(port); }
                    if let Ok(mut s) = st.secret.lock() { *s = Some(secret); }
                    let _ = handle.emit("aria2://started", ());
                } else {
                    let _ = handle.emit("aria2://failed", ());
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_rpc_endpoint,
            commands::get_settings,
            commands::save_settings,
            commands::open_folder,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(st) = app_handle.try_state::<AppState>() {
                let port = st.port.lock().ok().and_then(|g| *g);
                let secret = st.secret.lock().ok().and_then(|g| g.clone());
                if let (Some(port), Some(secret)) = (port, secret) {
                    let mut sup = st.supervisor.lock().unwrap();
                    tauri::async_runtime::block_on(sup.shutdown(port, &secret));
                }
            }
        }
    });
}
