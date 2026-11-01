// The Shelf: holds dropped files under %LOCALAPPDATA%\Awuuu\shelf.
// Safe retention policy (default 7 days), copy on drag-out, zero outside path modifications.

use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};

use crate::files;
use crate::settings;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ShelfFile {
    pub name: String,
    pub path: String,
    pub size: u64,
    pub added_at_ms: u64,
}

pub fn shelf_dir() -> PathBuf {
    settings::local_dir().join("shelf")
}

fn drag_paths(root: &Path, paths: Vec<String>) -> Result<Vec<PathBuf>, String> {
    if paths.is_empty() || paths.len() > 100 { return Err("Select 1 to 100 files to drag".into()); }
    let root = root.canonicalize().map_err(|_| "Shelf is empty")?;
    let mut files = Vec::new();
    for path in paths {
        let path = PathBuf::from(path).canonicalize().map_err(|_| "Shelf file no longer exists")?;
        if path.parent() != Some(root.as_path()) || !path.is_file() {
            return Err("Only files on Shelf can be dragged".into());
        }
        if !files.contains(&path) { files.push(path); }
    }
    Ok(files)
}

#[tauri::command]
pub async fn shelf_start_drag(window: tauri::WebviewWindow, paths: Vec<String>) -> Result<bool, String> {
    use std::sync::{Arc, atomic::{AtomicBool, Ordering}};
    static DRAG: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = DRAG.try_acquire().map_err(|_| "A file drag is already in progress")?;
    if window.label() != crate::island::WINDOW_LABEL { return Err("Drag files from the island".into()); }
    let files = drag_paths(&shelf_dir(), paths)?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    let source = window.clone();
    window.run_on_main_thread(move || {
        let dropped = Arc::new(AtomicBool::new(false));
        let result_flag = dropped.clone();
        let result = drag::start_drag(&source, drag::DragItem::Files(files),
            drag::Image::Raw(include_bytes!("../icons/32x32.png").to_vec()),
            move |result, _| { result_flag.store(matches!(result, drag::DragResult::Dropped), Ordering::Relaxed); },
            drag::Options { mode: drag::DragMode::Copy, ..Default::default() })
            .map(|_| dropped.load(Ordering::Relaxed)).map_err(|e| e.to_string());
        let _ = tx.send(result);
    }).map_err(|e| e.to_string())?;
    rx.await.map_err(|e| e.to_string())?
}

/// Small local thumbnails; never read outside the shelf or decode unbounded images.
#[tauri::command]
pub async fn shelf_preview(path: String) -> Option<String> {
    static PREVIEWS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(2);
    let _permit = PREVIEWS.acquire().await.ok()?;
    tauri::async_runtime::spawn_blocking(move || {
        let root = shelf_dir().canonicalize().ok()?;
        let file = PathBuf::from(path).canonicalize().ok()?;
        if file.parent()? != root || !file.is_file() {
            return None;
        }
        let is_image = file.extension().and_then(|s| s.to_str()).is_some_and(|s|
            ["png", "jpg", "jpeg", "webp", "bmp"].contains(&s.to_ascii_lowercase().as_str()));
        if !is_image || file.metadata().ok()?.len() > 25 * 1024 * 1024 {
            return std::thread::spawn(move || shell_icon(&file)).join().ok().flatten();
        }
        let mut reader = image::ImageReader::open(file).ok()?.with_guessed_format().ok()?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(64 * 1024 * 1024);
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        reader.limits(limits);
        let thumbnail = reader.decode().ok()?.thumbnail(240, 240);
        let mut output = std::io::Cursor::new(Vec::new());
        thumbnail.write_to(&mut output, image::ImageFormat::Png).ok()?;
        Some(format!("data:image/png;base64,{}", crate::claude::base64_for(output.get_ref())))
    }).await.ok().flatten()
}

