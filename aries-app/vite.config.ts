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
      minify: 'esbuild', // faster, lower-memory production minification on constrained build hosts
      sourcemap: false,          // never ship sourcemaps to production
      chunkSizeWarningLimit: 600,

      rollupOptions: {
        output: {
          // Split heavy libraries into separate cached chunks.
          // Browser only re-downloads what changed on deploy.
          manualChunks(id) {
            if (!id.includes('/node_modules/')) return;

            // Let Rollup preserve the optional WalletConnect/Reown dynamic-import graph.
            // Splitting its cyclic packages manually produced circular chunk dependencies.

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
