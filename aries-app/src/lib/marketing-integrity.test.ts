import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const html = readFileSync(new URL('./index.html', `file://${process.cwd()}/`).pathname, 'utf8');

describe('public marketing integrity', () => {
  it('does not advertise disabled stablecoin wagering or mainnet settlement', () => {
    const description = html.match(/<meta name="description" content="([^"]+)"/)?.[1] ?? '';
    const socialDescription = html.match(/<meta property="og:description" content="([^"]+)"/)?.[1] ?? '';
    expect(description).toMatch(/free-play/i);
    expect(description).toMatch(/wagering.{0,40}disabled|disabled.{0,40}wagering/i);
    expect(description).not.toMatch(/wager USDT|on-chain settlements|Ethereum Mainnet/i);
    expect(socialDescription).toMatch(/no live wagers|on-chain wagering is not enabled/i);
    expect(socialDescription).not.toMatch(/wager stablecoins|on-chain.*mainnet/i);
  });

  it('does not load an unconfigured AdSense placeholder', () => {
    expect(html).not.toMatch(/ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID/);
    expect(html).not.toMatch(/pagead2\.googlesyndication\.com\/pagead\/js\/adsbygoogle\.js/);
  });
});
