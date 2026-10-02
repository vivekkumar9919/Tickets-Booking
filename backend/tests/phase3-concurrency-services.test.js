import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dbPool } from '../src/infrastructure/database/DatabasePool.js';
import { runMigrations } from '../src/infrastructure/database/migrate.js';
import { ShowService } from '../src/services/ShowService.js';
import { ReservationService } from '../src/services/ReservationService.js';
import { CancellationService } from '../src/services/CancellationService.js';
import { HoldSweeper } from '../src/services/HoldSweeper.js';
import {
  SeatUnavailableError,
  UserLimitExceededError,
  IdempotencyMismatchError,
  UnauthorizedCancellationError,
} from '../src/domain/errors.js';

const uid = () => Math.random().toString(36).substring(2, 10);

describe('Phase 3: Concurrency Engine & Application Services', () => {
  let showService;
  let reservationService;
  let cancellationService;
  let holdSweeper;

  before(async () => {
    await runMigrations();
    showService = new ShowService(dbPool);
    reservationService = new ReservationService(dbPool);
    cancellationService = new CancellationService(dbPool);
    holdSweeper = new HoldSweeper(dbPool);
  });

  after(async () => {
    holdSweeper.stop();
    await dbPool.close();
  });

  it('ShowService should create a show, generate seats, and verify reconciliation invariant', async () => {
    const show = await showService.createShow({
      name: `Coldplay Ahmedabad ${uid()}`,
      totalSeats: 25,
      pricePaise: 500000, // Rs. 5000
      perUserLimit: 4,
    });

    assert.ok(show.id);
    assert.equal(show.totalSeats, 25);

    const state = await showService.getShowState(show.id);
    assert.equal(state.summary.total, 25);
    assert.equal(state.summary.available, 25);
    assert.equal(state.summary.held, 0);
    assert.equal(state.summary.confirmed, 0);
    assert.equal(state.summary.available + state.summary.held + state.summary.confirmed, 25);
    assert.equal(state.seats.length, 25);
  });

  it('ReservationService should successfully reserve requested seats', async () => {
    const show = await showService.createShow({
      name: `Dua Lipa Tour ${uid()}`,
      totalSeats: 10,
      pricePaise: 250000,
      perUserLimit: 4,
    });

    const reservation = await reservationService.reserveSeats({
      showId: show.id,
      seatNumbers: ['S1', 'S2'],
      userId: `usr_buyer_${uid()}`,
      idempotencyKey: `idemp_${uid()}`,
    });

    assert.ok(reservation.reservation_id);
    assert.equal(reservation.status, 'confirmed');
    assert.deepEqual(reservation.seats, ['S1', 'S2']);
    assert.equal(reservation.amount_paise, 500000);

    const state = await showService.getShowState(show.id);
    assert.equal(state.summary.available, 8);
    assert.equal(state.summary.confirmed, 2);
  });

  it('ReservationService should enforce strict idempotency (cache hit vs payload mismatch)', async () => {
    const show = await showService.createShow({
      name: `Taylor Swift Eras ${uid()}`,
      totalSeats: 10,
      pricePaise: 1000000,
      perUserLimit: 4,
    });

    const key = `idemp_swiftie_${uid()}`;
    const userId = `usr_swiftie_${uid()}`;

    const firstCall = await reservationService.reserveSeats({
      showId: show.id,
      seatNumbers: ['S1'],
      userId,
      idempotencyKey: key,
    });

    // Replay with identical payload should return cached result
    const secondCall = await reservationService.reserveSeats({
      showId: show.id,
      seatNumbers: ['S1'],
      userId,
      idempotencyKey: key,
    });

    assert.equal(firstCall.reservation_id, secondCall.reservation_id);
    assert.deepEqual(firstCall.seats, secondCall.seats);

    // Call with same idempotency key but different seat payload must fail with IdempotencyMismatchError
    await assert.rejects(
      async () => {
        await reservationService.reserveSeats({
          showId: show.id,
          seatNumbers: ['S2'],
          userId,
          idempotencyKey: key,
        });
      },
      (err) => err instanceof IdempotencyMismatchError
    );
  });

  it('ReservationService should strictly enforce per-user quota', async () => {
    const show = await showService.createShow({
      name: `Arijit Singh Live ${uid()}`,
      totalSeats: 20,
      pricePaise: 300000,
      perUserLimit: 3,
    });

    const userId = `usr_arijit_${uid()}`;

    // User books 2 seats (allowed)
    await reservationService.reserveSeats({
      showId: show.id,
      seatNumbers: ['S1', 'S2'],
      userId,
      idempotencyKey: `idemp_${uid()}`,
    });

    // User tries to book 2 more seats (2 + 2 = 4 > 3 -> reject)
    await assert.rejects(
      async () => {
        await reservationService.reserveSeats({
          showId: show.id,
          seatNumbers: ['S3', 'S4'],
          userId,
          idempotencyKey: `idemp_${uid()}`,
        });
      },
      (err) => err instanceof UserLimitExceededError
    );
  });

  it('Concurrency Stress: 20 concurrent requests for the exact same seat must yield exactly 1 winner and 19 clean 409s', async () => {
    const show = await showService.createShow({
      name: `IPL Final ${uid()}`,
      totalSeats: 15,
      pricePaise: 400000,
      perUserLimit: 4,
    });

    const hotSeat = ['S5'];
    const concurrencyCount = 20;

    const promises = Array.from({ length: concurrencyCount }, (_, i) => {
      return reservationService.reserveSeats({
        showId: show.id,
        seatNumbers: hotSeat,
        userId: `usr_contender_${uid()}_${i}`,
        idempotencyKey: `idemp_storm_${uid()}_${i}`,
      }).then(
        (res) => ({ success: true, result: res }),
        (err) => ({ success: false, error: err })
      );
    });

    const results = await Promise.all(promises);
    const winners = results.filter((r) => r.success);
    const losers = results.filter((r) => !r.success);

    assert.equal(winners.length, 1, 'Exactly one reservation should win the seat');
    assert.equal(losers.length, concurrencyCount - 1, 'All other concurrent requests must fail cleanly');

    for (const loser of losers) {
      assert.ok(
        loser.error instanceof SeatUnavailableError || loser.error.code === 'SEAT_UNAVAILABLE',
        `Expected SeatUnavailableError but got: ${loser.error.name} - ${loser.error.message}`
      );
    }

    const state = await showService.getShowState(show.id);
    assert.equal(state.summary.confirmed, 1);
    assert.equal(state.summary.available, 14);
  });

  it('Deadlock Prevention: concurrent requests reserving seats in reverse order should never deadlock', async () => {
    const show = await showService.createShow({
      name: `Ed Sheeran Live ${uid()}`,
      totalSeats: 10,
      pricePaise: 350000,
      perUserLimit: 4,
    });

    // Request 1 requests ['S1', 'S2'], Request 2 requests ['S2', 'S1'] (reverse order)
    const [res1, res2] = await Promise.allSettled([
      reservationService.reserveSeats({
        showId: show.id,
        seatNumbers: ['S1', 'S2'],
        userId: `usr_ed_${uid()}_1`,
        idempotencyKey: `idemp_${uid()}_1`,
      }),
      reservationService.reserveSeats({
        showId: show.id,
        seatNumbers: ['S2', 'S1'],
        userId: `usr_ed_${uid()}_2`,
        idempotencyKey: `idemp_${uid()}_2`,
      }),
    ]);

    const successes = [res1, res2].filter((r) => r.status === 'fulfilled');
    const rejections = [res1, res2].filter((r) => r.status === 'rejected');

    assert.equal(successes.length, 1, 'One request must succeed');
    assert.equal(rejections.length, 1, 'The other request must fail cleanly with 409');
  });

  it('CancellationService should release seats back to available and prevent unauthorized cancellation', async () => {
    const show = await showService.createShow({
      name: `Zakir Khan Standup ${uid()}`,
      totalSeats: 10,
      pricePaise: 150000,
      perUserLimit: 4,
    });

    const ownerId = `usr_zakir_${uid()}`;
    const booking = await reservationService.reserveSeats({
      showId: show.id,
      seatNumbers: ['S3', 'S4'],
      userId: ownerId,
      idempotencyKey: `idemp_${uid()}`,
    });

    // Unauthorized user cancellation must fail
    await assert.rejects(
      async () => {
        await cancellationService.cancelReservation({
          reservationId: booking.reservation_id,
          userId: `usr_impostor_${uid()}`,
        });
      },
      (err) => err instanceof UnauthorizedCancellationError
    );

    // Owner cancels reservation
    const cancelRes = await cancellationService.cancelReservation({
      reservationId: booking.reservation_id,
      userId: ownerId,
    });

    assert.equal(cancelRes.status, 'cancelled');
    assert.equal(cancelRes.released_seats.length, 2);

    // State should now have all 10 seats available again
    const state = await showService.getShowState(show.id);
    assert.equal(state.summary.available, 10);
    assert.equal(state.summary.confirmed, 0);
  });

  it('HoldSweeper should reclaim expired held seats', async () => {
    const show = await showService.createShow({
      name: `Prateek Kuhad Live ${uid()}`,
      totalSeats: 5,
      pricePaise: 200000,
      perUserLimit: 4,
    });

    // Manually insert an expired hold directly on seat S1
    await dbPool.query(
      `UPDATE seats 
       SET status = 'held', 
           hold_expires_at = NOW() - INTERVAL '1 minute' 
       WHERE show_id = $1 AND seat_number = 'S1'`,
      [show.id]
    );

    const reclaimed = await holdSweeper.sweep();
    assert.ok(reclaimed >= 1, 'Sweeper must reclaim at least the 1 expired held seat');

    const state = await showService.getShowState(show.id);
    assert.equal(state.summary.available, 5);
    assert.equal(state.summary.held, 0);
  });
});
