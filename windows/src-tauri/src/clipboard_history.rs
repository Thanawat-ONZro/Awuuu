//! Local, bounded session history. The listener only wakes a worker on clipboard changes.
use serde::Serialize;
use std::{
    collections::VecDeque,
    io::Cursor,
    sync::{
        atomic::{AtomicBool, AtomicIsize, AtomicU32, Ordering},
        mpsc::{sync_channel, SyncSender},
        Mutex, OnceLock,
    },
    time::{SystemTime, UNIX_EPOCH},
};
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HANDLE, HGLOBAL, HWND, LPARAM, LRESULT, WPARAM},
        System::{DataExchange::*, LibraryLoader::GetModuleHandleW, Memory::*},
        UI::WindowsAndMessaging::*,
    },
};

const MAX_ITEMS: usize = 50;
const MAX_TEXT: usize = 64 * 1024;
const MAX_IMAGE: usize = 4 * 1024 * 1024;
const MAX_TOTAL: usize = 20 * 1024 * 1024;
const MAX_AGE: u64 = 24 * 60 * 60 * 1000;
static ENABLED: AtomicBool = AtomicBool::new(false);
static READY: AtomicBool = AtomicBool::new(false);
static SKIP: AtomicU32 = AtomicU32::new(0);
static OWNER: AtomicIsize = AtomicIsize::new(0);
static EPOCH: AtomicU32 = AtomicU32::new(0);
static SIGNAL: OnceLock<SyncSender<()>> = OnceLock::new();
static HISTORY: OnceLock<Mutex<History>> = OnceLock::new();

#[derive(Clone)]
enum Content {
    Text(String),
    Image(Vec<u8>),
}
impl Content {
    fn bytes(&self) -> &[u8] {
        match self {
            Self::Text(s) => s.as_bytes(),
            Self::Image(b) => b,
        }
    }
}
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Entry {
    id: u64,
    kind: &'static str,
    text: Option<String>,
    preview: Option<String>,
    added_at_ms: u64,
    #[serde(skip)]
    content: Option<Content>,
}
#[derive(Default)]
struct History {
    items: VecDeque<Entry>,
    next_id: u64,
}
impl History {
    fn prune(&mut self, now: u64) {
        self.items
            .retain(|e| now.saturating_sub(e.added_at_ms) < MAX_AGE);
        while self.items.len() > MAX_ITEMS
            || self
                .items
                .iter()
                .map(|e| e.content.as_ref().map_or(0, |c| c.bytes().len()))
                .sum::<usize>()
                > MAX_TOTAL
        {
            self.items.pop_back();
        }
    }
    fn insert(&mut self, content: Content, preview: Option<String>, now: u64) {
        self.prune(now);
        self.items.retain(|e| {
            e.content
                .as_ref()
                .is_none_or(|c| c.bytes() != content.bytes())
        });
        self.next_id += 1;
        let (kind, text) = match &content {
            Content::Text(s) => ("text", Some(s.clone())),
            Content::Image(_) => ("image", None),
        };
        self.items.push_front(Entry {
            id: self.next_id,
            kind,
            text,
            preview,
            added_at_ms: now,
            content: Some(content),
        });
        self.prune(now);
    }
}
fn history() -> &'static Mutex<History> {
    HISTORY.get_or_init(|| Mutex::new(History::default()))
}
fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as u64
}
pub fn diagnostic_state() -> serde_json::Value {
    let h = history().lock().unwrap();
    serde_json::json!({"ready":READY.load(Ordering::Acquire),"recording":ENABLED.load(Ordering::Relaxed),"items":h.items.len(),
        "textItems":h.items.iter().filter(|e| e.kind == "text").count(),
        "imageItems":h.items.iter().filter(|e| e.kind == "image").count()})
}
fn changed(app: &AppHandle) {
    let _ = app.emit("clipboard-history-changed", ());
}

