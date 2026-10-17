// Translation module for Awuuu's notch dashboard (Task 12).
// Provider-pluggable: Local LibreTranslate (default), DeepL, or Google Cloud Translate.
// 0 % CPU idle: translation requests run ONLY on explicit user action.
// Never persists or logs the translated text (spec rule).

import { h, svg } from "../dom";
import { ICONS } from "../icons";
import { Bridge } from "../../core/bridge";
import type { ModuleCtx, ModuleHost } from "../../core/modules";
import { State } from "../../core/state";
import {
  chunkText,
  PROVIDER_CAPS,
  selectProvider,
  SUPPORTED_LANGUAGES,
  type TranslationProvider,
} from "../../core/translation";
import { t } from "../../i18n/i18n";

export function createTranslationModuleHost(ctx: ModuleCtx): ModuleHost {
  let activeProvider: TranslationProvider | null = null;
  let isTranslating = false;
  let disposed = false;

  const iconEl = svg(ICONS.translate, 13);
  const titleEl = h("span", { class: "translation-header-title", text: t("Translation") });
  const providerBadge = h("span", { class: "translation-badge", text: "--" });

  const headerEl = h(
    "div",
    { class: "translation-header" },
    h("div", { class: "translation-header-left" }, iconEl, titleEl, providerBadge),
  );

  // Language selectors
  const sourceSelect = h("select", { class: "translation-select" });
  sourceSelect.append(h("option", { value: "auto", text: t("Auto detect") }));
  for (const lang of SUPPORTED_LANGUAGES) {
    sourceSelect.append(h("option", { value: lang.code, text: t(lang.name) }));
  }
  sourceSelect.value = State.settings?.translateSource ?? "auto";

  const targetSelect = h("select", { class: "translation-select" });
  for (const lang of SUPPORTED_LANGUAGES) {
    targetSelect.append(h("option", { value: lang.code, text: t(lang.name) }));
  }
  targetSelect.value = State.settings?.translateTarget ?? "th";

  const swapBtn = h("button", { class: "translation-swap-btn", title: t("Swap languages") }, "⇌");
  swapBtn.addEventListener("click", () => {
    if (sourceSelect.value !== "auto") {
      const temp = sourceSelect.value;
      sourceSelect.value = targetSelect.value;
      targetSelect.value = temp;
    }
  });

  const langBar = h("div", { class: "translation-lang-bar" }, sourceSelect, swapBtn, targetSelect);

  // Input textarea
  const textarea = h("textarea", {
    class: "translation-textarea",
    placeholder: t("Type or paste text to translate..."),
    rows: 3,
  }) as HTMLTextAreaElement;

  textarea.addEventListener("keydown", (e: KeyboardEvent) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      void doTranslate();
    }
  });

  // Action row
  const translateBtn = h("button", { class: "translation-btn", text: t("Translate") });
  const errorEl = h("div", { class: "translation-error" });
  errorEl.style.display = "none";

  const actionsRow = h("div", { class: "translation-actions" }, errorEl, translateBtn);

  // Result display
  const resultContainer = h("div", { class: "translation-result-wrap" });
  resultContainer.style.display = "none";
  const resultTextEl = h("div", { class: "translation-result-text" });
  const copyBtn = h("button", { class: "translation-copy-btn", text: t("Copy") });

  copyBtn.addEventListener("click", () => {
    if (!resultTextEl.textContent) return;
    void navigator.clipboard.writeText(resultTextEl.textContent).then(() => {
      copyBtn.textContent = t("Copied!");
      window.setTimeout(() => {
        copyBtn.textContent = t("Copy");
      }, 1500);
    });
  });

  resultContainer.append(resultTextEl, copyBtn);

  const el = h(
    "div",
    { class: "widget widget-translation" },
    headerEl,
    langBar,
    textarea,
    actionsRow,
    resultContainer,
  );

  async function checkProviders(): Promise<TranslationProvider | null> {
    try {
      const [hasDeepl, hasGoogle] = await Promise.all([
        Bridge.secretPresent("deepl-api-key"),
        Bridge.secretPresent("google-translate-api-key"),
      ]);
      const endpoint = State.settings?.libreTranslateUrl;
      const reachable = await Bridge.checkLibreTranslate(endpoint);

      const pref = State.settings?.translateProvider as TranslationProvider | undefined;
      const provider = selectProvider({
        libreTranslateReachable: Boolean(reachable),
        hasDeeplKey: Boolean(hasDeepl),
        hasGoogleKey: Boolean(hasGoogle),
        preferred: pref || null,
      });

      return provider;
    } catch {
      return null;
    }
  }

  async function refreshProviderStatus() {
    activeProvider = await checkProviders();
    if (disposed) return;

    if (!activeProvider) {
      // Per spec: otherwise the module stays hidden
      el.style.display = "none";
      ctx.onActiveChange?.(false);
      return;
    }

    el.style.display = "";
    ctx.onActiveChange?.(true);

    if (activeProvider === "libretranslate") {
      providerBadge.textContent = "LibreTranslate";
    } else if (activeProvider === "deepl") {
      providerBadge.textContent = "DeepL";
    } else if (activeProvider === "google") {
      providerBadge.textContent = "Google";
    }
  }

  async function doTranslate() {
    if (isTranslating) return;
    const text = textarea.value.trim();
    if (!text) return;

    if (!activeProvider) {
      activeProvider = await checkProviders();
      if (!activeProvider) {
        errorEl.textContent = t("No translation provider available. Configure in Settings.");
        errorEl.style.display = "block";
        return;
      }
    }

    isTranslating = true;
    translateBtn.textContent = t("Translating...");
    translateBtn.setAttribute("disabled", "true");
    errorEl.style.display = "none";

    try {
      const cap = PROVIDER_CAPS[activeProvider] || 2000;
      const chunks = chunkText(text, cap);
      const translatedChunks: string[] = [];
      const endpoint = State.settings?.libreTranslateUrl;

      for (const chunk of chunks) {
        const trans = await Bridge.translateText(
          activeProvider,
          chunk,
          sourceSelect.value,
          targetSelect.value,
          endpoint,
        );
        translatedChunks.push(trans);
      }

      const fullResult = translatedChunks.join("\n\n");
      resultTextEl.textContent = fullResult;
      resultContainer.style.display = "flex";
    } catch (err) {
      errorEl.textContent = String(err).replace(/^Error:\s*/, "");
      errorEl.style.display = "block";
    } finally {
      isTranslating = false;
      translateBtn.textContent = t("Translate");
      translateBtn.removeAttribute("disabled");
    }
  }

  translateBtn.addEventListener("click", () => {
    void doTranslate();
  });

  // Initial check
  void refreshProviderStatus();

  return {
    el,
    refresh: () => refreshProviderStatus(),
    dispose: () => {
      disposed = true;
    },
  };
}
