package com.example.messaging;

import org.apache.kafka.clients.producer.ProducerRecord;
import org.springframework.amqp.rabbit.annotation.RabbitListener;
import org.springframework.amqp.rabbit.core.RabbitTemplate;
import org.springframework.jms.annotation.JmsListener;
import org.springframework.jms.core.JmsTemplate;
import org.springframework.kafka.annotation.KafkaListener;
import org.springframework.kafka.core.KafkaTemplate;

// Queue producers and consumers: both count.
public class Messaging {
  private final KafkaTemplate<String, String> kafka;
  private final JmsTemplate jms;
  private final RabbitTemplate rabbit;

  Messaging(KafkaTemplate<String, String> kafka, JmsTemplate jms, RabbitTemplate rabbit) {
    this.kafka = kafka;
    this.jms = jms;
    this.rabbit = rabbit;
  }

  void produce(String payload, ProducerRecord<String, String> record) {
    kafka.send("orders", payload);
    // The record names its topic: unknown here.
    kafka.send(record);
    jms.convertAndSend("queue.audit", payload);
    rabbit.convertAndSend("exchange.orders", "orders.created", payload);
    // The default exchange: the routing key is the queue.
    rabbit.convertAndSend("", "orders.retry", payload);
  }

  @KafkaListener(topics = {"orders", "${topics.refunds}"}, groupId = "billing")
  void onOrder(String payload) {}

  @JmsListener(destination = "queue.audit")
  void onAudit(String payload) {}

  @RabbitListener(queues = "orders.q")
  void onRabbit(String payload) {}
}
