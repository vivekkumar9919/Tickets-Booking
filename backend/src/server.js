import 'dotenv/config';
import { createApp } from './app.js';
import dbPool from './infrastructure/database/DatabasePool.js';
import { runMigrations } from './infrastructure/database/migrate.js';
import holdSweeper from './services/HoldSweeper.js';
import logger from './infrastructure/logger/Logger.js';

const PORT = parseInt(process.env.PORT || '3000', 10);

async function startServer() {
  try {
    logger.info('Initializing database pool and applying pending migrations...');
    await runMigrations();

    const app = createApp();
    const server = app.listen(PORT, '0.0.0.0', () => {
      logger.info('Seat Reservation Service started successfully', {
        port: PORT,
        environment: process.env.NODE_ENV || 'production',
      });
      // Start periodic background hold reclamation worker
      holdSweeper.start();
    });

    const handleShutdown = async (signal) => {
      logger.info(`Received ${signal}. Shutting down gracefully...`);
      holdSweeper.stop();
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
    };

    process.on('SIGTERM', () => handleShutdown('SIGTERM'));
    process.on('SIGINT', () => handleShutdown('SIGINT'));

    return server;
  } catch (err) {
    logger.error('Failed to start application server', { error: err.message, stack: err.stack });
    process.exit(1);
  }
}

startServer();
