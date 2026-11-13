use island_contract::{Event, Target, WsServerMessage};
use island_core::{Effect, Input, IslandCore, Millis};
use island_platform::{
    calculate_window_position, enumerate_monitors, find_window_by_process_and_title, focus_window,
    get_adaptive_poll_interval_ms, get_cursor_pos, poll_platform_state, update_window_clickthrough,
    MonitorInfo, Rect,
};
use island_secrets::{generate_pairing_token, SecretStore, WindowsSecretStore};
use island_server::{start_server, ServerState, DEFAULT_PORT};
use island_store::Store;
use source_desktop::{default_desktop_apps, DesktopAppConfig};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::{broadcast, mpsc};
use tracing::{error, info, warn};

pub struct AppState {
    pub core: Arc<Mutex<IslandCore>>,
    pub store: Store,
    pub secrets: Arc<dyn SecretStore>,
    pub server_token: Arc<tokio::sync::RwLock<String>>,
    pub input_tx: mpsc::Sender<Input>,
    pub hit_rect: Arc<Mutex<Option<Rect>>>,
    pub command_tx: broadcast::Sender<WsServerMessage>,
}

fn current_millis() -> Millis {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as Millis
}

#[tauri::command]
async fn get_pairing_token(state: State<'_, AppState>) -> Result<String, String> {
    let token = state.server_token.read().await;
    Ok(token.clone())
}

#[tauri::command]
async fn regenerate_pairing_token(state: State<'_, AppState>) -> Result<String, String> {
    let new_token = generate_pairing_token();
    let _ = state.secrets.set_secret("pairing-token", &new_token);
    let mut guard = state.server_token.write().await;
    *guard = new_token.clone();
    info!("Pairing token regenerated");
    Ok(new_token)
}

