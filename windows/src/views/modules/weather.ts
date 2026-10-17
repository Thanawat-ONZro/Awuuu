// Weather module for Awuuu's notch dashboard.
// Open-Meteo (free, no API key).
// Compact glance row + expanded panel on click (macnotch.io feel).
// Idle = 0 % CPU: refreshes every 15 min only while module is active.

import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge, type WeatherNow } from "../../core/bridge";
import { State } from "../../core/state";
import { currentLanguage, t, THAI } from "../../i18n/i18n";
import { loadValue } from "../../core/store";
import type { ModuleCtx, ModuleHost } from "../../core/modules";

/** WMO Weather Interpretation Codes (WW) mapping. */
const WMO_LABELS: Record<number, string> = {
  0: "Clear sky",
  1: "Mainly clear",
  2: "Partly cloudy",
  3: "Overcast",
  45: "Fog",
  48: "Depositing rime fog",
  51: "Light drizzle",
  53: "Moderate drizzle",
  55: "Dense drizzle",
  61: "Slight rain",
  63: "Moderate rain",
  65: "Heavy rain",
  71: "Slight snow fall",
  73: "Moderate snow fall",
  75: "Heavy snow fall",
  95: "Thunderstorm",
};

/**
 * Returns user-visible condition string for a WMO weather code.
 * Falls back to "Unknown" when code is unrecognised.
 */
export function weatherLabel(code: number, lang?: string): string {
  const selectedLang = lang ?? currentLanguage();
  const english = WMO_LABELS[code] ?? "Unknown";
  if (selectedLang === "th") {
    return THAI[english] ?? english;
  }
  return english;
}

export function weatherIconKey(code: number): keyof typeof ICONS {
  if (code === 0) return "sun";
  if (code === 1 || code === 2) return "cloud";
  if (code === 3 || code === 45 || code === 48) return "cloud";
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82)) return "rain";
  if ((code >= 71 && code <= 77) || (code >= 85 && code <= 86)) return "snow";
  if (code >= 95) return "bolt";
  return "cloud";
}

export function formatTemp(tempC: number, unit = "c"): string {
  if (unit === "f") {
    return `${Math.round((tempC * 9) / 5 + 32)}°`;
  }
  return `${Math.round(tempC)}°`;
}

function formatSunTime(isoOrTime: string): string {
  if (!isoOrTime) return "";
  const parts = isoOrTime.split("T");
  return parts.length > 1 ? parts[1].slice(0, 5) : isoOrTime.slice(0, 5);
}

