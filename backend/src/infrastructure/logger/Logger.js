import winston from 'winston';

const { combine, timestamp, json, errors } = winston.format;

export class AppLogger {
  constructor(logLevel = process.env.LOG_LEVEL || 'info') {
    this.logger = winston.createLogger({
      level: logLevel,
      format: combine(
        timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
        errors({ stack: true }),
        json()
      ),
      defaultMeta: { service: 'seat-reservation-backend' },
      transports: [
        new winston.transports.Console()
      ]
    });
  }

  child(meta = {}) {
    return this.logger.child(meta);
  }

  info(message, meta = {}) {
    this.logger.info(message, meta);
  }

  warn(message, meta = {}) {
    this.logger.warn(message, meta);
  }

  error(message, meta = {}) {
    this.logger.error(message, meta);
  }

  debug(message, meta = {}) {
    this.logger.debug(message, meta);
  }
}

export const logger = new AppLogger();
export default logger;
