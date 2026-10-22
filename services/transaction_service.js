const crypto = require('crypto');
const lockService = require('./lock_service');
const kafkaProducer = require('./kafka_producer');

class TransactionService {
  constructor() {
    this.resetState();
  }

  resetState() {
    // Initial Accounts
    this.accounts = {
      'ACC-94821': { name: 'Primary Account (Alice)', balance: 1000.0, initialBalance: 1000.0 },
      'ACC-33120': { name: 'Merchant / Recipient (Bob)', balance: 0.0, initialBalance: 0.0 },
    };

    // Ledger for double-entry records
    this.ledger = [];

    // Metrics for comparison
    this.stats = {
      naive: {
        totalRequests: 0,
        approved: 0,
        rejected: 0,
        raceConditionsDetected: 0,
        totalWithdrawn: 0,
        finalBalance: 1000.0,
      },
      dockerized: {
        totalRequests: 0,
        approved: 0,
        rejected: 0,
        raceConditionsDetected: 0,
        totalWithdrawn: 0,
        finalBalance: 1000.0,
      },
    };

    // Simulated Workers
    this.workers = [
      { id: 'Worker-1', status: 'HEALTHY', handled: 0 },
      { id: 'Worker-2', status: 'HEALTHY', handled: 0 },
    ];
    this.roundRobinIndex = 0;

    lockService.clear();
    kafkaProducer.clear();
  }

  /**
   * Select next healthy worker replica (simulating Nginx round-robin)
   */
  getWorker() {
    const healthy = this.workers.filter((w) => w.status === 'HEALTHY');
    if (healthy.length === 0) {
      throw new Error('502 Bad Gateway: All upstream workers offline');
    }
    const worker = healthy[this.roundRobinIndex % healthy.length];
    this.roundRobinIndex++;
    worker.handled++;
    return worker;
  }

  /**
   * MODE 1: NAIVE TRANSFER (Vulnerable to Race Conditions & Money Leaks)
   */
  async executeNaiveTransfer(fromAccount, toAccount, amount, idempotencyKey) {
    this.stats.naive.totalRequests++;
    const sender = this.accounts[fromAccount];
    const receiver = this.accounts[toAccount];

    if (!sender || !receiver) {
      return { success: false, status: 404, message: 'Account not found' };
    }

    // STEP 1: Naive Read (Non-atomic, no locks)
    const currentBalance = sender.balance;

    // STEP 2: Realistic Async I/O Delay (10ms) - opens window for race conditions!
    await new Promise((resolve) => setTimeout(resolve, 8 + Math.random() * 8));

    // STEP 3: Stale Check
    if (currentBalance >= amount) {
      // STEP 4: Unsynchronized Write
      sender.balance = parseFloat((sender.balance - amount).toFixed(2));
      receiver.balance = parseFloat((receiver.balance + amount).toFixed(2));

      this.stats.naive.approved++;
      this.stats.naive.totalWithdrawn += amount;
      this.stats.naive.finalBalance = sender.balance;

      // Check if race condition occurred (balance dipped below zero)
      let raceCondition = false;
      if (sender.balance < 0) {
        this.stats.naive.raceConditionsDetected++;
        raceCondition = true;
      }

      const txId = `TXN-NAIVE-${crypto.randomBytes(4).toString('hex')}`;
      return {
        success: true,
        status: 200,
        txId,
        fromAccount,
        toAccount,
        amount,
        senderNewBalance: sender.balance,
        raceCondition,
        mode: 'naive',
      };
    } else {
      this.stats.naive.rejected++;
      return {
        success: false,
        status: 409,
        message: 'Insufficient Funds',
        senderNewBalance: sender.balance,
        mode: 'naive',
      };
    }
  }

  /**
   * MODE 2: DOCKERIZED ENTERPRISE TRANSFER (ACID + Distributed Locks + Kafka Event Sourcing)
   */
  async executeDistributedTransfer(fromAccount, toAccount, amount, idempotencyKey) {
    this.stats.dockerized.totalRequests++;
    const worker = this.getWorker();

    // 1. Check Idempotency Key
    if (idempotencyKey) {
      const cached = lockService.checkIdempotency(idempotencyKey);
      if (cached.exists) {
        return { ...cached.response, cached: true, workerId: worker.id };
      }
    }

    const lockResource = `account:${fromAccount}`;
    let lockToken = null;
    const maxRetries = 15;
    let acquired = false;

    // 2. Distributed Mutex Acquisition (Spinlock with Exponential Backoff)
    for (let i = 0; i < maxRetries; i++) {
      const lockResult = await lockService.acquireLock(lockResource, 2000);
      if (lockResult.acquired) {
        acquired = true;
        lockToken = lockResult.lockToken;
        break;
      }
      // Wait before retry (2-6ms)
      await new Promise((r) => setTimeout(r, 2 + Math.random() * 4));
    }

    if (!acquired) {
      this.stats.dockerized.rejected++;
      return {
        success: false,
        status: 429,
        message: 'Concurrency Contention: Resource Locked. Please retry.',
        workerId: worker.id,
        mode: 'dockerized',
      };
    }

    try {
      // 3. ACID Row-Level Locking Simulation (`SELECT ... FOR UPDATE`)
      const sender = this.accounts[fromAccount];
      const receiver = this.accounts[toAccount];

      if (!sender || !receiver) {
        return { success: false, status: 404, message: 'Account not found' };
      }

      // Check current atomic balance
      if (sender.balance < amount) {
        this.stats.dockerized.rejected++;
        const rejectedRes = {
          success: false,
          status: 409,
          message: 'Insufficient Funds (Protected by ACID)',
          senderNewBalance: sender.balance,
          workerId: worker.id,
          mode: 'dockerized',
        };
        if (idempotencyKey) lockService.registerIdempotency(idempotencyKey, rejectedRes);
        return rejectedRes;
      }

      // 4. Double-Entry Atomic Ledger Mutation
      sender.balance = parseFloat((sender.balance - amount).toFixed(2));
      receiver.balance = parseFloat((receiver.balance + amount).toFixed(2));

      this.stats.dockerized.approved++;
      this.stats.dockerized.totalWithdrawn += amount;
      this.stats.dockerized.finalBalance = sender.balance;

      const txId = `TXN-PROD-${crypto.randomBytes(4).toString('hex').toUpperCase()}`;

      // 5. Append Double-Entry Record
      this.ledger.push({
        txId,
        timestamp: new Date().toISOString(),
        debitAccount: fromAccount,
        creditAccount: toAccount,
        amount,
        senderPostBalance: sender.balance,
        workerId: worker.id,
      });

      // 6. Publish Event to Apache Kafka Topic `bank.transfers.v1`
      await kafkaProducer.publishEvent('TRANSFER_SUCCESS', {
        txId,
        fromAccount,
        toAccount,
        amount,
        senderNewBalance: sender.balance,
        workerId: worker.id,
      });

      const response = {
        success: true,
        status: 200,
        txId,
        fromAccount,
        toAccount,
        amount,
        senderNewBalance: sender.balance,
        workerId: worker.id,
        mode: 'dockerized',
      };

      // 7. Store Idempotency
      if (idempotencyKey) {
        lockService.registerIdempotency(idempotencyKey, response);
      }

      return response;
    } finally {
      // 8. Always release the Distributed Lock
      await lockService.releaseLock(lockResource, lockToken);
    }
  }

  getSnapshot() {
    return {
      accounts: this.accounts,
      stats: this.stats,
      workers: this.workers,
      ledgerSize: this.ledger.length,
      kafkaMetrics: kafkaProducer.getMetrics(),
    };
  }
}

module.exports = new TransactionService();
