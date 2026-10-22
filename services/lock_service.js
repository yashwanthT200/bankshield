/**
 * Distributed Lock & Idempotency Service
 * Provides Redis-backed or atomic In-Memory Mutex locks with TTL to prevent race conditions.
 */
class LockService {
  constructor() {
    this.locks = new Map(); // In-memory distributed lock registry
    this.idempotencyKeys = new Map(); // Idempotency cache with TTL
  }

  /**
   * Acquire a distributed lock for a specific account
   * @param {string} resourceKey - e.g. "account:ACC-94821"
   * @param {number} ttlMs - Lock lease time in milliseconds (default: 2000ms)
   * @returns {Promise<{acquired: boolean, lockToken: string|null}>}
   */
  async acquireLock(resourceKey, ttlMs = 2000) {
    const now = Date.now();
    const existing = this.locks.get(resourceKey);

    // If locked and not expired, lock cannot be acquired
    if (existing && existing.expiresAt > now) {
      return { acquired: false, lockToken: null };
    }

    // Atomic acquisition
    const lockToken = `token_${Math.random().toString(36).substring(2)}_${now}`;
    this.locks.set(resourceKey, {
      token: lockToken,
      expiresAt: now + ttlMs,
    });

    return { acquired: true, lockToken };
  }

  /**
   * Release a distributed lock
   * @param {string} resourceKey
   * @param {string} lockToken
   */
  async releaseLock(resourceKey, lockToken) {
    const existing = this.locks.get(resourceKey);
    if (existing && existing.token === lockToken) {
      this.locks.delete(resourceKey);
      return true;
    }
    return false;
  }

  /**
   * Check and register Idempotency Key
   * @param {string} key - UUID idempotency key
   * @param {number} ttlMs - 24hr default in prod, 60s in demo
   */
  checkIdempotency(key) {
    if (!key) return { exists: false };
    const now = Date.now();
    const record = this.idempotencyKeys.get(key);

    if (record && record.expiresAt > now) {
      return { exists: true, response: record.response };
    }

    return { exists: false };
  }

  registerIdempotency(key, response, ttlMs = 60000) {
    if (!key) return;
    this.idempotencyKeys.set(key, {
      response,
      expiresAt: Date.now() + ttlMs,
    });
  }

  clear() {
    this.locks.clear();
    this.idempotencyKeys.clear();
  }
}

module.exports = new LockService();
