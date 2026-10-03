import express from 'express';
import reservationController from '../controllers/ReservationController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/shows/:id/reserve', authMiddleware, (req, res, next) =>
  reservationController.reserveSeats(req, res, next)
);

router.post('/shows/:id/hold', authMiddleware, (req, res, next) =>
  reservationController.holdSeats(req, res, next)
);

router.post('/reservations/:id/confirm', authMiddleware, (req, res, next) =>
  reservationController.confirmReservation(req, res, next)
);

router.post('/reservations/:id/cancel', authMiddleware, (req, res, next) =>
  reservationController.cancelReservation(req, res, next)
);

router.post('/admin/sweep', (req, res, next) =>
  reservationController.runSweeper(req, res, next)
);

export default router;
