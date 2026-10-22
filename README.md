# 🛡️ BankShield: High-Concurrency Distributed Banking Platform

> **An Enterprise-Grade Banking Engine demonstrating Concurrency Control, Distributed Mutex Locks, ACID Ledger Transactions, Apache Kafka Event Sourcing, and Docker Microservices Orchestration.**

---

## 📌 Executive Summary & Novelty
In financial systems (e.g., Stripe, UPI, PayPal), thousands of requests hit accounts simultaneously. If two requests withdraw \$500 from an account that only has \$500 at the exact same millisecond, a standard uncoordinated system suffers a **race condition**, leading to double-spending, data corruption, and negative balances.

**BankShield** provides a live, side-by-side comparative laboratory:
1. **Local / Naive Mode:** Simulates an uncoordinated monolith. Shows live money leakage (`-$2,400`) and race condition explosions under high traffic.
2. **Dockerized Resilient Cluster:** Orchestrates an Nginx reverse proxy, horizontally scaled API replicas, Redis 7 distributed locks (`Redlock`), PostgreSQL 15 ACID row-locking (`FOR UPDATE`), and Apache Kafka event sourcing. Guarantees **0% race conditions** and **\$0.00 discrepancy**.

---

## 🏗️ System Architecture

```
                                [ 🌐 Edge Client / Browser ]
                                              │
                                              ▼
                             [ 🔀 Nginx Gateway (:80 / :3000) ]
                                    (Round-Robin Ingress)
                                       /              \
                                      ▼                ▼
            [ ⚙️ API Worker-1 (:8001) ]            [ ⚙️ API Worker-2 (:8002) ]
                                      \                /
                                       ▼              ▼
                               ┌──────────────────────────────┐
                               │   ⚡ Redis 7 Lock Service    │
                               │  (Distributed Mutex + Redlock)│
                               └──────────────┬───────────────┘
                                              │
                                              ▼
                               ┌──────────────────────────────┐
                               │  🗄️ PostgreSQL 15 ACID DB    │
                               │   (Row-Level Locks: FOR UPDATE)│
                               └──────────────┬───────────────┘
                                              │ (Publishes Financial Events)
                                              ▼
                               ┌──────────────────────────────┐
                               │    📨 Apache Kafka KRaft     │
                               │     (Topic: bank.transfers)  │
                               └──────────────┬───────────────┘
                                              │
                                              ▼
                               [ 📜 Async Audit & Fraud Consumer ]
```

---

## ⚡ Core Engineering & Operating System Concepts

| Concept | Implementation in BankShield |
| :--- | :--- |
| **Concurrency & Synchronization** | Distributed Mutex via Redis (`SET resource NX PX 2000`) and database row-level locking (`SELECT ... FOR UPDATE`). |
| **Inter-Process Communication (IPC)** | High-throughput asynchronous messaging via **Apache Kafka KRaft** partitions and RESTful HTTP over Docker bridge networks. |
| **Horizontal Scaling & Load Balancing** | Nginx layer-7 reverse proxy with upstream pooling and dynamic health checks across worker replicas. |
| **Fault Tolerance & Chaos Engineering** | **Chaos Monkey** button: kills Worker-2 live; Nginx detects upstream failure within 5s and routes 100% of traffic to Worker-1 with zero dropped requests. |
| **Event Sourcing & Auditability** | Tamper-proof append-only ledger in Kafka maintaining double-entry balance invariant $\sum \text{Credits} - \sum \text{Debits} = 0$. |

---

## 🚀 Quickstart & Running the System

### Option A: Running with Docker Compose (Full Cluster)
```bash
# 1. Build and boot the entire microservice mesh
docker compose up --build

# 2. Access the Fintech Dashboard
open http://localhost:3000
```

### Option B: Running Locally (Standalone Host Mode)
Because BankShield is built with zero heavy external host dependencies, it can be tested immediately using Node.js:
```bash
# 1. Start the server
node server.js

# 2. Open dashboard
open http://localhost:3000
```

---

## 🎓 How to Present This to Your Professor (The 3-Minute Demo)

1. **The Setup:** Open the dashboard at `http://localhost:3000`. Show the account with an initial balance of **\$1,000.00**.
2. **The Naive Failure (The Contrast):**
   * Toggle the mode to **`LOCAL / NAIVE`**.
   * Set the slider to **200 Concurrent Requests** of **\$100** each.
   * Click **LAUNCH CONCURRENT ATTACK**.
   * *Point to the screen:* Balance goes red: **`-$2,100`** with **25+ Race Conditions Detected**. Explain how unsynchronized database reads allowed multiple transactions to pass the balance check before the write occurred.
3. **The Dockerized Triumph:**
   * Click **Reset Ledger** and toggle to **`DOCKERIZED CLUSTER`**.
   * Run the exact same **200 Concurrent Requests** attack.
   * *Point to the screen:* Balance cleanly stops at **`$0.00`**. Exactly 10 transfers succeed, 190 are cleanly rejected with `409 Insufficient Funds`. Zero race conditions.
4. **The Chaos Engineering Demonstration:**
   * Click **"Kill Worker-2"** on the dashboard.
   * Launch another burst attack. Show how Worker-1 absorbs all traffic seamlessly without downtime.
5. **The Kafka Event Stream:**
   * Show the real-time Kafka event feed terminal streaming partitions `P0`, `P1`, and `P2` with zero consumer lag.

---

## 📦 Project Structure
```
bankshield/
├── docker-compose.yml       # Production Docker multi-container cluster
├── Dockerfile               # Microservice container definition
├── nginx.conf               # Nginx reverse proxy & load balancer
├── server.js                # Core API & simulation server
├── services/
│   ├── lock_service.js      # Distributed Mutex (Redis/Redlock)
│   ├── transaction_service.js# ACID ledger & double-entry logic
│   ├── kafka_producer.js    # Apache Kafka event publisher & partitioner
│   └── audit_consumer.js    # Kafka audit consumer & fraud detector
├── public/
│   ├── index.html           # Dark-mode fintech dashboard
│   ├── app.js               # Reactive frontend logic & live Chart.js
│   └── styles.css           # Custom styling & animations
└── package.json             # Project metadata & scripts
```

---
*Created by Yashwanth for Operating Systems & Distributed Computing Laboratory.*
