import logger from '../../infrastructure/logger/Logger.js';

export function errorHandler(err, req, res, _next) {
  const correlationId = req.correlationId || 'unknown';
  const statusCode = err.statusCode || err.status || 500;

  // Log internal error with correlation_id via Winston (Zero PII)
  logger.error('Unhandled or Domain Exception occurred', {
    correlation_id: correlationId,
    error: err.message,
    code: err.code || 'INTERNAL_ERROR',
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  // Never leak raw SQL or internal stack traces to client
  const clientResponse = {
    error: err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST'),
    message: statusCode === 500 ? 'An unexpected server error occurred' : err.message,
    correlation_id: correlationId,
  };

  return res.status(statusCode).json(clientResponse);
}

export default errorHandler;
