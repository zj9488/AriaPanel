use std::net::TcpListener;

/// 绑定 127.0.0.1:0 取一个空闲端口并立即释放（与 aria2c 绑定之间存在轻微竞态，可接受）。
pub fn pick_free_port() -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind 127.0.0.1:0 failed");
    listener.local_addr().expect("local_addr failed").port()
}

/// 生成 32 字节的十六进制 secret（64 字符），用作 aria2 RPC token。
pub fn generate_secret() -> String {
    let mut buf = [0u8; 32];
    getrandom::fill(&mut buf).expect("getrandom failed");
    buf.iter().map(|b| format!("{:02x}", b)).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pick_free_port_returns_ephemeral_port() {
        let p = pick_free_port();
        assert!(p > 0);
    }

    #[test]
    fn generate_secret_is_64_hex_chars() {
        let s = generate_secret();
        assert_eq!(s.len(), 64);
        assert!(s.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn generate_secret_is_unique() {
        assert_ne!(generate_secret(), generate_secret());
    }
}
