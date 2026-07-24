use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub port: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none", default)]
    pub secret: Option<String>,
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
}

fn default_u32_5() -> u32 { 5 }
fn default_min_split() -> String { "20M".into() }
fn default_zero() -> String { "0".into() }
fn default_true() -> bool { true }

impl Default for Settings {
    fn default() -> Self {
        Self {
            port: None,
            secret: None,
            dir: String::new(),
            max_concurrent_downloads: 5,
            max_connection_per_server: 5,
            min_split_size: "20M".into(),
            split: 5,
            max_overall_download_limit: "0".into(),
            max_overall_upload_limit: "0".into(),
            all_proxy: String::new(),
            clipboard_watch: true,
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
    }

    #[test]
    fn serialize_deserialize_roundtrip() {
        let s = Settings { port: Some(6800), secret: Some("abc".into()), dir: "/dl".into(), ..Settings::default() };
        let json = serde_json::to_string(&s).unwrap();
        let back: Settings = serde_json::from_str(&json).unwrap();
        assert_eq!(s, back);
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
        let s = Settings { port: Some(6801), dir: "/x".into(), ..Settings::default() };
        save_to_disk(&path, &s);
        let loaded = load_settings(&path);
        assert_eq!(s, loaded);
        let _ = std::fs::remove_file(&path);
    }
}
