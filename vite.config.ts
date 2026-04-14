import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = String(env.VITE_BROKER_PROXY_TARGET ?? '').trim() || 'http://localhost:8787';

  return {
    server: {
      proxy: {
        '/api/stt/auth': {
          target,
          changeOrigin: true,
        },
      },
    },
  };
});
