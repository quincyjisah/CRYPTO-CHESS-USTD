export type StreamingPlatform =
  | "TikTok"
  | "Facebook"
  | "Instagram"
  | "YouTube"
  | "Twitch"
  | "X";

export interface StreamingDestination {
  name: StreamingPlatform;
  enabled: boolean;
  status: "planned" | "ready";
  note: string;
}

export interface MediaSettings {
  slowMusicEnabled: boolean;
  gameEffectsEnabled: boolean;
  microphoneMuted: boolean;
  cameraMuted: boolean;
}

export interface NftRuleSet {
  enabled: boolean;
  mintOnWin: boolean;
  transferable: boolean;
  royaltyBasisPoints: number;
  description: string;
}

export const streamingDestinations: StreamingDestination[] = [
  {
    name: "TikTok",
    enabled: false,
    status: "planned",
    note: "Requires approved live API or RTMP workflow before production use.",
  },
  {
    name: "Facebook",
    enabled: false,
    status: "planned",
    note: "Requires app review, OAuth permissions, and live video policy checks.",
  },
  {
    name: "Instagram",
    enabled: false,
    status: "planned",
    note: "Requires platform-approved live publishing workflow.",
  },
  {
    name: "YouTube",
    enabled: false,
    status: "planned",
    note: "Requires OAuth, channel verification, and live broadcast setup.",
  },
  {
    name: "Twitch",
    enabled: false,
    status: "planned",
    note: "Requires Twitch OAuth and stream-key handling outside the browser.",
  },
  {
    name: "X",
    enabled: false,
    status: "planned",
    note: "Requires current platform live-video support and app permissions.",
  },
];

export const defaultMediaSettings: MediaSettings = {
  slowMusicEnabled: false,
  gameEffectsEnabled: true,
  microphoneMuted: true,
  cameraMuted: true,
};

export const defaultNftRules: NftRuleSet = {
  enabled: false,
  mintOnWin: true,
  transferable: true,
  royaltyBasisPoints: 250,
  description:
    "Future winner badges may be minted only after audited game settlement and user consent.",
};
