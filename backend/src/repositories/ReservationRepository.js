import dbPool from '../infrastructure/database/DatabasePool.js';
import { Reservation, ReservationStatus } from '../domain/Reservation.js';
import { Money } from '../domain/Money.js';
import logger from '../infrastructure/logger/Logger.js';

export class ReservationRepository {
  constructor(pool = dbPool) {
    this.pool = pool;
  }

  async create(reservation, seatRecords, client) {
    if (!client) {
      throw new Error('ReservationRepository.create requires a transactional client');
    }

    const insertReservationQuery = `
      INSERT INTO reservations (id, show_id, user_id, amount_paise, status, hold_expires_at)
      VALUES (COALESCE($1, gen_random_uuid()), $2, $3, $4, $5, $6)
      RETURNING id, show_id, user_id, amount_paise, status, hold_expires_at, created_at, updated_at;
    `;

    const resParams = [
      reservation.id || null,
      reservation.showId,
      reservation.userId,
      reservation.amount.paise,
      reservation.status,
      reservation.holdExpiresAt || null,
    ];

    try {
      const res = await client.query(insertReservationQuery, resParams);
      const row = res.rows[0];

      // Insert mappings into reservation_seats
      if (seatRecords && seatRecords.length > 0) {
        const valClauses = [];
        const mapParams = [row.id];

        seatRecords.forEach((seat) => {
          mapParams.push(seat.id, seat.seatNumber);
          valClauses.push(`($1, $${mapParams.length - 1}, $${mapParams.length})`);
        });

        await client.query(`
          INSERT INTO reservation_seats (reservation_id, seat_id, seat_number)
          VALUES ${valClauses.join(', ')}
        `, mapParams);
      }

      return new Reservation({
        id: row.id,
        showId: row.show_id,
        userId: row.user_id,
        amountPaise: Money.fromPaise(Number(row.amount_paise)),
        seats: seatRecords ? seatRecords.map(s => s.seatNumber) : reservation.seats,
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (err) {
      logger.error('ReservationRepository.create failed', { error: err.message, code: err.code });
      throw err;
    }
  }

  async findById(id, client = null) {
    const executor = client || this.pool;
    const query = `
      SELECT r.id, r.show_id, r.user_id, r.amount_paise, r.status, r.created_at, r.updated_at,
             ARRAY_AGG(rs.seat_number ORDER BY rs.seat_number ASC) AS seats
      FROM reservations r
      LEFT JOIN reservation_seats rs ON rs.reservation_id = r.id
      WHERE r.id = $1
      GROUP BY r.id;
    `;

    try {
      const res = await executor.query(query, [id]);
      if (res.rows.length === 0) return null;
      const row = res.rows[0];

      return new Reservation({
        id: row.id,
        showId: row.show_id,
        userId: row.user_id,
        amountPaise: Money.fromPaise(Number(row.amount_paise)),
        seats: row.seats || [],
        status: row.status,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      });
    } catch (err) {
      logger.error('ReservationRepository.findById failed', { reservation_id: id, error: err.message, code: err.code });
      throw err;
    }
  }

  async countActiveSeatsByUser(showId, userId, client = null) {
    const executor = client || this.pool;
    const query = `
      SELECT COUNT(*)::int AS count
      FROM reservation_seats rs
      JOIN reservations r ON r.id = rs.reservation_id
      WHERE r.show_id = $1 
        AND r.user_id = $2 
        AND (r.status = 'confirmed' OR (r.status = 'held' AND (r.hold_expires_at IS NULL OR r.hold_expires_at > NOW())));
    `;

    try {
      const res = await executor.query(query, [showId, userId]);
      return res.rows[0].count;
    } catch (err) {
      logger.error('ReservationRepository.countActiveSeatsByUser failed', { show_id: showId, user_id: userId, error: err.message, code: err.code });
      throw err;
    }
  }

  async cancel(id, client = null) {
    const executor = client || this.pool;
    const query = `
      UPDATE reservations
      SET status = 'cancelled', updated_at = NOW()
      WHERE id = $1
      RETURNING id, show_id, user_id, amount_paise, status;
    `;

    try {
      const res = await executor.query(query, [id]);
      if (res.rows.length === 0) return null;
      return res.rows[0];
    } catch (err) {
      logger.error('ReservationRepository.cancel failed', { reservation_id: id, error: err.message, code: err.code });
      throw err;
    }
  }
}

export const reservationRepository = new ReservationRepository();
export default reservationRepository;
