import { defineConfig } from 'vite';

// vite.config.js
export default defineConfig({
    build: {
        rollupOptions: {
            input: {
                main: 'index.html',
                about: 'about.html'
            }
        }
    },
    base: '/solar-system-sim/'  // For GitHub Pages deployment
});