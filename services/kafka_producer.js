const crypto = require('crypto');

/**
 * Apache Kafka Event Producer
 * Publishes financial transaction events to the 'bank.transfers.v1' topic with partitioning.
 */
class KafkaProducer {
  constructor() {
    this.topic = 'bank.transfers.v1';
    this.numPartitions = 3;
    this.subscribers = new Set();
    this.messageLog = [];
    this.partitionOffsets = [0, 0, 0];
  }

  /**
   * Determine partition using standard Murmur2-like hash on key
   */
  getPartition(key) {
    if (!key) return 0;
    const hash = crypto.createHash('md5').update(key).digest('hex');
    const intVal = parseInt(hash.substring(0, 8), 16);
    return Math.abs(intVal) % this.numPartitions;
  }

  /**
   * Publish an event to the Kafka topic
   */
  async publishEvent(eventType, payload) {
    const partition = this.getPartition(payload.fromAccount || 'default');
    const offset = this.partitionOffsets[partition]++;

    const event = {
      topic: this.topic,
      partition,
      offset,
      timestamp: new Date().toISOString(),
      eventType,
      key: payload.fromAccount,
      payload,
    };

    this.messageLog.push(event);
    if (this.messageLog.length > 500) {
      this.messageLog.shift(); // retain last 500 events in circular buffer
    }

    // Broadcast to consumers & real-time SSE stream
    for (const listener of this.subscribers) {
      try {
        listener(event);
      } catch (err) {
        console.error('Kafka listener error:', err);
      }
    }

    return event;
  }

  subscribe(callback) {
    this.subscribers.add(callback);
    return () => this.subscribers.delete(callback);
  }

  getMetrics() {
    return {
      topic: this.topic,
      partitions: this.partitionOffsets,
      totalPublished: this.partitionOffsets.reduce((a, b) => a + b, 0),
      recentEvents: this.messageLog.slice(-15),
    };
  }

  clear() {
    this.partitionOffsets = [0, 0, 0];
    this.messageLog = [];
  }
}

module.exports = new KafkaProducer();
