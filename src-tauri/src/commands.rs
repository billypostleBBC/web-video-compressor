use crate::encoder::{
    build_export_plan, list_input_videos, output_dir_for_selection, JobKind, Selection,
};
use crate::sleep_blocker::SleepBlocker;
use crate::tools;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_notification::NotificationExt;
use tauri_plugin_opener::OpenerExt;

#[derive(Clone, Default)]
pub struct AppState {
    run: Arc<Mutex<RunState>>,
    sleep_blocker: Arc<Mutex<SleepBlocker>>,
}

#[derive(Default)]
struct RunState {
    active: bool,
    cancel_requested: bool,
    current_pid: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(tag = "type")]
pub enum JsSelection {
    #[serde(rename = "file")]
    File { path: String },
    #[serde(rename = "files")]
    Files { paths: Vec<String> },
    #[serde(rename = "folder")]
    Folder { path: String },
}

impl From<JsSelection> for Selection {
    fn from(selection: JsSelection) -> Self {
        match selection {
            JsSelection::File { path } => Selection::File {
                path: PathBuf::from(path),
            },
            JsSelection::Files { paths } => Selection::Files {
                paths: paths.into_iter().map(PathBuf::from).collect(),
            },
            JsSelection::Folder { path } => Selection::Folder {
                path: PathBuf::from(path),
            },
        }
    }
}

