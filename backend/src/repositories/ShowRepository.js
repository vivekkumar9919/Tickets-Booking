import dbPool from '../infrastructure/database/DatabasePool.js';
import { Show } from '../domain/Show.js';
import { Money } from '../domain/Money.js';
import logger from '../infrastructure/logger/Logger.js';

export class ShowRepository {
  constructor(pool = dbPool) {
    this.pool = pool;
  }

  async create(show, client = null) {
    const executor = client || this.pool;
    const query = `
      INSERT INTO shows (id, name, total_seats, price_paise, per_user_limit, status)
      VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6)
      RETURNING id, name, total_seats, price_paise, per_user_limit, status, created_at, updated_at;
    `;
    const params = [
      show.id || null,
      show.name,
      show.totalSeats,
      show.price.paise,
      show.perUserLimit,
      show.status || 'active',
    ];

    try {
      const res = await executor.query(query, params);
      const row = res.rows[0];
      return this._mapRowToShow(row);
    } catch (err) {
      logger.error('ShowRepository.create failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  async findById(id, client = null) {
    const executor = client || this.pool;
    const query = `
      SELECT id, name, total_seats, price_paise, per_user_limit, status, created_at, updated_at
      FROM shows
      WHERE id = $1;
    `;

    try {
      const res = await executor.query(query, [id]);
      if (res.rows.length === 0) return null;
      return this._mapRowToShow(res.rows[0]);
    } catch (err) {
      logger.error('ShowRepository.findById failed', { show_id: id, error: err.message, code: err.code });
      throw err;
    }
  }

  async findWithSeatCounts(id, client = null) {
    const executor = client || this.pool;
    const query = `
      SELECT 
        s.id, s.name, s.total_seats, s.price_paise, s.per_user_limit, s.status, s.created_at,
        COUNT(CASE WHEN st.status = 'available' THEN 1 END)::int AS available_count,
        COUNT(CASE WHEN st.status = 'held' AND (st.hold_expires_at IS NULL OR st.hold_expires_at > NOW()) THEN 1 END)::int AS held_count,
        COUNT(CASE WHEN st.status = 'confirmed' THEN 1 END)::int AS confirmed_count,
        COUNT(CASE WHEN st.status = 'held' AND st.hold_expires_at <= NOW() THEN 1 END)::int AS expired_held_count
      FROM shows s
      LEFT JOIN seats st ON st.show_id = s.id
      WHERE s.id = $1
      GROUP BY s.id;
    `;

    try {
      const res = await executor.query(query, [id]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];
      return {
        show: this._mapRowToShow(row),
        counts: {
          available: row.available_count + row.expired_held_count, // Expired holds count as available
          held: row.held_count,
          confirmed: row.confirmed_count,
          total: row.total_seats,
        },
      };
    } catch (err) {
      logger.error('ShowRepository.findWithSeatCounts failed', { show_id: id, error: err.message, code: err.code });
      throw err;
    }
  }

  _mapRowToShow(row) {
    return new Show({
      id: row.id,
      name: row.name,
      totalSeats: row.total_seats,
      pricePaise: Money.fromPaise(Number(row.price_paise)),
      perUserLimit: row.per_user_limit,
      status: row.status,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    });
  }
}

export const showRepository = new ShowRepository();
export default showRepository;
