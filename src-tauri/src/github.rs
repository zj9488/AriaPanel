use serde::Deserialize;

pub struct GithubReleaseRef {
    pub owner: String,
    pub repo: String,
    pub tag: String,
    pub filename: String,
}

/// 解析 github.com/{owner}/{repo}/releases/download/{tag}/{filename} 形式的链接。
/// tag 可含斜杠；文件名做百分号解码。
pub fn parse_release_url(url: &str) -> Option<GithubReleaseRef> {
    let rest = url
        .strip_prefix("https://github.com/")
        .or_else(|| url.strip_prefix("http://github.com/"))?;
    let mut segs = rest.split('/');
    let owner = segs.next()?;
    let repo = segs.next()?;
    if owner.is_empty() || repo.is_empty() || segs.next()? != "releases" || segs.next()? != "download" {
        return None;
    }
    let tail: Vec<&str> = segs.filter(|s| !s.is_empty()).collect();
    if tail.len() < 2 {
        return None;
    }
    let filename = percent_decode(tail.last()?);
    let tag = tail[..tail.len() - 1].join("/");
    Some(GithubReleaseRef {
        owner: owner.into(),
        repo: repo.into(),
        tag,
        filename,
    })
}

fn percent_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 3 <= bytes.len() {
            if let Some(h) = bytes.get(i + 1..i + 3) {
                if let Ok(v) = u8::from_str_radix(std::str::from_utf8(h).unwrap_or(""), 16) {
                    out.push(v);
                    i += 3;
                    continue;
                }
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn percent_encode_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        let safe = b.is_ascii_alphanumeric() || matches!(b, b'-' | b'.' | b'_' | b'~');
        if safe {
            out.push(b as char);
        } else {
            out.push_str(&format!("%{b:02X}"));
        }
    }
    out
}

fn parse_asset_size(json: &str, filename: &str) -> Option<u64> {
    let v: serde_json::Value = serde_json::from_str(json).ok()?;
    v.get("assets")?
        .as_array()?
        .iter()
        .find(|a| a.get("name").and_then(|n| n.as_str()) == Some(filename))
        .and_then(|a| a.get("size"))
        .and_then(|s| s.as_u64())
}

#[derive(Deserialize)]
struct ApiAsset {
    name: String,
    size: u64,
}

#[derive(Deserialize)]
struct ApiRelease {
    assets: Vec<ApiAsset>,
}

/// 通过 api.github.com（与 github.com 主站不同基础设施，封锁环境下通常可达）
/// 查询 release 资产的精确字节数。未认证限流 60 次/小时/IP。
pub async fn api_asset_size(rel: &GithubReleaseRef) -> Result<Option<u64>, String> {
    let tag = percent_encode_segment(&rel.tag);
    let url = format!("https://api.github.com/repos/{}/{}/releases/tags/{}", rel.owner, rel.repo, tag);
    let client = reqwest::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(5))
        .timeout(std::time::Duration::from_secs(10))
        .user_agent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AriaPanel")
        .build()
        .map_err(|e| e.to_string())?;
    let resp = client
        .get(&url)
        .header("Accept", "application/vnd.github+json")
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let release: ApiRelease = resp.json().await.map_err(|e| e.to_string())?;
    Ok(release.assets.into_iter().find(|a| a.name == rel.filename).map(|a| a.size))
}

#[cfg(test)]
mod tests {    use super::*;

    #[test]
    fn parse_release_url_standard() {
        let r = parse_release_url(
            "https://github.com/aria2/aria2/releases/download/release-1.37.0/aria2-1.37.0-win-64bit-build1.zip",
        )
        .unwrap();
        assert_eq!(r.owner, "aria2");
        assert_eq!(r.repo, "aria2");
        assert_eq!(r.tag, "release-1.37.0");
        assert_eq!(r.filename, "aria2-1.37.0-win-64bit-build1.zip");
    }

    #[test]
    fn parse_release_url_decodes_filename() {
        let r = parse_release_url("https://github.com/o/r/releases/download/v1/a%20b.zip").unwrap();
        assert_eq!(r.filename, "a b.zip");
    }

    #[test]
    fn parse_release_url_tag_with_slash() {
        let r = parse_release_url("https://github.com/o/r/releases/download/v1/beta/app.exe").unwrap();
        assert_eq!(r.tag, "v1/beta");
        assert_eq!(r.filename, "app.exe");
    }

    #[test]
    fn parse_release_url_rejects_non_release_or_non_github() {
        assert!(parse_release_url("https://github.com/o/r").is_none());
        assert!(parse_release_url("https://github.com/o/r/releases").is_none());
        assert!(parse_release_url("https://pt-n2.116pan.xyz/a.rar").is_none());
        assert!(parse_release_url("magnet:?xt=urn:btih:xyz").is_none());
    }

    #[test]
    fn percent_decode_and_encode() {
        assert_eq!(percent_decode("a%20b.zip"), "a b.zip");
        assert_eq!(percent_decode("plain"), "plain");
        assert_eq!(percent_decode("bad%zz"), "bad%zz");
        assert_eq!(percent_decode("%E4%B8%AD.zip"), "中.zip");
        assert_eq!(percent_encode_segment("v1/beta"), "v1%2Fbeta");
        assert_eq!(percent_encode_segment("release-1.37.0"), "release-1.37.0");
    }

    #[test]
    fn parse_asset_size_finds_matching_asset() {
        let json = r#"{"assets":[{"name":"other.zip","size":1},{"name":"app.zip","size":2475379}]}"#;
        assert_eq!(parse_asset_size(json, "app.zip"), Some(2475379));
        assert_eq!(parse_asset_size(json, "missing.zip"), None);
        assert_eq!(parse_asset_size("not json", "app.zip"), None);
    }
}
