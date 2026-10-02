import { v4 as uuidv4 } from 'uuid';
import test from 'node:test';
import assert from 'node:assert/strict';
import dbPool from '../src/infrastructure/database/DatabasePool.js';
import UnitOfWork from '../src/infrastructure/database/UnitOfWork.js';
import { Money } from '../src/domain/Money.js';
import { Show } from '../src/domain/Show.js';
import { Seat, SeatStatus } from '../src/domain/Seat.js';
import { Reservation, ReservationStatus } from '../src/domain/Reservation.js';
import { IdempotencyRecord, IdempotencyStatus } from '../src/domain/IdempotencyRecord.js';
import showRepository from '../src/repositories/ShowRepository.js';
import seatRepository from '../src/repositories/SeatRepository.js';
import reservationRepository from '../src/repositories/ReservationRepository.js';
import idempotencyRepository from '../src/repositories/IdempotencyRepository.js';

test('Phase 2: Domain Entities, Value Objects & Repositories Layer', async (t) => {
  const uow = new UnitOfWork(dbPool);

  // 1. Money Value Object Tests
  await t.test('Money: enforces integer paise and rejects floats and negatives', () => {
    const valid = Money.fromPaise(25000);
    assert.equal(valid.paise, 25000);

    // Reject float
    assert.throws(() => Money.fromPaise(250.50), TypeError);
    // Reject negative
    assert.throws(() => Money.fromPaise(-100), TypeError);

    // Arithmetic
    const sum = valid.add(Money.fromPaise(5000));
    assert.equal(sum.paise, 30000);

    const multiplied = valid.multiply(3);
    assert.equal(multiplied.paise, 75000);
  });

  // 2. Domain State Machine Guards
  await t.test('Seat & Show: State machine transitions and booking quotas', () => {
    const seat = new Seat({ id: 's1', showId: 'show1', seatNumber: 'A12' });
    assert.equal(seat.isAvailable(), true);

    seat.confirm('res1');
    assert.equal(seat.isConfirmed(), true);

    seat.release();
    assert.equal(seat.isAvailable(), true);

    const show = new Show({
      name: 'Coldplay Concert',
      totalSeats: 100,
      pricePaise: 50000,
      perUserLimit: 4,
    });
    assert.equal(show.canUserBook(2, 2), true);
    assert.equal(show.canUserBook(3, 2), false); // 5 > 4 limit
    assert.equal(show.calculateTotalAmount(3).paise, 150000);
  });

  // 3. ShowRepository Integration
  await t.test('ShowRepository: create and findById', async () => {
    const show = new Show({
      name: `Rock-Fest-${Date.now()}`,
      totalSeats: 10,
      pricePaise: 35000,
      perUserLimit: 4,
    });

    const created = await showRepository.create(show);
    assert.ok(created.id, 'Created show should have generated UUID');
    assert.equal(created.name, show.name);
    assert.equal(created.price.paise, 35000);

    const fetched = await showRepository.findById(created.id);
    assert.equal(fetched.id, created.id);
    assert.equal(fetched.totalSeats, 10);
  });

  // 4. SeatRepository: createBatch and deterministic locking
  await t.test('SeatRepository: createBatch, findSeatsForUpdate, and updateSeatsStatus', async () => {
    const show = await showRepository.create(new Show({
      name: `Seat-Test-${Date.now()}`,
      totalSeats: 3,
      pricePaise: 20000,
      perUserLimit: 4,
    }));

    const createdSeats = await seatRepository.createBatch(show.id, ['B2', 'A1', 'B1']);
    assert.equal(createdSeats.length, 3);

    const dummyReservationId = uuidv4();

    // Verify deterministic row locking inside transaction
    await uow.execute(async (tx) => {
      const lockedSeats = await seatRepository.findSeatsForUpdate(show.id, ['B2', 'A1'], tx.getClient());
      assert.equal(lockedSeats.length, 2);
      // Deterministic natural sort order: A1 should come before B2
      assert.equal(lockedSeats[0].seatNumber, 'A1');
      assert.equal(lockedSeats[1].seatNumber, 'B2');

      // Update seats to confirmed
      const updated = await seatRepository.updateSeatsStatus(
        show.id,
        ['A1', 'B2'],
        SeatStatus.CONFIRMED,
        dummyReservationId,
        null,
        'usr_test',
        tx.getClient()
      );
      assert.equal(updated.length, 2);
    });

    // Check counts
    const state = await showRepository.findWithSeatCounts(show.id);
    assert.equal(state.counts.confirmed, 2);
    assert.equal(state.counts.available, 1);
    assert.equal(state.counts.total, 3);
  });

  // 5. ReservationRepository & Quota Count
  await t.test('ReservationRepository: create, countActiveSeatsByUser, and cancel', async () => {
    const show = await showRepository.create(new Show({
      name: `Reservation-Test-${Date.now()}`,
      totalSeats: 5,
      pricePaise: 15000,
      perUserLimit: 4,
    }));

    const seats = await seatRepository.createBatch(show.id, ['C1', 'C2', 'C3']);

    let reservationId = null;
    await uow.execute(async (tx) => {
      const res = await reservationRepository.create(
        new Reservation({
          showId: show.id,
          userId: 'usr_alice',
          amountPaise: 30000,
          status: ReservationStatus.CONFIRMED,
        }),
        [seats[0], seats[1]],
        tx.getClient()
      );
      reservationId = res.id;
    });

    assert.ok(reservationId, 'Reservation should be created with UUID');

    // Count user's active seats
    const userCount = await reservationRepository.countActiveSeatsByUser(show.id, 'usr_alice');
    assert.equal(userCount, 2, 'User Alice should have 2 active booked seats');

    // Cancel reservation
    await reservationRepository.cancel(reservationId);
    const postCancelCount = await reservationRepository.countActiveSeatsByUser(show.id, 'usr_alice');
    assert.equal(postCancelCount, 0, 'User Alice should have 0 active seats after cancellation');
  });

  // 6. IdempotencyRepository: in-progress, findForUpdate, and markCompleted
  await t.test('IdempotencyRepository: transactional lifecycle and payload caching', async () => {
    const show = await showRepository.create(new Show({
      name: `Idempotency-Show-${Date.now()}`,
      totalSeats: 5,
      pricePaise: 10000,
      perUserLimit: 4,
    }));

    const testKey = `idem_key_${Date.now()}`;
    const testHash = IdempotencyRecord.generateHash({ seats: ['A1', 'A2'] });

    await uow.execute(async (tx) => {
      const initial = await idempotencyRepository.insert(
        new IdempotencyRecord({
          idempotencyKey: testKey,
          showId: show.id,
          userId: 'usr_bob',
          requestHash: testHash,
        }),
        tx.getClient()
      );
      assert.equal(initial.status, IdempotencyStatus.IN_PROGRESS);

      // Lock and complete
      const locked = await idempotencyRepository.findForUpdate(testKey, tx.getClient());
      assert.ok(locked.matchesPayload(testHash));

      const completed = await idempotencyRepository.markCompleted(
        testKey,
        201,
        { reservation_id: 'res_123', status: 'confirmed' },
        tx.getClient()
      );
      assert.equal(completed.isCompleted(), true);
      assert.equal(completed.responseStatus, 201);
    });
  });

  t.after(async () => {
    await dbPool.close();
  });
});
