const URL_PATTERN = /(https?:\/\/|www\.)/i;
const WALLET_DRAIN_KEYWORDS = [
  "seed phrase",
  "private key",
  "wallet recovery",
  "send usdt first",
];

export interface ChatModerationResult {
  blocked: boolean;
  reasons: string[];
}

export function moderateChatMessage(message: string): ChatModerationResult {
  const normalized = message.toLowerCase();
  const reasons: string[] = [];

  if (URL_PATTERN.test(message)) reasons.push("link-detected");
  if (WALLET_DRAIN_KEYWORDS.some((term) => normalized.includes(term))) {
    reasons.push("credential-phishing-pattern");
  }

  return {
    blocked: reasons.length > 0,
    reasons,
  };
}
