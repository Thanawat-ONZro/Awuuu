use serde::Serialize;
use windows::Media::Control::{
    GlobalSystemMediaTransportControlsSessionManager,
    GlobalSystemMediaTransportControlsSessionPlaybackStatus,
};

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingInfo {
    pub active: bool,
    pub title: String,
    pub artist: String,
    pub status: String,
    pub playing: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub position_ms: Option<u64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub duration_ms: Option<u64>,
}

#[tauri::command]
pub async fn now_playing() -> Option<NowPlayingInfo> {
    tauri::async_runtime::spawn_blocking(|| {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync().ok()?.get().ok()?;
        let session = manager.GetCurrentSession().ok()?;
        let props = session.TryGetMediaPropertiesAsync().ok()?.get().ok()?;
        let info = session.GetPlaybackInfo().ok()?;
        let title = props.Title().ok()?.to_string();
        if title.is_empty() {
            return None;
        }

        let playback_status = info.PlaybackStatus().ok();
        let playing = playback_status == Some(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Playing);

        let (position_ms, duration_ms) = if let Ok(timeline) = session.GetTimelineProperties() {
            let pos = timeline.Position().ok().map(|t| (t.Duration / 10_000).max(0) as u64);
            let dur = timeline.EndTime().ok().map(|t| (t.Duration / 10_000).max(0) as u64);
            (pos, dur)
        } else {
            (None, None)
        };

        Some(NowPlayingInfo {
            active: true,
            title,
            artist: props.Artist().ok()?.to_string(),
            status: format!("{:?}", playback_status.unwrap_or(GlobalSystemMediaTransportControlsSessionPlaybackStatus::Closed)),
            playing,
            position_ms,
            duration_ms,
        })
    })
    .await
    .ok()
    .flatten()
}

#[tauri::command]
pub async fn media_control(action: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let manager = GlobalSystemMediaTransportControlsSessionManager::RequestAsync()
            .map_err(|e| e.to_string())?
            .get()
            .map_err(|e| e.to_string())?;

        let session = manager
            .GetCurrentSession()
            .map_err(|_| "no active media session".to_string())?;

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
