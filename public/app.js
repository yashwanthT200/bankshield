// BankShield Frontend Application
let currentMode = 'dockerized'; // 'dockerized' | 'naive'
let balanceChart = null;
let chartTimeLabels = [];
let senderBalanceHistory = [1000];
let recipientBalanceHistory = [0];
let worker2Healthy = true;
let isOfflineMode = false;

// In-Browser Simulation Engine (Fallback for static hosting / GitHub Pages)
const clientState = {
  accounts: {
    'ACC-94821': { name: 'Alice', balance: 1000.0 },
    'ACC-33120': { name: 'Bob', balance: 0.0 },
  },
  stats: {
    naive: { raceConditionsDetected: 0, totalRequests: 0, approved: 0 },
    dockerized: { raceConditionsDetected: 0, totalRequests: 0, approved: 0 },
  },
  workers: [
    { id: 'Worker-1', handled: 0, status: 'HEALTHY' },
    { id: 'Worker-2', handled: 0, status: 'HEALTHY' },
  ],
  kafkaMetrics: { totalPublished: 0 },
  auditMetrics: { consumerLag: 0 },
  ledgerSize: 0,
};

// Initialize on DOM Load
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  connectSSE();
  fetchState();
});

// Initialize Chart.js
function initChart() {
  const ctx = document.getElementById('balanceChart').getContext('2d');
  const now = new Date().toLocaleTimeString();
  chartTimeLabels = [now];

  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: chartTimeLabels,
      datasets: [
        {
          label: 'Sender Balance (Alice)',
          data: senderBalanceHistory,
          borderColor: '#06b6d4', // Cyan
          backgroundColor: 'rgba(6, 182, 212, 0.1)',
          fill: true,
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2,
        },
        {
          label: 'Recipient Balance (Bob)',
          data: recipientBalanceHistory,
          borderColor: '#10b981', // Emerald
          backgroundColor: 'transparent',
          borderDash: [4, 4],
          tension: 0.3,
          borderWidth: 2,
          pointRadius: 2,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: { color: '#64748b', font: { family: 'monospace', size: 10 } },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.05)' },
          ticks: {
            color: '#64748b',
            font: { family: 'monospace', size: 10 },
            callback: (val) => '$' + val,
          },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#cbd5e1', font: { family: 'monospace', size: 11 } },
        },
      },
    },
  });
}

function updateChart(senderBalance, recipientBalance) {
  if (!balanceChart) return;
  const timeStr = new Date().toLocaleTimeString();
  chartTimeLabels.push(timeStr);
  senderBalanceHistory.push(senderBalance);
  recipientBalanceHistory.push(recipientBalance);

  if (chartTimeLabels.length > 20) {
    chartTimeLabels.shift();
    senderBalanceHistory.shift();
    recipientBalanceHistory.shift();
  }

  balanceChart.update();
}

// Mode Selector Toggle
function setMode(mode) {
  currentMode = mode;
  const naiveBtn = document.getElementById('mode-naive-btn');
  const dockerBtn = document.getElementById('mode-docker-btn');
  const banner = document.getElementById('mode-banner');
  const bannerTitle = document.getElementById('banner-title');
  const bannerDesc = document.getElementById('banner-desc');

  if (mode === 'naive') {
    naiveBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2 bg-gradient-to-r from-amber-500 to-rose-600 text-white shadow-lg shadow-amber-500/25';
    dockerBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2 text-slate-400 hover:text-white';

    banner.className = 'p-4 rounded-xl border transition-all duration-300 flex items-center justify-between bg-amber-950/20 border-amber-800/40 text-amber-200';
    bannerTitle.innerText = 'LOCAL / NAIVE MODE ACTIVE (VULNERABLE)';
    bannerTitle.className = 'font-bold text-sm text-amber-400';
    bannerDesc.innerText = 'Unsynchronized I/O without locks or load balancing. High concurrency will trigger double-spending and balance corruption.';
  } else {
    dockerBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2 bg-gradient-to-r from-cyan-500 to-blue-600 text-white shadow-lg shadow-cyan-500/25';
    naiveBtn.className = 'px-4 py-2 rounded-lg text-xs font-bold transition-all duration-200 flex items-center space-x-2 text-slate-400 hover:text-white';

    banner.className = 'p-4 rounded-xl border transition-all duration-300 flex items-center justify-between bg-cyan-950/20 border-cyan-800/40 text-cyan-200';
    bannerTitle.innerText = 'DOCKERIZED RESILIENT CLUSTER ACTIVE';
    bannerTitle.className = 'font-bold text-sm text-cyan-300';
    bannerDesc.innerText = 'Protected by Nginx Round-Robin, Redis Distributed Mutex (Redlock), PostgreSQL ACID row-locking, and Apache Kafka Event Sourcing.';
  }
}

