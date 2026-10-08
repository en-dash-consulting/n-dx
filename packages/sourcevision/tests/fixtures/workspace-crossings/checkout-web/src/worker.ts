import { SQSClient, ReceiveMessageCommand } from "@aws-sdk/client-sqs";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/acme-order-events";

const sqs = new SQSClient({ region: "us-east-1" });

export async function drainOrderEvents(): Promise<void> {
  await sqs.send(new ReceiveMessageCommand({ QueueUrl: QUEUE_URL, MaxNumberOfMessages: 10 }));
}
