import dbPool from '../infrastructure/database/DatabasePool.js';
import { Seat, SeatStatus } from '../domain/Seat.js';
import logger from '../infrastructure/logger/Logger.js';

export class SeatRepository {
  constructor(pool = dbPool) {
    this.pool = pool;
  }

  async createBatch(showId, seatNumbers, client = null) {
    const executor = client || this.pool;
    if (!seatNumbers || seatNumbers.length === 0) return [];

    const valueClauses = [];
    const params = [showId];

    seatNumbers.forEach((seatNum, idx) => {
      params.push(seatNum.trim().toUpperCase());
      valueClauses.push(`($1, $${params.length}, 'available')`);
    });

    const query = `
      INSERT INTO seats (show_id, seat_number, status)
      VALUES ${valueClauses.join(', ')}
      RETURNING id, show_id, seat_number, status, current_reservation_id, hold_expires_at;
    `;

    try {
      const res = await executor.query(query, params);
      return res.rows.map(r => this._mapRowToSeat(r));
    } catch (err) {
      logger.error('SeatRepository.createBatch failed', { show_id: showId, count: seatNumbers.length, error: err.message, code: err.code });
      throw err;
    }
  }

  async findSeatsForUpdate(showId, sortedSeatNumbers, client) {
    if (!client) {
      throw new Error('SeatRepository.findSeatsForUpdate requires a transactional client for row locking');
    }
    const query = `
      SELECT id, show_id, seat_number, status, current_reservation_id, held_by_user_id, hold_expires_at, version
      FROM seats
      WHERE show_id = $1 AND seat_number = ANY($2)
      ORDER BY seat_number ASC
      FOR UPDATE;
    `;

    try {
      const res = await client.query(query, [showId, sortedSeatNumbers]);
      return res.rows.map(r => this._mapRowToSeat(r));
    } catch (err) {
      logger.error('SeatRepository.findSeatsForUpdate failed', { show_id: showId, error: err.message, code: err.code });
      throw err;
    }
  }

  async updateSeatsStatus(showId, seatNumbers, status, reservationId = null, holdExpiresAt = null, heldByUserId = null, client = null) {
    const executor = client || this.pool;
    const query = `
      UPDATE seats
      SET 
        status = $1,
        current_reservation_id = $2,
        hold_expires_at = $3,
        held_by_user_id = $4,
        updated_at = NOW(),
        version = version + 1
      WHERE show_id = $5 AND seat_number = ANY($6)
      RETURNING id, show_id, seat_number, status, current_reservation_id, hold_expires_at;
    `;

    const params = [status, reservationId, holdExpiresAt, heldByUserId, showId, seatNumbers];

    try {
      const res = await executor.query(query, params);
      return res.rows.map(r => this._mapRowToSeat(r));
    } catch (err) {
      logger.error('SeatRepository.updateSeatsStatus failed', { show_id: showId, status, error: err.message, code: err.code });
      throw err;
    }
  }

  async findByShowId(showId, client = null) {
    const executor = client || this.pool;
    const query = `
      SELECT id, show_id, seat_number, status, current_reservation_id, hold_expires_at
      FROM seats
      WHERE show_id = $1
      ORDER BY seat_number ASC;
    `;

    try {
      const res = await executor.query(query, [showId]);
      return res.rows.map(r => this._mapRowToSeat(r));
    } catch (err) {
      logger.error('SeatRepository.findByShowId failed', { show_id: showId, error: err.message, code: err.code });
      throw err;
    }
  }

  async releaseExpiredHolds(client = null) {
    const executor = client || this.pool;
    const query = `
      UPDATE seats
      SET status = 'available', current_reservation_id = NULL, held_by_user_id = NULL, hold_expires_at = NULL, updated_at = NOW()
      WHERE status = 'held' AND hold_expires_at <= NOW()
      RETURNING id, show_id, seat_number;
    `;

    try {
      const res = await executor.query(query);
      return res.rows;
    } catch (err) {
      logger.error('SeatRepository.releaseExpiredHolds failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  _mapRowToSeat(row) {
    return new Seat({
      id: row.id,
      showId: row.show_id,
      seatNumber: row.seat_number,
      status: row.status,
      currentReservationId: row.current_reservation_id,
      lockedUntil: row.hold_expires_at,
    });
  }
}

export const seatRepository = new SeatRepository();
export default seatRepository;
