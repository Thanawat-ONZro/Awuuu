use serde::Serialize;
use tauri::Emitter;
use windows::Foundation::TypedEventHandler;
use windows::Storage::Streams::DataReader;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSession,
    GlobalSystemMediaTransportControlsSessionManager as SessionManager,
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
    CurrentSessionChangedEventArgs, SessionsChangedEventArgs,
    MediaPropertiesChangedEventArgs, PlaybackInfoChangedEventArgs, TimelinePropertiesChangedEventArgs,
};
use windows::Win32::Media::Audio::{eMultimedia, eRender, IMMDeviceEnumerator, MMDeviceEnumerator, AUDIO_VOLUME_NOTIFICATION_DATA};
use windows::Win32::Media::Audio::Endpoints::{IAudioEndpointVolume, IAudioEndpointVolumeCallback, IAudioEndpointVolumeCallback_Impl};
use windows::Win32::System::Com::{CoCreateInstance, CoInitializeEx, CoUninitialize, CLSCTX_ALL, COINIT_MULTITHREADED};

enum MediaSignal { Changed, SessionsChanged }

struct SessionHooks {
    session: GlobalSystemMediaTransportControlsSession,
    media: i64,
    playback: i64,
    timeline: i64,
}

impl Drop for SessionHooks {
    fn drop(&mut self) {
        let _ = self.session.RemoveMediaPropertiesChanged(self.media);
        let _ = self.session.RemovePlaybackInfoChanged(self.playback);
        let _ = self.session.RemoveTimelinePropertiesChanged(self.timeline);
    }
}

fn subscribe_sessions(manager: &SessionManager, tx: &std::sync::mpsc::Sender<MediaSignal>) -> Vec<SessionHooks> {
    let mut hooks = Vec::new();
    let Ok(sessions) = manager.GetSessions() else { return hooks };
    let Ok(count) = sessions.Size() else { return hooks };
    for i in 0..count {
        let Ok(session) = sessions.GetAt(i) else { continue };
        let sender = tx.clone();
        let Ok(media) = session.MediaPropertiesChanged(&TypedEventHandler::<_, MediaPropertiesChangedEventArgs>::new(move |_, _| {
            let _ = sender.send(MediaSignal::Changed);
            Ok(())
        })) else { continue };
        let sender = tx.clone();
        let Ok(playback) = session.PlaybackInfoChanged(&TypedEventHandler::<_, PlaybackInfoChangedEventArgs>::new(move |_, _| {
            let _ = sender.send(MediaSignal::Changed);
            Ok(())
        })) else {
            let _ = session.RemoveMediaPropertiesChanged(media);
            continue;
        };
        let sender = tx.clone();
        let Ok(timeline) = session.TimelinePropertiesChanged(&TypedEventHandler::<_, TimelinePropertiesChangedEventArgs>::new(move |_, _| {
            let _ = sender.send(MediaSignal::Changed);
            Ok(())
        })) else {
            let _ = session.RemoveMediaPropertiesChanged(media);
            let _ = session.RemovePlaybackInfoChanged(playback);
            continue;
        };
        hooks.push(SessionHooks { session, media, playback, timeline });
    }
    hooks
}

/// Follow Windows media session changes without a one-second WinRT poll.
pub fn watch(app: tauri::AppHandle) {
    std::thread::spawn(move || {
        let Some(manager) = SessionManager::RequestAsync().ok().and_then(|op| op.get().ok()) else {
            crate::log::line("media event subscription unavailable; Music will use its fallback refresh");
            return;
        };
        let (tx, rx) = std::sync::mpsc::channel();
        let sender = tx.clone();
        let Ok(current_token) = manager.CurrentSessionChanged(&TypedEventHandler::<_, CurrentSessionChangedEventArgs>::new(move |_, _| {
            let _ = sender.send(MediaSignal::Changed);
            Ok(())
        })) else { return };
        let sender = tx.clone();
        let Ok(sessions_token) = manager.SessionsChanged(&TypedEventHandler::<_, SessionsChangedEventArgs>::new(move |_, _| {
            let _ = sender.send(MediaSignal::SessionsChanged);
            Ok(())
        })) else {
            let _ = manager.RemoveCurrentSessionChanged(current_token);
            return;
        };
        let mut hooks = subscribe_sessions(&manager, &tx);
        while let Ok(signal) = rx.recv() {
            let mut rebind = matches!(signal, MediaSignal::SessionsChanged);
            while let Ok(next) = rx.try_recv() {
                rebind |= matches!(next, MediaSignal::SessionsChanged);
            }
            if rebind {
                hooks = subscribe_sessions(&manager, &tx);
            }
            let _ = app.emit("media-changed", read_now_playing(&manager));
        }
        drop(hooks);
        let _ = manager.RemoveSessionsChanged(sessions_token);
        let _ = manager.RemoveCurrentSessionChanged(current_token);
    });
}

