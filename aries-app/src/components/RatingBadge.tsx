/**
 * RatingBadge.tsx — Displays a player's Glicko-2 rating with band colour
 * Used in: Header, Leaderboard, ChessArena, Profile, TournamentUI
 */
import React from 'react';
import { ratingBand, ratingColor } from '../lib/rating';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';

interface RatingBadgeProps {
  rating:       number;
  rd?:          number;       // Rating deviation — shown as ± range
  ratingChange?: number;      // Show +/- after a game
  size?:        'sm' | 'md' | 'lg';
  showBand?:    boolean;
}

export default function RatingBadge({
  rating,
  rd,
  ratingChange,
  size = 'md',
  showBand = true,
}: RatingBadgeProps) {
  const colorClass = ratingColor(rating);
  const band       = ratingBand(rating);

  // RD > 100 means the rating is provisional (not enough games)
  const isProvisional = rd !== undefined && rd > 100;

  const sizeClasses = {
    sm: { rating: 'text-[11px]', band: 'text-[7px]',  change: 'text-[8px]'  },
    md: { rating: 'text-sm',     band: 'text-[8px]',  change: 'text-[9px]'  },
    lg: { rating: 'text-xl',     band: 'text-[10px]', change: 'text-[11px]' },
  }[size];

  return (
    <div className="flex items-center gap-1.5">
      {/* Rating number */}
      <span className={`font-black font-mono ${colorClass} ${sizeClasses.rating}`}>
        {rating}
        {isProvisional && <span className="text-zinc-500 font-normal">?</span>}
      </span>

      {/* Band label */}
      {showBand && (
        <span className={`text-zinc-500 font-mono ${sizeClasses.band} hidden sm:inline`}>
          {band}
        </span>
      )}

      {/* Rating deviation */}
      {rd !== undefined && rd > 0 && (
        <span className={`text-zinc-600 font-mono ${sizeClasses.band}`}>
          ±{rd}
        </span>
      )}

      {/* Rating change (shown after a game) */}
      {ratingChange !== undefined && ratingChange !== 0 && (
        <span className={`font-black font-mono flex items-center gap-0.5 ${sizeClasses.change} ${ratingChange > 0 ? 'text-green-400' : 'text-red-400'}`}>
          {ratingChange > 0
            ? <TrendingUp className="w-3 h-3" />
            : <TrendingDown className="w-3 h-3" />
          }
          {ratingChange > 0 ? '+' : ''}{ratingChange}
        </span>
      )}
    </div>
  );
}

/**
 * RatingProgressBar — shows progress within the current rating band
 */
export function RatingProgressBar({ rating }: { rating: number }) {
  const bands = [0, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2200, 2400, 2500, 3500];
  let bandStart = 0;
  let bandEnd   = 800;

  for (let i = 0; i < bands.length - 1; i++) {
    if (rating >= bands[i] && rating < bands[i + 1]) {
      bandStart = bands[i];
      bandEnd   = bands[i + 1];
      break;
    }
  }

  const progress = Math.min(100, ((rating - bandStart) / (bandEnd - bandStart)) * 100);

  return (
    <div className="w-full">
      <div className="flex justify-between text-[7px] font-mono text-zinc-600 mb-0.5">
        <span>{bandStart}</span>
        <span>{ratingBand(rating)}</span>
        <span>{bandEnd}</span>
      </div>
      <div className="bg-zinc-900 rounded-full h-1 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${ratingColor(rating).replace('text-', 'bg-')}`}
          style={{ width: `${progress}%` }}
        />
      </div>
    </div>
  );
}
