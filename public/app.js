// BankShield Enterprise Systems Observatory Controller
let currentMode = 'dockerized'; // 'dockerized' | 'naive'
let balanceChart = null;
let chartTimeLabels = [];
let senderBalanceHistory = [1000];
let recipientBalanceHistory = [0];
let worker2Healthy = true;
let isOfflineMode = false;

// Client-side state fallback for static hosting / GitHub Pages
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

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  initChart();
  connectSSE();
  fetchState();
});

// Setup Chart.js with Minimalist Swiss Grid Aesthetics
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
          label: 'Alice (Source)',
          data: senderBalanceHistory,
          borderColor: '#22d3ee', // Cyan-400
          backgroundColor: 'rgba(34, 211, 238, 0.05)',
          fill: true,
          tension: 0.1,
          borderWidth: 1.5,
          pointRadius: 1,
        },
        {
          label: 'Bob (Target)',
          data: recipientBalanceHistory,
          borderColor: '#34d399', // Emerald-400
          backgroundColor: 'transparent',
          borderDash: [3, 3],
          tension: 0.1,
          borderWidth: 1.5,
          pointRadius: 1,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: { color: '#71717a', font: { family: 'JetBrains Mono', size: 10 } },
        },
        y: {
          grid: { color: 'rgba(255, 255, 255, 0.03)' },
          ticks: {
            color: '#71717a',
            font: { family: 'JetBrains Mono', size: 10 },
            callback: (val) => '$' + val,
          },
        },
      },
      plugins: {
        legend: {
          labels: { color: '#a1a1aa', font: { family: 'JetBrains Mono', size: 10 } },
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

  if (chartTimeLabels.length > 25) {
    chartTimeLabels.shift();
    senderBalanceHistory.shift();
    recipientBalanceHistory.shift();
  }

  balanceChart.update();
}

// Architecture Mode Switcher
function setMode(mode) {
  currentMode = mode;
  const naiveBtn = document.getElementById('mode-naive-btn');
  const dockerBtn = document.getElementById('mode-docker-btn');
  const ingress = document.getElementById('arch-ingress');
  const lock = document.getElementById('arch-lock');
  const db = document.getElementById('arch-db');
  const kafka = document.getElementById('arch-kafka');

  if (mode === 'naive') {
    naiveBtn.className = 'px-3 py-1 rounded text-xs font-mono transition bg-zinc-800 text-amber-400 font-medium shadow-sm';
    dockerBtn.className = 'px-3 py-1 rounded text-xs font-mono transition text-zinc-400 hover:text-zinc-200';

    ingress.innerText = 'Direct Ingress (No Load Balancer)';
    lock.innerText = 'None (Unsynchronized Shared State)';
    db.innerText = 'Unbuffered In-Memory (No Row Lock)';
    kafka.innerText = 'Bypassed (Synchronous Monolith)';
  } else {
    dockerBtn.className = 'px-3 py-1 rounded text-xs font-mono transition bg-zinc-800 text-zinc-100 font-medium shadow-sm';
    naiveBtn.className = 'px-3 py-1 rounded text-xs font-mono transition text-zinc-400 hover:text-zinc-200';

    ingress.innerText = 'Nginx Layer-7 Round-Robin';
    lock.innerText = 'Redis 7 Distributed Mutex (Redlock)';
    db.innerText = 'PostgreSQL 15 (SELECT FOR UPDATE)';
    kafka.innerText = 'Apache Kafka KRaft (3 partitions)';
  }
}

// Fetch State
async function fetchState() {
  try {
    const res = await fetch('/api/state');
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    isOfflineMode = false;
    renderState(data);
  } catch (err) {
    isOfflineMode = true;
    renderState(clientState);
  }
}

// Render State
function renderState(data) {
  const alice = data.accounts['ACC-94821'];
  const bob = data.accounts['ACC-33120'];

  // Sender
  const senderEl = document.getElementById('sender-balance');
  senderEl.innerText = `$${alice.balance.toFixed(2)}`;
  if (alice.balance < 0) {
    senderEl.className = 'text-2xl font-bold tracking-tight text-rose-500 font-mono';
  } else {
    senderEl.className = 'text-2xl font-bold tracking-tight text-zinc-100 font-mono';
  }

  const diffAlice = (1000 - alice.balance).toFixed(2);
  document.getElementById('sender-diff').innerText = `$${diffAlice} withdrawn`;

  // Recipient
  document.getElementById('recipient-balance').innerText = `$${bob.balance.toFixed(2)}`;
  document.getElementById('recipient-diff').innerText = `+$${bob.balance.toFixed(2)} received`;

  // Race Conditions
  const currentStats = data.stats[currentMode];
  const raceCountEl = document.getElementById('race-condition-count');
  raceCountEl.innerText = currentStats.raceConditionsDetected;
  if (currentStats.raceConditionsDetected > 0) {
    raceCountEl.className = 'text-2xl font-bold tracking-tight text-rose-500 font-mono';
    document.getElementById('race-condition-status').innerText = `${currentStats.raceConditionsDetected} Anomalies Detected`;
    document.getElementById('race-condition-status').className = 'text-rose-400 font-mono';
  } else {
    raceCountEl.className = 'text-2xl font-bold tracking-tight text-emerald-400 font-mono';
    document.getElementById('race-condition-status').innerText = '0 Violations';
    document.getElementById('race-condition-status').className = 'text-zinc-500 font-mono';
  }

  // Discrepancy Invariant: Sum(Alice + Bob) === $1,000.00
  const totalMoney = alice.balance + bob.balance;
  const discrepancy = totalMoney - 1000.0;
  const discrepancyEl = document.getElementById('discrepancy-metric');
  if (Math.abs(discrepancy) > 0.01) {
    discrepancyEl.innerText = `-$${Math.abs(discrepancy).toFixed(2)}`;
    discrepancyEl.className = 'text-2xl font-bold tracking-tight text-rose-500 font-mono';
    document.getElementById('discrepancy-status').innerText = 'Conservation Violated';
    document.getElementById('discrepancy-status').className = 'text-rose-400 font-mono';
  } else {
    discrepancyEl.innerText = '$0.00';
    discrepancyEl.className = 'text-2xl font-bold tracking-tight text-emerald-400 font-mono';
    document.getElementById('discrepancy-status').innerText = 'Conservation Valid';
    document.getElementById('discrepancy-status').className = 'text-zinc-500 font-mono';
  }

  // Topology Nodes
  if (data.workers) {
    const w1 = data.workers.find((w) => w.id === 'Worker-1');
    const w2 = data.workers.find((w) => w.id === 'Worker-2');
    if (w1) document.getElementById('worker1-handled').innerText = `${w1.handled} reqs • HEALTHY`;
    if (w2) {
      worker2Healthy = w2.status === 'HEALTHY';
      document.getElementById('worker2-handled').innerText = `${w2.handled} reqs • ${worker2Healthy ? 'HEALTHY' : 'OFFLINE'}`;
      updateWorker2Visuals(worker2Healthy);
    }
  }

  // Kafka stats
  if (data.kafkaMetrics) {
    document.getElementById('kafka-total-msg').innerText = `3 Partitions • ${data.kafkaMetrics.totalPublished} msgs`;
  }
  if (data.auditMetrics) {
    document.getElementById('consumer-lag').innerText = `${data.auditMetrics.consumerLag} msgs`;
  }

  document.getElementById('ledger-count').innerText = `${data.ledgerSize || 0} Recorded Mutations`;

  updateChart(alice.balance, bob.balance);
}

// Trigger High-Concurrency Attack
async function triggerStressTest() {
  const count = parseInt(document.getElementById('concurrent-slider').value) || 200;
  const amount = parseFloat(document.getElementById('amount-slider').value) || 100;

  const btn = document.getElementById('stress-btn');
  const btnText = document.getElementById('stress-btn-text');
  btn.disabled = true;
  btnText.innerText = `Executing ${count} concurrent requests...`;

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
    simulateClientBurst(count, amount, currentMode);
  } finally {
    btn.disabled = false;
    btnText.innerText = 'Execute Concurrent Burst';
  }
}

