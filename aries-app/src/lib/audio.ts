/**
 * audio.ts — Aries Protocol Audio Engine
 *
 * Covers:
 *  - Background ambient music (lobby / game / victory / defeat)
 *  - Chess piece move / capture / check / illegal-move / game-end SFX
 *  - Coin flip SFX
 *  - Tip received chime
 *  - Master mute toggle (persisted to localStorage)
 *  - Volume control
 */

// ─── State ────────────────────────────────────────────────────────────────────

let audioCtx: AudioContext | null = null;
let bgNode: AudioBufferSourceNode | null = null;
let bgGain: GainNode | null = null;
let masterGain: GainNode | null = null;
let _muted = false;
let _volume = 0.6;

function getCtx(): AudioContext {
  if (!audioCtx || audioCtx.state === 'closed') {
    audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    masterGain = audioCtx.createGain();
    masterGain.gain.value = _muted ? 0 : _volume;
    masterGain.connect(audioCtx.destination);
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

function getMaster(): GainNode {
  getCtx();
  return masterGain!;
}

// ─── Mute / Volume ────────────────────────────────────────────────────────────

export function isMuted(): boolean { return _muted; }
export function getVolume(): number { return _volume; }

export function setMuted(mute: boolean) {
  _muted = mute;
  try { localStorage.setItem('aries_muted', mute ? '1' : '0'); } catch {}
  if (masterGain) {
    masterGain.gain.setTargetAtTime(mute ? 0 : _volume, getCtx().currentTime, 0.1);
  }
  if (mute) stopBgMusic();
}

export function setVolume(vol: number) {
  _volume = Math.max(0, Math.min(1, vol));
  try { localStorage.setItem('aries_volume', String(_volume)); } catch {}
  if (!_muted && masterGain) {
    masterGain.gain.setTargetAtTime(_volume, getCtx().currentTime, 0.05);
  }
}

export function loadSavedPrefs() {
  try {
    const m = localStorage.getItem('aries_muted');
    const v = localStorage.getItem('aries_volume');
    if (m !== null) _muted = m === '1';
    if (v !== null) _volume = parseFloat(v) || 0.6;
  } catch {}
}

// ─── Background Music ─────────────────────────────────────────────────────────

// Reliable royalty-free music from Incompetech (Kevin MacLeod, CC-BY 4.0)
// and Free Music Archive. These URLs are stable CDN links.
export const MUSIC_TRACKS = {
  lobby:   'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Cipher.mp3',
  game:    'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Investigations.mp3',
  victory: 'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Fanfare%20for%20Space.mp3',
  tense:   'https://incompetech.com/music/royalty-free/mp3-royaltyfree/Volatile%20Reaction.mp3',
} as const;

export type TrackKey = keyof typeof MUSIC_TRACKS;

let currentTrack: TrackKey | null = null;
const bgAudio = typeof window !== 'undefined' ? new Audio() : null;

export function playBgMusic(track: TrackKey, volume = 0.18) {
  if (_muted || !bgAudio) return;
  if (currentTrack === track && !bgAudio.paused) return;

  const src = MUSIC_TRACKS[track];
  bgAudio.pause();
  bgAudio.src = src;
  bgAudio.loop = true;
  bgAudio.volume = volume;
  bgAudio.crossOrigin = 'anonymous';

  const playAttempt = bgAudio.play();
  if (playAttempt) {
    playAttempt.catch(err => {
      // Autoplay blocked — user must interact first. This is expected.
      console.info('[Audio] Autoplay blocked. Will play on first interaction.', err);
    });
  }
  currentTrack = track;
}

export function stopBgMusic() {
  if (!bgAudio) return;
  bgAudio.pause();
  bgAudio.currentTime = 0;
  currentTrack = null;
}

export function setBgVolume(vol: number) {
  if (bgAudio) bgAudio.volume = Math.max(0, Math.min(1, vol));
}

// ─── Synthesized Sound Effects ────────────────────────────────────────────────

function playTone(
  type: OscillatorType,
  freq: number,
  gainVal: number,
  duration: number,
  freqEnd?: number
) {
  try {
    const ctx = getCtx();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(getMaster());
    osc.type = type;
    osc.frequency.setValueAtTime(freq, ctx.currentTime);
    if (freqEnd !== undefined) {
      osc.frequency.linearRampToValueAtTime(freqEnd, ctx.currentTime + duration);
    }
    gain.gain.setValueAtTime(gainVal, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.00001, ctx.currentTime + duration);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + duration);
  } catch {}
}

/** Soft click when a chess piece lands */
export function sfxMove() {
  playTone('sine', 600, 0.12, 0.08);
}

/** Crunchier sound when a piece is captured */
export function sfxCapture() {
  playTone('sawtooth', 180, 0.15, 0.18, 80);
  setTimeout(() => playTone('sine', 300, 0.08, 0.1), 40);
}

/** Tense sting when the king is in check */
export function sfxCheck() {
  playTone('square', 440, 0.12, 0.12);
  setTimeout(() => playTone('square', 554, 0.10, 0.12), 80);
  setTimeout(() => playTone('square', 659, 0.08, 0.15), 160);
}

/** Buzzer for an illegal move attempt */
export function sfxIllegal() {
  playTone('sawtooth', 120, 0.15, 0.22, 80);
}

/** Triumphant ascending fanfare on victory */
export function sfxVictory() {
  const notes = [261, 329, 392, 523, 659, 784];
  notes.forEach((freq, i) => {
    setTimeout(() => playTone('triangle', freq, 0.15, 0.3), i * 80);
  });
}

/** Descending diminished chord on defeat */
export function sfxDefeat() {
  [392, 370, 349, 311, 294].forEach((freq, i) => {
    setTimeout(() => playTone('sine', freq, 0.12, 0.35), i * 100);
  });
}

/** Coin spin and land */
export function sfxCoinFlip() {
  for (let i = 0; i < 8; i++) {
    setTimeout(() => playTone('triangle', 800 + Math.random() * 400, 0.06, 0.05), i * 60);
  }
  setTimeout(() => playTone('sine', 440, 0.18, 0.25), 520);
}

/** Soft chime when a tip arrives */
export function sfxTipReceived() {
  [523, 659, 784, 1046].forEach((freq, i) => {
    setTimeout(() => playTone('sine', freq, 0.1, 0.4), i * 60);
  });
}

/** Castle / special move whoosh */
export function sfxCastle() {
  playTone('triangle', 300, 0.10, 0.2, 600);
}

/** Promotion fanfare */
export function sfxPromotion() {
  [392, 494, 587, 784].forEach((freq, i) => {
    setTimeout(() => playTone('triangle', freq, 0.14, 0.25), i * 70);
  });
}
