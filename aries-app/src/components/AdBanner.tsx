import React, { useEffect, useRef, useState } from 'react';

/**
 * AdBanner — Google AdSense integration
 *
 * Account:   quincy.j.isah@gmail.com
 * Publisher: Replace VITE_ADSENSE_PUB_ID in .env.local with your
 *            ca-pub-XXXXXXXXXXXXXXXX after AdSense approval.
 *
 * Ad slots:
 *   VITE_ADSENSE_SLOT_BANNER   — 728×90 leaderboard (desktop sidebar)
 *   VITE_ADSENSE_SLOT_SQUARE   — 300×250 medium rectangle (in-game panel)
 *   VITE_ADSENSE_SLOT_NATIVE   — native / responsive (mobile)
 *
 * AdSense will auto-collapse empty ad units — no layout shift.
 */

type AdFormat = 'square' | 'banner' | 'responsive';

interface AdBannerProps {
  format?: AdFormat;
  className?: string;
}

// Read from Vite env — set in .env.local, never hardcoded
const PUB_ID   = (import.meta as any).env?.VITE_ADSENSE_PUB_ID   || 'ca-pub-REPLACE_WITH_YOUR_PUBLISHER_ID';
const SLOT_SQ  = (import.meta as any).env?.VITE_ADSENSE_SLOT_SQUARE  || 'REPLACE_SQUARE_SLOT_ID';
const SLOT_BAN = (import.meta as any).env?.VITE_ADSENSE_SLOT_BANNER  || 'REPLACE_BANNER_SLOT_ID';
const SLOT_NAT = (import.meta as any).env?.VITE_ADSENSE_SLOT_NATIVE  || 'REPLACE_NATIVE_SLOT_ID';
const IS_DEV   = (import.meta as any).env?.DEV === true;

function slotFor(format: AdFormat): string {
  if (format === 'square')   return SLOT_SQ;
  if (format === 'banner')   return SLOT_BAN;
  return SLOT_NAT;
}

function dimensionsFor(format: AdFormat): React.CSSProperties {
  if (format === 'square')   return { width: '300px', height: '250px' };
  if (format === 'banner')   return { width: '728px', height: '90px', maxWidth: '100%' };
  return { display: 'block', width: '100%', minHeight: '90px' };
}

export default function AdBanner({ format = 'responsive', className = '' }: AdBannerProps) {
  const ref = useRef<HTMLModElement>(null);
  const [pushed, setPushed] = useState(false);

  useEffect(() => {
    // In development, show a placeholder instead of real ads
    if (IS_DEV) return;
    // AdSense ins elements must only be pushed once
    if (pushed) return;
    try {
      if (ref.current && (window as any).adsbygoogle) {
        ((window as any).adsbygoogle = (window as any).adsbygoogle || []).push({});
        setPushed(true);
      }
    } catch (e) {
      console.warn('[AdSense] Push failed:', e);
    }
  }, [pushed]);

  // ─── Development placeholder ──────────────────────────────────────────────
  if (IS_DEV || PUB_ID.includes('REPLACE')) {
    return (
      <div className={`w-full bg-zinc-900/60 border border-dashed border-zinc-700 rounded-xl flex items-center justify-center text-center p-3 ${className}`}
        style={dimensionsFor(format)}>
        <div>
          <p className="text-[8px] font-black text-zinc-600 uppercase tracking-widest">Google AdSense</p>
          <p className="text-[7px] text-zinc-700 font-mono mt-0.5">{format} · {slotFor(format)}</p>
          <p className="text-[7px] text-zinc-700 font-mono">quincy.j.isah@gmail.com</p>
        </div>
      </div>
    );
  }

  // ─── Production AdSense unit ──────────────────────────────────────────────
  return (
    <div className={`w-full overflow-hidden ${className}`}>
      <ins
        ref={ref}
        className="adsbygoogle"
        style={{ ...dimensionsFor(format), display: 'block' }}
        data-ad-client={PUB_ID}
        data-ad-slot={slotFor(format)}
        data-ad-format={format === 'responsive' ? 'auto' : undefined}
        data-full-width-responsive={format === 'responsive' ? 'true' : undefined}
      />
    </div>
  );
}
