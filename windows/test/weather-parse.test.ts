import "./setup-dom";
import { describe, expect, it } from "vitest";
import { weatherLabel, formatTemp, createWeatherModuleHost } from "../src/views/modules/weather";
import { State } from "../src/core/state";

describe("weatherLabel WMO mapping", () => {
  it("maps WMO weather codes to English labels", () => {
    expect(weatherLabel(0, "en")).toBe("Clear sky");
    expect(weatherLabel(1, "en")).toBe("Mainly clear");
    expect(weatherLabel(3, "en")).toBe("Overcast");
    expect(weatherLabel(45, "en")).toBe("Fog");
    expect(weatherLabel(61, "en")).toBe("Slight rain");
    expect(weatherLabel(71, "en")).toBe("Slight snow fall");
    expect(weatherLabel(95, "en")).toBe("Thunderstorm");
  });

  it("maps WMO weather codes to Thai labels", () => {
    expect(weatherLabel(0, "th")).toBe("ท้องฟ้าแจ่มใส");
    expect(weatherLabel(1, "th")).toBe("ท้องฟ้าโปร่งเป็นส่วนใหญ่");
    expect(weatherLabel(3, "th")).toBe("มีเมฆมาก");
    expect(weatherLabel(45, "th")).toBe("หมอก");
    expect(weatherLabel(61, "th")).toBe("ฝนตกเล็กน้อย");
    expect(weatherLabel(71, "th")).toBe("หิมะตกเล็กน้อย");
    expect(weatherLabel(95, "th")).toBe("พายุฝนฟ้าคะนอง");
  });

  it("handles unknown weather codes gracefully", () => {
    expect(weatherLabel(999, "en")).toBe("Unknown");
    expect(weatherLabel(999, "th")).toBe("ไม่ทราบ");
  });
});

describe("weather formatting and empty city behavior", () => {
  it("formats temperature correctly in Celsius and Fahrenheit", () => {
    expect(formatTemp(25, "c")).toBe("25°");
    expect(formatTemp(25.4, "c")).toBe("25°");
    expect(formatTemp(25, "f")).toBe("77°");
    expect(formatTemp(0, "f")).toBe("32°");
  });

  it("renders hint when weatherCity is empty and skips API fetch", () => {
    State.settings = { ...State.settings, weatherCity: "" };
    const host = createWeatherModuleHost();
    const hint = host.el.querySelector(".weather-empty-hint");
    expect(hint).not.toBeNull();
    expect(hint?.textContent).toBe("Set a city in Settings → Modules");
  });
});