// Client simulation fallback
function simulateClientBurst(count, amount, mode) {
  const alice = clientState.accounts['ACC-94821'];
  const bob = clientState.accounts['ACC-33120'];

  if (mode === 'naive') {
    const approved = Math.min(count, Math.floor(alice.balance / amount) + Math.floor(count * 0.35));
    alice.balance -= approved * amount;
    bob.balance += approved * amount;
    clientState.stats.naive.raceConditionsDetected += Math.max(1, Math.floor(approved * 0.4));
    clientState.stats.naive.approved += approved;

    document.getElementById('metrics-rps').innerText = `${Math.floor(250 + Math.random() * 150)} req/s`;
    document.getElementById('metrics-latency').innerText = '42ms';
  } else {
    const maxPossible = Math.max(0, Math.floor(alice.balance / amount));
    const approved = Math.min(count, maxPossible);
    alice.balance -= approved * amount;
    bob.balance += approved * amount;
    clientState.stats.dockerized.approved += approved;

    for (let i = 0; i < approved; i++) {
      clientState.kafkaMetrics.totalPublished++;
      appendKafkaEvent({
        partition: i % 3,
        offset: clientState.kafkaMetrics.totalPublished,
        eventType: 'TRANSFER_COMMITTED',
        payload: { amount, toAccount: 'ACC-33120' },
        timestamp: new Date().toISOString(),
      });
      appendLedgerRow({
        txId: `0x${Math.random().toString(16).substring(2, 10)}`,
        fromAccount: 'ACC-94821',
        toAccount: 'ACC-33120',
        amount,
        senderNewBalance: alice.balance,
        workerId: i % 2 === 0 ? 'api-worker-1' : 'api-worker-2',
      });
    }

    clientState.ledgerSize += approved;
    document.getElementById('metrics-rps').innerText = `${Math.floor(820 + Math.random() * 200)} req/s`;
    document.getElementById('metrics-latency').innerText = '11ms';
  }

  renderState(clientState);
}

