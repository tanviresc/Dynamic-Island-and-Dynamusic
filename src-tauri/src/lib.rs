use island_contract::{Event, Target};
use island_core::{Effect, Input, IslandCore, Millis};
use island_secrets::{generate_pairing_token, SecretStore, WindowsSecretStore};
use island_server::{start_server, ServerState, DEFAULT_PORT};
use island_store::Store;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::menu::{CheckMenuItem, Menu, MenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::mpsc;
use tracing::{error, info, warn};

pub struct AppState {
    pub core: Arc<Mutex<IslandCore>>,
    pub store: Store,
    pub secrets: Arc<dyn SecretStore>,
    pub server_token: Arc<tokio::sync::RwLock<String>>,
    pub input_tx: mpsc::Sender<Input>,
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
    let input = match action.as_str() {
        "pill_clicked" => Input::PillClicked,
        "dot_clicked" => Input::DotClicked,
        "queue_clear" => Input::QueueClear,
        "queue_close" => Input::QueueClose,
        "hover_enter" => Input::HoverEnter,
        "hover_leave" => Input::HoverLeave,
        _ => return Err(format!("Unknown action: {}", action)),
    };

    state.input_tx.send(input).await.map_err(|e| e.to_string())
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
            // Setup Island window styles on Windows
            if let Some(window) = app.get_webview_window("island") {
                #[cfg(target_os = "windows")]
                {
                    use windows::Win32::Foundation::HWND;
                    use windows::Win32::UI::WindowsAndMessaging::{
                        GetWindowLongW, SetWindowLongW, GWL_EXSTYLE, WS_EX_NOACTIVATE,
                        WS_EX_TOOLWINDOW,
                    };

                    if let Ok(hwnd) = window.hwnd() {
                        let hwnd = HWND(hwnd.0 as _);
                        unsafe {
                            let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                            SetWindowLongW(
                                hwnd,
                                GWL_EXSTYLE,
                                ex_style | WS_EX_TOOLWINDOW.0 as i32 | WS_EX_NOACTIVATE.0 as i32,
                            );
                        }
                    }
                }
            }

            // Database setup
            let app_data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
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

            // Forward incoming server events to core input
            let input_tx_for_events = input_tx.clone();
            tauri::async_runtime::spawn(async move {
                while let Some(event) = event_rx.recv().await {
                    let _ = input_tx_for_events
                        .send(Input::EventAccepted(Box::new(event)))
                        .await;
                }
            });

            // Start Local HTTP/WS Server
            let server_state = ServerState::new(token, store.clone(), event_tx);
            tauri::async_runtime::spawn(async move {
                if let Err(e) = start_server(DEFAULT_PORT, server_state).await {
                    error!("Local server failed to start: {}", e);
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

            tauri::async_runtime::spawn(async move {
                let mut interval = tokio::time::interval(std::time::Duration::from_millis(100));
                loop {
                    tokio::select! {
                        _ = interval.tick() => {
                            let now = current_millis();
                            let effects = {
                                let mut guard = core_for_loop.lock().unwrap();
                                guard.handle_input(Input::Tick, now)
                            };
                            process_effects(&app_handle, &store_for_loop, &tray, &core_for_loop, effects);
                        }
                        Some(input) = input_rx.recv() => {
                            let now = current_millis();
                            let effects = {
                                let mut guard = core_for_loop.lock().unwrap();
                                guard.handle_input(input, now)
                            };
                            process_effects(&app_handle, &store_for_loop, &tray, &core_for_loop, effects);
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
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_pairing_token,
            regenerate_pairing_token,
            send_island_input
        ])
        .run(tauri::generate_context!())
        .expect("error while running island application");
}

fn process_effects(
    app: &AppHandle,
    store: &Store,
    tray: &TrayIcon,
    core: &Arc<Mutex<IslandCore>>,
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
            Effect::Jump(target) => match target {
                Target::Url { url } => {
                    open_url(&url);
                }
                Target::BrowserTab { url: Some(u), .. } => {
                    open_url(&u);
                }
                _ => {}
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
