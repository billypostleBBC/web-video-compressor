pub mod encoder;

mod commands;
mod sleep_blocker;
mod tools;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_opener::init())
        .manage(commands::AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::check_tools,
            commands::selection_from_dropped_paths,
            commands::preview_inputs,
            commands::start,
            commands::cancel
        ])
        .run(tauri::generate_context!())
        .expect("failed to run Web Video Compressor");
}
