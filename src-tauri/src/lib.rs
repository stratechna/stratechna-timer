use tauri::{
    image::Image,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WebviewUrl, WebviewWindowBuilder,
};

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_shell::init())
        .setup(|app| {
            // ── Janela principal (oculta por defeito) ──────────────────────
            let win = WebviewWindowBuilder::new(
                app,
                "main",
                WebviewUrl::App("index.html".into()),
            )
            .title("Stratechna Cronómetros")
            .inner_size(420.0, 620.0)
            .resizable(false)
            .decorations(true)
            .visible(false)
            .center()
            .skip_taskbar(true)
            .build()?;

            // Fechar janela esconde-a em vez de sair
            let win_clone = win.clone();
            win.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    win_clone.hide().unwrap_or_default();
                }
            });

            // ── Menu de contexto do tray ───────────────────────────────────
            let open_i = MenuItemBuilder::with_id("open", "Abrir Cronómetros").build(app)?;
            let portal_i = MenuItemBuilder::with_id("portal", "Abrir Portal").build(app)?;
            let sep_i = tauri::menu::PredefinedMenuItem::separator(app)?;
            let quit_i = MenuItemBuilder::with_id("quit", "Sair").build(app)?;

            let menu = MenuBuilder::new(app)
                .item(&open_i)
                .item(&portal_i)
                .item(&sep_i)
                .item(&quit_i)
                .build()?;

            // ── Ícone do tray ──────────────────────────────────────────────
            let icon = app.default_window_icon().cloned().unwrap_or_else(|| {
                Image::from_bytes(include_bytes!("../icons/icon.png")).unwrap()
            });

            let _tray = TrayIconBuilder::new()
                .icon(icon)
                .menu(&menu)
                .tooltip("Stratechna Cronómetros")
                .on_menu_event(move |app, event| match event.id.as_ref() {
                    "open" => {
                        let w = app.get_webview_window("main").unwrap();
                        if w.is_visible().unwrap_or(false) {
                            w.hide().unwrap_or_default();
                        } else {
                            w.show().unwrap_or_default();
                            w.set_focus().unwrap_or_default();
                        }
                    }
                    "portal" => {
                        let _ = app.shell().open(
                            "https://portal.stratechna.com/cronometros",
                            None,
                        );
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    // Clique esquerdo → toggle janela
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        let w = app.get_webview_window("main").unwrap();
                        if w.is_visible().unwrap_or(false) {
                            w.hide().unwrap_or_default();
                        } else {
                            w.show().unwrap_or_default();
                            w.set_focus().unwrap_or_default();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![update_tray_label])
        .run(tauri::generate_context!())
        .expect("Erro ao iniciar Stratechna Timer");
}

/// Chamado pelo frontend para actualizar o label do tray com o tempo activo
#[tauri::command]
fn update_tray_label(app: tauri::AppHandle, label: String) {
    if let Some(tray) = app.tray_by_id("main") {
        // Actualiza o tooltip com o tempo corrente
        let tooltip = if label.is_empty() {
            "Stratechna Cronómetros".to_string()
        } else {
            format!("⏱ {} — Stratechna", label)
        };
        let _ = tray.set_tooltip(Some(&tooltip));

        // No macOS, actualiza também o título inline na menu bar
        #[cfg(target_os = "macos")]
        {
            let title = if label.is_empty() {
                None
            } else {
                Some(label.as_str())
            };
            let _ = tray.set_title(title);
        }
    }
}
