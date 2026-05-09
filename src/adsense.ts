export interface AdSenseConfig {
  client: string;
  slot?: string;
  enabled: boolean;
}

const ADSENSE_CLIENT_PATTERN = /^ca-pub-\d{16}$/;

export function getAdSenseConfig(
  env: ImportMetaEnv = import.meta.env,
): AdSenseConfig {
  const client = env.VITE_ADSENSE_CLIENT?.trim() ?? "";
  const slot = env.VITE_ADSENSE_SLOT?.trim() || undefined;

  return {
    client,
    slot,
    enabled: ADSENSE_CLIENT_PATTERN.test(client),
  };
}

export function renderAdSenseSlot(config: AdSenseConfig): string {
  if (!config.enabled) {
    return `
      <div class="ad-placeholder" role="note">
        Google AdSense is disabled until VITE_ADSENSE_CLIENT is configured.
      </div>`;
  }

  return `
    <ins
      class="adsbygoogle ad-slot"
      style="display:block"
      data-ad-client="${config.client}"
      ${config.slot ? `data-ad-slot="${config.slot}"` : ""}
      data-ad-format="auto"
      data-full-width-responsive="true"
    ></ins>`;
}

export function loadAdSenseScript(
  config: AdSenseConfig,
  documentRef: Document = document,
): void {
  if (
    !config.enabled ||
    documentRef.querySelector("script[data-adsense-loader]")
  ) {
    return;
  }

  const script = documentRef.createElement("script");
  script.async = true;
  script.crossOrigin = "anonymous";
  script.dataset.adsenseLoader = "true";
  script.src = `https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${encodeURIComponent(
    config.client,
  )}`;
  documentRef.head.appendChild(script);
}