#[tauri::command]
async fn send_island_input(action: String, state: State<'_, AppState>) -> Result<(), String> {
    let input = if let Some(id_str) = action.strip_prefix("queue_item:") {
        if let Ok(id) = uuid::Uuid::parse_str(id_str) {
            Input::QueueItemClicked(id)
        } else {
            return Err("Invalid uuid format".to_string());
        }
    } else {
        match action.as_str() {
            "pill_clicked" => Input::PillClicked,
            "dot_clicked" => Input::DotClicked,
            "queue_clear" => Input::QueueClear,
            "queue_close" => Input::QueueClose,
            "hover_enter" => Input::HoverEnter,
            "hover_leave" => Input::HoverLeave,
            _ => return Err(format!("Unknown action: {}", action)),
        }
    };

    state.input_tx.send(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn update_hit_rect(rect: Option<Rect>, state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.hit_rect.lock().unwrap();
    *guard = rect;
    Ok(())
}

#[tauri::command]
async fn get_monitors() -> Result<Vec<MonitorInfo>, String> {
    Ok(enumerate_monitors())
}

#[tauri::command]
async fn set_monitor_settings(
    follow_active: bool,
    fixed_monitor_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    let idle_min = {
        let guard = state.core.lock().unwrap();
        guard.idle_threshold_min
    };

    let input = Input::SettingsChanged {
        follow_active_monitor: follow_active,
        fixed_monitor_id,
        idle_threshold_min: idle_min,
    };

    state.input_tx.send(input).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn get_desktop_apps(state: State<'_, AppState>) -> Result<Vec<DesktopAppConfig>, String> {
    if let Ok(Some(json)) = state.store.get_setting_json("desktop_apps") {
        if let Ok(apps) = serde_json::from_str::<Vec<DesktopAppConfig>>(&json) {
            return Ok(apps);
        }
    }
    Ok(default_desktop_apps())
}

#[tauri::command]
async fn save_desktop_apps(
    apps: Vec<DesktopAppConfig>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    for app in &apps {
        app.validate().map_err(|e| e.to_string())?;
    }
    let json = serde_json::to_string(&apps).map_err(|e| e.to_string())?;
    state
        .store
        .set_setting_json("desktop_apps", &json)
        .map_err(|e| e.to_string())?;
    info!("Saved {} desktop app configurations", apps.len());
    Ok(())
}

#[tauri::command]
async fn set_queue_focus(take_focus: bool, app: AppHandle) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Input::KeyboardAndMouse::SetFocus;
        use windows::Win32::UI::WindowsAndMessaging::{
            GetWindowLongW, SetForegroundWindow, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
        };

        if let Some(win) = app.get_webview_window("island") {
            if let Ok(hwnd) = win.hwnd() {
                let hwnd = HWND(hwnd.0 as _);
                unsafe {
                    let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                    if take_focus {
                        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style & !(WS_EX_NOACTIVATE.0 as i32));
                        let _ = SetForegroundWindow(hwnd);
                        let _ = SetFocus(hwnd);
                    } else {
                        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE.0 as i32);
                    }
                }
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (take_focus, app);
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tracing_subscriber::fmt()
        .with_env_filter("info,island_app=debug,island_server=debug,island_core=debug")
        .init();

    info!("Starting Island application...");

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            let hit_rect_arc = Arc::new(Mutex::new(None::<Rect>));

            // Setup Island window styles on Windows
            if let Some(window) = app.get_webview_window("island") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
                        WS_EX_TOOLWINDOW, WS_EX_TRANSPARENT,
                    };

                    if let Ok(hwnd) = window.hwnd() {
                        let raw_hwnd = hwnd.0 as isize;
                        let hwnd = HWND(raw_hwnd as _);
                        unsafe {
                            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                            SetWindowLongW(
                                hwnd,
                                GWL_EXSTYLE,
                                ex_style
                                    | WS_EX_TOOLWINDOW.0 as i32
                                    | WS_EX_NOACTIVATE.0 as i32
                                    | WS_EX_TRANSPARENT.0 as i32,
                            );
                        }

                        // Adaptive Click-through Worker Thread (§3.6)
                        let hit_rect_thread = hit_rect_arc.clone();
                        std::thread::spawn(move || {
                            let mut last_inside = false;
                            loop {
                                let rect_opt = {
                                    let guard = hit_rect_thread.lock().unwrap();
                                    *guard
                                };

                                let cursor_pt = get_cursor_pos().unwrap_or((0, 0));
                                let poll_interval = get_adaptive_poll_interval_ms(
                                    cursor_pt,
                                    rect_opt.as_ref(),
                                );

                                if let Some(rect) = rect_opt {
                                    let inside = rect.contains_point(cursor_pt.0, cursor_pt.1);
                                    if inside != last_inside {
                                        update_window_clickthrough(raw_hwnd, inside);
                                        last_inside = inside;
                                    }
                                } else if last_inside {
                                    update_window_clickthrough(raw_hwnd, false);
                                    last_inside = false;
                                }

                                std::thread::sleep(Duration::from_millis(poll_interval));
                            }
                        });
                    }
                }
            }

            // Database setup
            let app_data = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::path::PathBuf::from("."));
            let _ = std::fs::create_dir_all(&app_data);
            let db_path = app_data.join("island.db");
            let store = Store::open(&db_path).unwrap_or_else(|e| {
                warn!("Falling back to in-memory store due to: {}", e);
                Store::open_in_memory().unwrap()
            });

            // Secrets setup
            let secrets: Arc<dyn SecretStore> = Arc::new(WindowsSecretStore::new("Island"));
            let token = secrets
                .get_secret("pairing-token")
                .ok()
                .flatten()
                .unwrap_or_else(|| {
                    let new_tok = generate_pairing_token();
                    let _ = secrets.set_secret("pairing-token", &new_tok);
                    new_tok
                });

            let token_lock = Arc::new(tokio::sync::RwLock::new(token.clone()));

            // Core State & Ingest channels
            let mut core = IslandCore::new();
            if let Ok(unreads) = store.get_unread_notifications() {
                core.load_initial_unread(unreads);
            }
            let core_arc = Arc::new(Mutex::new(core));

            let (input_tx, mut input_rx) = mpsc::channel::<Input>(64);
            let (event_tx, mut event_rx) = mpsc::channel::<Event>(64);
            let (focus_tx, mut focus_rx) = mpsc::channel::<island_contract::WebFocusReport>(64);

            // Forward incoming server events to core input
            let input_tx_for_events = input_tx.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    let _ = input_tx_for_events
                        .send(Input::EventAccepted(Box::new(event)))
                        .await;
                }
            });

            // Forward incoming web focus reports to core input
            let input_tx_for_focus = input_tx.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(report) = focus_rx.recv().await {
                    let _ = input_tx_for_focus
                        .send(Input::WebFocus(report))
                        .await;
                }
            });

            // Start Local HTTP/WS Server
            let server_state = ServerState::new(token, store.clone(), event_tx).with_focus_tx(focus_tx);
            let command_tx = server_state.command_tx.clone();
            let command_tx_for_effects = command_tx.clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server(DEFAULT_PORT, server_state).await {
                    error!("Local server failed to start: {}", e);
                }
            });

            // Platform Context Poller Task (500 ms context poll, §3.3)
            let input_tx_for_platform = input_tx.clone();
            let core_for_platform = core_arc.clone();
            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(500));
                let island_pid = std::process::id();
                loop {
                    interval.tick().await;
                    let (follow, fixed, idle_min) = {
                        let guard = core_for_platform.lock().unwrap();
                        (
                            guard.follow_active_monitor,
                            guard.fixed_monitor_id.clone(),
                            guard.idle_threshold_min,
                        )
                    };

                    let state = poll_platform_state(
                        island_pid,
                        fixed.as_deref(),
                        follow,
                        idle_min,
                    );

                    let _ = input_tx_for_platform
                        .send(Input::PlatformContext(Box::new(state)))
                        .await;
                }
            });

            // Tray setup
            let pause_item = CheckMenuItem::with_id(app, "pause", "Pause", true, false, None::<&str>)?;
            let dnd_item = CheckMenuItem::with_id(app, "dnd", "Do Not Disturb", true, false, None::<&str>)?;
            let settings_item = MenuItem::with_id(app, "settings", "Settings...", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;

            let tray_menu = Menu::with_items(
                app,
                &[&pause_item, &dnd_item, &settings_item, &quit_item],
            )?;

            let input_tx_for_tray = input_tx.clone();
            let app_handle_for_tray = app.handle().clone();

            let tray = TrayIconBuilder::new()
                .menu(&tray_menu)
                .tooltip("Island • 0 unread")
                .on_menu_event(move |_app, event| {
                    let id = event.id().as_ref();
                    match id {
                        "pause" => {
                            let tx = input_tx_for_tray.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = tx.send(Input::PauseToggled(true)).await;
                            });
                        }
                        "dnd" => {
                            let tx = input_tx_for_tray.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = tx.send(Input::DndToggled(true)).await;
                            });
                        }
                        "settings" => {
                            if let Some(win) = app_handle_for_tray.get_webview_window("settings") {
                                let _ = win.show();
                                let _ = win.set_focus();
                            }
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            // Background Core Event Loop & Effect Processor
            let app_handle = app.handle().clone();
            let core_for_loop = core_arc.clone();
            let store_for_loop = store.clone();
            let hit_rect_for_effects = hit_rect_arc.clone();
            let cmd_tx_for_effects = command_tx_for_effects.clone();

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(Duration::from_millis(100));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let now = current_millis();
                            let effects = {
                                let mut guard = core_for_loop.lock().unwrap();
                                guard.handle_input(Input::Tick, now)
                            };
                            process_effects(&app_handle, &store_for_loop, &tray, &core_for_loop, &hit_rect_for_effects, &cmd_tx_for_effects, effects);
                        }
                        Some(input) = input_rx.recv() => {
                            let now = current_millis();
                            let effects = {
                                let mut guard = core_for_loop.lock().unwrap();
                                guard.handle_input(input, now)
                            };
                            process_effects(&app_handle, &store_for_loop, &tray, &core_for_loop, &hit_rect_for_effects, &cmd_tx_for_effects, effects);
                        }
                    }
                }
            });

            // Register State
            app.manage(AppState {
                core: core_arc,
                store,
                secrets,
                server_token: token_lock,
                input_tx,
                hit_rect: hit_rect_arc,
                command_tx,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pairing_token,
            regenerate_pairing_token,
            send_island_input,
            update_hit_rect,
            get_monitors,
            set_monitor_settings,
            set_queue_focus,
            get_desktop_apps,
            save_desktop_apps
        ])
        .run(tauri::generate_context!())
        .expect("error while running island application");
}

