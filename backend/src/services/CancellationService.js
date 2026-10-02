import dbPoolInstance from '../infrastructure/database/DatabasePool.js';
import { UnitOfWork } from '../infrastructure/database/UnitOfWork.js';
import { ReservationRepository } from '../repositories/ReservationRepository.js';
import { SeatRepository } from '../repositories/SeatRepository.js';
import {
  ReservationNotFoundError,
  UnauthorizedCancellationError,
  DomainError,
} from '../domain/errors.js';
import logger from '../infrastructure/logger/Logger.js';

export class CancellationService {
  constructor(pool = dbPoolInstance) {
    this.pool = pool;
    this.resRepo = new ReservationRepository(pool);
    this.seatRepo = new SeatRepository(pool);
  }

  async cancelReservation({ reservationId, userId, correlationId = null }) {
    if (!reservationId || !userId) {
      throw new DomainError('Reservation ID and User ID are required for cancellation', 'INVALID_INPUT', 400);
    }

    const reservation = await this.resRepo.findById(reservationId);
    if (!reservation) {
      throw new ReservationNotFoundError(reservationId);
    }

    if (!reservation.isOwnedBy(userId)) {
      throw new UnauthorizedCancellationError();
    }

    if (reservation.isCancelled()) {
      throw new DomainError('Reservation is already cancelled', 'ALREADY_CANCELLED', 400);
    }

    const uow = new UnitOfWork(this.pool);
    return await uow.execute(async (unit) => {
      const client = unit.getClient();
      await this.resRepo.cancel(reservationId, client);

      if (reservation.seats && reservation.seats.length > 0) {
        await this.seatRepo.updateSeatsStatus(
          reservation.showId,
          reservation.seats,
          'available',
          null,
          null,
          null,
          client
        );
      }

      logger.info('Reservation successfully cancelled and seats released', {
        correlation_id: correlationId,
        reservation_id: reservationId,
        user_id: userId,
        seat_count: reservation.seats.length,
      });

      return {
        reservation_id: reservationId,
        status: 'cancelled',
        released_seats: reservation.seats,
      };
    });
  }
}

export const cancellationService = new CancellationService();
export default cancellationService;
