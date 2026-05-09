import {
  getAdSenseConfig,
  loadAdSenseScript,
  renderAdSenseSlot,
} from "./adsense";
import {
  createDemoMatch,
  formatUsdt,
  getPieceIcon,
  validateWalletAddress,
  type WagerMatch,
} from "./chess";
import { calculateMatchEconomy } from "./economy";
import {
  defaultMediaSettings,
  defaultNftRules,
  streamingDestinations,
} from "./platform";
import "./styles.css";

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => {
    const entities: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "'": "&#39;",
      '"': "&quot;",
    };

    return entities[character];
  });
}

function renderPlayer(match: WagerMatch): string {
  return match.players
    .map(
      (player) => `
        <li class="player-card">
          <span class="player-color ${player.color}"></span>
          <div>
            <strong>${escapeHtml(player.name)}</strong>
            <span>${player.color} · ${escapeHtml(player.walletAddress)}</span>
          </div>
        </li>`,
    )
    .join("");
}

function renderBoard(match: WagerMatch): string {
  return match.board
    .map((rank, rankIndex) =>
      rank
        .map((square, fileIndex) => {
          const isLight = (rankIndex + fileIndex) % 2 === 0;
          const label = `${String.fromCharCode(97 + fileIndex)}${8 - rankIndex}`;

          return `
            <button class="square ${isLight ? "light" : "dark"}" aria-label="${label}" data-sound="move">
              <span>${getPieceIcon(square)}</span>
            </button>`;
        })
        .join(""),
    )
    .join("");
}

function renderStreamingOptions(): string {
  return streamingDestinations
    .map(
      (destination) => `
        <button class="stream-chip" type="button" disabled title="${escapeHtml(destination.note)}">
          ${destination.name}
          <span>${destination.status}</span>
        </button>`,
    )
    .join("");
}

function renderApp(match: WagerMatch): string {
  const escrowIsValid = validateWalletAddress(match.escrowAddress);
  const economy = calculateMatchEconomy({ playerStakeUsdt: match.stakeUsdt });
  const adSenseConfig = getAdSenseConfig();

  return `
    <section class="hero">
      <p class="eyebrow">Crypto Chess Mainnet Gate</p>
      <h1>USDT wager chess lobby</h1>
      <p class="lede">
        Two players bring equal candles to the board; the winner receives the pot
        after a ${economy.platformFeeBasisPoints / 100}% platform fee is carved from the victory.
      </p>
      <div class="hero-actions">
        <button id="music-toggle" class="primary-action" type="button" aria-pressed="false">
          Start slow background music
        </button>
        <button id="effects-toggle" class="secondary-action" type="button" aria-pressed="${defaultMediaSettings.gameEffectsEnabled}">
          Game effects on
        </button>
      </div>
    </section>

    <section class="dashboard" aria-label="Match dashboard">
      <article class="panel summary-panel">
        <div>
          <p class="label">Match</p>
          <h2>${escapeHtml(match.id)}</h2>
        </div>
        <dl class="stats">
          <div>
            <dt>Stake</dt>
            <dd>${formatUsdt(economy.playerStakeUsdt)} each</dd>
          </div>
          <div>
            <dt>Escrow total</dt>
            <dd>${formatUsdt(economy.totalEscrowUsdt)}</dd>
          </div>
          <div>
            <dt>Platform fee</dt>
            <dd>${formatUsdt(economy.platformFeeUsdt)}</dd>
          </div>
          <div>
            <dt>Winner payout</dt>
            <dd>${formatUsdt(economy.winnerPayoutUsdt)}</dd>
          </div>
          <div>
            <dt>Clock</dt>
            <dd>${match.timeControlMinutes}+0 rapid</dd>
          </div>
          <div>
            <dt>Escrow</dt>
            <dd class="${escrowIsValid ? "status-ok" : "status-error"}">
              ${escrowIsValid ? "Address format verified" : "Invalid escrow address"}
            </dd>
          </div>
        </dl>
      </article>

      <article class="panel board-panel">
        <h2>Board preview</h2>
        <div class="board" role="grid" aria-label="Initial chess board">
          ${renderBoard(match)}
        </div>
      </article>

      <aside class="panel roster-panel">
        <h2>Players</h2>
        <ul class="player-list">
          ${renderPlayer(match)}
        </ul>
      </aside>

      <article class="panel media-panel">
        <h2>Live table controls</h2>
        <div class="control-grid">
          <button type="button" aria-pressed="${defaultMediaSettings.microphoneMuted}">Mic muted</button>
          <button type="button" aria-pressed="${defaultMediaSettings.cameraMuted}">Camera muted</button>
          <button type="button">Tip White Hat</button>
          <button type="button">Tip Black Bishop</button>
        </div>
        <p class="note">Tips, live video, and stream keys must be processed by a hardened backend before mainnet.</p>
        <div class="stream-list" aria-label="Planned live-stream destinations">
          ${renderStreamingOptions()}
        </div>
      </article>

      <article class="panel ad-panel">
        <h2>Sponsored space</h2>
        <p class="note">Ads are kept away from wallet prompts, moves, fee disclosures, and settlement actions.</p>
        ${renderAdSenseSlot(adSenseConfig)}
      </article>

      <article class="panel rules-panel">
        <h2>Rules ready for audit</h2>
        <ul>
          <li>Equal wagers only: player A stake must equal player B stake.</li>
          <li>Fee rule: ${economy.platformFeeBasisPoints / 100}% of the escrowed pot goes to the platform.</li>
          <li>NFT rule: ${defaultNftRules.description}</li>
          <li>Settlement rule: no mainnet release without audited contracts and deterministic game proof.</li>
        </ul>
      </article>
    </section>`;
}

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

const app = document.querySelector<HTMLDivElement>("#app");

if (!app) {
  throw new Error("Application root element #app was not found.");
}

app.innerHTML = renderApp(createDemoMatch());
loadAdSenseScript(getAdSenseConfig());

const playMoveTone = createTonePlayer(440, 0.16);
const playSlowTone = createTonePlayer(174, 1.2);
let effectsEnabled = defaultMediaSettings.gameEffectsEnabled;

document
  .querySelector("#effects-toggle")
  ?.addEventListener("click", (event) => {
    effectsEnabled = !effectsEnabled;
    const button = event.currentTarget as HTMLButtonElement;
    button.setAttribute("aria-pressed", String(effectsEnabled));
    button.textContent = effectsEnabled
      ? "Game effects on"
      : "Game effects muted";
  });

document.querySelector("#music-toggle")?.addEventListener("click", (event) => {
  playSlowTone();
  const button = event.currentTarget as HTMLButtonElement;
  button.setAttribute("aria-pressed", "true");
  button.textContent = "Slow music played";
});

document
  .querySelectorAll<HTMLButtonElement>('[data-sound="move"]')
  .forEach((square) => {
    square.addEventListener("click", () => {
      if (effectsEnabled) {
        playMoveTone();
      }
    });
  });
