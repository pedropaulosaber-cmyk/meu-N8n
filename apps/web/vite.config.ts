import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    // Encaminha as chamadas para a API em dev, assim o painel usa caminhos
    // relativos e o mesmo código funciona em produção atrás do Caddy.
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
      '/hooks': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
});
