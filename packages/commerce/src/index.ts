/** Payment abstractions only. Fake and real providers are intentionally absent in M00. */
export interface Money {
  readonly amountMinor: number;
  readonly currency: string;
}

export interface CreatePaymentInput {
  readonly orderId: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface PaymentResult {
  readonly providerReference: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
}

export interface RawWebhook {
  readonly body: Uint8Array;
  readonly headers: Readonly<Record<string, string | undefined>>;
}

export interface VerifiedPaymentEvent {
  readonly providerEventId: string;
  readonly providerReference: string;
  readonly status: PaymentResult['status'];
  readonly occurredAt: string;
}

export interface RefundInput {
  readonly orderId: string;
  readonly paymentReference: string;
  readonly amount: Money;
  readonly idempotencyKey: string;
}

export interface RefundResult {
  readonly providerRefundReference: string;
  readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED' | 'UNKNOWN';
}

export interface PaymentProvider {
  createPayment(input: CreatePaymentInput): Promise<PaymentResult>;
  verifyWebhook(input: RawWebhook): Promise<VerifiedPaymentEvent>;
  refund(input: RefundInput): Promise<RefundResult>;
}
