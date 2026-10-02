import dbPool from './DatabasePool.js';
import logger from '../logger/Logger.js';
import config from '../config.js';

/**
 * Design Pattern: Unit of Work & Transaction Manager
 * Manages atomic transaction boundaries, lock timeouts, and client release.
 */
export class UnitOfWork {
  constructor(pool = dbPool) {
    this.pool = pool;
    this.client = null;
    this.inTransaction = false;
  }

  async begin(lockTimeoutMs = config.database.lockTimeoutMs) {
    if (this.inTransaction) {
      throw new Error('Transaction is already active in this UnitOfWork');
    }
    this.client = await this.pool.getClient();
    await this.client.query('BEGIN');
    // Set lock timeout to avoid blocking threads on deadlocks or high contention
    await this.client.query(`SET LOCAL lock_timeout = '${lockTimeoutMs}ms'`);
    this.inTransaction = true;
  }

  getClient() {
    if (!this.client) {
      throw new Error('UnitOfWork has not acquired a database client');
    }
    return this.client;
  }

  async query(text, params) {
    return await this.getClient().query(text, params);
  }

  async commit() {
    if (!this.inTransaction) return;
    try {
      await this.client.query('COMMIT');
    } finally {
      this.inTransaction = false;
      this.release();
    }
  }

  async rollback() {
    if (!this.inTransaction) return;
    try {
      await this.client.query('ROLLBACK');
    } catch (err) {
      logger.error('Error during transaction rollback', { error: err.message });
    } finally {
      this.inTransaction = false;
      this.release();
    }
  }

  release() {
    if (this.client) {
      this.client.release();
      this.client = null;
      this.inTransaction = false;
    }
  }

  /**
   * Helper to execute a callback within an isolated managed transaction.
   */
  async execute(callback) {
    await this.begin();
    try {
      const result = await callback(this);
      await this.commit();
      return result;
    } catch (error) {
      await this.rollback();
      throw error;
    }
  }
}

export default UnitOfWork;