/// Explorer's associated icon, including embedded EXE icons; no file is launched.
fn shell_icon(path: &Path) -> Option<String> {
    // canonicalize() adds a verbatim prefix on Windows. Shell namespace APIs
    // need normal DOS/UNC syntax, unlike filesystem APIs that accept both.
    let path = dunce::simplified(path);
    use windows::core::PCWSTR;
    use windows::Win32::Foundation::SIZE;
    use windows::Win32::Graphics::Gdi::*;
    use windows::Win32::System::Com::*;
    use windows::Win32::UI::Shell::{SHCreateItemFromParsingName, IShellItemImageFactory, SIIGBF_ICONONLY};
    struct ComApartment;
    impl Drop for ComApartment {
        fn drop(&mut self) { unsafe { CoUninitialize(); } }
    }
    unsafe {
        CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().ok()?;
        let _apartment = ComApartment;
        let wide: Vec<u16> = path.to_string_lossy().encode_utf16().chain(Some(0)).collect();
        let factory: IShellItemImageFactory = SHCreateItemFromParsingName(PCWSTR(wide.as_ptr()), None).ok()?;
        let bitmap = factory.GetImage(SIZE { cx: 96, cy: 96 }, SIIGBF_ICONONLY).ok()?;
        let dc = GetDC(None);
        let result = (|| {
            let mut info = BITMAP::default();
            if GetObjectW(HGDIOBJ(bitmap.0), std::mem::size_of::<BITMAP>() as i32,
                Some((&mut info as *mut BITMAP).cast())) == 0 { return None; }
            let (w, h) = (info.bmWidth, info.bmHeight.abs());
            if w <= 0 || h <= 0 || w > 256 || h > 256 { return None; }
            let mut pixels = vec![0u8; (w * h * 4) as usize];
            let mut dib = BITMAPINFO::default();
            dib.bmiHeader = BITMAPINFOHEADER {
                biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: w, biHeight: -h, biPlanes: 1, biBitCount: 32,
                biCompression: BI_RGB.0, ..Default::default()
            };
            if GetDIBits(dc, bitmap, 0, h as u32, Some(pixels.as_mut_ptr().cast()), &mut dib, DIB_RGB_COLORS) == 0 { return None; }
            for pixel in pixels.chunks_exact_mut(4) { pixel.swap(0, 2); }
            let image = image::RgbaImage::from_raw(w as u32, h as u32, pixels)?;
            let mut output = std::io::Cursor::new(Vec::new());
            image::DynamicImage::ImageRgba8(image).write_to(&mut output, image::ImageFormat::Png).ok()?;
            Some(format!("data:image/png;base64,{}", crate::claude::base64_for(output.get_ref())))
        })();
        let _ = ReleaseDC(None, dc);
        let _ = DeleteObject(HGDIOBJ(bitmap.0));
        result
    }
}

#[cfg(test)]
mod preview_tests {
    #[test]
    fn windows_executable_has_a_local_png_icon() {
        let executable = std::env::current_exe().unwrap().canonicalize().unwrap();
        let icon = super::shell_icon(&executable).expect("Windows executable icon");
        assert!(icon.starts_with("data:image/png;base64,iVBORw0KGgo"));
        assert!(icon.len() > 100);
    }
}

/// Lists all files in the shelf folder. Sweeps files exceeding `retention_days` (default 7 days).
#[tauri::command]
pub async fn shelf_list(retention_days: Option<u32>) -> Result<Vec<ShelfFile>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let dir = shelf_dir();
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
            return Ok(Vec::new());
        }

        let days = retention_days.unwrap_or(7);
        sweep(&dir, days);

        let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
        let mut files = Vec::new();

        for entry in entries.flatten() {
            let Ok(meta) = entry.metadata() else { continue };
            if meta.is_dir() {
                continue;
            }

            let name = entry.file_name().to_string_lossy().to_string();
            let path = entry.path().to_string_lossy().to_string();
            let size = meta.len();
            let added_at_ms = meta
                .modified()
                .unwrap_or_else(|_| SystemTime::now())
                .duration_since(UNIX_EPOCH)
                .map(|d| d.as_millis() as u64)
                .unwrap_or(0);

            files.push(ShelfFile {
                name,
                path,
                size,
                added_at_ms,
            });
        }

        // Sort newest first
        files.sort_by(|a, b| b.added_at_ms.cmp(&a.added_at_ms));
        Ok(files)
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Copies a file into the shelf folder, never overwriting existing items.
#[tauri::command]
pub async fn shelf_add(source: String, original_name: Option<String>) -> Result<ShelfFile, String> {
    static ADDS: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(1);
    let _permit = ADDS.acquire().await.map_err(|e| e.to_string())?;
    tauri::async_runtime::spawn_blocking(move || {
        add_to_shelf(&shelf_dir(), Path::new(&source), original_name.as_deref())
    }).await.map_err(|e| e.to_string())?
}

fn same_contents(a: &Path, b: &Path) -> std::io::Result<bool> {
    use std::io::Read;
    let mut left = std::io::BufReader::new(std::fs::File::open(a)?);
    let mut right = std::io::BufReader::new(std::fs::File::open(b)?);
    let mut x = [0u8; 65536];
    let mut y = [0u8; 65536];
    loop {
        let nx = left.read(&mut x)?;
        let mut ny = 0;
        while ny < nx {
            let n = right.read(&mut y[ny..nx])?;
            if n == 0 { return Ok(false); }
            ny += n;
        }
        if x[..nx] != y[..ny] { return Ok(false); }
        if nx == 0 { return Ok(right.read(&mut y[..1])? == 0); }
    }
}

