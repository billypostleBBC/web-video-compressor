use std::ffi::OsStr;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

pub const ACCEPTED_EXTENSIONS: [&str; 2] = [".mov", ".mp4"];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct Target {
    pub key: &'static str,
    pub width: u32,
    pub height: u32,
}

pub const TARGETS: [Target; 3] = [
    Target {
        key: "1080p",
        width: 1920,
        height: 1080,
    },
    Target {
        key: "720p",
        width: 1280,
        height: 720,
    },
    Target {
        key: "480p",
        width: 854,
        height: 480,
    },
];

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct QualityPreset {
    pub key: &'static str,
    pub label: &'static str,
    pub mp4_crf: u8,
    pub webm_crf: u8,
}

pub const QUALITY_PRESET_LOW: QualityPreset = QualityPreset {
    key: "low",
    label: "Low",
    mp4_crf: 34,
    webm_crf: 46,
};

pub const QUALITY_PRESET_MEDIUM: QualityPreset = QualityPreset {
    key: "medium",
    label: "Medium",
    mp4_crf: 30,
    webm_crf: 42,
};

pub const QUALITY_PRESET_HIGH: QualityPreset = QualityPreset {
    key: "high",
    label: "High",
    mp4_crf: 26,
    webm_crf: 36,
};

pub const QUALITY_PRESETS: [QualityPreset; 3] = [
    QUALITY_PRESET_LOW,
    QUALITY_PRESET_MEDIUM,
    QUALITY_PRESET_HIGH,
];

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum Selection {
    File { path: PathBuf },
    Files { paths: Vec<PathBuf> },
    Folder { path: PathBuf },
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub enum JobKind {
    Mp4,
    Webm,
    Poster,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct ExportJob {
    pub kind: JobKind,
    pub label: String,
    pub input_path: PathBuf,
    pub output_path: PathBuf,
    pub args: Vec<String>,
    pub fallback_args: Option<Vec<String>>,
}

pub fn quality_preset(quality_key: &str) -> QualityPreset {
    QUALITY_PRESETS
        .iter()
        .find(|preset| preset.key == quality_key)
        .copied()
        .unwrap_or(QUALITY_PRESET_MEDIUM)
}

pub fn is_supported_video_file(file_path: impl AsRef<Path>) -> bool {
    let Some(extension) = file_path.as_ref().extension().and_then(OsStr::to_str) else {
        return false;
    };

    ACCEPTED_EXTENSIONS
        .iter()
        .any(|accepted| extension.eq_ignore_ascii_case(&accepted[1..]))
}

pub fn list_input_videos(selection: &Selection) -> io::Result<Vec<PathBuf>> {
    match selection {
        Selection::Files { paths } => Ok(paths
            .iter()
            .filter(|path| is_supported_video_file(path))
            .cloned()
            .collect()),
        Selection::File { path } => Ok(if is_supported_video_file(path) {
            vec![path.clone()]
        } else {
            Vec::new()
        }),
        Selection::Folder { path } => {
            let mut videos = Vec::new();

            for entry_result in fs::read_dir(path)? {
                let entry = entry_result?;
                if entry.file_type()?.is_file() {
                    let entry_path = entry.path();
                    if is_supported_video_file(&entry_path) {
                        videos.push(entry_path);
                    }
                }
            }

            videos.sort_by(|left, right| {
                let left_name = left.file_name().unwrap_or_default().to_string_lossy();
                let right_name = right.file_name().unwrap_or_default().to_string_lossy();
                left_name.as_ref().cmp(right_name.as_ref())
            });
            Ok(videos)
        }
    }
}

pub fn output_dir_for_selection(selection: &Selection) -> Option<PathBuf> {
    match selection {
        Selection::Folder { path } => Some(path.join("web-video-exports")),
        Selection::Files { paths } => paths
            .first()
            .and_then(|path| path.parent())
            .map(|parent| parent.join("web-video-exports")),
        Selection::File { path } => path.parent().map(|parent| parent.join("web-video-exports")),
    }
}

pub fn video_filter(width: u32, height: u32) -> String {
    [
        format!("scale={width}:{height}:force_original_aspect_ratio=decrease"),
        format!("pad={width}:{height}:(ow-iw)/2:(oh-ih)/2"),
        "setsar=1".to_string(),
    ]
    .join(",")
}

pub fn build_mp4_args(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    width: u32,
    height: u32,
    quality: QualityPreset,
) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        path_to_string(input_path),
        "-vf".to_string(),
        video_filter(width, height),
        "-c:v".to_string(),
        "libx264".to_string(),
        "-preset".to_string(),
        "medium".to_string(),
        "-crf".to_string(),
        quality.mp4_crf.to_string(),
        "-pix_fmt".to_string(),
        "yuv420p".to_string(),
        "-movflags".to_string(),
        "+faststart".to_string(),
        "-c:a".to_string(),
        "aac".to_string(),
        "-b:a".to_string(),
        "160k".to_string(),
        path_to_string(output_path),
    ]
}

