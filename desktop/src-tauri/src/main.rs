#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

// On Linux, Tauri renders through WebKitGTK. On NVIDIA + Wayland, WebKitGTK's
// DMABUF renderer shares buffers with the compositor using NVIDIA explicit sync;
// the NVIDIA driver mismatches that, so the window gets scaled from a stale buffer
// during the minimize/maximize animation — the "ghostly", non-smooth transition.
// Disabling NVIDIA explicit sync keeps hardware acceleration and is the cheap,
// documented fix (step 2 of https://v2.tauri.app/develop/debug/linux-graphics/).
// The var is NVIDIA-specific and inert on AMD/Intel, so it's safe to set on Linux.
fn main() {
    #[cfg(target_os = "linux")]
    std::env::set_var("__NV_DISABLE_EXPLICIT_SYNC", "1");
    privy_cloud_desktop_lib::run();
}
