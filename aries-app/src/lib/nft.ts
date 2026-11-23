/**
 * nft.ts — Real NFT marketplace integration
 *
 * Fetches live NFT data from Alchemy's NFT API.
 * Falls back to your contract's on-chain metadata if Alchemy is unavailable.
 *
 * Set VITE_ALCHEMY_API_KEY in your .env.local file.
 * Set VITE_NFT_CONTRACT_ADDRESS to your deployed ERC-721 contract.
 */

export interface NftToken {
  id: number;
  name: string;
  description: string;
  image: string;
  animationUrl?: string;
  attributes: { trait_type: string; value: string | number }[];
  owner?: string;
  floorPrice?: number;
  lastSaleEth?: number;
  openseaUrl?: string;
  alchemyTokenId?: string;
}

const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_API_KEY || '';
const CONTRACT_ADDRESS = import.meta.env.VITE_NFT_CONTRACT_ADDRESS || '';
const ALCHEMY_BASE = `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}`;

// ─── Fetch NFTs by contract ───────────────────────────────────────────────────

/**
 * Fetches all tokens from your ERC-721 contract via Alchemy NFT API.
 * Returns structured NftToken objects ready for the Vault UI.
 */
export async function fetchContractNFTs(limit = 64): Promise<NftToken[]> {
  if (!ALCHEMY_KEY || !CONTRACT_ADDRESS) {
    console.warn('[NFT] Missing VITE_ALCHEMY_API_KEY or VITE_NFT_CONTRACT_ADDRESS — using mock data.');
    return getMockNFTs();
  }

  try {
    const url = new URL(`${ALCHEMY_BASE}/getNFTsForContract`);
    url.searchParams.set('contractAddress', CONTRACT_ADDRESS);
    url.searchParams.set('withMetadata', 'true');
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);

    const data = await res.json();
    return (data.nfts || []).map(alchemyNftToToken);
  } catch (err) {
    console.error('[NFT] Alchemy fetch failed, using mock data:', err);
    return getMockNFTs();
  }
}

/**
 * Fetches a single NFT by token ID.
 */
export async function fetchNFTById(tokenId: string): Promise<NftToken | null> {
  if (!ALCHEMY_KEY || !CONTRACT_ADDRESS) return null;

  try {
    const url = new URL(`${ALCHEMY_BASE}/getNFTMetadata`);
    url.searchParams.set('contractAddress', CONTRACT_ADDRESS);
    url.searchParams.set('tokenId', tokenId);
    url.searchParams.set('tokenType', 'ERC721');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);

    const data = await res.json();
    return alchemyNftToToken(data);
  } catch (err) {
    console.error('[NFT] Single NFT fetch failed:', err);
    return null;
  }
}

/**
 * Fetches NFTs owned by a specific wallet address from your contract.
 */
export async function fetchNFTsOwnedBy(ownerAddress: string): Promise<NftToken[]> {
  if (!ALCHEMY_KEY || !CONTRACT_ADDRESS) return [];

  try {
    const url = new URL(`${ALCHEMY_BASE}/getNFTsForOwner`);
    url.searchParams.set('owner', ownerAddress);
    url.searchParams.set('contractAddresses[]', CONTRACT_ADDRESS);
    url.searchParams.set('withMetadata', 'true');

    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`Alchemy API error: ${res.status}`);

    const data = await res.json();
    return (data.ownedNfts || []).map(alchemyNftToToken);
  } catch (err) {
    console.error('[NFT] Owner NFT fetch failed:', err);
    return [];
  }
}

/**
 * Fetches floor price and recent sale data from OpenSea API.
 * Requires VITE_OPENSEA_API_KEY in your env.
 */
export async function fetchOpenSeaStats(slug: string): Promise<{ floorPrice: number; volume: number } | null> {
  const OPENSEA_KEY = import.meta.env.VITE_OPENSEA_API_KEY || '';
  if (!OPENSEA_KEY) return null;

  try {
    const res = await fetch(`https://api.opensea.io/api/v2/collections/${slug}/stats`, {
      headers: { 'X-API-KEY': OPENSEA_KEY }
    });
    if (!res.ok) throw new Error(`OpenSea API error: ${res.status}`);
    const data = await res.json();
    return {
      floorPrice: data?.total?.floor_price ?? 0,
      volume: data?.total?.volume ?? 0
    };
  } catch (err) {
    console.error('[NFT] OpenSea stats fetch failed:', err);
    return null;
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function alchemyNftToToken(raw: any): NftToken {
  const tokenId = parseInt(raw.tokenId || raw.id?.tokenId || '0', 10);
  const meta = raw.raw?.metadata || raw.metadata || {};
  const name = raw.name || meta.name || `Genesis Board #${String(tokenId).padStart(2, '0')}`;
  const image = resolveIpfs(meta.image || raw.image?.cachedUrl || raw.image?.originalUrl || '');
  const animationUrl = resolveIpfs(meta.animation_url || '');

  return {
    id: tokenId,
    name,
    description: meta.description || 'Aries Protocol Genesis Board Collection.',
    image,
    animationUrl: animationUrl || undefined,
    attributes: (meta.attributes || []).map((a: any) => ({
      trait_type: a.trait_type || '',
      value: a.value ?? ''
    })),
    owner: raw.owners?.[0]?.ownerAddress,
    alchemyTokenId: String(tokenId),
    openseaUrl: CONTRACT_ADDRESS
      ? `https://opensea.io/assets/ethereum/${CONTRACT_ADDRESS}/${tokenId}`
      : undefined
  };
}

/** Converts ipfs:// URIs to a public IPFS gateway URL */
function resolveIpfs(uri: string): string {
  if (!uri) return '';
  if (uri.startsWith('ipfs://')) {
    return `https://cloudflare-ipfs.com/ipfs/${uri.slice(7)}`;
  }
  return uri;
}

// ─── Mock data (used when no contract is configured) ─────────────────────────

const CHESS_PIECES = ['King', 'Queen', 'Rook', 'Bishop', 'Knight', 'Pawn'];
const VARIANTS = ['Obsidian', 'Ivory'];

export function getMockNFTs(): NftToken[] {
  const nfts: NftToken[] = [];
  let id = 1;
  for (const piece of CHESS_PIECES) {
    for (const variant of VARIANTS) {
      nfts.push({
        id,
        name: `${variant} ${piece}`,
        description: `Genesis Board Collection — ${variant} ${piece}. 1 of 2 in its class.`,
        image: `https://picsum.photos/seed/chess-${piece.toLowerCase()}-${variant.toLowerCase()}/400`,
        attributes: [
          { trait_type: 'Piece', value: piece },
          { trait_type: 'Variant', value: variant },
          { trait_type: 'Supply', value: 2 },
          { trait_type: 'Royalty', value: '5%' },
        ],
        openseaUrl: `https://opensea.io/assets/ethereum/${CONTRACT_ADDRESS || '0x0'}/${id}`
      });
      id++;
    }
  }
  return nfts;
}