fn selected_session(manager: &SessionManager) -> Option<GlobalSystemMediaTransportControlsSession> {
    let current = manager.GetCurrentSession().ok();
    let playing = |session: &GlobalSystemMediaTransportControlsSession| {
        session.GetPlaybackInfo().ok().and_then(|info| info.PlaybackStatus().ok())
            == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing)
    };
    if current.as_ref().is_some_and(playing) { return current; }
    if let Ok(sessions) = manager.GetSessions() {
        if let Ok(count) = sessions.Size() {
            for index in 0..count {
                if let Ok(session) = sessions.GetAt(index) {
                    if playing(&session) { return Some(session); }
                }
            }
        }
    }
    current
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingInfo {
    pub active: bool,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub source_app: String,
    pub status: String,
    pub playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
    pub can_seek: bool,
}

fn read_now_playing(manager: &SessionManager) -> Option<NowPlayingInfo> {
        let session = selected_session(manager)?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let info = session.GetPlaybackInfo().ok()?;
        let source_app = session.SourceAppUserModelId().ok().map(|id| id.to_string()).unwrap_or_default();
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }

        let playback_status = info.PlaybackStatus().ok();
        let playing = playback_status == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);

        let (position_ms, duration_ms) = if let Ok(timeline) = session.GetTimelineProperties() {
            // Position is a snapshot at LastUpdatedTime, not necessarily the
            // current playhead. Advance it before handing it to the UI.
            let elapsed_ms = if playing {
                let now_ticks = std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH).unwrap_or_default()
                    .as_millis().saturating_mul(10_000) + 116_444_736_000_000_000;
                timeline.LastUpdatedTime().ok()
                    .map(|at| now_ticks.saturating_sub(at.UniversalTime.max(0) as u128) / 10_000)
                    .unwrap_or(0).min(u64::MAX as u128) as u64
            } else { 0 };
            let pos = timeline.Position().ok().map(|t| (t.Duration / 10_000).max(0) as u64 + elapsed_ms);
            let dur = timeline.EndTime().ok().map(|t| (t.Duration / 10_000).max(0) as u64);
            (pos.map(|p| dur.map_or(p, |d| p.min(d))), dur)
        } else {
            (None, None)
        };

        Some(NowPlayingInfo {
            active: true,
            title,
            artist: props.Artist().ok()?.to_string(),
            album: props.AlbumTitle().ok().map(|s| s.to_string()).unwrap_or_default(),
            source_app,
            status: format!("{:?}", playback_status.unwrap_or(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed)),
            playing,
            position_ms,
            duration_ms,
            can_seek: info.Controls().ok().and_then(|c| c.IsPlaybackPositionEnabled().ok()).unwrap_or(false),
        })
}

#[tauri::command]
pub async fn now_playing() -> Option<NowPlayingInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = SessionManager::RequestAsync().ok()?.get().ok()?;
        read_now_playing(&manager)
    })
    .await
    .ok()
    .flatten()
}

/// Artwork is requested on track changes, outside the one-second timeline poll.
#[tauri::command]
pub async fn media_artwork() -> Option<String> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?.get().ok()?;
        let session = selected_session(&manager)?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let stream = props.Thumbnail().ok()?.OpenReadAsync().ok()?.get().ok()?;
        let size = stream.Size().ok()?;
        if size == 0 || size > 2_000_000 { return None; }
        let mime = stream.ContentType().ok()?.to_string();
        if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/webp" | "image/bmp") { return None; }
        let input = stream.GetInputStreamAt(0).ok()?;
        let reader = DataReader::CreateDataReader(&input).ok()?;
        let loaded = reader.LoadAsync(size as u32).ok()?.get().ok()?;
        if loaded == 0 { return None; }
        let mut bytes = vec![0; loaded as usize];
        reader.ReadBytes(&mut bytes).ok()?;
        Some(format!("data:{mime};base64,{}", crate::claude::base64_for(&bytes)))
    }).await.ok().flatten()
}

#[tauri::command]
pub async fn media_seek(position_ms: u64) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
        let session = selected_session(&manager).ok_or("no active media session")?;
        let controls = session.GetPlaybackInfo().map_err(|e| e.to_string())?
            .Controls().map_err(|e| e.to_string())?;
        if !controls.IsPlaybackPositionEnabled().unwrap_or(false) {
            return Err("media session does not support seeking".into());
        }
        let ticks = position_ms.min(i64::MAX as u64 / 10_000) as i64 * 10_000;
        let changed = session.TryChangePlaybackPositionAsync(ticks)
            .map_err(|e| e.to_string())?.get().map_err(|e| e.to_string())?;
        if changed { Ok(()) } else { Err("seek was not handled by media session".into()) }
    }).await.map_err(|e| e.to_string())?
}

