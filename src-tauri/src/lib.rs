//! PortPal - Tauri 应用核心库

mod process_control;
mod process_info;
mod scanner;

use process_control::{KillResult, ProcessController};
use process_info::ProcessInfo;
use scanner::PortScanner;
use serde::{Deserialize, Serialize};
use std::{
    path::Path,
    sync::Mutex,
    time::{Duration, Instant},
};
use tauri::{
    image::Image,
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIcon, TrayIconBuilder, TrayIconEvent},
    ActivationPolicy, LogicalSize, Manager, PhysicalPosition, Position, Rect, RunEvent, Size,
    WindowEvent,
};
use tracing::{debug, error, info, warn};
use tracing_subscriber::EnvFilter;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortInfo {
    pub port: u16,
    pub protocol: String,
    pub address: String,
    pub pid: u32,
    pub process_name: String,
    pub command: String,
    pub work_dir: String,
    pub project_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ScanResult {
    pub timestamp: u64,
    pub ports: Vec<PortInfo>,
    pub errors: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct PortRange {
    pub start: u16,
    pub end: u16,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct ScanOptions {
    pub include_ranges: Vec<PortRange>,
    pub exclude_ports: Vec<u16>,
    pub exclude_processes: Vec<String>,
    pub allow_processes: Vec<String>,
}

#[tauri::command]
fn scan_ports(scan_options: Option<ScanOptions>) -> Result<ScanResult, String> {
    let scan_options = scan_options.unwrap_or_default();
    info!(
        include_ranges = scan_options.include_ranges.len(),
        exclude_ports = scan_options.exclude_ports.len(),
        exclude_processes = scan_options.exclude_processes.len(),
        allow_processes = scan_options.allow_processes.len(),
        "scan_ports started"
    );
    let ranges = scan_options
        .include_ranges
        .iter()
        .map(|range| {
            if range.start <= range.end {
                (range.start, range.end)
            } else {
                (range.end, range.start)
            }
        })
        .collect::<Vec<_>>();

    let scanner = PortScanner::new().with_port_ranges(ranges);
    let entries = scanner.scan().map_err(|e| {
        error!(error = %e, "scan_ports failed");
        e.to_string()
    })?;

    let mut process_info = ProcessInfo::new();
    let mut ports = Vec::new();

    for entry in &entries {
        if scan_options.exclude_ports.contains(&entry.port) {
            continue;
        }

        let process_details = process_info.get_process_details(entry.pid);
        let (process_name, command, work_dir, project_name) = match process_details {
            Some(details) => (
                details.name,
                details.command,
                details.cwd,
                details.project_name,
            ),
            None => (
                String::new(),
                String::new(),
                String::new(),
                String::from("未识别来源"),
            ),
        };

        if !matches_process_filters(&scan_options, &process_name, &command, &project_name) {
            continue;
        }

        ports.push(PortInfo {
            port: entry.port,
            protocol: entry.protocol.clone(),
            address: entry.address.clone(),
            pid: entry.pid,
            process_name,
            command,
            work_dir,
            project_name,
        });
    }

    let result = ScanResult {
        timestamp: std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map_err(|e| format!("System clock is before UNIX_EPOCH: {}", e))?
            .as_millis() as u64,
        ports,
        errors: Vec::new(),
    };

    info!(port_count = result.ports.len(), "scan_ports completed");
    Ok(result)
}

fn matches_process_filters(
    scan_options: &ScanOptions,
    process_name: &str,
    command: &str,
    project_name: &str,
) -> bool {
    let haystack = format!(
        "{} {} {}",
        process_name.to_lowercase(),
        command.to_lowercase(),
        project_name.to_lowercase()
    );

    if scan_options
        .exclude_processes
        .iter()
        .filter(|value| !value.trim().is_empty())
        .any(|value| haystack.contains(&value.to_lowercase()))
    {
        return false;
    }

    let allow_processes = scan_options
        .allow_processes
        .iter()
        .filter_map(|value| {
            let normalized = value.trim().to_lowercase();
            if normalized.is_empty() {
                None
            } else {
                Some(normalized)
            }
        })
        .collect::<Vec<_>>();

    if allow_processes.is_empty() {
        return true;
    }

    allow_processes.iter().any(|value| haystack.contains(value))
}

#[tauri::command]
fn kill_process(pid: u32) -> Result<KillResult, String> {
    if pid == 0 {
        return Err(String::from("Refusing to terminate PID 0"));
    }

    info!(pid, "kill_process requested");
    let controller = ProcessController::new();
    let result = controller.kill(pid);
    if result.success {
        info!(pid, message = %result.message, "kill_process completed");
    } else {
        warn!(pid, message = %result.message, "kill_process failed");
    }

    Ok(KillResult {
        pid: result.pid,
        success: result.success,
        message: result.message,
    })
}

#[tauri::command]
fn open_in_browser(port: u16) -> Result<(), String> {
    if port == 0 {
        return Err(String::from("Port must be between 1 and 65535"));
    }

    info!(port, "open_in_browser requested");
    opener::open(&format!("http://localhost:{}", port))
        .map_err(|e| format!("Failed to open browser: {}", e))
}

#[tauri::command]
fn open_folder(path: String) -> Result<(), String> {
    let path = path.trim();
    if path.is_empty() {
        return Err(String::from("Folder path is required"));
    }
    if !Path::new(path).exists() {
        return Err(String::from("Folder path does not exist"));
    }

    info!("open_folder requested");
    opener::open(&path).map_err(|e| format!("Failed to open folder: {}", e))
}

const POPUP_WIDTH: f64 = 440.0;
const POPUP_HEIGHT: f64 = 380.0;
const POPUP_MARGIN: f64 = 12.0;
const TRAY_TOGGLE_DEBOUNCE_MS: u64 = 250;

#[derive(Default)]
struct PopupState {
    last_toggle_at: Mutex<Option<Instant>>,
}

impl PopupState {
    fn register_toggle(&self) -> bool {
        let now = Instant::now();
        let Ok(mut last_toggle_at) = self.last_toggle_at.lock() else {
            error!("popup state lock poisoned");
            return false;
        };
        if let Some(last_toggle) = *last_toggle_at {
            if now.duration_since(last_toggle) < Duration::from_millis(TRAY_TOGGLE_DEBOUNCE_MS) {
                return false;
            }
        }
        *last_toggle_at = Some(now);
        true
    }
}

#[derive(Default)]
struct TrayState {
    tray: Mutex<Option<TrayIcon>>,
}

fn present_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    tray_anchor: Option<(PhysicalPosition<f64>, Rect)>,
) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    debug!(
        visible = window.is_visible().unwrap_or(false),
        anchored = tray_anchor.is_some(),
        "present_main_window requested"
    );

    if let Err(error) = window.set_size(Size::Logical(LogicalSize::new(POPUP_WIDTH, POPUP_HEIGHT)))
    {
        warn!(%error, "failed to size main window");
    }

    if let Some((cursor_position, rect)) = tray_anchor {
        position_window_near_tray(&window, cursor_position, rect);
    } else {
        position_window_default(&window);
    }

    if let Err(error) = window.show() {
        warn!(%error, "failed to show main window");
    }
    if let Err(error) = window.set_focus() {
        warn!(%error, "failed to focus main window");
    }
}

fn show_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    tray_anchor: Option<(PhysicalPosition<f64>, Rect)>,
) {
    let popup_state = app.state::<PopupState>();
    if !popup_state.register_toggle() {
        return;
    }

    present_main_window(app, tray_anchor);
}

