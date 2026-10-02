import express from 'express';
import cors from 'cors';
import correlationMiddleware from './api/middlewares/correlationMiddleware.js';
import errorHandler from './api/middlewares/errorHandler.js';
import healthRoutes from './api/routes/healthRoutes.js';

export function createApp() {
  const app = express();

  // Cross-Origin Resource Sharing
  app.use(cors({
    origin: '*',
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'Idempotency-Key', 'X-Correlation-ID'],
  }));

  // Body Parsing
  app.use(express.json());

  // Request Tracing & Structured Logging
  app.use(correlationMiddleware);

  // Health and Readiness Probes
  app.use('/', healthRoutes);

  // 404 Handler
  app.use((req, res) => {
    res.status(404).json({
      error: 'NOT_FOUND',
      message: `Cannot ${req.method} ${req.originalUrl}`,
      correlation_id: req.correlationId,
    });
  });

  // Global Error Handler
  app.use(errorHandler);

  return app;
}

export default createApp;

