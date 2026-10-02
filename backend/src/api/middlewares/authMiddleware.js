/**
 * Authentication Middleware
 * Enforces Invariant 6: Identity strictly extracted from Bearer token.
 * Prevents identity spoofing via request body.
 */
export function authMiddleware(req, res, next) {
  const authHeader = req.headers['authorization'];
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Missing or malformed Authorization header. Expected Bearer token.',
      correlation_id: req.correlationId,
    });
  }

  // Reject identity spoofing attempts in request body
  if (req.body && (req.body.user_id !== undefined || req.body.userId !== undefined)) {
    return res.status(400).json({
      error: 'IDENTITY_SPOOFING_FORBIDDEN',
      message: 'user_id must not be supplied in the request body; identity is strictly extracted from the Bearer token.',
      correlation_id: req.correlationId,
    });
  }

  const token = authHeader.slice(7).trim();
  if (!token) {
    return res.status(401).json({
      error: 'UNAUTHORIZED',
      message: 'Empty Bearer token provided.',
      correlation_id: req.correlationId,
    });
  }

  // Support JWT claims or opaque token IDs
  const userId = _extractUserId(token);
  req.user = {
    userId,
    token,
  };

  next();
}

function _extractUserId(token) {
  if (token.includes('.')) {
    try {
      const parts = token.split('.');
      if (parts.length >= 2) {
        const payload = JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'));
        return payload.sub || payload.userId || payload.user_id || token;
      }
    } catch {
      // Fallback to token string if parsing fails
    }
  }
  return token;
}

export default authMiddleware;