fn add_to_shelf(dir: &Path, src: &Path, original_name: Option<&str>) -> Result<ShelfFile, String> {
        let meta = std::fs::metadata(src).map_err(|e| format!("cannot read file: {e}"))?;
        if meta.is_dir() {
            return Err("Folders cannot be added to shelf.".into());
        }

        std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;

        for entry in std::fs::read_dir(dir).map_err(|e| e.to_string())?.flatten() {
            let path = entry.path();
            let Ok(existing) = path.metadata() else { continue };
            if existing.is_file() && existing.len() == meta.len() && same_contents(src, &path).unwrap_or(false) {
                return Ok(ShelfFile {
                    name: entry.file_name().to_string_lossy().into_owned(),
                    path: path.to_string_lossy().into_owned(), size: existing.len(),
                    added_at_ms: existing.modified().unwrap_or(SystemTime::now()).duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() as u64,
                });
            }
        }

        let name = src
            .file_name()
            .map(|n| n.to_string_lossy().to_string())
            .unwrap_or_else(|| "file".into());

        let name = original_name.filter(|name| !name.is_empty() && *name != "." && *name != ".."
            && !name.chars().any(|c| c.is_control() || "<>:\"/\\|?*".contains(c))
            && !name.ends_with([' ', '.'])).unwrap_or(&name);
        let dest = files::free_name(dir, name);
        std::fs::copy(src, &dest).map_err(|e| format!("cannot copy to shelf: {e}"))?;

        // Clear read-only bit if copied from read-only source so timestamp update succeeds
        if let Ok(mut perms) = std::fs::metadata(&dest).map(|m| m.permissions()) {
            if perms.readonly() {
                perms.set_readonly(false);
                let _ = std::fs::set_permissions(&dest, perms);
            }
        }

        // Fresh timestamp for retention window
        let now = SystemTime::now();
        if let Ok(file) = std::fs::File::options().write(true).open(&dest) {
            let _ = file.set_modified(now);
        }

        let added_at_ms = now
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_millis() as u64)
            .unwrap_or(0);

        Ok(ShelfFile {
            name: dest.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| name.to_owned()),
            path: dest.to_string_lossy().to_string(),
            size: meta.len(),
            added_at_ms,
        })
}

/// Removes a specific file from the shelf.
/// SAFETY: Ensures path is strictly inside the shelf directory. Never touches outside files.
#[tauri::command]
pub fn shelf_remove(path: String) -> Result<bool, String> {
    let p = Path::new(&path);
    let dir = shelf_dir();

    let Ok(canon_dir) = std::fs::canonicalize(&dir) else {
        return Ok(false);
    };
    let Ok(canon_p) = std::fs::canonicalize(p) else {
        return Ok(false);
    };

    if !canon_p.starts_with(&canon_dir) {
        return Err("Refusing to delete file outside shelf folder.".into());
    }

    if canon_p.is_file() {
        std::fs::remove_file(canon_p).map_err(|e| e.to_string())?;
        Ok(true)
    } else {
        Ok(false)
    }
}

/// Clears all files in the shelf directory.
#[tauri::command]
pub fn shelf_clear() -> Result<usize, String> {
    let dir = shelf_dir();
    if !dir.exists() {
        return Ok(0);
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| e.to_string())?;
    let mut count = 0;
    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if meta.is_file() && std::fs::remove_file(entry.path()).is_ok() {
            count += 1;
        }
    }
    Ok(count)
}