struct ClipboardLock;
impl ClipboardLock {
    fn open() -> Result<Self, String> {
        let owner = OWNER.load(Ordering::Acquire);
        for _ in 0..4 {
            if unsafe {
                OpenClipboard(if owner == 0 {
                    None
                } else {
                    Some(HWND(owner as *mut _))
                })
            }
            .is_ok()
            {
                return Ok(Self);
            }
            std::thread::sleep(std::time::Duration::from_millis(15));
        }
        Err("Clipboard is busy. Try again.".into())
    }
}
impl Drop for ClipboardLock {
    fn drop(&mut self) {
        let _ = unsafe { CloseClipboard() };
    }
}
unsafe fn read_bytes(format: u32, limit: usize) -> Option<Vec<u8>> {
    let handle = unsafe { GetClipboardData(format) }.ok()?;
    let mem = HGLOBAL(handle.0);
    let len = unsafe { GlobalSize(mem) };
    if len == 0 || len > limit {
        return None;
    }
    let ptr = unsafe { GlobalLock(mem) };
    if ptr.is_null() {
        return None;
    }
    let bytes = unsafe { std::slice::from_raw_parts(ptr.cast::<u8>(), len) }.to_vec();
    let _ = unsafe { GlobalUnlock(mem) };
    Some(bytes)
}
fn format(name: &str) -> u32 {
    let wide: Vec<u16> = name.encode_utf16().chain(Some(0)).collect();
    unsafe { RegisterClipboardFormatW(PCWSTR(wide.as_ptr())) }
}
fn read_content() -> Option<(Content, Option<String>)> {
    let _lock = ClipboardLock::open().ok()?;
    if !ENABLED.load(Ordering::Relaxed)
        || unsafe { GetClipboardSequenceNumber() } == SKIP.load(Ordering::Acquire)
    {
        return None;
    }
    if unsafe { IsClipboardFormatAvailable(format("ExcludeClipboardContentFromMonitorProcessing")) }
        .is_ok()
    {
        return None;
    }
    if unsafe { read_bytes(format("CanIncludeInClipboardHistory"), 256) }
        .is_some_and(|b| b.len() >= 4 && b[..4] == [0, 0, 0, 0])
    {
        return None;
    }
    let png = unsafe { read_bytes(format("PNG"), 32 * 1024 * 1024) };
    let dib = if png.is_none() {
        unsafe { read_bytes(8, 64 * 1024 * 1024) }
    } else {
        None
    };
    let raw_text = unsafe { read_bytes(13, MAX_TEXT * 2 + 2) };
    drop(_lock);
    if let Some(bytes) = png.or_else(|| dib.and_then(|dib| dib_to_bmp(&dib))) {
        // Bound decoded memory before allocation, including malicious clipboard images.
        let mut reader = image::ImageReader::new(Cursor::new(&bytes))
            .with_guessed_format()
            .ok()?;
        let mut limits = image::Limits::default();
        limits.max_alloc = Some(64 * 1024 * 1024);
        limits.max_image_width = Some(8192);
        limits.max_image_height = Some(8192);
        reader.limits(limits);
        let image = reader.decode().ok()?;
        let mut out = Cursor::new(Vec::new());
        image.write_to(&mut out, image::ImageFormat::Png).ok()?;
        if out.get_ref().len() > MAX_IMAGE {
            return None;
        }
        let mut thumb = Cursor::new(Vec::new());
        image
            .thumbnail(240, 160)
            .write_to(&mut thumb, image::ImageFormat::Png)
            .ok()?;
        let preview = format!(
            "data:image/png;base64,{}",
            crate::claude::base64_for(thumb.get_ref())
        );
        return Some((Content::Image(out.into_inner()), Some(preview)));
    }
    let raw = raw_text?;
    let units: Vec<u16> = raw
        .chunks_exact(2)
        .map(|c| u16::from_le_bytes([c[0], c[1]]))
        .take_while(|c| *c != 0)
        .collect();
    let text = String::from_utf16_lossy(&units);
    if text.trim().is_empty() || text.len() > MAX_TEXT {
        return None;
    }
    Some((Content::Text(text), None))
}
fn dib_to_bmp(dib: &[u8]) -> Option<Vec<u8>> {
    if dib.len() < 40 {
        return None;
    }
    let header = u32::from_le_bytes(dib[..4].try_into().ok()?) as usize;
    if !(40..=124).contains(&header) || dib.len() < header {
        return None;
    }
    let bits = u16::from_le_bytes(dib[14..16].try_into().ok()?);
    let compression = u32::from_le_bytes(dib[16..20].try_into().ok()?);
    let used = u32::from_le_bytes(dib[32..36].try_into().ok()?) as usize;
    let colors = if used > 0 {
        used
    } else if bits <= 8 {
        1usize << bits
    } else {
        0
    };
    let masks = if header == 40 && compression == 3 {
        12
    } else if header == 40 && compression == 6 {
        16
    } else {
        0
    };
    let offset = 14usize
        .checked_add(header)?
        .checked_add(masks)?
        .checked_add(colors.checked_mul(4)?)?;
    if offset > dib.len() + 14 {
        return None;
    }
    let mut bmp = Vec::with_capacity(dib.len() + 14);
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&((dib.len() + 14) as u32).to_le_bytes());
    bmp.extend_from_slice(&[0; 4]);
    bmp.extend_from_slice(&(offset as u32).to_le_bytes());
    bmp.extend_from_slice(dib);
    Some(bmp)
}
unsafe extern "system" fn window_proc(hwnd: HWND, msg: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    if msg == WM_CLIPBOARDUPDATE {
        if ENABLED.load(Ordering::Relaxed) {
            if let Some(tx) = SIGNAL.get() {
                let _ = tx.try_send(());
            }
        }
        return LRESULT(0);
    }
    unsafe { DefWindowProcW(hwnd, msg, wp, lp) }
}
pub fn start(app: AppHandle, enabled: bool) {
    ENABLED.store(enabled, Ordering::Relaxed);
    let (tx, rx) = sync_channel(1);
    let _ = SIGNAL.set(tx);
    std::thread::spawn(move || {
        while rx.recv().is_ok() {
            let epoch = EPOCH.load(Ordering::Acquire);
            if let Some((content, preview)) = read_content() {
                let mut h = history().lock().unwrap();
                if ENABLED.load(Ordering::Relaxed) && epoch == EPOCH.load(Ordering::Acquire) {
                    h.insert(content, preview, now_ms());
                    drop(h);
                    changed(&app);
                }
            }
        }
    });
    std::thread::spawn(|| unsafe {
        let instance = GetModuleHandleW(None)
            .ok()
            .map(|h| h.into())
            .unwrap_or_default();
        let class = WNDCLASSW {
            lpfnWndProc: Some(window_proc),
            hInstance: instance,
            lpszClassName: w!("AwuuuClipboardHistory"),
            ..Default::default()
        };
        if RegisterClassW(&class) == 0 {
            return;
        }
        let Ok(hwnd) = CreateWindowExW(
            WINDOW_EX_STYLE::default(),
            class.lpszClassName,
            w!(""),
            WINDOW_STYLE::default(),
            0,
            0,
            0,
            0,
            Some(HWND_MESSAGE),
            None,
            Some(instance),
            None,
        ) else {
            return;
        };
        if AddClipboardFormatListener(hwnd).is_err() {
            return;
        }
        OWNER.store(hwnd.0 as isize, Ordering::Release);
        READY.store(true, Ordering::Release);
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {
            let _ = DispatchMessageW(&msg);
        }
    });
}