impl From<&Selection> for JsSelection {
    fn from(selection: &Selection) -> Self {
        match selection {
            Selection::File { path } => JsSelection::File {
                path: path_to_string(path),
            },
            Selection::Files { paths } => JsSelection::Files {
                paths: paths.iter().map(path_to_string).collect(),
            },
            Selection::Folder { path } => JsSelection::Folder {
                path: path_to_string(path),
            },
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BasicResult {
    ok: bool,
    message: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SelectionResult {
    ok: bool,
    message: Option<String>,
    selection: Option<JsSelection>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreviewResult {
    videos: Vec<String>,
    output_dir: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StartResult {
    ok: bool,
    cancelled: Option<bool>,
    message: Option<String>,
    output_dir: Option<String>,
    completed_jobs: Option<usize>,
    total_jobs: Option<usize>,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct EncoderEvent {
    #[serde(rename = "type")]
    event_type: String,
    output_dir: Option<String>,
    total_files: Option<usize>,
    total_jobs: Option<usize>,
    completed_jobs: Option<usize>,
    input_path: Option<String>,
    file_name: Option<String>,
    label: Option<String>,
    output_path: Option<String>,
    message: Option<String>,
    progress: Option<f64>,
}

#[tauri::command]
pub fn check_tools(app: AppHandle) -> tools::ToolResult {
    tools::check_tools(&app)
}

#[tauri::command]
pub fn selection_from_dropped_paths(paths: Vec<String>) -> SelectionResult {
    let paths = paths
        .into_iter()
        .filter(|path| !path.trim().is_empty())
        .collect::<Vec<_>>();

    if paths.is_empty() {
        return selection_error("Drop one folder, or one or more .mov or .mp4 files.");
    }

    let mut folders = Vec::new();
    let mut files = Vec::new();

    for path in paths {
        let Ok(metadata) = fs::metadata(&path) else {
            return selection_error(
                "Some dropped items could not be read. Drop one folder, or one or more .mov or .mp4 files.",
            );
        };

        if metadata.is_dir() {
            folders.push(path);
        } else if metadata.is_file() {
            files.push(path);
        }
    }

    if folders.len() == 1 && files.is_empty() {
        return SelectionResult {
            ok: true,
            message: None,
            selection: Some(JsSelection::Folder {
                path: folders.remove(0),
            }),
        };
    }

    if !folders.is_empty() {
        return selection_error(
            "Drop one folder at a time, or drop one or more .mov or .mp4 files.",
        );
    }

    let selection = if files.len() == 1 {
        JsSelection::File {
            path: files.remove(0),
        }
    } else {
        JsSelection::Files { paths: files }
    };

    SelectionResult {
        ok: true,
        message: None,
        selection: Some(selection),
    }
}

#[tauri::command]
pub fn preview_inputs(selection: JsSelection) -> PreviewResult {
    let selection = Selection::from(selection);
    PreviewResult {
        videos: list_input_videos(&selection)
            .unwrap_or_default()
            .iter()
            .map(path_to_string)
            .collect(),
        output_dir: output_dir_for_selection(&selection).map(|path| path_to_string(&path)),
    }
}

#[tauri::command]
pub async fn start(
    app: AppHandle,
    state: State<'_, AppState>,
    selection: JsSelection,
    quality_key: String,
) -> Result<StartResult, String> {
    let app_state = state.inner().clone();
    let app_handle = app.clone();

    match tauri::async_runtime::spawn_blocking(move || {
        start_encoding(
            app_handle,
            app_state,
            Selection::from(selection),
            quality_key,
        )
    })
    .await
    {
        Ok(result) => Ok(result),
        Err(error) => Ok(StartResult {
            ok: false,
            cancelled: Some(false),
            message: Some(format!("Compression failed. {error}")),
            output_dir: None,
            completed_jobs: None,
            total_jobs: None,
        }),
    }
}

#[tauri::command]
pub fn cancel(state: State<'_, AppState>) -> BasicResult {
    let mut run = state.run.lock().expect("run state lock poisoned");

    if !run.active {
        return BasicResult {
            ok: true,
            message: None,
        };
    }

    run.cancel_requested = true;

    if let Some(pid) = run.current_pid {
        let _ = Command::new("/bin/kill")
            .arg("-TERM")
            .arg(pid.to_string())
            .status();
    }

    BasicResult {
        ok: true,
        message: None,
    }
}

fn start_encoding(
    app: AppHandle,
    state: AppState,
    selection: Selection,
    quality_key: String,
) -> StartResult {
    {
        let mut run = state.run.lock().expect("run state lock poisoned");
        if run.active {
            return StartResult {
                ok: false,
                cancelled: Some(false),
                message: Some("A compression run is already active.".to_string()),
                output_dir: None,
                completed_jobs: None,
                total_jobs: None,
            };
        }
        run.active = true;
        run.cancel_requested = false;
        run.current_pid = None;
    }

    state
        .sleep_blocker
        .lock()
        .expect("sleep blocker lock poisoned")
        .start();

    let result = run_encoding(&app, &state, selection, &quality_key);

    state
        .sleep_blocker
        .lock()
        .expect("sleep blocker lock poisoned")
        .stop();
    let mut run = state.run.lock().expect("run state lock poisoned");
    run.active = false;
    run.cancel_requested = false;
    run.current_pid = None;

    result
}

fn run_encoding(
    app: &AppHandle,
    state: &AppState,
    selection: Selection,
    quality_key: &str,
) -> StartResult {
    let tools = tools::check_tools(app);
    if !tools.ok {
        return StartResult {
            ok: false,
            cancelled: Some(false),
            message: Some(tools.message),
            output_dir: None,
            completed_jobs: None,
            total_jobs: None,
        };
    }
    let ffmpeg_path = tools.ffmpeg_path.expect("checked ffmpeg path should exist");

    let videos = match list_input_videos(&selection) {
        Ok(videos) => videos,
        Err(error) => {
            return failed_without_event(format!("Compression failed. {error}"));
        }
    };

    if videos.is_empty() {
        return failed_without_event(
            "Choose a .mov or .mp4 file, or a folder containing .mov or .mp4 files.".to_string(),
        );
    }

    let Some(output_dir) = output_dir_for_selection(&selection) else {
        return failed_without_event(
            "Choose a .mov or .mp4 file, or a folder containing .mov or .mp4 files.".to_string(),
        );
    };

    if let Err(error) = fs::create_dir_all(&output_dir) {
        return failed_without_event(format!("Compression failed. {error}"));
    }

    let total_files = videos.len();
    let total_jobs = total_files * 7;
    let mut completed_jobs = 0;

    emit(
        app,
        EncoderEvent {
            event_type: "run-started".to_string(),
            output_dir: Some(path_to_string(&output_dir)),
            total_files: Some(total_files),
            total_jobs: Some(total_jobs),
            completed_jobs: None,
            input_path: None,
            file_name: None,
            label: None,
            output_path: None,
            message: None,
            progress: None,
        },
    );

    for input_path in videos {
        let file_name = input_path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        let jobs = build_export_plan(&input_path, &output_dir, quality_key);

        emit(
            app,
            EncoderEvent {
                event_type: "file-started".to_string(),
                output_dir: None,
                total_files: None,
                total_jobs: Some(jobs.len()),
                completed_jobs: None,
                input_path: Some(path_to_string(&input_path)),
                file_name: Some(file_name.clone()),
                label: None,
                output_path: None,
                message: None,
                progress: None,
            },
        );

        for job in jobs {
            if is_cancelled(state) {
                return cancelled(app, completed_jobs, total_jobs);
            }

            emit(
                app,
                EncoderEvent {
                    event_type: "job-started".to_string(),
                    output_dir: None,
                    total_files: None,
                    total_jobs: Some(total_jobs),
                    completed_jobs: Some(completed_jobs),
                    input_path: Some(path_to_string(&job.input_path)),
                    file_name: Some(file_name.clone()),
                    label: Some(job.label.clone()),
                    output_path: Some(path_to_string(&job.output_path)),
                    message: None,
                    progress: None,
                },
            );

            let progress_input_path = path_to_string(&job.input_path);
            let progress_label = job.label.clone();
            let progress_output_path = path_to_string(&job.output_path);
            let mut on_progress = |progress| {
                emit(
                    app,
                    EncoderEvent {
                        event_type: "job-progress".to_string(),
                        output_dir: None,
                        total_files: None,
                        total_jobs: Some(total_jobs),
                        completed_jobs: Some(completed_jobs),
                        input_path: Some(progress_input_path.clone()),
                        file_name: Some(file_name.clone()),
                        label: Some(progress_label.clone()),
                        output_path: Some(progress_output_path.clone()),
                        message: None,
                        progress: Some(progress),
                    },
                );
            };

            if let Err(error) = run_job(&ffmpeg_path, &job, state, &mut on_progress) {
                if is_cancelled(state) {
                    return cancelled(app, completed_jobs, total_jobs);
                }

                let message = format!("Compression failed. {error}");
                emit(
                    app,
                    EncoderEvent {
                        event_type: "run-failed".to_string(),
                        output_dir: None,
                        total_files: None,
                        total_jobs: Some(total_jobs),
                        completed_jobs: Some(completed_jobs),
                        input_path: None,
                        file_name: None,
                        label: None,
                        output_path: None,
                        message: Some(message.clone()),
                        progress: None,
                    },
                );
                return failed_without_event(message);
            }

            completed_jobs += 1;
            emit(
                app,
                EncoderEvent {
                    event_type: "job-finished".to_string(),
                    output_dir: None,
                    total_files: None,
                    total_jobs: Some(total_jobs),
                    completed_jobs: Some(completed_jobs),
                    input_path: Some(path_to_string(&job.input_path)),
                    file_name: Some(file_name.clone()),
                    label: Some(job.label),
                    output_path: Some(path_to_string(&job.output_path)),
                    message: None,
                    progress: None,
                },
            );
        }

        emit(
            app,
            EncoderEvent {
                event_type: "file-finished".to_string(),
                output_dir: None,
                total_files: None,
                total_jobs: Some(7),
                completed_jobs: None,
                input_path: Some(path_to_string(&input_path)),
                file_name: Some(file_name),
                label: None,
                output_path: None,
                message: None,
                progress: None,
            },
        );
    }

    let output_dir = path_to_string(&output_dir);
    emit(
        app,
        EncoderEvent {
            event_type: "run-finished".to_string(),
            output_dir: Some(output_dir.clone()),
            total_files: Some(total_files),
            total_jobs: Some(total_jobs),
            completed_jobs: Some(completed_jobs),
            input_path: None,
            file_name: None,
            label: None,
            output_path: None,
            message: None,
            progress: None,
        },
    );

    show_queue_complete_notification(app, &output_dir, total_files);
    let _ = app.opener().open_path(output_dir.clone(), None::<&str>);

    StartResult {
        ok: true,
        cancelled: None,
        message: None,
        output_dir: Some(output_dir),
        completed_jobs: Some(completed_jobs),
        total_jobs: Some(total_jobs),
    }
}

fn run_job(
    ffmpeg_path: &str,
    job: &crate::encoder::ExportJob,
    state: &AppState,
    on_progress: &mut impl FnMut(f64),
) -> Result<(), String> {
    match run_ffmpeg(ffmpeg_path, &job.args, state, on_progress) {
        Ok(()) => Ok(()),
        Err(error) => {
            if job.kind == JobKind::Poster && job.fallback_args.is_some() && !is_cancelled(state) {
                run_ffmpeg(
                    ffmpeg_path,
                    job.fallback_args.as_ref().expect("checked fallback args"),
                    state,
                    on_progress,
                )
            } else {
                Err(error)
            }
        }
    }
}

fn run_ffmpeg(
    ffmpeg_path: &str,
    args: &[String],
    state: &AppState,
    on_progress: &mut impl FnMut(f64),
) -> Result<(), String> {
    if is_cancelled(state) {
        return Err("Run cancelled.".to_string());
    }

    let mut child = Command::new(ffmpeg_path)
        .args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| error.to_string())?;
    let pid = child.id();
    let mut stderr_pipe = child
        .stderr
        .take()
        .ok_or_else(|| "Could not read ffmpeg progress output.".to_string())?;

    {
        let mut run = state.run.lock().expect("run state lock poisoned");
        run.current_pid = Some(pid);
    }

    let mut stderr = String::new();
    let mut buffer = [0; 4096];
    let mut duration_seconds = None;
    let mut last_progress = 0.0;
    let mut last_progress_sent_at: Option<Instant> = None;

    loop {
        let bytes_read = stderr_pipe
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;

        if bytes_read == 0 {
            break;
        }

        stderr.push_str(&String::from_utf8_lossy(&buffer[..bytes_read]));
        let parsed = parse_ffmpeg_progress(&stderr, duration_seconds);
        duration_seconds = parsed.duration_seconds;

        if let Some(progress) = parsed.progress {
            let should_emit = progress > last_progress
                && last_progress_sent_at
                    .map(|last_sent| last_sent.elapsed() >= Duration::from_millis(100))
                    .unwrap_or(true);

            if should_emit {
                last_progress = progress;
                last_progress_sent_at = Some(Instant::now());
                on_progress(progress);
            }
        }
    }

    let status = child.wait().map_err(|error| error.to_string())?;

    {
        let mut run = state.run.lock().expect("run state lock poisoned");
        if run.current_pid == Some(pid) {
            run.current_pid = None;
        }
    }

    if is_cancelled(state) {
        return Err("Run cancelled.".to_string());
    }

    if status.success() {
        return Ok(());
    }

    let useful_error = stderr
        .trim()
        .lines()
        .rev()
        .take(4)
        .collect::<Vec<_>>()
        .into_iter()
        .rev()
        .collect::<Vec<_>>()
        .join("\n");

    Err(if useful_error.is_empty() {
        format!("ffmpeg exited with code {:?}.", status.code())
    } else {
        useful_error
    })
}

struct ParsedFfmpegProgress {
    duration_seconds: Option<f64>,
    progress: Option<f64>,
}

fn parse_ffmpeg_progress(
    stderr: &str,
    known_duration_seconds: Option<f64>,
) -> ParsedFfmpegProgress {
    let duration_seconds = parse_ffmpeg_duration(stderr).or(known_duration_seconds);
    let progress = duration_seconds.and_then(|duration| {
        if duration <= 0.0 {
            return None;
        }

        parse_latest_ffmpeg_time(stderr)
            .map(|current_time| (current_time / duration).clamp(0.0, 0.99))
    });

    ParsedFfmpegProgress {
        duration_seconds,
        progress,
    }
}

fn parse_ffmpeg_duration(stderr: &str) -> Option<f64> {
    let start = stderr.rfind("Duration:")? + "Duration:".len();
    parse_timestamp_seconds(stderr[start..].trim_start())
}

fn parse_latest_ffmpeg_time(stderr: &str) -> Option<f64> {
    let start = stderr.rfind("time=")? + "time=".len();
    parse_timestamp_seconds(stderr[start..].trim_start())
}

fn parse_timestamp_seconds(text: &str) -> Option<f64> {
    let timestamp = text.split_whitespace().next()?.trim_end_matches(',');
    let mut parts = timestamp.split(':');
    let hours = parts.next()?.parse::<f64>().ok()?;
    let minutes = parts.next()?.parse::<f64>().ok()?;
    let seconds = parts.next()?.parse::<f64>().ok()?;

    if parts.next().is_some() {
        return None;
    }

    Some((hours * 3600.0) + (minutes * 60.0) + seconds)
}

fn selection_error(message: &str) -> SelectionResult {
    SelectionResult {
        ok: false,
        message: Some(message.to_string()),
        selection: None,
    }
}

fn failed_without_event(message: String) -> StartResult {
    StartResult {
        ok: false,
        cancelled: Some(false),
        message: Some(message),
        output_dir: None,
        completed_jobs: None,
        total_jobs: None,
    }
}

fn cancelled(app: &AppHandle, completed_jobs: usize, total_jobs: usize) -> StartResult {
    let message = "Compression cancelled. Completed exports were left in place.".to_string();
    emit(
        app,
        EncoderEvent {
            event_type: "run-cancelled".to_string(),
            output_dir: None,
            total_files: None,
            total_jobs: Some(total_jobs),
            completed_jobs: Some(completed_jobs),
            input_path: None,
            file_name: None,
            label: None,
            output_path: None,
            message: Some(message.clone()),
            progress: None,
        },
    );
    StartResult {
        ok: false,
        cancelled: Some(true),
        message: Some(message),
        output_dir: None,
        completed_jobs: None,
        total_jobs: None,
    }
}

fn is_cancelled(state: &AppState) -> bool {
    state
        .run
        .lock()
        .expect("run state lock poisoned")
        .cancel_requested
}

fn emit(app: &AppHandle, event: EncoderEvent) {
    let _ = app.emit("encoder:event", event);
}

fn show_queue_complete_notification(app: &AppHandle, output_dir: &str, total_files: usize) {
    let source_label = format!(
        "{total_files} source video{}",
        if total_files == 1 { "" } else { "s" }
    );

    let _ = app
        .notification()
        .builder()
        .title("Compression queue complete")
        .body(format!("{source_label} exported to {output_dir}"))
        .show();
}

fn path_to_string(path: impl AsRef<Path>) -> String {
    path.as_ref().to_string_lossy().into_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_ffmpeg_progress_uses_duration_and_latest_time() {
        let stderr = concat!(
            "Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s\n",
            "frame=12 fps=0.0 q=28.0 size=0kB time=00:00:02.50 bitrate=0.1kbits/s\r",
            "frame=24 fps=0.0 q=28.0 size=0kB time=00:00:05.00 bitrate=0.1kbits/s\r"
        );

        let progress = parse_ffmpeg_progress(stderr, None);

        assert_eq!(progress.duration_seconds, Some(10.0));
        assert_eq!(progress.progress, Some(0.5));
    }

    #[test]
    fn parse_ffmpeg_progress_clamps_before_complete() {
        let stderr = concat!(
            "Duration: 00:00:10.00, start: 0.000000, bitrate: 500 kb/s\n",
            "frame=48 fps=0.0 q=28.0 size=0kB time=00:00:12.00 bitrate=0.1kbits/s\r"
        );

        let progress = parse_ffmpeg_progress(stderr, None);

        assert_eq!(progress.progress, Some(0.99));
    }
}
