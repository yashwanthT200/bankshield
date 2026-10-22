const http = require('http');
const fs = require('fs');
const path = require('path');
const url = require('url');

const transactionService = require('./services/transaction_service');
const kafkaProducer = require('./services/kafka_producer');
const auditConsumer = require('./services/audit_consumer');

const PORT = process.env.PORT || 3000;
const PUBLIC_DIR = path.join(__dirname, 'public');

// Connected SSE clients for live telemetry broadcast
const sseClients = new Set();

function broadcastEvent(eventType, data) {
  const payload = `data: ${JSON.stringify({ type: eventType, data, timestamp: Date.now() })}\n\n`;
  for (const client of sseClients) {
    try {
      client.write(payload);
    } catch (e) {
      sseClients.delete(client);
    }
  }
}

// Broadcast Kafka events to UI in real time
kafkaProducer.subscribe((event) => {
  broadcastEvent('KAFKA_EVENT', event);
});

// Helper to parse JSON body
function parseJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);
  const pathname = parsedUrl.pathname;

  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Idempotency-Key');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    return res.end();
  }

  // --- 1. SSE Real-time Telemetry Stream ---
  if (pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    });
    res.write(`data: ${JSON.stringify({ type: 'CONNECTED', timestamp: Date.now() })}\n\n`);
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  // --- 2. API Endpoints ---
  if (pathname.startsWith('/api/')) {
    res.setHeader('Content-Type', 'application/json');

    // GET /api/state - Full system state
    if (pathname === '/api/state' && req.method === 'GET') {
      const state = {
        ...transactionService.getSnapshot(),
        auditMetrics: auditConsumer.getMetrics(),
        timestamp: Date.now(),
      };
      res.writeHead(200);
      return res.end(JSON.stringify(state));
    }

    // POST /api/transfer - Single Transfer
    if (pathname === '/api/transfer' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const { fromAccount, toAccount, amount, mode, idempotencyKey } = body;

        let result;
        if (mode === 'naive') {
          result = await transactionService.executeNaiveTransfer(
            fromAccount || 'ACC-94821',
            toAccount || 'ACC-33120',
            parseFloat(amount) || 100.0,
            idempotencyKey
          );
        } else {
          result = await transactionService.executeDistributedTransfer(
            fromAccount || 'ACC-94821',
            toAccount || 'ACC-33120',
            parseFloat(amount) || 100.0,
            idempotencyKey
          );
        }

        broadcastEvent('TRANSACTION_COMPLETE', { result, mode });
        res.writeHead(result.status || 200);
        return res.end(JSON.stringify(result));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // POST /api/stress-test - High-Concurrency Burst Simulation
    if (pathname === '/api/stress-test' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        const count = Math.min(parseInt(body.count) || 100, 1000);
        const mode = body.mode || 'dockerized';
        const amount = parseFloat(body.amount) || 100.0;
        const fromAccount = body.fromAccount || 'ACC-94821';
        const toAccount = body.toAccount || 'ACC-33120';

        const startTime = Date.now();
        const promises = [];

        // Launch all concurrent requests simultaneously
        for (let i = 0; i < count; i++) {
          const idempotencyKey = `REQ-${Date.now()}-${i}-${Math.random().toString(36).substring(2, 7)}`;
          if (mode === 'naive') {
            promises.push(transactionService.executeNaiveTransfer(fromAccount, toAccount, amount, idempotencyKey));
          } else {
            promises.push(transactionService.executeDistributedTransfer(fromAccount, toAccount, amount, idempotencyKey));
          }
        }

        const results = await Promise.all(promises);
        const duration = Date.now() - startTime;
        const approved = results.filter((r) => r.success).length;
        const rejected = results.filter((r) => !r.success).length;

        const summary = {
          mode,
          total: count,
          approved,
          rejected,
          durationMs: duration,
          throughputRps: Math.round((count / (duration / 1000)) * 10) / 10,
          snapshot: transactionService.getSnapshot(),
        };

        broadcastEvent('STRESS_TEST_COMPLETE', summary);
        res.writeHead(200);
        return res.end(JSON.stringify(summary));
      } catch (err) {
        res.writeHead(500);
        return res.end(JSON.stringify({ success: false, error: err.message }));
      }
    }

    // POST /api/reset - Reset Bank Balances
    if (pathname === '/api/reset' && req.method === 'POST') {
      transactionService.resetState();
      auditConsumer.clear();
      broadcastEvent('SYSTEM_RESET', { timestamp: Date.now() });
      res.writeHead(200);
      return res.end(JSON.stringify({ success: true, message: 'All accounts and statistics reset to default' }));
    }

    // POST /api/chaos/toggle-worker - Kill or Revive Worker 2
    if (pathname === '/api/chaos/toggle-worker' && req.method === 'POST') {
      const worker2 = transactionService.workers.find((w) => w.id === 'Worker-2');
      if (worker2) {
        worker2.status = worker2.status === 'HEALTHY' ? 'CRASHED_OFFLINE' : 'HEALTHY';
        broadcastEvent('WORKER_STATUS_CHANGED', worker2);
        res.writeHead(200);
        return res.end(JSON.stringify({ success: true, worker: worker2 }));
      }
      res.writeHead(404);
      return res.end(JSON.stringify({ success: false, message: 'Worker not found' }));
    }

    res.writeHead(404);
    return res.end(JSON.stringify({ error: 'API endpoint not found' }));
  }

  // --- 3. Static File Serving (Frontend Dashboard) ---
  let filePath = path.join(PUBLIC_DIR, pathname === '/' ? 'index.html' : pathname);
  const ext = path.extname(filePath).toLowerCase();

  const mimeTypes = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.png': 'image/png',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
  };

  const contentType = mimeTypes[ext] || 'application/octet-stream';

  fs.readFile(filePath, (err, content) => {
    if (err) {
      if (err.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('404 Not Found');
      } else {
        res.writeHead(500);
        res.end(`Server Error: ${err.code}`);
      }
    } else {
      res.writeHead(200, { 'Content-Type': contentType });
      res.end(content, 'utf-8');
    }
  });
});

server.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(`🛡️  BANKSHIELD CORE PLATFORM READY`);
  console.log(`🚀 Mode: Local & Docker Ready`);
  console.log(`🌐 Server running at: http://localhost:${PORT}`);
  console.log(`=======================================================`);
});
