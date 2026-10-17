import { clear, h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge, type SystemStats } from "../../core/bridge";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import { pctBar } from "../../core/format";
import { t } from "../../i18n/i18n";

export { pctBar } from "../../core/format";

export function createSystemModuleHost(_ctx?: ModuleCtx): ModuleHost {
  const iconEl = svg(ICONS.tools, 13);
  const titleEl = h("span", { class: "system-header-title", text: t("System") });
  const cpuBadge = h("span", { class: "system-badge", text: "--%" });
  const headerEl = h("div", { class: "system-header" }, h("div", { class: "system-header-left" }, iconEl, titleEl), cpuBadge);

  // CPU row
  const cpuLabel = h("span", { class: "meter-label", text: t("CPU") });
  const cpuValue = h("span", { class: "meter-value", text: "--%" });
  const cpuBarFill = h("div", { class: "meter-bar-fill", style: "width: 0%" });
  const cpuBar = h("div", { class: "meter-bar" }, cpuBarFill);
  const cpuRow = h("div", { class: "system-row" }, h("div", { class: "row-info" }, cpuLabel, cpuValue), cpuBar);

  // RAM row
  const ramLabel = h("span", { class: "meter-label", text: t("RAM") });
  const ramValue = h("span", { class: "meter-value", text: "-- GB" });
  const ramBarFill = h("div", { class: "meter-bar-fill", style: "width: 0%" });
  const ramBar = h("div", { class: "meter-bar" }, ramBarFill);
  const ramRow = h("div", { class: "system-row" }, h("div", { class: "row-info" }, ramLabel, ramValue), ramBar);

  // Disks container
  const disksEl = h("div", { class: "system-disks" });

  // Top process row
  const topEl = h("div", { class: "system-top", text: "" });

  const el = h(
    "div",
    { class: "widget widget-system" },
    headerEl,
    h("div", { class: "system-meters" }, cpuRow, ramRow, disksEl),
    topEl,
  );

  let isRefreshing = false;
  let lastTickMs = 0;
  let disposed = false;

  function updateMeters(stats: SystemStats) {
    if (disposed) return;

    // CPU
    const cpuPct = Math.min(100, Math.max(0, stats.cpuPct));
    cpuBadge.textContent = `${cpuPct.toFixed(0)}%`;
    cpuValue.textContent = `${cpuPct.toFixed(1)}%`;
    cpuBarFill.style.width = `${cpuPct}%`;
    cpuBar.title = pctBar(cpuPct, 10);

    // RAM
    if (stats.memTotalMb > 0) {
      const ramUsedGb = stats.memUsedMb / 1024;
      const ramTotalGb = stats.memTotalMb / 1024;
      const ramPct = Math.min(100, Math.max(0, (stats.memUsedMb / stats.memTotalMb) * 100));
      ramValue.textContent = `${ramUsedGb.toFixed(1)}/${ramTotalGb.toFixed(0)} GB`;
      ramBarFill.style.width = `${ramPct}%`;
      ramBar.title = pctBar(ramPct, 10);
    }

    // Disks
    clear(disksEl);
    for (const disk of stats.disks.slice(0, 2)) {
      const usedGb = Math.max(0, disk.totalGb - disk.freeGb);
      const diskPct = disk.totalGb > 0 ? Math.min(100, Math.max(0, (usedGb / disk.totalGb) * 100)) : 0;

      const dLabel = h("span", { class: "meter-label", text: disk.mount });
      const dValue = h("span", { class: "meter-value", text: `${usedGb.toFixed(0)}/${disk.totalGb.toFixed(0)} GB` });
      const dFill = h("div", { class: "meter-bar-fill", style: `width: ${diskPct}%` });
      const dBar = h("div", { class: "meter-bar", title: pctBar(diskPct, 10) }, dFill);
      disksEl.append(h("div", { class: "system-row" }, h("div", { class: "row-info" }, dLabel, dValue), dBar));
    }

    // Top processes
    if (stats.top.length > 0) {
      const topList = stats.top
        .slice(0, 2)
        .map((p) => `${p.name} ${p.cpuPct.toFixed(0)}%`)
        .join(" · ");
      topEl.textContent = `${t("Top processes")}: ${topList}`;
      topEl.style.display = "block";
    } else {
      topEl.style.display = "none";
    }
  }

  async function refresh() {
    if (disposed || isRefreshing) return;
    isRefreshing = true;
    try {
      const stats = await Bridge.systemStats();
      if (!disposed && stats) {
        updateMeters(stats);
      }
    } catch {
      /* ignore bridge errors when app is closing or unmounted */
    } finally {
      isRefreshing = false;
    }
  }

  function tick(nowMs: number) {
    if (disposed) return;
    if (nowMs - lastTickMs < 1000) return;
    lastTickMs = nowMs;
    void refresh();
  }

  function dispose() {
    disposed = true;
    isRefreshing = false;
  }

  return { el, refresh, tick, dispose };
}
