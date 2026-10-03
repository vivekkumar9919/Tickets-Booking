import logger from '../../infrastructure/logger/Logger.js';

export function errorHandler(err, req, res, _next) {
  const correlationId = req.correlationId || 'unknown';
  // Gracefully map lock timeouts and database connection queue exhaustion under peak concurrency to 409
  let statusCode = err.statusCode || err.status || 500;
  let errorCode = err.code || (statusCode === 500 ? 'INTERNAL_SERVER_ERROR' : 'BAD_REQUEST');
  let errorMessage = statusCode === 500 ? 'An unexpected server error occurred' : err.message;

  if (
    err.code === '55P03' ||
    err.code === '57014' ||
    err.code === '53300' ||
    (err.message && (
      err.message.includes('timeout exceeded') ||
      err.message.includes('Connection terminated') ||
      err.message.includes('Connection timeout') ||
      err.message.includes('canceling statement')
    ))
  ) {
    statusCode = 409;
    errorCode = 'SEAT_LOCK_TIMEOUT';
    errorMessage = 'Seat lock or database pool timeout under peak contention, please retry';
  }

  // Log internal error with correlation_id via Winston (Zero PII)
  logger.error('Unhandled or Domain Exception occurred', {
    correlation_id: correlationId,
    error: err.message,
    code: errorCode,
    stack: err.stack,
    path: req.originalUrl,
    method: req.method,
  });

  // Never leak raw SQL or internal stack traces to client
  const clientResponse = {
    error: errorCode,
    message: errorMessage,
    correlation_id: correlationId,
  };

  return res.status(statusCode).json(clientResponse);
}

export default errorHandler;
