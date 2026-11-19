use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default)]
    pub dir: String,
    #[serde(default = "default_u32_5")]
    pub max_concurrent_downloads: u32,
    #[serde(default = "default_u32_5")]
    pub max_connection_per_server: u32,
    #[serde(default = "default_min_split")]
    pub min_split_size: String,
    #[serde(default = "default_u32_5")]
    pub split: u32,
    #[serde(default = "default_zero")]
    pub max_overall_download_limit: String,
    #[serde(default = "default_zero")]
    pub max_overall_upload_limit: String,
    #[serde(default)]
    pub all_proxy: String,
    #[serde(default = "default_true")]
    pub clipboard_watch: bool,
    #[serde(default = "default_bt_max_peers")]
    pub bt_max_peers: u32,
    #[serde(default = "default_seed_ratio")]
    pub seed_ratio: f64,
    #[serde(default)]
    pub seed_time: u64,
    #[serde(default = "default_true")]
    pub enable_dht: bool,
    #[serde(default = "default_bt_listen_port")]
    pub bt_listen_port: String,
    #[serde(default = "default_bt_listen_port")]
    pub dht_listen_port: String,
    #[serde(default)]
    pub bt_tracker: String,
    #[serde(default)]
    pub bt_save_metadata: bool,
}

fn default_u32_5() -> u32 { 5 }
fn default_min_split() -> String { "20M".into() }
fn default_zero() -> String { "0".into() }
fn default_true() -> bool { true }
fn default_bt_max_peers() -> u32 { 55 }
fn default_seed_ratio() -> f64 { 1.0 }
fn default_bt_listen_port() -> String { "6881-6999".into() }

impl Default for Settings {
    fn default() -> Self {
        Self {
            dir: String::new(),
            max_concurrent_downloads: 5,
            max_connection_per_server: 5,
            min_split_size: "20M".into(),
            split: 5,
            max_overall_download_limit: "0".into(),
            max_overall_upload_limit: "0".into(),
            all_proxy: String::new(),
            clipboard_watch: true,
            bt_max_peers: 55,
            seed_ratio: 1.0,
            seed_time: 0,
            enable_dht: true,
            bt_listen_port: "6881-6999".into(),
            dht_listen_port: "6881-6999".into(),
            bt_tracker: String::new(),
            bt_save_metadata: false,
        }
    }
}

pub fn settings_path(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("settings.json")
}

pub fn load_settings(path: &Path) -> Settings {
    match std::fs::read_to_string(path) {
        Ok(s) => serde_json::from_str(&s).unwrap_or_default(),
        Err(_) => Settings::default(),
    }
}

pub fn save_to_disk(path: &Path, settings: &Settings) {
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    if let Ok(json) = serde_json::to_string_pretty(settings) {
        let _ = std::fs::write(path, json);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_settings() {
        let s = Settings::default();
        assert_eq!(s.max_concurrent_downloads, 5);
        assert_eq!(s.split, 5);
        assert_eq!(s.min_split_size, "20M");
        assert!(s.clipboard_watch);
        assert_eq!(s.all_proxy, "");
        assert_eq!(s.bt_max_peers, 55);
        assert_eq!(s.seed_ratio, 1.0);
        assert_eq!(s.seed_time, 0);
        assert!(s.enable_dht);
        assert_eq!(s.bt_listen_port, "6881-6999");
        assert_eq!(s.dht_listen_port, "6881-6999");
        assert_eq!(s.bt_tracker, "");
        assert!(!s.bt_save_metadata);
    }

    #[test]
    fn serialize_deserialize_roundtrip() {
        let s = Settings {
            dir: "/dl".into(),
            bt_max_peers: 100,
            seed_ratio: 1.5,
            bt_tracker: "http://t.example.com".into(),
            bt_save_metadata: true,
            ..Settings::default()
        };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
    }

    #[test]
    fn load_ignores_legacy_rpc_fields() {
        // 旧版本 settings.json 持久化了 port/secret，读取时必须忽略而不是解析失败。
        let legacy = r#"{"port": 64952, "secret": "d076", "dir": "D:\\Download", "split": 8}"#;
        let path = std::env::temp_dir().join("ap_test_legacy_settings.json");
        std::fs::write(&path, legacy).unwrap();
        let s = load_settings(&path);
        assert_eq!(s.dir, "D:\\Download");
        assert_eq!(s.split, 8);
        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_missing_file_returns_default() {
        let s = load_settings(Path::new("/nonexistent/path/settings.json"));
        assert_eq!(s.max_concurrent_downloads, 5);
    }

    #[test]
    fn save_and_load_roundtrip() {
        let dir = std::env::temp_dir();
        let path = dir.join("ap_test_settings.json");
        let s = Settings { dir: "/x".into(), ..Settings::default() };
        save_to_disk(&path, &s);
        let loaded = load_settings(&path);
        assert_eq!(s, loaded);
        let _ = std::fs::remove_file(&path);
    }
}
