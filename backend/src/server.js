import 'dotenv/config';
import { createApp } from './app.js';
import dbPool from './infrastructure/database/DatabasePool.js';
import logger from './infrastructure/logger/Logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);
const app = createApp();

const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info('Server started successfully', {
    port: PORT,
    environment: process.env.NODE_ENV || 'development',
  });
  dbPool.connect();
});

// Graceful Shutdown
async function handleShutdown(signal) {
  logger.info(`Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    logger.info('HTTP server closed');
    try {
      await dbPool.close();
      logger.info('Database pool closed');
      process.exit(0);
    } catch (err) {
      logger.error('Error during database pool teardown', { error: err.message });
      process.exit(1);
    }
  });

  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10000).unref();
}

process.on('SIGTERM', () => handleShutdown('SIGTERM'));
process.on('SIGINT', () => handleShutdown('SIGINT'));

export default server;
