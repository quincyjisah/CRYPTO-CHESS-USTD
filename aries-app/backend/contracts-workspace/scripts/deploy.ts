/**
 * scripts/deploy.ts — Aries Protocol Contract Deployment
 *
 * Usage:
 *   Sepolia:  npx hardhat run scripts/deploy.ts --network sepolia
 *   Mainnet:  npx hardhat run scripts/deploy.ts --network mainnet
 *   Local:    npx hardhat run scripts/deploy.ts --network hardhat
 *
 * Always deploy to Sepolia and run full test suite before Mainnet.
 *
 * After deployment:
 *   1. Copy contract addresses to .env.local in the frontend
 *   2. Run: npx hardhat verify --network mainnet <NFT_ADDRESS> ...
 *   3. Open auction for each NFT token via openSeason()
 *   4. Update VITE_NFT_CONTRACT_ADDRESS and VITE_VAULT_CONTRACT_ADDRESS
 */

import { ethers, run, network } from 'hardhat';
import * as fs from 'fs';
import * as path from 'path';
import { assertDeploymentRoleState, assertDistinctNonZeroDeploymentRoles } from './deployment-policy';

// Sepolia testnet token addresses must be explicitly configured and code-checked.
// Sepolia testnet mock addresses (deploy mock ERC-20s first)
const SEPOLIA_TOKENS = {
  USDT: process.env.SEPOLIA_USDT || '',
  USDC: process.env.SEPOLIA_USDC || '',
  DAI:  process.env.SEPOLIA_DAI  || '',
};

