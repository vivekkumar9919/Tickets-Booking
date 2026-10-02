import express from 'express';
import reservationController from '../controllers/ReservationController.js';
import authMiddleware from '../middlewares/authMiddleware.js';

const router = express.Router();

router.post('/shows/:id/reserve', authMiddleware, (req, res, next) =>
  reservationController.reserveSeats(req, res, next)
);

router.post('/reservations/:id/cancel', authMiddleware, (req, res, next) =>
  reservationController.cancelReservation(req, res, next)
);

export default router;
