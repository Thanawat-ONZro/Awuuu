// Awuuu runs without a console window: the companion is the whole UI.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    awuuu_lib::run()
}
