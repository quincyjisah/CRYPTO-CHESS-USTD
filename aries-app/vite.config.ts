import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, '.', '');

  return {
    plugins: [react(), tailwindcss()],

    define: {
      'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY),
    },

    resolve: {
      alias: { '@': path.resolve(__dirname, '.') },
    },

    // ─── Build optimisation for 1M-user scale ──────────────────────────────
    build: {
      target: 'es2020',
      minify: 'terser',
      sourcemap: false,          // never ship sourcemaps to production
      chunkSizeWarningLimit: 600,

      rollupOptions: {
        output: {
          // Split heavy libraries into separate cached chunks.
          // Browser only re-downloads what changed on deploy.
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return;

            // Keep the optional WalletConnect/Reown QR modal graph out of one
            // oversized shared chunk. These chunks are requested only when the
            // user opens the WalletConnect flow.
            if (id.includes('/node_modules/@reown/appkit-controllers/')) return 'vendor-reown-controllers';
            if (id.includes('/node_modules/@reown/appkit-ui/')) return 'vendor-reown-ui';
            if (id.includes('/node_modules/@reown/appkit-utils/')) return 'vendor-reown-utils';
            if (id.includes('/node_modules/@reown/appkit-common/')) return 'vendor-reown-common';
            if (id.includes('/node_modules/@walletconnect/')) return 'vendor-walletconnect';
            if (id.includes('/node_modules/viem/')) return 'vendor-viem';
            if (id.includes('/node_modules/ox/')) return 'vendor-ox';
            if (id.includes('/node_modules/@noble/')) return 'vendor-crypto-primitives';
            if (id.includes('/node_modules/@reown/')) return 'vendor-reown';

            if (id.includes('/node_modules/react/') || id.includes('/node_modules/react-dom/')) return 'vendor-react';
            if (id.includes('/node_modules/firebase/')) return 'vendor-firebase';
            if (id.includes('/node_modules/ethers/')) return 'vendor-ethers';
            if (id.includes('/node_modules/chess.js/') || id.includes('/node_modules/react-chessboard/')) return 'vendor-chess';
            if (id.includes('/node_modules/lucide-react/')) return 'vendor-icons';
          },
          // Deterministic asset file names with content hash for CDN cache busting
          assetFileNames:  'assets/[name]-[hash][extname]',
          chunkFileNames:  'assets/[name]-[hash].js',
          entryFileNames:  'assets/[name]-[hash].js',
        },
      },
    },

    // ─── Dev server ────────────────────────────────────────────────────────
    server: {
      hmr: process.env.DISABLE_HMR !== 'true',
      port: 3000,
      host: '0.0.0.0',
    },

    // ─── Optimise deps ─────────────────────────────────────────────────────
    optimizeDeps: {
      include: ['react', 'react-dom', 'chess.js', 'react-chessboard', 'ethers'],
      exclude: ['@walletconnect/ethereum-provider'],  // lazy-loaded only when needed
    },
  };
});
