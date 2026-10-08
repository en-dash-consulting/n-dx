import { SQSClient, SendMessageCommand } from "@aws-sdk/client-sqs";

const QUEUE_URL = "https://sqs.us-east-1.amazonaws.com/000000000000/acme-order-events";

const sqs = new SQSClient({ region: "us-east-1" });

export async function publishOrderEvent(body: string): Promise<void> {
  await sqs.send(new SendMessageCommand({ QueueUrl: QUEUE_URL, MessageBody: body }));
}
