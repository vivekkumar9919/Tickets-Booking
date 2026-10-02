import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import dbPool from './DatabasePool.js';
import logger from '../logger/Logger.js';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export async function runMigrations() {
  const migrationsDir = path.resolve(__dirname, '../../../migrations');
  logger.info('Starting database migrations', { directory: migrationsDir });

  const client = await dbPool.getClient();
  try {
    const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

    await client.query('BEGIN');
    for (const file of files) {
      const filePath = path.join(migrationsDir, file);
      logger.info(`Applying migration: ${file}`);
      const sql = fs.readFileSync(filePath, 'utf8');
      await client.query(sql);
      logger.info(`Migration applied successfully: ${file}`);
    }
    await client.query('COMMIT');
    logger.info('All migrations completed successfully');
  } catch (error) {
    await client.query('ROLLBACK');
    logger.error('Failed to apply database migrations', { error: error.message, stack: error.stack });
    throw error;
  } finally {
    client.release();
  }
}

// Allow direct execution: node src/infrastructure/database/migrate.js
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runMigrations()
    .then(() => {
      logger.info('Migration script finished');
      process.exit(0);
    })
    .catch((err) => {
      logger.error('Migration script failed', { error: err.message });
      process.exit(1);
    });
}
