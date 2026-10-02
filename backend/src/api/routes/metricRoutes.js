import express from 'express';
import metricsCollector from '../../infrastructure/metrics/MetricsCollector.js';

const router = express.Router();

router.get('/metrics', async (req, res, next) => {
  try {
    res.set('Content-Type', metricsCollector.getContentType());
    res.end(await metricsCollector.getMetrics());
  } catch (err) {
    next(err);
  }
});

export default router;
