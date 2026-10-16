use serde::Serialize;
use windows::Media::Control::GlobalSystemMediaTransportControlsSessionManager;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NowPlayingInfo {
    pub active: bool,
    pub title: String,
    pub artist: String,
    pub status: String,
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
        Some(NowPlayingInfo {
            active: true,
            title,
            artist: props.Artist().ok()?.to_string(),
            status: format!("{:?}", info.PlaybackStatus().ok()?),
        })
    })
    .await
    .ok()
    .flatten()
}