pub fn build_webm_args(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    width: u32,
    height: u32,
    quality: QualityPreset,
) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-i".to_string(),
        path_to_string(input_path),
        "-vf".to_string(),
        video_filter(width, height),
        "-c:v".to_string(),
        "libvpx-vp9".to_string(),
        "-b:v".to_string(),
        "0".to_string(),
        "-crf".to_string(),
        quality.webm_crf.to_string(),
        "-row-mt".to_string(),
        "1".to_string(),
        "-c:a".to_string(),
        "libopus".to_string(),
        "-b:a".to_string(),
        "128k".to_string(),
        path_to_string(output_path),
    ]
}

pub fn build_poster_args(
    input_path: impl AsRef<Path>,
    output_path: impl AsRef<Path>,
    timestamp_seconds: u32,
) -> Vec<String> {
    vec![
        "-y".to_string(),
        "-ss".to_string(),
        timestamp_seconds.to_string(),
        "-i".to_string(),
        path_to_string(input_path),
        "-vf".to_string(),
        video_filter(1920, 1080),
        "-frames:v".to_string(),
        "1".to_string(),
        "-q:v".to_string(),
        "2".to_string(),
        path_to_string(output_path),
    ]
}

pub fn build_export_plan(
    input_path: impl AsRef<Path>,
    output_dir: impl AsRef<Path>,
    quality_key: &str,
) -> Vec<ExportJob> {
    let input_path = input_path.as_ref();
    let output_dir = output_dir.as_ref();
    let quality = quality_preset(quality_key);
    let name = input_path
        .file_stem()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    let mut jobs = Vec::new();

    for target in TARGETS {
        let mp4_output = output_dir.join(format!("{name}-{}.mp4", target.key));
        jobs.push(ExportJob {
            kind: JobKind::Mp4,
            label: format!("{} MP4", target.key),
            input_path: input_path.to_path_buf(),
            output_path: mp4_output.clone(),
            args: build_mp4_args(
                input_path,
                &mp4_output,
                target.width,
                target.height,
                quality,
            ),
            fallback_args: None,
        });

        let webm_output = output_dir.join(format!("{name}-{}.webm", target.key));
        jobs.push(ExportJob {
            kind: JobKind::Webm,
            label: format!("{} WebM", target.key),
            input_path: input_path.to_path_buf(),
            output_path: webm_output.clone(),
            args: build_webm_args(
                input_path,
                &webm_output,
                target.width,
                target.height,
                quality,
            ),
            fallback_args: None,
        });
    }

    let poster_output = output_dir.join(format!("{name}-poster.jpg"));
    jobs.push(ExportJob {
        kind: JobKind::Poster,
        label: "Poster JPG".to_string(),
        input_path: input_path.to_path_buf(),
        output_path: poster_output.clone(),
        args: build_poster_args(input_path, &poster_output, 3),
        fallback_args: Some(build_poster_args(input_path, &poster_output, 0)),
    });

    jobs
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn list_input_videos_accepts_only_top_level_mov_and_mp4_files() {
        let root = temp_dir();
        fs::write(root.join("clip.mov"), "").unwrap();
        fs::write(root.join("clip.MP4"), "").unwrap();
        fs::write(root.join("notes.txt"), "").unwrap();
        fs::create_dir(root.join("nested")).unwrap();
        fs::write(root.join("nested").join("ignored.mov"), "").unwrap();

        let videos = list_input_videos(&Selection::Folder { path: root }).unwrap();
        let mut names = videos
            .iter()
            .map(|path| path.file_name().unwrap().to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        names.sort();

        assert_eq!(names, vec!["clip.MP4", "clip.mov"]);
    }

    #[test]
    fn single_file_selection_rejects_unsupported_file_types() {
        let root = temp_dir();
        let txt = root.join("notes.txt");
        fs::write(&txt, "").unwrap();

        let videos = list_input_videos(&Selection::File { path: txt }).unwrap();

        assert!(videos.is_empty());
    }

    #[test]
    fn multi_file_selection_accepts_only_mov_and_mp4_files() {
        let root = temp_dir();
        let mov = root.join("clip.mov");
        let mp4 = root.join("clip.mp4");
        let txt = root.join("notes.txt");
        fs::write(&mov, "").unwrap();
        fs::write(&mp4, "").unwrap();
        fs::write(&txt, "").unwrap();

        let videos = list_input_videos(&Selection::Files {
            paths: vec![mov.clone(), txt, mp4.clone()],
        })
        .unwrap();

        assert_eq!(videos, vec![mov, mp4]);
    }

    #[test]
    fn output_dir_for_selection_keeps_exports_out_of_the_source_files() {
        assert_eq!(
            output_dir_for_selection(&Selection::File {
                path: PathBuf::from("/work/source/clip.mov"),
            }),
            Some(PathBuf::from("/work/source/web-video-exports"))
        );
        assert_eq!(
            output_dir_for_selection(&Selection::Folder {
                path: PathBuf::from("/work/source"),
            }),
            Some(PathBuf::from("/work/source/web-video-exports"))
        );
        assert_eq!(
            output_dir_for_selection(&Selection::Files {
                paths: vec![
                    PathBuf::from("/work/source/clip-a.mov"),
                    PathBuf::from("/work/source/clip-b.mp4"),
                ],
            }),
            Some(PathBuf::from("/work/source/web-video-exports"))
        );
    }

    #[test]
    fn build_export_plan_creates_six_videos_and_one_poster_per_input() {
        let plan = build_export_plan(
            "/work/source/launch.mov",
            "/work/source/web-video-exports",
            "medium",
        );

        assert_eq!(plan.len(), 7);
        assert_eq!(
            plan.iter()
                .map(|item| item.output_path.file_name().unwrap().to_string_lossy())
                .collect::<Vec<_>>(),
            vec![
                "launch-1080p.mp4",
                "launch-1080p.webm",
                "launch-720p.mp4",
                "launch-720p.webm",
                "launch-480p.mp4",
                "launch-480p.webm",
                "launch-poster.jpg",
            ]
        );
    }

    #[test]
    fn build_mp4_args_uses_web_safe_h264_settings_and_exact_dimensions() {
        let args = build_mp4_args(
            "/in/clip.mov",
            "/out/clip-1080p.mp4",
            1920,
            1080,
            QUALITY_PRESET_HIGH,
        );
        let joined = args.join(" ");

        assert!(args.contains(&"-c:v".to_string()));
        assert!(args.contains(&"libx264".to_string()));
        assert!(args.contains(&"-pix_fmt".to_string()));
        assert!(args.contains(&"yuv420p".to_string()));
        assert!(args.contains(&"+faststart".to_string()));
        assert!(joined.contains("scale=1920:1080:force_original_aspect_ratio=decrease"));
        assert!(joined.contains("pad=1920:1080:(ow-iw)/2:(oh-ih)/2"));
        assert!(args.contains(&"26".to_string()));
    }

    #[test]
    fn build_webm_args_uses_vp9_and_opus_settings() {
        let args = build_webm_args(
            "/in/clip.mov",
            "/out/clip-720p.webm",
            1280,
            720,
            QUALITY_PRESET_LOW,
        );
        let joined = args.join(" ");

        assert!(args.contains(&"libvpx-vp9".to_string()));
        assert!(args.contains(&"libopus".to_string()));
        assert!(joined.contains("scale=1280:720:force_original_aspect_ratio=decrease"));
        assert!(joined.contains("pad=1280:720:(ow-iw)/2:(oh-ih)/2"));
        assert!(args.contains(&"46".to_string()));
    }

    #[test]
    fn build_poster_args_captures_a_1080p_jpg_at_the_requested_timestamp() {
        let args = build_poster_args("/in/clip.mov", "/out/clip-poster.jpg", 3);
        let joined = args.join(" ");

        assert_eq!(args[0..4], ["-y", "-ss", "3", "-i"]);
        assert!(joined.contains("scale=1920:1080:force_original_aspect_ratio=decrease"));
        assert!(joined.contains("pad=1920:1080:(ow-iw)/2:(oh-ih)/2"));
        assert!(args.contains(&"-frames:v".to_string()));
        assert!(args.contains(&"1".to_string()));
    }

    #[test]
    fn build_export_plan_adds_poster_fallback_at_zero_seconds() {
        let plan = build_export_plan(
            "/work/source/launch.mov",
            "/work/source/web-video-exports",
            "medium",
        );
        let poster = plan.last().unwrap();

        assert_eq!(poster.kind, JobKind::Poster);
        assert!(poster.args.contains(&"3".to_string()));
        assert_eq!(
            poster.fallback_args.as_ref().unwrap(),
            &build_poster_args(
                "/work/source/launch.mov",
                "/work/source/web-video-exports/launch-poster.jpg",
                0,
            )
        );
    }

    #[test]
    fn unknown_quality_key_defaults_to_medium() {
        let args = build_mp4_args(
            "/in/clip.mov",
            "/out/clip-1080p.mp4",
            1920,
            1080,
            quality_preset("unknown"),
        );

        assert!(args.contains(&"30".to_string()));
    }

    fn temp_dir() -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let path = std::env::temp_dir().join(format!("wvc-{nanos}"));
        fs::create_dir(&path).unwrap();
        path
    }
}
