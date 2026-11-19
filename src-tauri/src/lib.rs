pub mod aria2;
pub mod settings;
pub mod commands;
pub mod secret;
pub mod log_buffer;

use aria2::{binary_path, new_config, rpc_http_url};
use commands::{AppState, RpcEndpoint};
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tauri::{Emitter, Manager};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri_plugin_window_state::{AppHandleExt, StateFlags};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let save_debounce: Arc<Mutex<Option<tauri::async_runtime::JoinHandle<()>>>> =
        Arc::new(Mutex::new(None));
    let state_flags = StateFlags::all() - StateFlags::VISIBLE;
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .with_state_flags(state_flags)
                .build(),
        )
        .on_window_event(move |window, event| {
            match event {
                tauri::WindowEvent::CloseRequested { api, .. } => {
                    let allow = window.app_handle().try_state::<AppState>()
                        .map(|s| s.allow_exit.load(std::sync::atomic::Ordering::Relaxed))
                        .unwrap_or(false);
                    if !allow {
                        let _ = window.hide();
                        api.prevent_close();
                    }
                }
                tauri::WindowEvent::Resized(_) | tauri::WindowEvent::Moved(_) => {
                    let mut d = save_debounce.lock().unwrap();
                    if let Some(h) = d.take() {
                        h.abort();
                    }
                    let ah = window.app_handle().clone();
                    let flags = state_flags;
                    *d = Some(tauri::async_runtime::spawn(async move {
                        tokio::time::sleep(Duration::from_millis(500)).await;
                        let _ = ah.save_window_state(flags);
                    }));
                }
                _ => {}
            }
        })
        .manage(AppState {
            endpoint: Mutex::new(None),
            port: Mutex::new(None),
            secret: Mutex::new(None),
            cfg: Mutex::new(None),
            supervisor: Mutex::new(aria2::Supervisor::new()),
            allow_exit: std::sync::atomic::AtomicBool::new(false),
            logs: log_buffer::LogBuffer::new(200),
            intentional_stop: std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false)),
        })
        .setup(|app| {
            let show_i = MenuItem::with_id(app, "tray_show", "显示主窗口", true, None::<&str>)?;
            let pause_i = MenuItem::with_id(app, "tray_pause", "全部暂停", true, None::<&str>)?;
            let resume_i = MenuItem::with_id(app, "tray_resume", "全部继续", true, None::<&str>)?;
            let sep = PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItem::with_id(app, "tray_quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &pause_i, &resume_i, &sep, &quit_i])?;
            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().cloned().ok_or("no icon")?)
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "tray_show" => {
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                    "tray_pause" => { let _ = app.emit("tray://pause-all", ()); }
                    "tray_resume" => { let _ = app.emit("tray://resume-all", ()); }
                    "tray_quit" => {
                        if let Some(s) = app.try_state::<AppState>() {
                            s.allow_exit.store(true, std::sync::atomic::Ordering::Relaxed);
                        }
                        if let Some(w) = app.get_webview_window("main") { let _ = w.close(); }
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = event {
                        let app = tray.app_handle();
                        if let Some(w) = app.get_webview_window("main") { let _ = w.show(); let _ = w.set_focus(); }
                    }
                })
                .build(app)?;

            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                let binary = match binary_path(&handle) {
                    Some(p) => p,
                    None => {
                        eprintln!("aria2 binary not found");
                        return;
                    }
                };
                let data_dir = handle.path().app_data_dir().unwrap_or_default();
                let _ = std::fs::create_dir_all(&data_dir);
                let settings_path = settings::settings_path(&data_dir);
                let settings = settings::load_settings(&settings_path);
                let cfg = new_config(&data_dir, &settings);
                if !cfg.session.exists() {
                    let _ = std::fs::write(&cfg.session, b"");
                }
                let _ = std::fs::create_dir_all(&cfg.dir);
                let port = cfg.port;
                let secret = cfg.secret.clone();
                let st = match handle.try_state::<AppState>() { Some(s) => s, None => return };
                *st.cfg.lock().unwrap() = Some(cfg.clone());
                let (ok, stderr) = {
                    let mut sup = std::mem::replace(&mut *st.supervisor.lock().unwrap(), aria2::Supervisor::new());
                    let result = sup.start(&binary, &cfg, &settings).await;
                    let _ = std::mem::replace(&mut *st.supervisor.lock().unwrap(), sup);
                    result
                };
                if ok {
                    if let Some(stderr) = stderr {
                        let logs = st.logs.clone();
                        let is = st.intentional_stop.clone();
                        let h = handle.clone();
                        aria2::spawn_stderr_reader(stderr, logs, is, move || {
                            commands::start_crash_recovery(h);
                        });
                    }
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
            commands::get_aria2_logs,
            commands::get_restarts_count,
            commands::restart_aria2,
            commands::read_torrent_base64,
            commands::parse_torrent_files,
            commands::delete_task_files,
            commands::probe_url,
            commands::get_file_size,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let tauri::RunEvent::ExitRequested { .. } = event {
            if let Some(st) = app_handle.try_state::<AppState>() {
                st.intentional_stop.store(true, std::sync::atomic::Ordering::Relaxed);
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
