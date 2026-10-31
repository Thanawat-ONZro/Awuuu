// Settings for Dashboard modules (enable / order / default / collapsed strip).

import "../modules.css";
import { h, svg } from "../../views/dom";
import { ICONS } from "../../views/icons";
import { card, pageOf, save, select, settings, textField, secretField, toggle } from "../ui";
import { t } from "../../i18n/i18n";
import {
  MODULES,
  normalizeModuleOrder,
  isCollapsedStripEligible,
  moduleOn,
  collapsedModuleOn,
} from "../../core/modules";
import { saveValue } from "../../core/store";
import { navigate } from "../shell";
import { serviceCost } from "../service-cost";

export function page(): HTMLElement {
  function persistModulesState() {
    void save();
    saveValue("modules", {
      modules: settings.modules,
      moduleOrder: settings.moduleOrder,
      defaultModule: settings.defaultModule,
      collapsedModules: settings.collapsedModules,
    });
  }

  // ── Default module selection ──────────────────────────────────────────────────
  const defaultModuleSelect = select(
    MODULES.map((m) => [m.id, t(m.titleKey)] as [string, string]),
    () => settings.defaultModule ?? "dashboard",
    (v) => {
      settings.defaultModule = v;
      persistModulesState();
    },
  );

  const defaultCard = card(
    t("Default module"),
    h(
      "div",
      { class: "row" },
      h("label", { text: t("Opens on") }),
      defaultModuleSelect,
      h("span", {
        class: "hint",
        text: t("The module focused when you open the dashboard."),
      }),
    ),
  );

  // ── Modules order, enable/disable & collapsed strip ────────────────────────────
  const moduleListContainer = h("div", { class: "module-list" });

  function renderModuleList() {
    moduleListContainer.replaceChildren();
    const order = normalizeModuleOrder(settings.moduleOrder);
    settings.moduleOrder = order;

    const byId = new Map(MODULES.map((m) => [m.id, m]));

    order.forEach((modId, index) => {
      const m = byId.get(modId);
      if (!m) return;

      const isEnabled = moduleOn(settings.modules, m.id);

      // Drag handle icon
      const dragHandle = h(
        "div",
        {
          class: "module-drag-handle",
          title: t("Drag to reorder"),
          "aria-label": t("Drag to reorder"),
        },
        svg("M4 6h16M4 12h16M4 18h16", 14),
      );

      // Up and Down reorder buttons for accessible keyboard & click control
      const upBtn = h(
        "button",
        {
          class: "module-order-btn",
          title: t("Move up"),
          "aria-label": t("Move up"),
          disabled: index === 0,
        },
        "↑",
      ) as HTMLButtonElement;

      const downBtn = h(
        "button",
        {
          class: "module-order-btn",
          title: t("Move down"),
          "aria-label": t("Move down"),
          disabled: index === order.length - 1,
        },
        "↓",
      ) as HTMLButtonElement;

      upBtn.addEventListener("click", () => {
        if (index > 0) {
          const newOrder = [...order];
          [newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
          settings.moduleOrder = newOrder;
          persistModulesState();
          renderModuleList();
        }
      });

      downBtn.addEventListener("click", () => {
        if (index < order.length - 1) {
          const newOrder = [...order];
          [newOrder[index], newOrder[index + 1]] = [newOrder[index + 1], newOrder[index]];
          settings.moduleOrder = newOrder;
          persistModulesState();
          renderModuleList();
        }
      });

      const orderBtns = h("div", { class: "module-order-btns" }, upBtn, downBtn);

      // Module icon & title
      const iconSvg = ICONS[m.icon] ? svg(ICONS[m.icon], 15) : svg(ICONS.tools, 15);
      const iconEl = h("div", { class: "module-icon" }, iconSvg);
      const titleEl = h("span", { class: "module-title", text: t(m.titleKey) });
      let titleCol: HTMLElement = titleEl;
      const setupHint = m.id === "calendar"
        ? t("Needs a calendar link or connected account")
        : m.id === "translation"
          ? t("Needs a translation provider")
          : m.id === "weather"
            ? t("Needs a city and internet")
            : m.id === "screentime"
              ? t("Samples active apps every 5s while dashboard is open")
              : "";
      if (setupHint) {
        const descEl = h("span", {
          class: "module-desc",
          text: setupHint,
          style: "display:block; font-size:10px; opacity:0.6; font-weight:normal; margin-top:1px;",
        });
        titleCol = h("div", { class: "module-title-col", style: "display:flex; flex-direction:column;" }, titleEl, descEl);
      }
      const setupButton = m.id === "calendar" || m.id === "weather"
        ? h("button", { class: "module-setup-link", text: t("Set up"), onclick: () => void navigate("integrations", m.id === "calendar" ? "everyday" : "no-account") })
        : m.id === "translation"
          ? h("button", { class: "module-setup-link", text: t("Set up"), onclick: () => {
            const target = document.getElementById("translation-settings") as HTMLDetailsElement | null;
            if (target) target.open = true;
            target?.scrollIntoView({ behavior: "smooth", block: "center" });
          } })
          : null;

      // Collapsed strip checkbox (media, timer/dashboard, calendar, weather)
      let collapsedEl: HTMLElement;
      if (isCollapsedStripEligible(m.id)) {
        const inCollapsed = collapsedModuleOn(settings.collapsedModules, m.id);
        const checkInput = h("input", {
          type: "checkbox",
        }) as HTMLInputElement;
        checkInput.checked = inCollapsed;
        checkInput.addEventListener("change", () => {
          settings.collapsedModules = {
            ...settings.collapsedModules,
            [m.id]: checkInput.checked,
          };
          persistModulesState();
        });
        collapsedEl = h(
          "label",
          { class: "module-collapsed-check", title: t("Show in collapsed strip") },
          checkInput,
          h("span", { text: t("In collapsed strip") }),
        );
      } else {
        collapsedEl = h("div", { class: "module-collapsed-placeholder" });
      }

      // Enable / Disable switch toggle
      const sw = toggle(isEnabled, (on) => {
        settings.modules = {
          ...settings.modules,
          [m.id]: on,
        };
        persistModulesState();
      });

      // Draggable row container
      const row = h(
        "div",
        {
          class: "module-row",
          draggable: "true",
          "data-id": m.id,
        },
        dragHandle,
        orderBtns,
        iconEl,
        titleCol,
        h("span", { class: "spacer" }),
        setupButton,
        collapsedEl,
        sw,
      );

      row.addEventListener("dragstart", (e: DragEvent) => {
        row.classList.add("dragging");
        e.dataTransfer?.setData("text/plain", String(index));
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = "move";
        }
      });

      row.addEventListener("dragend", () => {
        row.classList.remove("dragging");
        document.querySelectorAll(".module-row.drag-over").forEach((el) => {
          el.classList.remove("drag-over");
        });
      });

      row.addEventListener("dragover", (e: DragEvent) => {
        e.preventDefault();
        if (e.dataTransfer) {
          e.dataTransfer.dropEffect = "move";
        }
        row.classList.add("drag-over");
      });

      row.addEventListener("dragleave", () => {
        row.classList.remove("drag-over");
      });

      row.addEventListener("drop", (e: DragEvent) => {
        e.preventDefault();
        row.classList.remove("drag-over");
        const fromIdx = Number(e.dataTransfer?.getData("text/plain"));
        if (!isNaN(fromIdx) && fromIdx !== index) {
          const newOrder = [...order];
          const [moved] = newOrder.splice(fromIdx, 1);
          newOrder.splice(index, 0, moved);
          settings.moduleOrder = newOrder;
          persistModulesState();
          renderModuleList();
        }
      });

      moduleListContainer.append(row);
    });
  }

  renderModuleList();

  const resetBtn = h("button", {
    text: t("Reset order"),
    title: t("Reset to default order"),
    onclick: () => {
      settings.moduleOrder = MODULES.map((m) => m.id);
      persistModulesState();
      renderModuleList();
    },
  });

  const modulesCard = card(
    t("Show, hide & reorder"),
    h("p", { class: "hint", text: t("Music, notes, to-dos, quick toggles and Shelf work without an account. Calendar, weather and translation need setup before they can show data.") }),
    h("div", { class: "row", style: "justify-content: flex-end; margin-bottom: 4px;" }, resetBtn),
    moduleListContainer,
  );

  // ── Translation settings ────────────────────────────────────────────────────
  const libreUrlInput = textField(
    () => settings.libreTranslateUrl ?? "http://127.0.0.1:5000",
    (v) => {
      settings.libreTranslateUrl = v;
    },
    "http://127.0.0.1:5000",
  );

  const providerSelect = select(
    [
      ["", t("Auto (LibreTranslate → DeepL → Google)")],
      ["libretranslate", t("LibreTranslate (Local)")],
      ["deepl", t("DeepL")],
      ["google", t("Google Cloud Translate")],
    ],
    () => settings.translateProvider ?? "",
    (v) => {
      settings.translateProvider = v;
    },
  );

  const deeplKeyField = secretField("deepl-api-key", t("DeepL Auth Key"));
  const googleKeyField = secretField("google-translate-api-key", t("Google Cloud API Key"));

  const translationCard = h("details", { id: "translation-settings", class: "module-settings-details" },
    h("summary", { text: t("Translation · provider setup") }),
    h("p", { class: "hint", text: t("Choose one provider below, then turn on Translation above. Local LibreTranslate must already be running; DeepL and Google need an API key.") }),
    serviceCost("Translation"),
    h("div", { class: "row" }, h("label", { text: t("LibreTranslate endpoint") }), libreUrlInput),
    h("div", { class: "row" }, h("label", { text: t("Preferred provider") }), providerSelect),
    h("div", { class: "row" }, h("label", { text: t("DeepL API key") }), deeplKeyField),
    h("div", { class: "row" }, h("label", { text: t("Google Translate API key") }), googleKeyField),
  );

  // ── Notifications settings ──────────────────────────────────────────────────
  const notificationsCard = card(
    t("Notifications"),
    h(
      "div",
      { class: "row" },
      h("label", { text: t("Windows notification listener") }),
      toggle(Boolean(settings.modules?.windowsNotifications), (on) => {
        settings.modules = {
          ...settings.modules,
          windowsNotifications: on,
        };
        persistModulesState();
      }),
    ),
    h(
      "div",
      {
        class: "hint",
        text: t(
          "App events and approvals are always active. Windows toast listener requires runtime permission.",
        ),
      },
    ),
  );

  return pageOf(
    t("Modules"),
    t("Choose what appears in the island. Local features work immediately; online features show their setup steps below."),
    defaultCard,
    modulesCard,
    translationCard,
    notificationsCard,
  );
}