// Fetch Full System State
async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    isOfflineMode = false;
    renderState(data);
  } catch (err) {
    // Client-side simulation fallback (e.g., when hosted on GitHub Pages)
    isOfflineMode = true;
    renderState(clientState);
  }
}

// Render State to UI
function renderState(data) {
  const alice = data.accounts['ACC-94821'];
  const bob = data.accounts['ACC-33120'];

  // 1. Balances
  const senderEl = document.getElementById('sender-balance');
  senderEl.innerText = `$${alice.balance.toFixed(2)}`;
  if (alice.balance < 0) {
    senderEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-rose-500 animate-pulse';
  } else {
    senderEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-white';
  }

  const diffAlice = (1000 - alice.balance).toFixed(2);
  document.getElementById('sender-diff').innerText = `$${diffAlice} withdrawn`;

  document.getElementById('recipient-balance').innerText = `$${bob.balance.toFixed(2)}`;
  document.getElementById('recipient-diff').innerText = `+$${bob.balance.toFixed(2)} received`;

  // 2. Metrics (Naive vs Dockerized)
  const currentStats = data.stats[currentMode];
  const raceCountEl = document.getElementById('race-condition-count');
  raceCountEl.innerText = currentStats.raceConditionsDetected;
  if (currentStats.raceConditionsDetected > 0) {
    raceCountEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-rose-500 animate-pulse';
    document.getElementById('race-condition-status').innerText = 'CRITICAL: Money Leaked!';
    document.getElementById('race-condition-status').className = 'text-rose-400 font-bold';
  } else {
    raceCountEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-emerald-400';
    document.getElementById('race-condition-status').innerText = 'Protection Active';
    document.getElementById('race-condition-status').className = 'text-slate-400';
  }

  // 3. Discrepancy Invariant Check: Sum(Alice + Bob) should always === $1,000.00
  const totalMoney = alice.balance + bob.balance;
  const discrepancy = totalMoney - 1000.0;
  const discrepancyEl = document.getElementById('discrepancy-metric');
  if (Math.abs(discrepancy) > 0.01) {
    discrepancyEl.innerText = `-$${Math.abs(discrepancy).toFixed(2)}`;
    discrepancyEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-rose-500 animate-pulse';
    document.getElementById('discrepancy-status').innerText = 'VIOLATION DETECTED';
    document.getElementById('discrepancy-status').className = 'text-rose-400 font-bold';
  } else {
    discrepancyEl.innerText = '$0.00';
    discrepancyEl.className = 'text-3xl font-extrabold tracking-tight font-mono text-emerald-400';
    document.getElementById('discrepancy-status').innerText = '100% Balanced';
    document.getElementById('discrepancy-status').className = 'text-slate-400';
  }

  // 4. Workers State
  if (data.workers) {
    const w1 = data.workers.find((w) => w.id === 'Worker-1');
    const w2 = data.workers.find((w) => w.id === 'Worker-2');
    if (w1) document.getElementById('worker1-handled').innerText = `Handled: ${w1.handled} reqs`;
    if (w2) {
      document.getElementById('worker2-handled').innerText = `Handled: ${w2.handled} reqs`;
      worker2Healthy = w2.status === 'HEALTHY';
      updateWorker2Visuals(worker2Healthy);
    }
  }

  // 5. Kafka Metrics
  if (data.kafkaMetrics) {
    document.getElementById('kafka-total-msg').innerText = `Events: ${data.kafkaMetrics.totalPublished} msgs`;
  }
  if (data.auditMetrics) {
    document.getElementById('consumer-lag').innerText = `${data.auditMetrics.consumerLag} messages`;
  }

  // 6. Ledger Count
  document.getElementById('ledger-count').innerText = `${data.ledgerSize || 0} Ledger Records`;

  updateChart(alice.balance, bob.balance);
}

