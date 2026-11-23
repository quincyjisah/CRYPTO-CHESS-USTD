import { defaultMediaSettings } from "../../platform";

function createTonePlayer(
  frequency: number,
  durationSeconds: number,
): () => void {
  return () => {
    const AudioContextClass = window.AudioContext ?? window.webkitAudioContext;
    const audio = new AudioContextClass();
    const oscillator = audio.createOscillator();
    const gain = audio.createGain();

    oscillator.frequency.value = frequency;
    oscillator.type = "sine";
    gain.gain.setValueAtTime(0.04, audio.currentTime);
    gain.gain.exponentialRampToValueAtTime(
      0.001,
      audio.currentTime + durationSeconds,
    );
    oscillator.connect(gain).connect(audio.destination);
    oscillator.start();
    oscillator.stop(audio.currentTime + durationSeconds);
  };
}

export function bindAudioControls(root: ParentNode = document): void {
  const playMoveTone = createTonePlayer(440, 0.16);
  const playSlowTone = createTonePlayer(174, 1.2);
  let effectsEnabled = defaultMediaSettings.gameEffectsEnabled;

  root.querySelector("#effects-toggle")?.addEventListener("click", (event) => {
    effectsEnabled = !effectsEnabled;
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute("aria-pressed", String(effectsEnabled));
    button.textContent = effectsEnabled
      ? "Game effects on"
      : "Game effects muted";
  });

  root.querySelector("#music-toggle")?.addEventListener("click", (event) => {
    playSlowTone();
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute("aria-pressed", "true");
    button.textContent = "Slow music played";
  });

  root
    .querySelectorAll<HTMLButtonElement>('[data-sound="move"]')
    .forEach((square) => {
      square.addEventListener("click", () => {
        if (effectsEnabled) playMoveTone();
      });
    });
}