fn toggle_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
    tray_anchor: Option<(PhysicalPosition<f64>, Rect)>,
) {
    let popup_state = app.state::<PopupState>();
    if !popup_state.register_toggle() {
        return;
    }

    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    if window.is_visible().unwrap_or(false) {
        if let Err(error) = window.hide() {
            warn!(%error, "failed to hide main window");
        }
        return;
    }

    present_main_window(app, tray_anchor);
}

fn position_window_near_tray<R: tauri::Runtime>(
    window: &tauri::WebviewWindow<R>,
    cursor_position: PhysicalPosition<f64>,
    tray_rect: Rect,
) {
    let monitor = window
        .monitor_from_point(cursor_position.x, cursor_position.y)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten());

    let Some(monitor) = monitor else {
        return;
    };

    let work_area = monitor.work_area();
    let tray_position = tray_rect
        .position
        .to_physical::<f64>(monitor.scale_factor());
    let tray_size = tray_rect.size.to_physical::<f64>(monitor.scale_factor());
    let tray_center_x = tray_position.x + (tray_size.width / 2.0);
    let tray_top = tray_position.y;
    let tray_bottom = tray_position.y + tray_size.height;

    let min_x = work_area.position.x as f64 + POPUP_MARGIN;
    let max_x =
        work_area.position.x as f64 + work_area.size.width as f64 - POPUP_WIDTH - POPUP_MARGIN;
    let x = (tray_center_x - POPUP_WIDTH / 2.0).clamp(min_x, max_x.max(min_x));

    let work_top = work_area.position.y as f64 + POPUP_MARGIN;
    let work_bottom =
        work_area.position.y as f64 + work_area.size.height as f64 - POPUP_HEIGHT - POPUP_MARGIN;
    let is_menu_bar_anchor = tray_top <= work_area.position.y as f64;
    let prefer_below = is_menu_bar_anchor
        || tray_top <= work_area.position.y as f64 + (work_area.size.height as f64 / 2.0);
    let y = if prefer_below {
        (tray_bottom + 6.0).clamp(work_top, work_bottom.max(work_top))
    } else {
        (tray_top - POPUP_HEIGHT - 8.0).clamp(work_top, work_bottom.max(work_top))
    };

    if let Err(error) = window.set_position(Position::Physical(PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ))) {
        warn!(%error, "failed to position main window near tray");
    }
}

