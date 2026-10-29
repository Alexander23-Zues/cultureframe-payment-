import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
export default defineConfig({ plugins: [react(), tailwindcss()], server: { port: Number(process.env.VITE_PORT || 5175), strictPort: true, proxy: { '/api': `http://127.0.0.1:${process.env.VITE_API_PORT || process.env.PORT || 4000}` } }, build: { rollupOptions: { output: { manualChunks: { charts: ['recharts'], motion: ['framer-motion'], react: ['react', 'react-dom/client', 'react-router-dom'] } } } } });
