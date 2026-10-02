import dbPool from '../infrastructure/database/DatabasePool.js';
import { IdempotencyRecord, IdempotencyStatus } from '../domain/IdempotencyRecord.js';
import logger from '../infrastructure/logger/Logger.js';

export class IdempotencyRepository {
  constructor(pool = dbPool) {
    this.pool = pool;
  }

  async findForUpdate(key, client) {
    if (!client) {
      throw new Error('IdempotencyRepository.findForUpdate requires a transactional client');
    }

    const query = `
      SELECT idempotency_key, show_id, user_id, request_hash, status, response_status, response_body, created_at, updated_at
      FROM idempotency_records
      WHERE idempotency_key = $1
      FOR UPDATE;
    `;

    try {
      const res = await client.query(query, [key]);
      if (res.rows.length === 0) return null;
      return this._mapRowToRecord(res.rows[0]);
    } catch (err) {
      logger.error('IdempotencyRepository.findForUpdate failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  async insert(record, client) {
    if (!client) {
      throw new Error('IdempotencyRepository.insert requires a transactional client');
    }

    const query = `
      INSERT INTO idempotency_records (idempotency_key, show_id, user_id, request_hash, status)
      VALUES ($1, $2, $3, $4, $5)
      RETURNING idempotency_key, show_id, user_id, request_hash, status, created_at, updated_at;
    `;

    const params = [
      record.idempotencyKey,
      record.showId,
      record.userId,
      record.requestHash,
      record.status || IdempotencyStatus.IN_PROGRESS,
    ];

    try {
      const res = await client.query(query, params);
      return this._mapRowToRecord(res.rows[0]);
    } catch (err) {
      logger.error('IdempotencyRepository.insert failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  async markCompleted(key, responseStatus, responseBody, client) {
    if (!client) {
      throw new Error('IdempotencyRepository.markCompleted requires a transactional client');
    }

    const query = `
      UPDATE idempotency_records
      SET status = 'COMPLETED', response_status = $1, response_body = $2, updated_at = NOW()
      WHERE idempotency_key = $3
      RETURNING idempotency_key, show_id, user_id, request_hash, status, response_status, response_body;
    `;

    try {
      const res = await client.query(query, [responseStatus, JSON.stringify(responseBody), key]);
      if (res.rows.length === 0) return null;
      return this._mapRowToRecord(res.rows[0]);
    } catch (err) {
      logger.error('IdempotencyRepository.markCompleted failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  _mapRowToRecord(row) {
    return new IdempotencyRecord({
      idempotencyKey: row.idempotency_key,
      showId: row.show_id,
      userId: row.user_id,
      requestHash: row.request_hash,
      status: row.status,
      responseStatus: row.response_status,
      responseBody: row.response_body,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

export const idempotencyRepository = new IdempotencyRepository();
export default idempotencyRepository;
