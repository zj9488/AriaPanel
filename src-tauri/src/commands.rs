use serde::Serialize;
use std::sync::Mutex;
use tauri::State;

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
    pub supervisor: Mutex<crate::aria2::Supervisor>,
}

#[tauri::command]
pub fn get_rpc_endpoint(state: State<'_, AppState>) -> Option<RpcEndpoint> {
    state.endpoint.lock().ok().and_then(|g| g.clone())
}
