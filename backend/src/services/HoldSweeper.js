import dbPoolInstance from '../infrastructure/database/DatabasePool.js';
import { SeatRepository } from '../repositories/SeatRepository.js';
import { ReservationRepository } from '../repositories/ReservationRepository.js';
import logger from '../infrastructure/logger/Logger.js';

export class HoldSweeper {
  constructor(pool = dbPoolInstance, intervalMs = 15000) {
    this.pool = pool;
    this.seatRepo = new SeatRepository(pool);
    this.resRepo = new ReservationRepository(pool);
    this.intervalMs = intervalMs;
    this.timer = null;
    this.isSweeping = false;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.sweep(), this.intervalMs);
    logger.info('HoldSweeper background worker started', { interval_ms: this.intervalMs });
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
      logger.info('HoldSweeper background worker stopped');
    }
  }

  async sweep() {
    if (this.isSweeping) return 0;
    this.isSweeping = true;

    try {
      const reclaimedSeats = await this.seatRepo.releaseExpiredHolds();
      await this.resRepo.cancelExpiredHolds();
      const count = reclaimedSeats.length;
      if (count > 0) {
        logger.info('HoldSweeper successfully reclaimed expired held seats', {
          reclaimed_count: count,
          seat_numbers: reclaimedSeats.map((s) => s.seat_number),
        });
      }
      return count;
    } catch (err) {
      logger.error('Error during HoldSweeper execution', {
        error_message: err.message,
        pg_code: err.code,
      });
      return 0;
    } finally {
      this.isSweeping = false;
    }
  }
}

export const holdSweeper = new HoldSweeper();
export default holdSweeper;