pub fn capture_enabled(modules: &std::collections::BTreeMap<String, bool>) -> bool {
    // The retired opt-in flag could be false before automatic history existed.
    // Only an explicit pause in the automatic-history UI should stop capture.
    !modules.get("clipboardPaused").copied().unwrap_or(false)
}

#[cfg(test)]
mod automatic_capture_tests {
    #[test]
    fn legacy_opt_in_false_does_not_pause_automatic_history() {
        let mut modules = std::collections::BTreeMap::new();
        modules.insert("clipboardRecording".into(), false);
        assert!(super::capture_enabled(&modules));
        modules.insert("clipboardPaused".into(), true);
        assert!(!super::capture_enabled(&modules));
        modules.insert("clipboardPaused".into(), false);
        assert!(super::capture_enabled(&modules));
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    enabled: bool,
    ready: bool,
    entries: Vec<Entry>,
}
#[tauri::command]
pub fn clipboard_history_list() -> Snapshot {
    let mut h = history().lock().unwrap();
    h.prune(now_ms());
    Snapshot {
        enabled: ENABLED.load(Ordering::Relaxed),
        ready: READY.load(Ordering::Acquire),
        entries: h
            .items
            .iter()
            .map(|e| Entry {
                id: e.id,
                kind: e.kind,
                text: e.text.clone(),
                preview: e.preview.clone(),
                added_at_ms: e.added_at_ms,
                content: None,
            })
            .collect(),
    }
}
#[tauri::command]
pub fn clipboard_history_enable(app: AppHandle, enabled: bool) -> Result<(), String> {
    let shared = app.state::<crate::Shared>();
    let mut settings = shared.settings.lock().unwrap();
    let mut updated = settings.clone();
    updated.modules.insert("clipboardRecording".into(), enabled);
    updated.modules.insert("clipboardPaused".into(), !enabled);
    crate::settings::save(&updated).map_err(|e| e.to_string())?;
    *settings = updated.clone();
    drop(settings);
    ENABLED.store(enabled, Ordering::Release);
    EPOCH.fetch_add(1, Ordering::AcqRel);
    let _ = app.emit("settings-changed", updated);
    changed(&app);
    Ok(())
}
#[tauri::command]
pub fn clipboard_history_remove(app: AppHandle, id: Option<u64>) {
    EPOCH.fetch_add(1, Ordering::AcqRel);
    let mut h = history().lock().unwrap();
    if let Some(id) = id {
        h.items.retain(|e| e.id != id);
    } else {
        h.items.clear();
    }
    drop(h);
    changed(&app);
}
unsafe fn put(format: u32, bytes: &[u8]) -> Result<(), String> {
    let mem = unsafe { GlobalAlloc(GMEM_MOVEABLE, bytes.len()) }.map_err(|e| e.to_string())?;
    let ptr = unsafe { GlobalLock(mem) };
    if ptr.is_null() {
        let _ = unsafe { windows::Win32::Foundation::GlobalFree(Some(mem)) };
        return Err("Cannot allocate clipboard memory".into());
    }
    unsafe {
        std::ptr::copy_nonoverlapping(bytes.as_ptr(), ptr.cast::<u8>(), bytes.len());
    }
    let _ = unsafe { GlobalUnlock(mem) };
    if let Err(error) = unsafe { SetClipboardData(format, Some(HANDLE(mem.0))) } {
        let _ = unsafe { windows::Win32::Foundation::GlobalFree(Some(mem)) };
        return Err(error.to_string());
    }
    Ok(())
}
#[tauri::command]
pub async fn clipboard_history_copy(id: u64) -> Result<(), String> {
    let content = history()
        .lock()
        .unwrap()
        .items
        .iter()
        .find(|e| e.id == id)
        .and_then(|e| e.content.clone())
        .ok_or("Clipboard item no longer exists")?;
    write_content(content).await
}
#[tauri::command]
pub async fn clipboard_write_text(text: String) -> Result<(), String> {
    if text.len() > MAX_TEXT {
        return Err("Text is too long".into());
    }
    write_content(Content::Text(text)).await
}
async fn write_content(content: Content) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let formats = match content {
            Content::Text(text) => {
                let bytes: Vec<u8> = text
                    .encode_utf16()
                    .chain(Some(0))
                    .flat_map(u16::to_le_bytes)
                    .collect();
                vec![(13, bytes)]
            }
            Content::Image(bytes) => {
                let image = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                    .map_err(|e| e.to_string())?;
                let mut bmp = Cursor::new(Vec::new());
                image
                    .write_to(&mut bmp, image::ImageFormat::Bmp)
                    .map_err(|e| e.to_string())?;
                vec![(format("PNG"), bytes), (8, bmp.into_inner()[14..].to_vec())]
            }
        };
        let _lock = ClipboardLock::open()?;
        unsafe { EmptyClipboard() }.map_err(|e| e.to_string())?;
        for (kind, bytes) in formats {
            unsafe { put(kind, &bytes) }?;
        }
        SKIP.store(unsafe { GetClipboardSequenceNumber() }, Ordering::Release);
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn history_deduplicates_limits_and_expires() {
        let mut h = History::default();
        for n in 0..70 {
            h.insert(Content::Text(n.to_string()), None, n);
        }
        assert_eq!(h.items.len(), 50);
        h.insert(Content::Text("69".into()), None, 80);
        assert_eq!(h.items.len(), 50);
        assert_eq!(h.items.front().unwrap().added_at_ms, 80);
        h.prune(MAX_AGE + 100);
        assert!(h.items.is_empty());
    }
    #[test]
    fn invalid_dib_is_rejected() {
        assert!(dib_to_bmp(&[]).is_none());
        assert!(dib_to_bmp(&[255; 40]).is_none());
    }
    #[test]
    fn bitmap_header_conversion_preserves_pixels() {
        let source = image::DynamicImage::ImageRgba8(image::RgbaImage::from_pixel(
            2,
            2,
            image::Rgba([12, 34, 56, 255]),
        ));
        let mut bytes = Cursor::new(Vec::new());
        source
            .write_to(&mut bytes, image::ImageFormat::Bmp)
            .unwrap();
        let restored = dib_to_bmp(&bytes.into_inner()[14..]).unwrap();
        let decoded = image::load_from_memory_with_format(&restored, image::ImageFormat::Bmp)
            .unwrap()
            .to_rgba8();
        assert_eq!(*decoded.get_pixel(0, 0), image::Rgba([12, 34, 56, 255]));
    }
    #[test]
    fn image_history_has_a_total_memory_budget() {
        let mut h = History::default();
        for n in 0..8 {
            h.insert(Content::Image(vec![n; MAX_IMAGE]), None, n as u64);
        }
        assert_eq!(h.items.len(), MAX_TOTAL / MAX_IMAGE);
    }
}