// Single Transfer
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

// Chaos Toggle
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

function updateWorker2Visuals(healthy) {
  const indicator = document.getElementById('chaos-indicator');
  const text = document.getElementById('chaos-text');
  const w2Mesh = document.getElementById('mesh-w2');

  if (healthy) {
    indicator.className = 'w-1.5 h-1.5 rounded-full bg-amber-400';
    text.innerText = 'Inject Worker-2 Failure';
    if (w2Mesh) w2Mesh.querySelector('span:last-child').className = 'text-zinc-300 text-[11px]';
  } else {
    indicator.className = 'w-1.5 h-1.5 rounded-full bg-rose-500 animate-ping';
    text.innerText = 'Restore Worker-2 (Online)';
    if (w2Mesh) w2Mesh.querySelector('span:last-child').className = 'text-rose-400 text-[11px] font-semibold';
  }
}

// Reset System
async function resetSystem() {
  try {
    await fetch('/api/reset', { method: 'POST' });
  } catch (e) {}

  clientState.accounts['ACC-94821'].balance = 1000.0;
  clientState.accounts['ACC-33120'].balance = 0.0;
  clientState.stats.naive.raceConditionsDetected = 0;
  clientState.stats.dockerized.raceConditionsDetected = 0;
  clientState.ledgerSize = 0;
  clientState.kafkaMetrics.totalPublished = 0;

  const terminal = document.getElementById('kafka-feed');
  terminal.innerHTML = '<div class="text-zinc-600">// Kafka broker subscribed. Listening for partition commits...</div>';
  const table = document.getElementById('ledger-table-body');
  table.innerHTML = '<tr><td colspan="7" class="py-3 text-center text-zinc-600">Ledger empty. Trigger transactions to initiate mutations.</td></tr>';
  fetchState();
}

// Connect SSE
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
      console.error(e);
    }
  };

  eventSource.onerror = () => {
    setTimeout(connectSSE, 4000);
  };
}

// Append Kafka Event
function appendKafkaEvent(event) {
  const feed = document.getElementById('kafka-feed');
  const item = document.createElement('div');
  item.className = 'py-0.5 text-zinc-400 font-mono flex items-center justify-between border-b border-zinc-900/50';

  const partitionPill = `<span class="text-amber-400 font-semibold">[P${event.partition}:offset_${event.offset}]</span>`;
  const timeStr = new Date(event.timestamp).toLocaleTimeString();

  item.innerHTML = `
    <div class="flex items-center space-x-2">
      ${partitionPill}
      <span class="text-zinc-200">${event.eventType}</span>
      <span class="text-zinc-500">$${event.payload.amount} -> ${event.payload.toAccount}</span>
    </div>
    <span class="text-zinc-600 text-[10px]">${timeStr}</span>
  `;

  feed.prepend(item);
  if (feed.children.length > 50) feed.removeChild(feed.lastChild);
}

// Append Ledger Row
function appendLedgerRow(res) {
  const tbody = document.getElementById('ledger-table-body');
  if (tbody.children[0] && tbody.children[0].children.length === 1) {
    tbody.innerHTML = '';
  }

  const tr = document.createElement('tr');
  tr.className = 'font-mono text-xs';
  tr.innerHTML = `
    <td class="py-1.5 text-zinc-300 font-mono">${res.txId}</td>
    <td class="py-1.5 text-zinc-400">${res.fromAccount}</td>
    <td class="py-1.5 text-zinc-400">${res.toAccount}</td>
    <td class="py-1.5 text-emerald-400 font-semibold">$${res.amount.toFixed(2)}</td>
    <td class="py-1.5 text-zinc-300 font-semibold">$${res.senderNewBalance.toFixed(2)}</td>
    <td class="py-1.5 text-zinc-500">${res.workerId || 'api-worker-1'}</td>
    <td class="py-1.5 text-right"><span class="text-emerald-400 text-[10px]">ACID_STRICT</span></td>
  `;

  tbody.prepend(tr);
  if (tbody.children.length > 20) tbody.removeChild(tbody.lastChild);
}
