use crate::secret::{generate_secret, pick_free_port};
use std::path::PathBuf;

pub struct Aria2Config {
    pub port: u16,
    pub secret: String,
    pub dir: PathBuf,
    pub session: PathBuf,
}

pub fn new_config(dir: PathBuf, session: PathBuf) -> Aria2Config {
    Aria2Config {
        port: pick_free_port(),
        secret: generate_secret(),
        dir,
        session,
    }
}

pub fn build_args(cfg: &Aria2Config) -> Vec<String> {
    vec![
        "--enable-rpc".into(),
        "--rpc-listen-all=false".into(),
        "--rpc-allow-origin-all=false".into(),
        format!("--rpc-listen-port={}", cfg.port),
        format!("--rpc-secret={}", cfg.secret),
        format!("--dir={}", cfg.dir.display()),
        "--continue=true".into(),
        "--file-allocation=none".into(),
        format!("--input-file={}", cfg.session.display()),
        format!("--save-session={}", cfg.session.display()),
        "--quiet=true".into(),
    ]
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
        assert!(a.contains(&"--rpc-allow-origin-all=false".to_string()));
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
}
