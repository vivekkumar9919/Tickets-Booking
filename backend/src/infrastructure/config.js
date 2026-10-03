import dotenv from 'dotenv';

dotenv.config();

/**
 * Centralized, immutable application configuration.
 */
export const config = Object.freeze({
  env: process.env.NODE_ENV || 'development',
  port: parseInt(process.env.PORT || '3000', 10),
  
  database: Object.freeze({
    url: process.env.DATABASE_URL || 'postgres://postgres:postgrespassword@localhost:5432/ticket_booking',
    poolMin: parseInt(process.env.DB_POOL_MIN || '5', 10),
    poolMax: parseInt(process.env.DB_POOL_MAX || '30', 10),
    idleTimeoutMs: parseInt(process.env.DB_IDLE_TIMEOUT_MS || '30000', 10),
    connectionTimeoutMs: parseInt(process.env.DB_CONNECTION_TIMEOUT_MS || '10000', 10),
    lockTimeoutMs: parseInt(process.env.DB_LOCK_TIMEOUT_MS || '2000', 10),
  }),

  booking: Object.freeze({
    defaultPerUserLimit: parseInt(process.env.DEFAULT_PER_USER_LIMIT || '4', 10),
    holdDurationSeconds: parseInt(process.env.HOLD_DURATION_SECONDS || '600', 10), // 10 minutes
  }),

  auth: Object.freeze({
    jwtSecret: process.env.JWT_SECRET || 'super-secret-paytm-key-change-in-production',
    adminToken: process.env.ADMIN_TOKEN || 'admin-secret-token-paytm',
  }),

  logging: Object.freeze({
    level: process.env.LOG_LEVEL || 'info',
  }),
});

export default config;
