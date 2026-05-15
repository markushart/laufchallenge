const { defineConfig } = require('vite');
const react = require('@vitejs/plugin-react');
const path = require('path');

module.exports = defineConfig({
  root: path.join(__dirname, 'app'),
  plugins: [react()],
  build: {
    outDir: path.join(__dirname, 'public'),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: path.join(__dirname, 'app', 'index.html'),
        admin: path.join(__dirname, 'app', 'admin.html'),
        login: path.join(__dirname, 'app', 'login.html'),
      },
    },
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3000',
    },
  },
});
