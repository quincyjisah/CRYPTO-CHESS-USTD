import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");
const appReadme = read("../../README.md");
const gameRules = read("../../GAME_RULES.md");
const nftRules = read("../../NFT_RULES.md");
const deployment = read("../../DEPLOYMENT.md");
const mainnetGates = read("../../MAINNET_CHECKLIST.md");
const escrow = read("../../backend/contracts/AriesEscrow.sol");
const nft = read("../../backend/contracts/AriesGenesisNFT.sol");
const contractsReadme = read("../../backend/contracts-workspace/README.md");

describe("Aries product documentation integrity", () => {
  it("labels the current app as a prototype without live deposits or payouts", () => {
    expect(appReadme).toMatch(/Development prototype/i);
    expect(appReadme).toMatch(/deposits, withdrawals, payouts and on-chain wagering are disabled/i);
    expect(appReadme).toMatch(/drafts, not effective customer terms/i);
  });

  it("keeps wager fee and draw/refund language aligned with the escrow source", () => {
    expect(escrow).toMatch(/PLATFORM_FEE_BPS\s*=\s*200/);
    expect(gameRules).toMatch(/DRAFT — NOT EFFECTIVE/);
    expect(gameRules).toMatch(/2% from the combined pot/);
    expect(gameRules).toMatch(/returns each wager in full and charges no fee/);
    expect(gameRules).not.toMatch(/2\.5%/);
  });

  it("keeps NFT supply and royalty terms aligned with the contract constants", () => {
    expect(nft).toMatch(/MAX_GENESIS_SUPPLY\s*=\s*10_000/);
    expect(nft).toMatch(/MAX_SEASONAL_CAP\s*=\s*1_000/);
    expect(nft).toMatch(/_setDefaultRoyalty\(_treasury,\s*500\)/);
    expect(nft).toMatch(/_setTokenRoyalty\(tokenId,\s*creator,\s*300\)/);
    expect(nftRules).toMatch(/DRAFT — NOT EFFECTIVE/);
    expect(nftRules).toMatch(/10,000/);
    expect(nftRules).toMatch(/1,000/);
    expect(nftRules).toMatch(/5% ERC-2981/);
    expect(nftRules).toMatch(/3% creator royalty/);
    expect(nftRules).not.toMatch(/64-token|64 tokens|collection of 64/i);
  });

  it("marks mainnet deployment blocked and prohibits release commands from the checklist", () => {
    expect(deployment).toMatch(/release status: BLOCKED/i);
    expect(mainnetGates).toMatch(/STATUS: BLOCKED/i);
    expect(mainnetGates).toMatch(/Do not run `deploy:sepolia`, `deploy:mainnet`/);
  });

  it("documents the actual Hardhat workspace and source-level contract values", () => {
    expect(contractsReadme).toMatch(/Hardhat compile\/test environment/);
    expect(contractsReadme).toMatch(/200 basis points \(2%\)/);
    expect(contractsReadme).toMatch(/10,000/);
    expect(contractsReadme).toMatch(/1,000/);
    expect(contractsReadme).toMatch(/Local development and testing only/);
  });
});