pub(crate) fn sweep(dir: &Path, retention_days: u32) {
    let Ok(entries) = std::fs::read_dir(dir) else { return };
    let keep_duration = Duration::from_secs(retention_days as u64 * 86400);
    let now = SystemTime::now();

    for entry in entries.flatten() {
        let Ok(meta) = entry.metadata() else { continue };
        if !meta.is_file() {
            continue;
        }
        let Ok(modified) = meta.modified() else { continue };
        if now.duration_since(modified).map(|age| age > keep_duration).unwrap_or(false) {
            let _ = std::fs::remove_file(entry.path());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn repeated_drop_reuses_bytes_and_keeps_original_filename() {
        let root = std::env::temp_dir().join(format!("awuuu-dedupe-{}-{}", std::process::id(), SystemTime::now().duration_since(UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir_all(&root).unwrap();
        let source = root.join("inbox-renamed (2).exe");
        let shelf = root.join("shelf");
        std::fs::write(&source, vec![7u8; 150_000]).unwrap();
        let first = add_to_shelf(&shelf, &source, Some("ไฟล์ต้นฉบับ.exe")).unwrap();
        let repeated = add_to_shelf(&shelf, &source, Some("ไฟล์ต้นฉบับ.exe")).unwrap();
        assert_eq!(first.path, repeated.path);
        assert_eq!(first.name, "ไฟล์ต้นฉบับ.exe");
        assert_eq!(std::fs::read_dir(&shelf).unwrap().count(), 1);
        std::fs::write(&source, vec![8u8; 150_000]).unwrap();
        let changed = add_to_shelf(&shelf, &source, Some("ไฟล์ต้นฉบับ.exe")).unwrap();
        assert_ne!(first.path, changed.path);
        assert_eq!(std::fs::read(&first.path).unwrap()[0], 7);
        assert_eq!(std::fs::read_dir(&shelf).unwrap().count(), 2);
        let drag = drag_paths(&shelf, vec![first.path.clone(), changed.path.clone(), first.path.clone()]).unwrap();
        assert_eq!(drag.len(), 2);
        assert!(drag_paths(&shelf, vec![source.to_string_lossy().into_owned()]).is_err());
        assert!(drag_paths(&shelf, vec![]).is_err());
        std::fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn test_shelf_lifecycle_and_safety() {
        let tmp = std::env::temp_dir().join(format!("awuuu-shelf-test-{}", std::process::id()));
        std::fs::create_dir_all(&tmp).unwrap();

        let sample = tmp.join("demo.txt");
        std::fs::write(&sample, b"shelf test content").unwrap();

        let sdir = shelf_dir();
        std::fs::create_dir_all(&sdir).unwrap();

        let added = tauri::async_runtime::block_on(shelf_add(sample.to_str().unwrap().to_string(), None)).unwrap();
        assert_eq!(added.name, "demo.txt");
        assert!(Path::new(&added.path).exists());
        assert_eq!(added.size, 18);

        // Outside path deletion must be refused
        assert!(shelf_remove(sample.to_str().unwrap().to_string()).is_err());
        assert!(sample.exists());

        // Inside shelf deletion must succeed
        let removed = shelf_remove(added.path.clone()).unwrap();
        assert!(removed);
        assert!(!Path::new(&added.path).exists());

        let _ = std::fs::remove_dir_all(&tmp);
    }

    #[test]
    fn test_shelf_readonly_sweep_case() {
        let tmp = std::env::temp_dir().join(format!("awuuu-shelf-sweep-test-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&tmp);
        std::fs::create_dir_all(&tmp).unwrap();

        // 1. Subfolder: sweep must never touch directories
        let sub = tmp.join("subfolder");
        std::fs::create_dir(&sub).unwrap();
        std::fs::write(sub.join("nested.txt"), b"nested").unwrap();

        // 2. Old file exceeding 7 days retention
        let old_file = tmp.join("old.txt");
        std::fs::write(&old_file, b"old content").unwrap();
        let ten_days_ago = SystemTime::now() - Duration::from_secs(10 * 86400);
        let f_old = std::fs::File::options().write(true).open(&old_file).unwrap();
        f_old.set_modified(ten_days_ago).unwrap();
        drop(f_old);

        // 3. Read-only file added to shelf
        let src_ro = tmp.join("source_ro.txt");
        std::fs::write(&src_ro, b"read only source").unwrap();
        let mut perms = std::fs::metadata(&src_ro).unwrap().permissions();
        perms.set_readonly(true);
        std::fs::set_permissions(&src_ro, perms).unwrap();

        // Simulate shelf_add copy + readonly clearance + mtime refresh
        let dest_ro = tmp.join("copied_ro.txt");
        std::fs::copy(&src_ro, &dest_ro).unwrap();
        assert!(std::fs::metadata(&dest_ro).unwrap().permissions().readonly());

        // Clearing read-only allows set_modified to succeed
        if let Ok(mut perms) = std::fs::metadata(&dest_ro).map(|m| m.permissions()) {
            if perms.readonly() {
                perms.set_readonly(false);
                std::fs::set_permissions(&dest_ro, perms).unwrap();
            }
        }
        let now = SystemTime::now();
        let f_dest = std::fs::File::options().write(true).open(&dest_ro).unwrap();
        f_dest.set_modified(now).unwrap();
        drop(f_dest);

        // Run sweep with 7-day retention
        sweep(&tmp, 7);

        // Assert: old file swept, read-only copy preserved, subfolder preserved
        assert!(!old_file.exists(), "files older than retention window must be swept");
        assert!(dest_ro.exists(), "read-only copy with refreshed timestamp must be preserved");
        assert!(sub.exists(), "sweep must never delete subfolders");
        assert!(sub.join("nested.txt").exists());

        // Cleanup
        let _ = std::fs::set_permissions(&src_ro, {
            let mut p = std::fs::metadata(&src_ro).unwrap().permissions();
            p.set_readonly(false);
            p
        });
        let _ = std::fs::remove_dir_all(&tmp);
    }
}
