use std::process::{Child, Command};
use std::sync::Mutex;
use tauri::Manager;

struct Backend(Mutex<Option<Child>>);

fn backend_script() -> Option<String> {
    if let Ok(p) = std::env::var("PRIVY_BACKEND") { return Some(p); }
    // Resolve server/dist/index.js relative to this crate, falling back to the repo layout.
    for cand in [
        concat!(env!("CARGO_MANIFEST_DIR"), "/../../server/dist/index.js").to_string(),
        "server/dist/index.js".to_string(),
    ] {
        if std::path::Path::new(&cand).exists() { return Some(cand); }
    }
    None
}

fn backend_alive() -> bool {
    reqwest::blocking::Client::new()
        .get("http://localhost:5178/api/health")
        .timeout(std::time::Duration::from_millis(700))
        .send()
        .map(|r| r.status().is_success())
        .unwrap_or(false)
}

fn spawn_backend() -> Option<Child> {
    let script = backend_script()?;
    Command::new("node")
        .arg(&script)
        .env("PRIVY_PORT", "5178")
        .spawn()
        .ok()
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|_app| {
            if !backend_alive() {
                if let Some(child) = spawn_backend() {
                    let _ = _app.manage(Backend(Mutex::new(Some(child))));
                }
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if let Some(state) = window.app_handle().try_state::<Backend>() {
                    if let Some(mut child) = state.0.lock().unwrap().take() {
                        let _ = child.kill();
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
