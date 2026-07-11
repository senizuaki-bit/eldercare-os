import { connect, type MqttClient } from 'mqtt';

export function connectToBroker(url: string, timeoutMs: number): MqttClient {
  return connect(url, {
    clean: true,
    clientId: `eldercare-m00-simulator-${process.pid}`,
    connectTimeout: timeoutMs,
    reconnectPeriod: 2_000
  });
}

export async function checkBroker(url: string, timeoutMs: number): Promise<void> {
  const client = connect(url, {
    clean: true,
    clientId: `eldercare-m00-check-${process.pid}`,
    connectTimeout: timeoutMs,
    reconnectPeriod: 0
  });

  try {
    await new Promise<void>((resolve, reject) => {
      const cleanup = (): void => {
        clearTimeout(timer);
        client.off('connect', onConnect);
        client.off('error', onError);
      };
      const onConnect = (): void => {
        cleanup();
        resolve();
      };
      const onError = (error: Error): void => {
        cleanup();
        reject(error);
      };
      const timer = setTimeout(() => {
        cleanup();
        reject(new Error('MQTT connection timed out'));
      }, timeoutMs + 100);

      client.once('connect', onConnect);
      client.once('error', onError);
    });
  } finally {
    await new Promise<void>((resolve) => {
      client.end(true, {}, () => resolve());
    });
  }
}
