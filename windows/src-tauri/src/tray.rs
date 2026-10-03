// Notification-area icon: Open, Settings, Reset position, Check for updates, Pause, Quit.

use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::TrayIconBuilder;
use tauri::{AppHandle, Emitter};

use crate::island::WINDOW_LABEL;

pub fn build(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Awuuu", true, None::<&str>)?;
    let settings = MenuItem::with_id(app, "settings", "Settings…", true, None::<&str>)?;
    let updates = MenuItem::with_id(app, "updates", "Check for updates…", true, None::<&str>)?;
    let pause = MenuItem::with_id(app, "pause", "Pause", true, None::<&str>)?;
    let reset = MenuItem::with_id(app, "reset-position", "Reset island position", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
    let sep1 = PredefinedMenuItem::separator(app)?;
    let sep2 = PredefinedMenuItem::separator(app)?;

    let menu = Menu::with_items(app, &[&open, &sep1, &settings, &reset, &updates, &pause, &sep2, &quit])?;

    let mut builder = TrayIconBuilder::with_id("awuuu")
        .tooltip("Awuuu")
        .menu(&menu)
        .on_menu_event(|app: &AppHandle, event| match event.id.as_ref() {
            "quit" => app.exit(0),
            "settings" => crate::show_settings_window(app),
            "updates" => crate::updater::check_now(app),
            "reset-position" => crate::reset_island_position(app),
            id => {
                let _ = app.emit_to(WINDOW_LABEL, "tray", id.to_string());
            }
        });

    let icon = match app.default_window_icon() {
        Some(icon) => icon.clone(),
        None => tauri::include_image!("icons/32x32.png"),
    };
    builder = builder.icon(icon);

    builder.build(app)?;
    Ok(())
}
