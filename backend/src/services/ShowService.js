import dbPoolInstance from '../infrastructure/database/DatabasePool.js';
import { UnitOfWork } from '../infrastructure/database/UnitOfWork.js';
import { ShowRepository } from '../repositories/ShowRepository.js';
import { SeatRepository } from '../repositories/SeatRepository.js';
import { Show } from '../domain/Show.js';
import { Money } from '../domain/Money.js';
import { ShowNotFoundError, DomainError } from '../domain/errors.js';
import logger from '../infrastructure/logger/Logger.js';

export class ShowService {
  constructor(pool = dbPoolInstance) {
    this.pool = pool;
    this.showRepo = new ShowRepository(pool);
    this.seatRepo = new SeatRepository(pool);
  }

  async createShow({ name, totalSeats, pricePaise, perUserLimit = 4, correlationId = null }) {
    if (!name || typeof name !== 'string' || !name.trim()) {
      throw new DomainError('Show name is required', 'INVALID_SHOW_NAME', 400);
    }
    if (!Number.isInteger(totalSeats) || totalSeats <= 0) {
      throw new DomainError('Total seats must be a positive integer', 'INVALID_SEAT_COUNT', 400);
    }

    const money = new Money(pricePaise);
    const uow = new UnitOfWork(this.pool);

    return await uow.execute(async (unit) => {
      const client = unit.getClient();
      const showEntity = new Show({
        name: name.trim(),
        totalSeats,
        pricePaise: money.paise,
        perUserLimit,
      });

      const show = await this.showRepo.create(showEntity, client);
      const seatNumbers = Array.from({ length: totalSeats }, (_, i) => `S${i + 1}`);
      await this.seatRepo.createBatch(show.id, seatNumbers, client);

      logger.info('Show inventory created successfully', {
        correlation_id: correlationId,
        show_id: show.id,
        total_seats: totalSeats,
      });

      return show;
    });
  }

  async getShowState(showId, correlationId = null) {
    const res = await this.showRepo.findWithSeatCounts(showId);
    if (!res || !res.show) {
      throw new ShowNotFoundError(showId);
    }

    const { available, held, confirmed, total } = res.counts;

    if (available + held + confirmed !== total) {
      logger.error('Reconciliation invariant breach detected', {
        correlation_id: correlationId,
        show_id: showId,
        available,
        held,
        confirmed,
        total,
      });
      throw new DomainError('Reconciliation invariant violated: seat sum does not equal total_seats', 'RECONCILIATION_BREACH', 500);
    }

    const seats = await this.seatRepo.findByShowId(showId);
    return {
      show: res.show,
      summary: { available, held, confirmed, total },
      seats,
    };
  }
}

export const showService = new ShowService();
export default showService;
