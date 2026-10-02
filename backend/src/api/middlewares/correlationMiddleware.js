import { v4 as uuidv4 } from 'uuid';
import logger from '../../infrastructure/logger/Logger.js';

export function correlationMiddleware(req, res, next) {
  const correlationId = req.headers['x-correlation-id'] || uuidv4();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-ID', correlationId);

  req.logger = logger.child({ correlation_id: correlationId });

  const startTime = Date.now();

  res.on('finish', () => {
    const durationMs = Date.now() - startTime;
    // Strictly zero customer PII: operational metadata only
    req.logger.info('HTTP Request completed', {
      method: req.method,
      path: req.originalUrl || req.url,
      statusCode: res.statusCode,
      duration_ms: durationMs,
    });
  });

  next();
}

export default correlationMiddleware;