async function main() {
  const networkName = network.name;
  const isLocal = networkName === 'hardhat' || networkName === 'localhost';
  if (networkName === 'mainnet') {
    throw new Error('Mainnet deployment is disabled until role separation, escrow recovery review, and independent audit are complete.');
  }
  if (!isLocal && networkName !== 'sepolia') {
    throw new Error('Remote deployment is restricted to Sepolia only.');
  }
  if (!isLocal && process.env.ALLOW_SEPOLIA_DEPLOYMENT !== 'true') {
    throw new Error('Set ALLOW_SEPOLIA_DEPLOYMENT=true to explicitly opt in to Sepolia deployment.');
  }
  const expectedChainIds: Record<string, bigint> = {
    hardhat: 31337n,
    localhost: 31337n,
    sepolia: 11155111n,
  };
  const actualNetwork = await ethers.provider.getNetwork();
  const expectedChainId = expectedChainIds[networkName];
  if (expectedChainId !== undefined && actualNetwork.chainId !== expectedChainId) {
    throw new Error(`Wrong chain ID for ${networkName}: expected ${expectedChainId}, got ${actualNetwork.chainId}`);
  }
  if (!isLocal) {
    if (!process.env.DEPLOYER_PRIVATE_KEY || !process.env.ALCHEMY_API_KEY) {
      throw new Error('Set DEPLOYER_PRIVATE_KEY and ALCHEMY_API_KEY for Sepolia deployment.');
    }
    for (const key of ['TREASURY_ADDRESS', 'ADMIN_ADDRESS', 'SETTLER_ADDRESS', 'PAUSER_ADDRESS', 'MINTER_ADDRESS']) {
      if (!process.env[key]) throw new Error(`Set ${key} before deploying to Sepolia.`);
    }
  }

  const [deployer] = await ethers.getSigners();
  if (!deployer) throw new Error('No deployer signer is configured for this network.');
  const treasuryAddress = isLocal ? deployer.address : ethers.getAddress(process.env.TREASURY_ADDRESS!);
  const adminAddress = isLocal ? deployer.address : ethers.getAddress(process.env.ADMIN_ADDRESS!);
  const settlerAddress = isLocal ? deployer.address : ethers.getAddress(process.env.SETTLER_ADDRESS!);
  const pauserAddress = isLocal ? deployer.address : ethers.getAddress(process.env.PAUSER_ADDRESS!);
  const minterAddress = isLocal ? deployer.address : ethers.getAddress(process.env.MINTER_ADDRESS!);
  if (!isLocal) {
    assertDistinctNonZeroDeploymentRoles({
      deployer: deployer.address,
      treasury: treasuryAddress,
      admin: adminAddress,
      settler: settlerAddress,
      pauser: pauserAddress,
      minter: minterAddress,
    });
  }

  console.log('\n═══════════════════════════════════════════');
  console.log(' Aries Protocol Contract Deployment');
  console.log('═══════════════════════════════════════════');
  console.log(`Network:   ${networkName}`);
  console.log(`Deployer:  ${deployer.address}`);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Balance:   ${ethers.formatEther(balance)} ETH`);
  console.log('═══════════════════════════════════════════\n');

  let tokens: Record<string, string>;
  if (isLocal) {
    console.log('Deploying a local-only mock ERC-20 for development.');
    const MockToken = await ethers.getContractFactory('MockERC20');
    const mockToken = await MockToken.deploy('Mock USD', 'mUSD', 6);
    await mockToken.waitForDeployment();
    tokens = { TEST_USD: await mockToken.getAddress() };
  } else {
    tokens = SEPOLIA_TOKENS;
  }

  const acceptedTokens = Object.values(tokens).filter(Boolean).map(address => ethers.getAddress(address));
  if (acceptedTokens.length === 0) {
    throw new Error('No token addresses configured. Set SEPOLIA_USDT/USDC/DAI for Sepolia.');
  }
  for (const token of acceptedTokens) {
    const code = await ethers.provider.getCode(token);
    if (code === '0x') throw new Error(`Configured token has no contract code: ${token}`);
  }

  // ─── 1. Deploy NFT contract ──────────────────────────────────────────────
  console.log('📦 Deploying AriesGenesisNFT...');
  const NFTFactory = await ethers.getContractFactory('AriesGenesisNFT');
  const nft = await NFTFactory.deploy(treasuryAddress);
  await nft.waitForDeployment();
  const nftAddress = await nft.getAddress();
  console.log(`✅ AriesGenesisNFT deployed: ${nftAddress}`);

  // ─── 2. Deploy Escrow contract ───────────────────────────────────────────
  console.log('\n📦 Deploying AriesEscrow...');
  const EscrowFactory = await ethers.getContractFactory('AriesEscrow');
  const escrow = await EscrowFactory.deploy(treasuryAddress, acceptedTokens);
  await escrow.waitForDeployment();
  const escrowAddress = await escrow.getAddress();
  console.log(`✅ AriesEscrow deployed: ${escrowAddress}`);

  // ─── 3. Open first season (Genesis drop) ─────────────────────────────────
  console.log('\n🎨 Opening Genesis season (cap: 64 tokens)...');
  const openSeasonTx = await nft.openSeason(64);
  await openSeasonTx.wait();
  console.log('✅ Genesis season opened');

  if (!isLocal) {
    const adminRole = await nft.DEFAULT_ADMIN_ROLE();
    const minterRole = await nft.MINTER_ROLE();
    const pauserRole = await nft.PAUSER_ROLE();
    await (await nft.grantRole(adminRole, adminAddress)).wait();
    await (await nft.grantRole(minterRole, minterAddress)).wait();
    await (await nft.grantRole(pauserRole, pauserAddress)).wait();
    await (await nft.renounceRole(minterRole, deployer.address)).wait();
    await (await nft.renounceRole(pauserRole, deployer.address)).wait();
    await (await nft.renounceRole(adminRole, deployer.address)).wait();
    console.log('✅ NFT admin, minter, and pauser roles separated from deployer');
  }


  if (!isLocal) {
    const adminRole = await escrow.DEFAULT_ADMIN_ROLE();
    const settlerRole = await escrow.SETTLER_ROLE();
    const pauserRole = await escrow.PAUSER_ROLE();
    await (await escrow.grantRole(adminRole, adminAddress)).wait();
    await (await escrow.grantRole(settlerRole, settlerAddress)).wait();
    await (await escrow.grantRole(pauserRole, pauserAddress)).wait();
    await (await escrow.renounceRole(settlerRole, deployer.address)).wait();
    await (await escrow.renounceRole(pauserRole, deployer.address)).wait();
    await (await escrow.renounceRole(adminRole, deployer.address)).wait();
    console.log('✅ Escrow admin, settler, and pauser roles separated from deployer');
  }


  if (!isLocal) {
    const nftAdminRole = await nft.DEFAULT_ADMIN_ROLE();
    const nftMinterRole = await nft.MINTER_ROLE();
    const nftPauserRole = await nft.PAUSER_ROLE();
    const nftTreasuryRole = await nft.TREASURY_ROLE();
    const escrowAdminRole = await escrow.DEFAULT_ADMIN_ROLE();
    const escrowSettlerRole = await escrow.SETTLER_ROLE();
    const escrowPauserRole = await escrow.PAUSER_ROLE();
    const escrowTreasuryRole = await escrow.TREASURY_ROLE();

    const roleState = [
      { contract: 'AriesGenesisNFT', role: 'DEFAULT_ADMIN_ROLE', account: 'admin', expected: true, actual: await nft.hasRole(nftAdminRole, adminAddress) },
      { contract: 'AriesGenesisNFT', role: 'MINTER_ROLE', account: 'minter', expected: true, actual: await nft.hasRole(nftMinterRole, minterAddress) },
      { contract: 'AriesGenesisNFT', role: 'PAUSER_ROLE', account: 'pauser', expected: true, actual: await nft.hasRole(nftPauserRole, pauserAddress) },
      { contract: 'AriesGenesisNFT', role: 'TREASURY_ROLE', account: 'treasury', expected: true, actual: await nft.hasRole(nftTreasuryRole, treasuryAddress) },
      { contract: 'AriesGenesisNFT', role: 'DEFAULT_ADMIN_ROLE', account: 'deployer', expected: false, actual: await nft.hasRole(nftAdminRole, deployer.address) },
      { contract: 'AriesGenesisNFT', role: 'MINTER_ROLE', account: 'deployer', expected: false, actual: await nft.hasRole(nftMinterRole, deployer.address) },
      { contract: 'AriesGenesisNFT', role: 'PAUSER_ROLE', account: 'deployer', expected: false, actual: await nft.hasRole(nftPauserRole, deployer.address) },
      { contract: 'AriesEscrow', role: 'DEFAULT_ADMIN_ROLE', account: 'admin', expected: true, actual: await escrow.hasRole(escrowAdminRole, adminAddress) },
      { contract: 'AriesEscrow', role: 'SETTLER_ROLE', account: 'settler', expected: true, actual: await escrow.hasRole(escrowSettlerRole, settlerAddress) },
      { contract: 'AriesEscrow', role: 'PAUSER_ROLE', account: 'pauser', expected: true, actual: await escrow.hasRole(escrowPauserRole, pauserAddress) },
      { contract: 'AriesEscrow', role: 'TREASURY_ROLE', account: 'treasury', expected: true, actual: await escrow.hasRole(escrowTreasuryRole, treasuryAddress) },
      { contract: 'AriesEscrow', role: 'DEFAULT_ADMIN_ROLE', account: 'deployer', expected: false, actual: await escrow.hasRole(escrowAdminRole, deployer.address) },
      { contract: 'AriesEscrow', role: 'SETTLER_ROLE', account: 'deployer', expected: false, actual: await escrow.hasRole(escrowSettlerRole, deployer.address) },
      { contract: 'AriesEscrow', role: 'PAUSER_ROLE', account: 'deployer', expected: false, actual: await escrow.hasRole(escrowPauserRole, deployer.address) },
    ];
    assertDeploymentRoleState(roleState);
    console.log('✅ On-chain role assignments verified; deployer has no retained privileged roles');
  }

  // ─── 4. Write deployment record ──────────────────────────────────────────
  const deploymentRecord = {
    network:       networkName,
    chainId:       (await ethers.provider.getNetwork()).chainId.toString(),
    deployedAt:    new Date().toISOString(),
    deployer:      deployer.address,
    roles: {
      admin: adminAddress,
      settler: settlerAddress,
      pauser: pauserAddress,
      minter: minterAddress,
      treasury: treasuryAddress,
    },
    contracts: {
      AriesGenesisNFT: {
        address:   nftAddress,
        args:      [treasuryAddress],
      },
      AriesEscrow: {
        address:   escrowAddress,
        args:      [treasuryAddress, acceptedTokens],
      },
    },
    tokens:        tokens,
  };

  const recordPath = path.join(__dirname, `../deployments/${networkName}.json`);
  fs.mkdirSync(path.dirname(recordPath), { recursive: true });
  fs.writeFileSync(recordPath, JSON.stringify(deploymentRecord, null, 2));
  console.log(`\n📄 Deployment record saved: ${recordPath}`);

  // ─── 5. Etherscan verification (skip on local) ────────────────────────────
  if (networkName !== 'hardhat' && networkName !== 'localhost') {
    console.log('\n🔍 Waiting 30 seconds for Etherscan to index blocks...');
    await new Promise(r => setTimeout(r, 30_000));

    console.log('🔍 Verifying AriesGenesisNFT on Etherscan...');
    try {
      await run('verify:verify', {
        address:              nftAddress,
        constructorArguments: [treasuryAddress],
      });
      console.log('✅ AriesGenesisNFT verified');
    } catch (e: any) {
      if (e.message.includes('Already Verified')) {
        console.log('ℹ️  AriesGenesisNFT already verified');
      } else {
        console.warn('⚠️  NFT verification failed:', e.message);
      }
    }

    console.log('\n🔍 Verifying AriesEscrow on Etherscan...');
    try {
      await run('verify:verify', {
        address:              escrowAddress,
        constructorArguments: [treasuryAddress, acceptedTokens],
      });
      console.log('✅ AriesEscrow verified');
    } catch (e: any) {
      if (e.message.includes('Already Verified')) {
        console.log('ℹ️  AriesEscrow already verified');
      } else {
        console.warn('⚠️  Escrow verification failed:', e.message);
      }
    }
  }

  // ─── 6. Final summary ─────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════════');
  console.log(' DEPLOYMENT COMPLETE');
  console.log('═══════════════════════════════════════════');
  console.log(`NFT Contract:    ${nftAddress}`);
  console.log(`Escrow Contract: ${escrowAddress}`);
  console.log('\n📋 Add these to your .env.local:');
  console.log(`VITE_NFT_CONTRACT_ADDRESS=${nftAddress}`);
  console.log(`VITE_VAULT_CONTRACT_ADDRESS=${escrowAddress}`);

  if (networkName === 'sepolia') {
    console.log(`\n🔗 View on Sepolia Etherscan:`);
    console.log(`   NFT:    https://sepolia.etherscan.io/address/${nftAddress}`);
    console.log(`   Escrow: https://sepolia.etherscan.io/address/${escrowAddress}`);
  }
  console.log('═══════════════════════════════════════════\n');
}

main().catch((err) => {
  console.error('Deployment failed:', err);
  process.exit(1);
});