fn process_effects(
    app: &AppHandle,
    store: &Store,
    tray: &TrayIcon,
    core: &Arc<Mutex<IslandCore>>,
    hit_rect: &Arc<Mutex<Option<Rect>>>,
    command_tx: &broadcast::Sender<WsServerMessage>,
    effects: Vec<Effect>,
) {
    for effect in effects {
        match effect {
            Effect::Render(vm) => {
                let _ = app.emit("island://view", &vm);
                let unread = {
                    let guard = core.lock().unwrap();
                    guard.unread_count()
                };
                let _ = tray.set_tooltip(Some(&format!("Island • {} unread", unread)));
            }
            Effect::PlaceWindow {
                monitor_id,
                transition: _,
            } => {
                if let Some(win) = app.get_webview_window("island") {
                    let monitors = enumerate_monitors();
                    if let Some(mon) = monitors.iter().find(|m| m.id == monitor_id) {
                        let (x, y, w, h) = calculate_window_position(
                            &mon.work_area,
                            640.0,
                            560.0,
                            mon.scale_factor,
                            0.0,
                        );

                        #[cfg(target_os = "windows")]
                        if let Ok(hwnd) = win.hwnd() {
                            use windows::Win32::Foundation::HWND;
                            use windows::Win32::UI::WindowsAndMessaging::{
                                SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_SHOWWINDOW,
                            };
                            unsafe {
                                let _ = SetWindowPos(
                                    HWND(hwnd.0 as _),
                                    HWND_TOPMOST,
                                    x,
                                    y,
                                    w,
                                    h,
                                    SWP_NOACTIVATE | SWP_SHOWWINDOW,
                                );
                            }
                        }
                    }
                }
            }
            Effect::SetHitRect(rect) => {
                let mut guard = hit_rect.lock().unwrap();
                *guard = rect;
            }
            Effect::Jump(target) => match target {
                Target::Url { url } => {
                    open_url(&url);
                }
                Target::BrowserTab {
                    tab_id,
                    window_id,
                    url,
                } => {
                    let cmd = WsServerMessage::Command {
                        request_id: uuid::Uuid::new_v4().to_string(),
                        command: "focusTab".to_string(),
                        tab_id,
                        window_id,
                    };
                    // Send command to browser extension; if extension is not connected, fallback to URL
                    if command_tx.send(cmd).is_err() {
                        if let Some(ref u) = url {
                            open_url(u);
                        }
                    }
                }
                Target::Process {
                    process_names,
                    window_title_contains,
                } => {
                    for proc in process_names {
                        if let Some(hwnd) = find_window_by_process_and_title(
                            &proc,
                            window_title_contains.as_deref(),
                        ) {
                            focus_window(hwnd);
                            break;
                        }
                    }
                }
                Target::Ide {
                    ref workspace_path,
                    ref deep_link,
                    ref window_title_contains,
                } => {
                    if let Some(ref link) = deep_link {
                        open_url(link);
                    } else {
                        let folder = std::path::Path::new(workspace_path)
                            .file_name()
                            .and_then(|n| n.to_str())
                            .unwrap_or(workspace_path);
                        let title_filter = window_title_contains.as_deref().unwrap_or(folder);
                        if let Some(hwnd) =
                            find_window_by_process_and_title("antigravity", Some(title_filter))
                        {
                            focus_window(hwnd);
                        }
                    }
                }
            },
            Effect::PersistSave(stored) => {
                let _ = store.save_notification(&stored);
            }
            Effect::PersistUpdateState(id, st) => {
                let _ = store.update_notification_state(id, st);
            }
            Effect::PersistRemove(id, res) => {
                let _ = store.remove_notification(id, res);
            }
            Effect::PersistClearAll(res) => {
                let _ = store.clear_all_unread(res);
            }
        }
    }
}

fn open_url(url: &str) {
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        use windows::core::PCWSTR;
        use windows::Win32::Foundation::HWND;
        use windows::Win32::UI::Shell::ShellExecuteW;
        use windows::Win32::UI::WindowsAndMessaging::SW_SHOWNORMAL;

        let wide_op: Vec<u16> = std::ffi::OsStr::new("open")
            .encode_wide()
            .chain(Some(0))
            .collect();
        let wide_url: Vec<u16> = std::ffi::OsStr::new(url)
            .encode_wide()
            .chain(Some(0))
            .collect();
        unsafe {
            let _ = ShellExecuteW(
                HWND(std::ptr::null_mut()),
                PCWSTR::from_raw(wide_op.as_ptr()),
                PCWSTR::from_raw(wide_url.as_ptr()),
                PCWSTR::null(),
                PCWSTR::null(),
                SW_SHOWNORMAL,
            );
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = url;
    }
}
