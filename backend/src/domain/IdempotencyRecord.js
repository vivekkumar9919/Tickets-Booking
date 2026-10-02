import crypto from 'crypto';

export const IdempotencyStatus = Object.freeze({
  IN_PROGRESS: 'IN_PROGRESS',
  COMPLETED: 'COMPLETED'
});

/**
 * Domain Entity: IdempotencyRecord
 */
export class IdempotencyRecord {
  constructor({ idempotencyKey, showId, userId, requestHash, status = IdempotencyStatus.IN_PROGRESS, responseStatus = null, responseBody = null, createdAt, updatedAt }) {
    if (!idempotencyKey) throw new TypeError('idempotencyKey is required');
    if (!requestHash) throw new TypeError('requestHash is required');

    this.idempotencyKey = idempotencyKey;
    this.showId = showId;
    this.userId = userId;
    this.requestHash = requestHash;
    this.status = status;
    this.responseStatus = responseStatus;
    this.responseBody = responseBody;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
  }

  static generateHash(payload) {
    const canonicalString = typeof payload === 'string' ? payload : JSON.stringify(payload, Object.keys(payload).sort());
    return crypto.createHash('sha256').update(canonicalString).digest('hex');
  }

  matchesPayload(hash) {
    return this.requestHash === hash;
  }

  isCompleted() {
    return this.status === IdempotencyStatus.COMPLETED;
  }

  complete(status, body) {
    this.status = IdempotencyStatus.COMPLETED;
    this.responseStatus = status;
    this.responseBody = body;
  }
}
