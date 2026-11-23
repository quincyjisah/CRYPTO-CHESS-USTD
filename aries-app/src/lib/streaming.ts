/**
 * streaming.ts — Aries Protocol Live Streaming Hub
 *
 * Provides platform configs, RTMP instructions, and WebRTC screen-share
 * for TikTok, YouTube, Twitch, Facebook, Instagram, and X (Twitter).
 *
 * NOTE: True RTMP from browser requires a relay server (e.g. your own
 * nginx-rtmp or a service like Restream.io). This module wires up the
 * screen-capture stream and provides the deep-link / setup instructions
 * for each platform's broadcast dashboard.
 */

export interface StreamPlatform {
  id: string;
  name: string;
  color: string;
  borderColor: string;
  icon: string;           // emoji fallback
  dashboardUrl: string;   // where user sets up their stream key
  rtmpBase: string;       // RTMP ingest (user pastes their key after)
  instructions: string[]; // step-by-step shown in the modal
  note?: string;
}

export const PLATFORMS: StreamPlatform[] = [
  {
    id: 'tiktok',
    name: 'TikTok',
    color: 'bg-black',
    borderColor: 'border-white/20',
    icon: '🎵',
    dashboardUrl: 'https://www.tiktok.com/live/studio',
    rtmpBase: 'rtmp://push.tiktokv.com/rtmp/',
    instructions: [
      'Open TikTok → Go Live → Live Studio',
      'Copy your Stream Key from the Live Studio dashboard',
      'Paste it into the Stream Key field below',
      'Click "Go Live" here — your game will broadcast in portrait mode',
      'TikTok requires 1,000+ followers for LIVE access',
    ],
    note: 'TikTok Live is portrait-optimised. 9:16 ratio recommended.'
  },
  {
    id: 'youtube',
    name: 'YouTube',
    color: 'bg-red-600/20',
    borderColor: 'border-red-500/30',
    icon: '▶',
    dashboardUrl: 'https://studio.youtube.com/channel/live',
    rtmpBase: 'rtmp://a.rtmp.youtube.com/live2/',
    instructions: [
      'Go to YouTube Studio → Go Live → Stream',
      'Select "Stream" tab (not Webcam)',
      'Copy the Stream Key from the right panel',
      'Paste it below and click Go Live',
      'Your stream will be unlisted by default — set to Public in Studio',
    ],
    note: 'YouTube streams are archived as VODs automatically.'
  },
  {
    id: 'twitch',
    name: 'Twitch',
    color: 'bg-purple-600/20',
    borderColor: 'border-purple-500/30',
    icon: '📺',
    dashboardUrl: 'https://dashboard.twitch.tv/u/YOUR_NAME/settings/stream',
    rtmpBase: 'rtmp://live.twitch.tv/app/',
    instructions: [
      'Go to Twitch Dashboard → Settings → Stream',
      'Click "Copy" next to your primary stream key',
      'Paste it below and click Go Live',
      'Set your stream title and category in the Twitch dashboard',
      'Real-time chat is pulled from your Twitch chat overlay',
    ],
  },
  {
    id: 'facebook',
    name: 'Facebook',
    color: 'bg-blue-600/20',
    borderColor: 'border-blue-500/30',
    icon: '🌐',
    dashboardUrl: 'https://www.facebook.com/live/producer',
    rtmpBase: 'rtmps://live-api-s.facebook.com:443/rtmp/',
    instructions: [
      'Go to facebook.com/live/producer',
      'Click "Use stream key" → copy the persistent stream key',
      'Paste it below and click Go Live',
      'Facebook uses RTMPS (secure) — your connection is encrypted',
      'Set your audience: Public / Friends / Only Me before going live',
    ],
    note: 'Facebook requires RTMPS (port 443) not plain RTMP.'
  },
  {
    id: 'instagram',
    name: 'Instagram',
    color: 'bg-pink-600/20',
    borderColor: 'border-pink-500/30',
    icon: '📸',
    dashboardUrl: 'https://www.instagram.com/live',
    rtmpBase: 'rtmps://edgetee-upload-prn3-1.instagram.com:443/rtmp/',
    instructions: [
      'Instagram Live from a desktop requires a third-party tool (OBS + Instagram RTMP)',
      'In OBS: Settings → Stream → Service: Custom → Server: paste RTMP URL',
      'Get your Instagram stream key via the Instagram API or Creator Studio',
      'Alternatively: use the Aries mobile app (Android APK) which streams natively',
      'Instagram allows max 4-hour live sessions',
    ],
    note: 'Instagram Live desktop streaming requires OBS or the Aries Android app.'
  },
  {
    id: 'twitter',
    name: 'X (Twitter)',
    color: 'bg-zinc-800',
    borderColor: 'border-zinc-600/40',
    icon: '✕',
    dashboardUrl: 'https://twitter.com/i/broadcasts',
    rtmpBase: 'rtmp://ingest.pscp.tv:80/x/',
    instructions: [
      'Go to twitter.com/i/broadcasts',
      'Click "Go Live" → select "Use Stream Key"',
      'Copy your Periscope RTMP key',
      'Paste it below — Twitter X uses the Periscope infrastructure',
      'Your live stream will appear in your Twitter/X feed automatically',
    ],
    note: 'X Live uses Periscope RTMP endpoints (legacy but still active).'
  },
];

// ─── Screen Capture ────────────────────────────────────────────────────────────

export interface ScreenCaptureResult {
  stream: MediaStream;
  videoTrack: MediaStreamTrack;
  stop: () => void;
}

/**
 * Captures the browser screen/tab for streaming.
 * The resulting MediaStream can be piped to a WebRTC sender or displayed
 * in a <video> element for local preview before the RTMP relay picks it up.
 */
export async function startScreenCapture(): Promise<ScreenCaptureResult | null> {
  try {
    const stream = await (navigator.mediaDevices as any).getDisplayMedia({
      video: {
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        sampleRate: 44100,
      },
    });

    const videoTrack = stream.getVideoTracks()[0];
    return {
      stream,
      videoTrack,
      stop: () => stream.getTracks().forEach((t: MediaStreamTrack) => t.stop()),
    };
  } catch (err: any) {
    if (err.name === 'NotAllowedError') {
      console.info('[Stream] Screen capture permission denied by user.');
    } else {
      console.error('[Stream] Screen capture failed:', err);
    }
    return null;
  }
}

/**
 * Generates an Aries-branded stream title for each platform.
 */
export function buildStreamTitle(playerHandle: string, wager: number, currency: string): string {
  return `🔴 ARIES PROTOCOL — ${playerHandle} wagering ${wager} ${currency} | Crypto Chess Arena`;
}

/**
 * Generates a Restream.io URL for multi-platform streaming.
 * Restream allows you to go live to all platforms simultaneously.
 */
export const RESTREAM_URL = 'https://restream.io/';