export function createWeatherModuleHost(_ctx?: ModuleCtx): ModuleHost {
  const el = h("div", { class: "widget widget-weather", style: "cursor:pointer; user-select:none;" });

  let cachedData: WeatherNow | null = null;
  let lastFetchMs = 0;
  let isExpanded = false;
  let isFetching = false;

  const FIFTEEN_MINUTES_MS = 15 * 60 * 1000;

  function render() {
    clear(el);
    const city = (State.settings?.weatherCity || "").trim();
    if (!city) {
      const emptyEl = h(
        "div",
        {
          class: "weather-empty-hint",
          style: "padding:12px 8px; text-align:center; font-size:12px; opacity:0.7;",
        },
        h("span", { text: t("Set a city in Settings → Modules") }),
      );
      el.append(emptyEl);
      return;
    }

    if (!cachedData) {
      const emptyEl = h(
        "div",
        { class: "weather-compact", style: "display:flex; align-items:center; justify-content:space-between; width:100%;" },
        h("div", { style: "display:flex; align-items:center; gap:8px;" },
          svg(ICONS.cloud, 16),
          h("span", { text: city, style: "font-weight:500;" }),
        ),
        h("span", { text: t("No weather data"), style: "opacity:0.6; font-size:12px;" }),
      );
      el.append(emptyEl);
      return;
    }

    const unit = State.settings?.weatherUnit || "c";
    const icon = weatherIconKey(cachedData.code);
    const condLabel = weatherLabel(cachedData.code);

    const compactRow = h(
      "div",
      { class: "weather-compact", style: "display:flex; align-items:center; justify-content:space-between; width:100%;" },
      h("div", { style: "display:flex; align-items:center; gap:8px;" },
        svg(ICONS[icon] ?? ICONS.cloud, 18),
        h("div", { style: "display:flex; flex-direction:column;" },
          h("span", { text: `${city} · ${condLabel}`, style: "font-weight:500; font-size:13px;" }),
          h("span", {
            text: t("H: {hi}  L: {lo}", {
              hi: formatTemp(cachedData.hi, unit),
              lo: formatTemp(cachedData.lo, unit),
            }),
            style: "opacity:0.6; font-size:11px;",
          }),
        ),
      ),
      h("div", { style: "font-size:20px; font-weight:600; font-variant-numeric:tabular-nums;" },
        formatTemp(cachedData.tempC, unit),
      ),
    );

    el.append(compactRow);

    if (isExpanded) {
      const hourlyBoxes = (cachedData.hourly || []).slice(0, 6).map((hTemp, idx) => {
        return h(
          "div",
          { style: "display:flex; flex-direction:column; align-items:center; gap:3px; flex:1;" },
          h("span", { text: idx === 0 ? t("Now") : t("+{n}h", { n: idx }), style: "font-size:10px; opacity:0.6;" }),
          h("span", { text: formatTemp(hTemp, unit), style: "font-size:12px; font-weight:500;" }),
        );
      });

      const hourlyStrip = h(
        "div",
        {
          class: "weather-hourly",
          style: "display:flex; justify-content:space-between; margin-top:10px; padding:8px; background:rgba(255,255,255,0.05); border-radius:8px;",
        },
        ...hourlyBoxes,
      );

      const sunRow = h(
        "div",
        {
          class: "weather-sun-row",
          style: "display:flex; justify-content:space-between; font-size:11px; opacity:0.7; margin-top:8px; padding:0 4px;",
        },
        h("span", { text: `${t("Sunrise")}: ${formatSunTime(cachedData.sunrise)}` }),
        h("span", { text: `${t("Sunset")}: ${formatSunTime(cachedData.sunset)}` }),
      );

      el.append(hourlyStrip, sunRow);
    }
  }

  el.addEventListener("click", () => {
    isExpanded = !isExpanded;
    render();
  });

  async function fetchFreshWeather(force = false): Promise<void> {
    const cityName = (State.settings?.weatherCity || "").trim();
    if (!cityName) {
      render();
      return;
    }

    const now = Date.now();
    if (!force && now - lastFetchMs < FIFTEEN_MINUTES_MS && cachedData !== null) {
      return;
    }
    if (isFetching) return;
    isFetching = true;

    try {
      const unit = State.settings?.weatherUnit || "c";
      let lat = 0;
      let lon = 0;

      const coords = await Bridge.geocode(cityName);
      if (coords && coords.length === 2) {
        lat = coords[0];
        lon = coords[1];
      } else {
        return;
      }

      const fresh = await Bridge.weatherNow(lat, lon, unit);
      if (fresh) {
        cachedData = fresh;
        lastFetchMs = now;
        render();
      }
    } catch {
      // Degrade gracefully on network failure: keep last cached value
    } finally {
      isFetching = false;
    }
  }

  // Initial load from cache, then fetch fresh
  void loadValue<WeatherNow | null>("weather_cache", null).then((stored) => {
    if (stored && !cachedData) {
      cachedData = stored;
      render();
    }
    void fetchFreshWeather();
  });

  render();

  return {
    el,
    refresh: async () => {
      await fetchFreshWeather(false);
    },
    tick: (_nowMs: number) => {
      const now = Date.now();
      if (now - lastFetchMs >= FIFTEEN_MINUTES_MS) {
        void fetchFreshWeather();
      }
    },
    dispose: () => {
      // No polling timer to clean up: tick() driven by dashboard host
    },
  };
}
