import { getAdSenseConfig, loadAdSenseScript } from "./adsense";
import { createDemoMatch } from "./features/chess";
import { bindAudioControls } from "./features/ui/audio";
import { renderApp } from "./features/ui/render";
import "./styles.css";

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Application root element #app was not found.");
}

app.innerHTML = renderApp(createDemoMatch());
loadAdSenseScript(getAdSenseConfig());
bindAudioControls(document);
