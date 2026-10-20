import os

import pika
from confluent_kafka import Consumer, Producer
from kafka import KafkaConsumer, KafkaProducer

from app.celery_app import celery_app
from app.messaging import channel as shared_channel


def confluent():
    producer = Producer({"bootstrap.servers": "kafka:9092"})
    producer.produce("orders", b"payload")
    consumer = Consumer({"group.id": "g"})
    consumer.subscribe(["payments", os.environ["REFUNDS_TOPIC"]])
    Producer({}).produce(topic="audit", value=b"x")


def kafka_python(topic):
    producer = KafkaProducer(bootstrap_servers="kafka:9092")
    producer.send("clicks", b"payload")
    KafkaConsumer("views", "searches", group_id="g")
    consumer = KafkaConsumer(group_id="g")
    consumer.subscribe(topics=("signups",))
    producer.send(topic, b"x")


def rabbit():
    connection = pika.BlockingConnection(pika.ConnectionParameters("rabbitmq"))
    channel = connection.channel()
    channel.basic_publish(exchange="", routing_key="emails", body=b"x")
    channel.basic_publish("notifications", "sms", b"x")
    channel.basic_consume(queue="replies", on_message_callback=print)


def unknown_receivers():
    # Receivers bound in another module: likely only for methods no other client shares.
    shared_channel.basic_publish(exchange="events", routing_key="", body=b"x")
    celery_app.send_task("reports.build", args=[1])
    shared_channel.produce("not-graded", b"x")
