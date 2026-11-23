// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/**
 * AriesGenesisNFT.sol — Aries Protocol Cosmetic Chess Piece NFT
 *
 * Principles:
 *  - Cosmetic ONLY. Zero gameplay advantages. Ever.
 *  - 5% creator royalty via ERC-2981 on all secondary sales
 *  - On-chain rarity verification
 *  - Creator collaborations via the MINTER_ROLE
 *  - Anti-wash-trading: 24h transfer cooldown after mint
 *  - Seasonal supply caps enforced on-chain
 *  - Metadata permanently on IPFS — not changeable after mint
 *
 * Import OpenZeppelin:
 *   npm install @openzeppelin/contracts
 */

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/token/ERC721/extensions/ERC721URIStorage.sol";
import "@openzeppelin/contracts/token/common/ERC2981.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import "@openzeppelin/contracts/utils/Pausable.sol";
import "@openzeppelin/contracts/utils/Strings.sol";

contract AriesGenesisNFT is
    ERC721,
    ERC721URIStorage,
    ERC2981,
    AccessControl,
    ReentrancyGuard,
    Pausable
{
    using Strings for uint256;

    // ─── Roles ────────────────────────────────────────────────────────────────
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant TREASURY_ROLE = keccak256("TREASURY_ROLE");

    // ─── Supply ───────────────────────────────────────────────────────────────
    uint256 public constant MAX_GENESIS_SUPPLY = 10_000;
    uint256 public constant MAX_SEASONAL_CAP   = 1_000;   // Per seasonal drop

    uint256 public totalMinted;
    uint256 public currentSeasonId;
    mapping(uint256 => uint256) public seasonMintCount;
    mapping(uint256 => uint256) public seasonCap;
    mapping(uint256 => bool) public seasonClosed;

    // ─── Token metadata ───────────────────────────────────────────────────────
    struct TokenData {
        uint8   pieceType;    // 0=King 1=Queen 2=Rook 3=Bishop 4=Knight 5=Pawn 6=FullSet
        uint8   rarity;       // 0=Common 1=Rare 2=Epic 3=Legendary 4=Genesis
        uint16  seasonId;
        address creator;
        bool    isAnimated;
        uint256 mintedAt;
    }

    mapping(uint256 => TokenData) public tokenData;

    // ─── Anti-wash-trading ────────────────────────────────────────────────────
    // Tokens cannot be transferred for 24 hours after minting
    uint256 public constant TRANSFER_COOLDOWN = 24 hours;
    mapping(uint256 => uint256) public lastTransferAt;

    // ─── Mint price (0 for tournament rewards / airdrops) ────────────────────
    mapping(uint8 => uint256) public mintPriceByRarity; // rarity → price in wei

    // ─── Treasury ─────────────────────────────────────────────────────────────
    address public treasury;
    uint256 public accumulatedFees;

    // ─── Events ───────────────────────────────────────────────────────────────
    event TokenMinted(
        uint256 indexed tokenId,
        address indexed to,
        uint8   pieceType,
        uint8   rarity,
        uint16  seasonId,
        address creator
    );
    event SeasonOpened(uint256 indexed seasonId, uint256 cap);
    event SeasonClosed(uint256 indexed seasonId);
    event TreasuryWithdrawn(address indexed to, uint256 amount);
    event RoyaltyUpdated(address indexed receiver, uint96 feeBps);

    // ─── Constructor ──────────────────────────────────────────────────────────
    constructor(address _treasury) ERC721("Aries Genesis Board", "ARIESG") {
        require(_treasury != address(0), "Invalid treasury");
        treasury = _treasury;

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(MINTER_ROLE,        msg.sender);
        _grantRole(PAUSER_ROLE,        msg.sender);
        _grantRole(TREASURY_ROLE,      _treasury);

        // Default 5% royalty on all secondary sales
        _setDefaultRoyalty(_treasury, 500);

        // Default mint prices (0 = free / tournament reward)
        mintPriceByRarity[0] = 0;                   // Common: free / airdrop
        mintPriceByRarity[1] = 0.02 ether;          // Rare
        mintPriceByRarity[2] = 0.08 ether;          // Epic
        mintPriceByRarity[3] = 0.25 ether;          // Legendary
        mintPriceByRarity[4] = 1.00 ether;          // Genesis
    }

    // ─── Open a new season ────────────────────────────────────────────────────
    function openSeason(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(cap > 0 && cap <= MAX_SEASONAL_CAP, "Invalid cap");
        require(currentSeasonId == 0 || seasonClosed[currentSeasonId], "Current season still open");
        require(currentSeasonId < type(uint16).max, "Season id exhausted");
        currentSeasonId++;
        seasonCap[currentSeasonId] = cap;
        emit SeasonOpened(currentSeasonId, cap);
    }

    function closeSeason() external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(currentSeasonId > 0 && !seasonClosed[currentSeasonId], "No active season");
        seasonClosed[currentSeasonId] = true;
        emit SeasonClosed(currentSeasonId);
    }

    // ─── Mint (with payment for paid rarities) ────────────────────────────────
    function mint(
        address to,
        uint8   pieceType,
        uint8   rarity,
        address creator,
        bool    isAnimated,
        string  calldata metadataURI   // ipfs://Qm... — permanent, immutable
    ) external payable nonReentrant whenNotPaused onlyRole(MINTER_ROLE) {
        _validateMint(to, pieceType, rarity, metadataURI);
        require(totalMinted < MAX_GENESIS_SUPPLY, "Genesis supply exhausted");

        // Season cap enforcement
        if (currentSeasonId > 0) {
            require(
                seasonMintCount[currentSeasonId] < seasonCap[currentSeasonId],
                "Season cap reached"
            );
            seasonMintCount[currentSeasonId]++;
        }

        // Payment check for paid rarities
        uint256 price = mintPriceByRarity[rarity];
        require(msg.value == price, "Incorrect payment");
        if (price > 0) accumulatedFees += price;

        uint256 tokenId = ++totalMinted;

        tokenData[tokenId] = TokenData({
            pieceType:  pieceType,
            rarity:     rarity,
            seasonId:   uint16(currentSeasonId),
            creator:    creator != address(0) ? creator : msg.sender,
            isAnimated: isAnimated,
            mintedAt:   block.timestamp
        });

        lastTransferAt[tokenId] = block.timestamp;

        _safeMint(to, tokenId);
        _setTokenURI(tokenId, metadataURI);

        // Set per-token royalty to creator if specified
        if (creator != address(0) && creator != treasury) {
            _setTokenRoyalty(tokenId, creator, 300); // 3% to creator
        }

        emit TokenMinted(tokenId, to, pieceType, rarity, uint16(currentSeasonId), tokenData[tokenId].creator);
    }

    // ─── Batch mint (tournament rewards / airdrops) ───────────────────────────
    function batchMint(
        address[]  calldata recipients,
        uint8[]    calldata pieceTypes,
        uint8[]    calldata rarities,
        string[]   calldata uris
    ) external nonReentrant onlyRole(MINTER_ROLE) whenNotPaused {
        uint256 len = recipients.length;
        require(len > 0, "Empty batch");
        require(len == pieceTypes.length && len == rarities.length && len == uris.length, "Length mismatch");
        require(totalMinted + len <= MAX_GENESIS_SUPPLY, "Would exceed max supply");

        for (uint256 i = 0; i < len; i++) {
            _validateMint(recipients[i], pieceTypes[i], rarities[i], uris[i]);
            if (currentSeasonId > 0) seasonMintCount[currentSeasonId]++;
            uint256 tokenId = ++totalMinted;
            tokenData[tokenId] = TokenData({
                pieceType:  pieceTypes[i],
                rarity:     rarities[i],
                seasonId:   uint16(currentSeasonId),
                creator:    msg.sender,
                isAnimated: false,
                mintedAt:   block.timestamp
            });
            lastTransferAt[tokenId] = block.timestamp;
            _safeMint(recipients[i], tokenId);
            _setTokenURI(tokenId, uris[i]);
            emit TokenMinted(tokenId, recipients[i], pieceTypes[i], rarities[i], uint16(currentSeasonId), msg.sender);
        }
    }

    // ─── Anti-wash-trading transfer override ──────────────────────────────────
    function _update(
        address to,
        uint256 tokenId,
        address auth
    ) internal override(ERC721) returns (address) {
        address from = _ownerOf(tokenId);

        // Enforce transfer cooldown (skip for mints: from == address(0))
        if (from != address(0) && to != address(0)) {
            _requireNotPaused();
            require(
                block.timestamp >= lastTransferAt[tokenId] + TRANSFER_COOLDOWN,
                unicode"Transfer cooldown active — wait 24h after last transfer"
            );
            lastTransferAt[tokenId] = block.timestamp;
        }

        return super._update(to, tokenId, auth);
    }

    // ─── Treasury withdrawal ──────────────────────────────────────────────────
    function withdrawFees() external onlyRole(TREASURY_ROLE) nonReentrant {
        uint256 amount = accumulatedFees;
        require(amount > 0, "Nothing to withdraw");
        accumulatedFees = 0;
        (bool ok,) = treasury.call{value: amount}("");
        require(ok, "Transfer failed");
        emit TreasuryWithdrawn(treasury, amount);
    }

    // ─── Update royalty ───────────────────────────────────────────────────────
    function setDefaultRoyalty(
        address receiver,
        uint96 feeBps
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(feeBps <= 1000, "Royalty cannot exceed 10%");
        _setDefaultRoyalty(receiver, feeBps);
        emit RoyaltyUpdated(receiver, feeBps);
    }

    // ─── Pause / unpause ──────────────────────────────────────────────────────
    function pause()   external onlyRole(PAUSER_ROLE) { _pause(); }
    function unpause() external onlyRole(PAUSER_ROLE) { _unpause(); }

    // ─── View helpers ─────────────────────────────────────────────────────────
    function getTokenData(uint256 tokenId) external view returns (TokenData memory) {
        require(_ownerOf(tokenId) != address(0), "Token does not exist");
        return tokenData[tokenId];
    }

    function remainingSupply() external view returns (uint256) {
        return MAX_GENESIS_SUPPLY - totalMinted;
    }

    function canTransfer(uint256 tokenId) external view returns (bool, uint256 unlocksAt) {
        uint256 unlocks = lastTransferAt[tokenId] + TRANSFER_COOLDOWN;
        return (block.timestamp >= unlocks, unlocks);
    }

    // ─── Required overrides ───────────────────────────────────────────────────
    function tokenURI(uint256 tokenId)
        public view override(ERC721, ERC721URIStorage) returns (string memory)
    {
        return super.tokenURI(tokenId);
    }

    function supportsInterface(bytes4 interfaceId)
        public view override(ERC721, ERC721URIStorage, ERC2981, AccessControl)
        returns (bool)
    {
        return super.supportsInterface(interfaceId);
    }

    // ─── Internal helpers ─────────────────────────────────────────────────────
    function _validateMint(address to, uint8 pieceType, uint8 rarity, string calldata metadataURI)
        internal view
    {
        require(currentSeasonId > 0 && !seasonClosed[currentSeasonId], "No active season");
        require(to != address(0), "Invalid recipient");
        require(pieceType <= 6, "Invalid piece type");
        require(rarity <= 4, "Invalid rarity");
        require(bytes(metadataURI).length > 0 && _startsWith(metadataURI, "ipfs://"), "Metadata must be IPFS URI");
        if (currentSeasonId > 0) {
            require(seasonMintCount[currentSeasonId] < seasonCap[currentSeasonId], "Season cap reached");
        }
    }

    function _startsWith(string memory str, string memory prefix)
        internal pure returns (bool)
    {
        bytes memory strBytes    = bytes(str);
        bytes memory prefixBytes = bytes(prefix);
        if (strBytes.length < prefixBytes.length) return false;
        for (uint i = 0; i < prefixBytes.length; i++) {
            if (strBytes[i] != prefixBytes[i]) return false;
        }
        return true;
    }

    receive() external payable { accumulatedFees += msg.value; }
}
