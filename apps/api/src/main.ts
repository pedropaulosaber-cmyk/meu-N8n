import { loadEnv } from './env.js';
import { buildServer } from './server.js';

async function main(): Promise<void> {
  const env = loadEnv();
  const { app, close } = await buildServer({ env });

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info({ signal }, 'encerrando...');
    await close();
    process.exit(0);
  };
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  await app.listen({ port: env.API_PORT, host: '0.0.0.0' });
  app.log.info(`API ouvindo em ${env.PUBLIC_API_URL}`);
}

main().catch((err: unknown) => {
  console.error('Falha ao subir a API:', err);
  process.exit(1);
});
