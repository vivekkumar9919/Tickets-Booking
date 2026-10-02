import { Router } from 'express';
import healthController from '../controllers/HealthController.js';

const router = Router();

router.get('/livez', healthController.getLiveness);
router.get('/readyz', healthController.getReadiness);
router.get('/health', healthController.getDetailedHealth);

export default router;

