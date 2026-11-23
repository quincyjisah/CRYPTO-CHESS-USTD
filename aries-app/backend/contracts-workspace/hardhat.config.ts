import { HardhatUserConfig } from 'hardhat/config';
import '@nomicfoundation/hardhat-toolbox';
import '@nomicfoundation/hardhat-verify';
import 'hardhat-contract-sizer';
import 'dotenv/config';
import path from 'node:path';

const PRIVATE_KEY    = process.env.DEPLOYER_PRIVATE_KEY;
const ALCHEMY_KEY    = process.env.ALCHEMY_API_KEY || '';
const ETHERSCAN_KEY  = process.env.ETHERSCAN_API_KEY || '';
const POLYGONSCAN_KEY = process.env.POLYGONSCAN_API_KEY || '';

const config: HardhatUserConfig = {
  typechain: { outDir: './contracts-workspace/typechain-types' },
  solidity: {
    version: '0.8.26',
    settings: {
      optimizer: {
        enabled: true,
        runs:    200,     // Optimise for many calls (transfers, bids)
      },
      viaIR: true,        // Better gas optimisation via intermediate representation
      evmVersion: 'cancun',
    },
  },

  networks: {
    // ── Local development ─────────────────────────────────────────────────────
    hardhat: {
      chainId: 31337,
      forking: {
        // Fork Mainnet locally for realistic testing with real USDT
        url:     `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
        enabled: process.env.FORK_MAINNET === 'true',
      },
    },

    // ── Sepolia testnet (deploy here first — ALWAYS) ──────────────────────────
    sepolia: {
      url:      `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId:  11155111,
      gasPrice: 'auto',
    },

    // ── Ethereum Mainnet ──────────────────────────────────────────────────────
    mainnet: {
      url:      `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId:  1,
      gasPrice: 'auto',
      // Timeout longer for Mainnet — gas estimation can be slow
      timeout:  300_000,
    },

    // ── Polygon (for micro-wagers < $20) ──────────────────────────────────────
    polygon: {
      url:      `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
      chainId:  137,
      gasPrice: 'auto',
    },
  },

  etherscan: {
    apiKey: {
      mainnet:         ETHERSCAN_KEY,
      sepolia:         ETHERSCAN_KEY,
      polygon:         POLYGONSCAN_KEY,
      polygonMumbai:   POLYGONSCAN_KEY,
    },
  },

  gasReporter: {
    enabled:     process.env.REPORT_GAS === 'true',
    currency:    'USD',
    coinmarketcap: process.env.CMC_API_KEY || '',
    token:       'ETH',
  },

  paths: {
    root:      path.resolve(__dirname, '..'),
    sources:   './contracts',
    tests:     './contracts-workspace/test',
    artifacts: './contracts-workspace/artifacts',
    cache:     './contracts-workspace/cache',
  },
};

export default config;