#[derive(Serialize, Clone)]
pub struct SystemVolume { level: u8, muted: bool }

#[windows::core::implement(IAudioEndpointVolumeCallback)]
struct VolumeCallback { sender: std::sync::mpsc::Sender<SystemVolume> }

impl IAudioEndpointVolumeCallback_Impl for VolumeCallback_Impl {
    fn OnNotify(&self, notification: *mut AUDIO_VOLUME_NOTIFICATION_DATA) -> windows::core::Result<()> {
        if let Some(value) = unsafe { notification.as_ref() } {
            let state = SystemVolume {
                level: (value.fMasterVolume.clamp(0.0, 1.0) * 100.0).round() as u8,
                muted: value.bMuted.as_bool(),
            };
            let _ = self.sender.send(state);
        }
        Ok(())
    }
}

/// Windows notifies this callback for keyboard, app and taskbar volume changes.
pub fn watch_volume(app: tauri::AppHandle) {
    std::thread::spawn(move || unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| -> windows::core::Result<()> {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            let (sender, receiver) = std::sync::mpsc::channel();
            let callback: IAudioEndpointVolumeCallback = VolumeCallback { sender }.into();
            endpoint.RegisterControlChangeNotify(&callback)?;
            while let Ok(state) = receiver.recv() {
                let _ = app.emit("system-volume-changed", state);
            }
            endpoint.UnregisterControlChangeNotify(&callback)?;
            Ok(())
        })();
        if initialized { CoUninitialize(); }
        if let Err(err) = result { crate::log::line(format!("volume listener unavailable: {err}")); }
    });
}

fn with_endpoint<T>(f: impl FnOnce(&IAudioEndpointVolume) -> windows::core::Result<T>) -> Result<T, String> {
    unsafe {
        let initialized = CoInitializeEx(None, COINIT_MULTITHREADED).is_ok();
        let result = (|| {
            let enumerator: IMMDeviceEnumerator = CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
            let device = enumerator.GetDefaultAudioEndpoint(eRender, eMultimedia)?;
            let endpoint: IAudioEndpointVolume = device.Activate(CLSCTX_ALL, None)?;
            f(&endpoint)
        })();
        if initialized { CoUninitialize(); }
        result.map_err(|err| err.to_string())
    }
}

fn volume_state(endpoint: &IAudioEndpointVolume) -> windows::core::Result<SystemVolume> {
    unsafe {
        Ok(SystemVolume {
            level: (endpoint.GetMasterVolumeLevelScalar()?.clamp(0.0, 1.0) * 100.0).round() as u8,
            muted: endpoint.GetMute()?.as_bool(),
        })
    }
}

#[tauri::command]
pub async fn system_volume() -> Result<SystemVolume, String> {
    tauri::async_runtime::spawn_blocking(|| with_endpoint(volume_state))
        .await.map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn change_system_volume(delta: i32) -> Result<SystemVolume, String> {
    tauri::async_runtime::spawn_blocking(move || with_endpoint(|endpoint| unsafe {
        let current = volume_state(endpoint)?;
        let next = (i32::from(current.level) + delta.clamp(-5, 5)).clamp(0, 100);
        endpoint.SetMasterVolumeLevelScalar(next as f32 / 100.0, std::ptr::null())?;
        volume_state(endpoint)
    })).await.map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn toggle_system_mute() -> Result<SystemVolume, String> {
    tauri::async_runtime::spawn_blocking(|| with_endpoint(|endpoint| unsafe {
        let muted = endpoint.GetMute()?.as_bool();
        endpoint.SetMute(!muted, std::ptr::null())?;
        volume_state(endpoint)
    })).await.map_err(|err| err.to_string())?
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = selected_session(&manager).ok_or("no active media session")?;

        match action.as_str() {
            "play_pause" => {
                let op = session.TryTogglePlayPauseAsync().map_err(|e| e.to_string())?;
                let success = op.get().map_err(|e| e.to_string())?;
                if !success {
                    return Err("play_pause command was not handled by media session".into());
                }
                Ok(())
            }
            "next" => {
                let op = session.TrySkipNextAsync().map_err(|e| e.to_string())?;
                let success = op.get().map_err(|e| e.to_string())?;
                if !success {
                    return Err("skip next command was not handled by media session".into());
                }
                Ok(())
            }
            "prev" => {
                let op = session.TrySkipPreviousAsync().map_err(|e| e.to_string())?;
                let success = op.get().map_err(|e| e.to_string())?;
                if !success {
                    return Err("skip previous command was not handled by media session".into());
                }
                Ok(())
            }
            other => Err(format!("unknown media action: {other}")),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}