fn position_window_default<R: tauri::Runtime>(window: &tauri::WebviewWindow<R>) {
    let Some(monitor) = window.current_monitor().ok().flatten() else {
        return;
    };

    let work_area = monitor.work_area();
    let x = work_area.position.x as f64 + ((work_area.size.width as f64 - POPUP_WIDTH) / 2.0);
    let y = work_area.position.y as f64 + ((work_area.size.height as f64 - POPUP_HEIGHT) / 2.0);

    if let Err(error) = window.set_position(Position::Physical(PhysicalPosition::new(
        x.round() as i32,
        y.round() as i32,
    ))) {
        warn!(%error, "failed to position main window");
    }
}

#[cfg(target_os = "macos")]
fn apply_window_chrome<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg(not(target_os = "macos"))]
fn apply_window_chrome<R: tauri::Runtime>(_window: &tauri::WebviewWindow<R>) {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    init_logging();

    let app = tauri::Builder::default()
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                if let Err(error) = window.hide() {
                    warn!(%error, "failed to hide main window on close request");
                }
            }
            WindowEvent::Focused(false) => {
                if let Err(error) = window.hide() {
                    warn!(%error, "failed to hide main window on focus loss");
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            scan_ports,
            kill_process,
            open_in_browser,
            open_folder
        ])
        .setup(|app| {
            #[cfg(target_os = "macos")]
            {
                let _ = app.set_activation_policy(ActivationPolicy::Accessory);
            }

            app.manage(PopupState::default());
            app.manage(TrayState::default());

            if let Some(window) = app.get_webview_window("main") {
                apply_window_chrome(&window);
            }

            // 创建托盘
            let menu = Menu::with_items(
                app,
                &[
                    &MenuItem::with_id(app, "show", "显示窗口", true, None::<&str>)?,
                    &MenuItem::with_id(app, "quit", "退出 PortPal", true, None::<&str>)?,
                ],
            )?;

            let tray_icon = Image::from_bytes(include_bytes!("../icons/tray-template.png"))?;

            let tray = TrayIconBuilder::with_id("portpal-tray")
                .icon(tray_icon)
                .icon_as_template(true)
                .tooltip("PortPal")
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id.as_ref() == "show" {
                        show_main_window(app, None);
                    } else if event.id.as_ref() == "quit" {
                        std::process::exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    debug!(?event, "tray icon event");
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        position,
                        rect,
                        ..
                    } = event
                    {
                        toggle_main_window(tray.app_handle(), Some((position, rect)));
                    }
                })
                .build(app)?;

            if let Ok(mut tray_guard) = app.state::<TrayState>().tray.lock() {
                *tray_guard = Some(tray);
            }

            #[cfg(debug_assertions)]
            {
                position_and_show_debug_window(app.handle());
            }

            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application");

    app.run(|app_handle, event| {
        if let RunEvent::Reopen { .. } = event {
            show_main_window(app_handle, None);
        }
    });
}

fn init_logging() {
    let env_filter =
        EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("portpal=info"));
    let _ = tracing_subscriber::fmt()
        .with_env_filter(env_filter)
        .with_target(false)
        .try_init();
}

#[cfg(debug_assertions)]
fn position_and_show_debug_window<R: tauri::Runtime>(app: &tauri::AppHandle<R>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };

    position_window_default(&window);
    if let Err(error) = window.show() {
        warn!(%error, "failed to show debug window");
    }
    if let Err(error) = window.set_focus() {
        warn!(%error, "failed to focus debug window");
    }
}