// Trigger High-Concurrency Attack
async function triggerStressTest() {
  const count = parseInt(document.getElementById('concurrent-slider').value) || 200;
  const amount = parseFloat(document.getElementById('amount-slider').value) || 100;

  const btn = document.getElementById('stress-btn');
  const btnText = document.getElementById('stress-btn-text');
  btn.disabled = true;
  btnText.innerText = `EXECUTING ${count} CONCURRENT REQUESTS...`;

  try {
    const res = await fetch('/api/stress-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ count, amount, mode: currentMode }),
    });

    if (!res.ok) throw new Error('API offline');
    const summary = await res.json();
    document.getElementById('metrics-rps').innerText = `${summary.throughputRps} req/s`;
    document.getElementById('metrics-latency').innerText = `${Math.round(summary.durationMs / (count / 10))}ms`;

    if (summary.snapshot) {
      renderState(summary.snapshot);
    }
  } catch (err) {
    // Client-side simulation fallback for GitHub Pages
    simulateClientBurst(count, amount, currentMode);
  } finally {
    btn.disabled = false;
    btnText.innerText = 'LAUNCH CONCURRENT ATTACK';
  }
}

// Client-side fallback simulation engine
function simulateClientBurst(count, amount, mode) {
  const alice = clientState.accounts['ACC-94821'];
  const bob = clientState.accounts['ACC-33120'];

  if (mode === 'naive') {
    // Naive race condition: allows far more transfers than balance permits
    const approved = Math.min(count, Math.floor(alice.balance / amount) + Math.floor(count * 0.35));
    const leaked = (approved * amount) - alice.balance;
    alice.balance -= approved * amount;
    bob.balance += approved * amount;
    clientState.stats.naive.raceConditionsDetected += Math.max(1, Math.floor(approved * 0.4));
    clientState.stats.naive.approved += approved;

    document.getElementById('metrics-rps').innerText = `${Math.floor(250 + Math.random() * 150)} req/s`;
    document.getElementById('metrics-latency').innerText = '48ms';
  } else {
    // Dockerized mode: strictly allows only what balance permits
    const maxPossible = Math.max(0, Math.floor(alice.balance / amount));
    const approved = Math.min(count, maxPossible);
    alice.balance -= approved * amount;
    bob.balance += approved * amount;
    clientState.stats.dockerized.approved += approved;

    // Publish simulated Kafka events
    for (let i = 0; i < approved; i++) {
      clientState.kafkaMetrics.totalPublished++;
      appendKafkaEvent({
        partition: i % 3,
        offset: clientState.kafkaMetrics.totalPublished,
        eventType: 'TRANSFER_SUCCESS',
        payload: { amount, toAccount: 'ACC-33120' },
        timestamp: new Date().toISOString(),
      });
      appendLedgerRow({
        txId: `TXN-PROD-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        fromAccount: 'ACC-94821',
        toAccount: 'ACC-33120',
        amount,
        senderNewBalance: alice.balance,
        workerId: i % 2 === 0 ? 'Worker-1' : 'Worker-2',
      });
    }

    clientState.ledgerSize += approved;
    document.getElementById('metrics-rps').innerText = `${Math.floor(750 + Math.random() * 300)} req/s`;
    document.getElementById('metrics-latency').innerText = '14ms';
  }

  renderState(clientState);
}

// Single Transfer Tap
async function sendSingleTransfer() {
  const amount = parseFloat(document.getElementById('amount-slider').value) || 100;
  try {
    const res = await fetch('/api/transfer', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Idempotency-Key': `IDEMP-${Date.now()}`,
      },
      body: JSON.stringify({
        fromAccount: 'ACC-94821',
        toAccount: 'ACC-33120',
        amount,
        mode: currentMode,
      }),
    });
    if (!res.ok) throw new Error('Offline');
    await res.json();
    fetchState();
  } catch (err) {
    simulateClientBurst(1, amount, currentMode);
  }
}

// Chaos Monkey: Toggle Worker 2
async function toggleChaos() {
  try {
    const res = await fetch('/api/chaos/toggle-worker', { method: 'POST' });
    if (!res.ok) throw new Error('Offline');
    const data = await res.json();
    if (data.worker) {
      worker2Healthy = data.worker.status === 'HEALTHY';
      updateWorker2Visuals(worker2Healthy);
    }
  } catch (err) {
    worker2Healthy = !worker2Healthy;
    updateWorker2Visuals(worker2Healthy);
  }
}

// Reset System
async function resetSystem() {
  try {
    await fetch('/api/reset', { method: 'POST' });
  } catch (e) {
    // Offline reset
  }
  clientState.accounts['ACC-94821'].balance = 1000.0;
  clientState.accounts['ACC-33120'].balance = 0.0;
  clientState.stats.naive.raceConditionsDetected = 0;
  clientState.stats.dockerized.raceConditionsDetected = 0;
  clientState.ledgerSize = 0;
  clientState.kafkaMetrics.totalPublished = 0;

  const terminal = document.getElementById('kafka-feed');
  terminal.innerHTML = '<div class="text-slate-500 text-[11px]">// System reset. Ready for attack.</div>';
  const table = document.getElementById('ledger-table-body');
  table.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500">No transactions recorded yet.</td></tr>';
  fetchState();
}
  const dot = document.getElementById('worker2-status-dot');
  const badge = document.getElementById('worker2-status-badge');
  const btnText = document.getElementById('chaos-btn-text');

  if (healthy) {
    dot.className = 'w-2 h-2 rounded-full bg-emerald-400';
    badge.className = 'mt-2 text-[10px] text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded font-mono';
    badge.innerText = 'STATUS: HEALTHY';
    btnText.innerText = 'Kill Worker-2';
  } else {
    dot.className = 'w-2 h-2 rounded-full bg-rose-500 animate-ping';
    badge.className = 'mt-2 text-[10px] text-rose-400 bg-rose-950/60 px-2 py-0.5 rounded font-mono';
    badge.innerText = 'STATUS: CRASHED (OFFLINE)';
    btnText.innerText = 'Revive Worker-2';
  }
}

// Reset System
async function resetSystem() {
  await fetch('/api/reset', { method: 'POST' });
  const terminal = document.getElementById('kafka-feed');
  terminal.innerHTML = '<div class="text-slate-500 text-[11px]">// System reset. Ready for attack.</div>';
  const table = document.getElementById('ledger-table-body');
  table.innerHTML = '<tr><td colspan="7" class="py-4 text-center text-slate-500">No transactions recorded yet.</td></tr>';
  fetchState();
}

// Connect Real-Time Server-Sent Events (SSE)
function connectSSE() {
  const eventSource = new EventSource('/events');

  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'KAFKA_EVENT') {
        appendKafkaEvent(parsed.data);
      } else if (parsed.type === 'TRANSACTION_COMPLETE') {
        fetchState();
        if (parsed.data.result && parsed.data.result.success) {
          appendLedgerRow(parsed.data.result);
        }
      } else if (parsed.type === 'SYSTEM_RESET') {
        fetchState();
      }
    } catch (e) {
      console.error('Error parsing SSE:', e);
    }
  };

  eventSource.onerror = () => {
    // Retry connection automatically
    setTimeout(connectSSE, 3000);
  };
}

// Append Kafka Event Pill into Terminal
function appendKafkaEvent(event) {
  const feed = document.getElementById('kafka-feed');
  const item = document.createElement('div');
  item.className = 'p-1.5 rounded bg-slate-900 border border-slate-800 text-[11px] font-mono flex items-center justify-between hover:border-slate-700 transition';

  const partitionColors = ['text-cyan-400', 'text-amber-400', 'text-purple-400'];
  const pColor = partitionColors[event.partition % 3];

  item.innerHTML = `
    <div class="flex items-center space-x-2">
      <span class="px-1.5 py-0.2 rounded bg-slate-800 ${pColor} font-bold text-[10px]">P${event.partition}:${event.offset}</span>
      <span class="text-slate-300 font-semibold">${event.eventType}</span>
      <span class="text-slate-400">$${event.payload.amount} -> ${event.payload.toAccount}</span>
    </div>
    <span class="text-slate-500 text-[10px]">${new Date(event.timestamp).toLocaleTimeString()}</span>
  `;

  feed.prepend(item);
  if (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

// Append Ledger Row into Double-Entry Table
function appendLedgerRow(res) {
  const tbody = document.getElementById('ledger-table-body');
  if (tbody.children[0] && tbody.children[0].children.length === 1) {
    tbody.innerHTML = '';
  }

  const tr = document.createElement('tr');
  tr.className = 'hover:bg-slate-800/40 transition font-mono text-[11px]';
  tr.innerHTML = `
    <td class="py-2 text-cyan-400">${res.txId}</td>
    <td class="py-2 text-slate-300">${res.fromAccount}</td>
    <td class="py-2 text-slate-300">${res.toAccount}</td>
    <td class="py-2 text-emerald-400 font-bold">$${res.amount.toFixed(2)}</td>
    <td class="py-2 text-slate-300">$${res.senderNewBalance.toFixed(2)}</td>
    <td class="py-2 text-slate-400">${res.workerId || 'Worker-1'}</td>
    <td class="py-2 text-right"><span class="px-2 py-0.5 rounded text-[10px] bg-emerald-950/70 border border-emerald-800/50 text-emerald-300">ACID VERIFIED</span></td>
  `;

  tbody.prepend(tr);
  if (tbody.children.length > 15) tbody.removeChild(tbody.lastChild);
}
