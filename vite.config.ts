import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const target = String(env.VITE_BROKER_PROXY_TARGET ?? '').trim() || 'http://localhost:8787';
  const brokerUnavailableBody = JSON.stringify({
    ok: false,
    category: 'network_error',
    code: 'broker_unreachable',
    message: 'Unable to reach speech auth service.',
  });

  return {
    server: {
      proxy: {
        '/api/stt/auth': {
          target,
          changeOrigin: false,
          configure: (proxy) => {
            proxy.on('error', (_error, _req, res) => {
              if (!res.headersSent) {
                res.writeHead(502, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store',
                });
              }

              res.end(brokerUnavailableBody);
            });
          },
        },
        '/api/ai/respond': {
          target,
          changeOrigin: false,
          configure: (proxy) => {
            proxy.on('error', (_error, _req, res) => {
              if (!res.headersSent) {
                res.writeHead(502, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store',
                });
              }

              res.end(JSON.stringify({
                ok: false,
                category: 'network_error',
                code: 'gemini_broker_unreachable',
                message: 'Unable to reach Gemini broker service.',
              }));
            });
          },
        },
        '/api/ai/openai/respond': {
          target,
          changeOrigin: false,
          configure: (proxy) => {
            proxy.on('error', (_error, _req, res) => {
              if (!res.headersSent) {
                res.writeHead(502, {
                  'Content-Type': 'application/json; charset=utf-8',
                  'Cache-Control': 'no-store',
                });
              }

              res.end(JSON.stringify({
                ok: false,
                category: 'network_error',
                code: 'openai_broker_unreachable',
                message: 'Unable to reach OpenAI broker service.',
              }));
            });
          },
        },
      },
    },
  };
});
