import express from 'express';
import showController from '../controllers/ShowController.js';

const router = express.Router();

router.post('/', (req, res, next) => showController.createShow(req, res, next));
router.get('/:id', (req, res, next) => showController.getShow(req, res, next));

export default router;
