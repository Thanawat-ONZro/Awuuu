// Open-Meteo weather and geocoding integration for Awuuu.
// Free API, no API key required.
// In-memory 15-minute cache + persistent store cache under %LOCALAPPDATA%\Awuuu\store\weather_cache.json.

use std::sync::Mutex;
use std::time::{Duration, Instant};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WeatherNow {
    pub temp_c: f64,
    pub code: u32,
    pub hi: f64,
    pub lo: f64,
    pub hourly: [f64; 6],
    pub sunrise: String,
    pub sunset: String,
}

#[derive(Deserialize)]
struct GeocodingResponse {
    results: Option<Vec<GeocodingResult>>,
}

#[derive(Deserialize)]
struct GeocodingResult {
    latitude: f64,
    longitude: f64,
}

#[derive(Deserialize)]
struct OpenMeteoResponse {
    current_weather: Option<OpenMeteoCurrent>,
    daily: Option<OpenMeteoDaily>,
    hourly: Option<OpenMeteoHourly>,
}

#[derive(Deserialize)]
struct OpenMeteoCurrent {
    temperature: f64,
    weathercode: u32,
    #[serde(default)]
    time: String,
}

#[derive(Deserialize)]
struct OpenMeteoDaily {
    temperature_2m_max: Option<Vec<f64>>,
    temperature_2m_min: Option<Vec<f64>>,
    sunrise: Option<Vec<String>>,
    sunset: Option<Vec<String>>,
}

#[derive(Deserialize)]
struct OpenMeteoHourly {
    time: Option<Vec<String>>,
    temperature_2m: Option<Vec<f64>>,
}

struct CacheEntry {
    instant: Instant,
    lat_key: i64,
    lon_key: i64,
    unit: String,
    data: WeatherNow,
}

static CACHE: Mutex<Option<CacheEntry>> = Mutex::new(None);

fn coord_key(val: f64) -> i64 {
    (val * 1000.0).round() as i64
}

#[tauri::command]
pub async fn geocode(city: String) -> Option<(f64, f64)> {
    let trimmed = city.trim();
    if trimmed.is_empty() {
        return None;
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Awuuu/0.8.0")
        .build()
        .ok()?;

    let url = "https://geocoding-api.open-meteo.com/v1/search";
    let resp = client
        .get(url)
        .query(&[
            ("name", trimmed),
            ("count", "1"),
            ("language", "en"),
            ("format", "json"),
        ])
        .send()
        .await
        .ok()?;

    if !resp.status().is_success() {
        return None;
    }

    let parsed: GeocodingResponse = resp.json().await.ok()?;
    let first = parsed.results?.into_iter().next()?;
    Some((first.latitude, first.longitude))
}

#[tauri::command]
pub async fn weather_now(lat: f64, lon: f64, unit: String) -> Result<WeatherNow, String> {
    let lat_k = coord_key(lat);
    let lon_k = coord_key(lon);

    // Check 15-minute in-memory cache
    if let Ok(guard) = CACHE.lock() {
        if let Some(ref entry) = *guard {
            if entry.lat_key == lat_k
                && entry.lon_key == lon_k
                && entry.unit == unit
                && entry.instant.elapsed() < Duration::from_secs(15 * 60)
            {
                return Ok(entry.data.clone());
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("Awuuu/0.8.0")
        .build()
        .map_err(|e| e.to_string())?;

    let url = "https://api.open-meteo.com/v1/forecast";
    let resp = client
        .get(url)
        .query(&[
            ("latitude", lat.to_string()),
            ("longitude", lon.to_string()),
            ("current_weather", "true".to_string()),
            ("hourly", "temperature_2m".to_string()),
            ("daily", "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset".to_string()),
            ("timezone", "auto".to_string()),
        ])
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Open-Meteo returned status {}", resp.status()));
    }

    let parsed: OpenMeteoResponse = resp.json().await.map_err(|e| e.to_string())?;

    let current = parsed
        .current_weather
        .ok_or_else(|| "missing current_weather in response".to_string())?;

    let temp_c = current.temperature;
    let code = current.weathercode;

    let hi = parsed
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_max.as_ref())
        .and_then(|v| v.first().copied())
        .unwrap_or(temp_c);

    let lo = parsed
        .daily
        .as_ref()
        .and_then(|d| d.temperature_2m_min.as_ref())
        .and_then(|v| v.first().copied())
        .unwrap_or(temp_c);

    let sunrise = parsed
        .daily
        .as_ref()
        .and_then(|d| d.sunrise.as_ref())
        .and_then(|v| v.first().cloned())
        .unwrap_or_default();

    let sunset = parsed
        .daily
        .as_ref()
        .and_then(|d| d.sunset.as_ref())
        .and_then(|v| v.first().cloned())
        .unwrap_or_default();

    // Extract next 6 hourly temperatures
    let mut hourly_arr = [temp_c; 6];
    if let Some(hourly) = parsed.hourly {
        if let Some(temps) = hourly.temperature_2m {
            let start_idx = if let Some(times) = hourly.time {
                times
                    .iter()
                    .position(|t| t == &current.time)
                    .unwrap_or(0)
            } else {
                0
            };

            for i in 0..6 {
                if let Some(t) = temps.get(start_idx + i) {
                    hourly_arr[i] = *t;
                } else if let Some(last) = temps.last() {
                    hourly_arr[i] = *last;
                }
            }
        }
    }

    let weather = WeatherNow {
        temp_c,
        code,
        hi,
        lo,
        hourly: hourly_arr,
        sunrise,
        sunset,
    };

    // Update in-memory cache
    if let Ok(mut guard) = CACHE.lock() {
        *guard = Some(CacheEntry {
            instant: Instant::now(),
            lat_key: lat_k,
            lon_key: lon_k,
            unit,
            data: weather.clone(),
        });
    }

    // Persist to store under weather_cache.json
    if let Ok(val) = serde_json::to_value(&weather) {
        let _ = crate::store::store_write("weather_cache".into(), val);
    }

    Ok(weather)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_coord_key() {
        assert_eq!(coord_key(13.75398), 13754);
        assert_eq!(coord_key(100.50144), 100501);
    }

    #[test]
    fn test_weather_now_serialization() {
        let w = WeatherNow {
            temp_c: 28.5,
            code: 1,
            hi: 32.0,
            lo: 24.0,
            hourly: [28.0, 29.0, 31.0, 30.0, 28.0, 26.0],
            sunrise: "2026-10-17T06:08".into(),
            sunset: "2026-10-17T17:58".into(),
        };
        let val = serde_json::to_value(&w).unwrap();
        assert_eq!(val["tempC"], 28.5);
        assert_eq!(val["code"], 1);
        assert_eq!(val["hi"], 32.0);
        assert_eq!(val["lo"], 24.0);
        assert_eq!(val["hourly"].as_array().unwrap().len(), 6);
        assert_eq!(val["sunrise"], "2026-10-17T06:08");
        assert_eq!(val["sunset"], "2026-10-17T17:58");
    }
}
