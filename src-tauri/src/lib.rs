pub mod aria2;
pub mod commands;
pub mod secret;

use aria2::{binary_path, new_config, rpc_http_url};
use commands::{AppState, RpcEndpoint};
use std::sync::Mutex;
use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
        })
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let binary = match binary_path(&handle) {
                    Ok(p) => p,
                    Err(e) => { eprintln!("aria2 binary not found: {e}"); return; }
                };
                let dir = handle.path().app_data_dir().unwrap_or_default();
                let session = dir.join("aria2.session.gz");
                let _ = std::fs::create_dir_all(&dir);
                let _ = std::fs::write(&session, b"");
                let cfg = new_config(dir, session);
                let port = cfg.port;
                let secret = cfg.secret.clone();
                let st = match handle.try_state::<AppState>() { Some(s) => s, None => return };
                let ok = {
                    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
                    let result = sup.start(&binary, &cfg).await;
                    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
                    result
                };
                if ok {
                    if let Ok(mut g) = st.endpoint.lock() {
                        *g = Some(RpcEndpoint { url: rpc_http_url(port), secret: secret.clone() });
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
        .invoke_handler(tauri::generate_handler![commands::get_rpc_endpoint])
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
