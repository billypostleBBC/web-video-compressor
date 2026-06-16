use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{AppHandle, Manager};

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolResult {
    pub ok: bool,
    pub ffmpeg_path: Option<String>,
    pub message: String,
}

pub fn resolve_binary(name: &str, resources_path: Option<PathBuf>) -> Option<PathBuf> {
    let mut path_candidates = Vec::new();

    if let Some(resources_path) = resources_path {
        path_candidates.push(resources_path.join("bin").join(name));
    }

    path_candidates.extend([
        PathBuf::from(format!("/opt/homebrew/bin/{name}")),
        PathBuf::from(format!("/usr/local/bin/{name}")),
        PathBuf::from(format!("/usr/bin/{name}")),
    ]);

    for candidate in path_candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }

    Command::new("which")
        .arg(name)
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| {
            let resolved = String::from_utf8_lossy(&output.stdout).trim().to_string();
            if resolved.is_empty() {
                None
            } else {
                Some(Path::new(&resolved).to_path_buf())
            }
        })
}

pub fn check_tools_for_resources(resources_path: Option<PathBuf>) -> ToolResult {
    match resolve_binary("ffmpeg", resources_path) {
        Some(ffmpeg_path) => {
            let ffmpeg_path = ffmpeg_path.to_string_lossy().to_string();
            ToolResult {
                ok: true,
                message: format!("Using ffmpeg at {ffmpeg_path}"),
                ffmpeg_path: Some(ffmpeg_path),
            }
        }
        None => ToolResult {
            ok: false,
            ffmpeg_path: None,
            message: "ffmpeg is required. Rebuild the app with bundled tools or install ffmpeg with Homebrew."
                .to_string(),
        },
    }
}

pub fn check_tools(app: &AppHandle) -> ToolResult {
    check_tools_for_resources(app.path().resource_dir().ok())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn resolve_binary_prefers_bundled_resources() {
        let root = tempfile::tempdir().unwrap();
        let bin = root.path().join("bin");
        fs::create_dir(&bin).unwrap();
        let bundled = bin.join("ffmpeg");
        fs::write(&bundled, "").unwrap();

        assert_eq!(
            resolve_binary("ffmpeg", Some(root.path().to_path_buf())),
            Some(bundled)
        );
    }
}
