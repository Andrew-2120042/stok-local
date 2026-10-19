import { createHmac } from 'crypto'
import { getWebhooksForEventAndDeveloper, recordWebhookDelivery } from './db'

// Deliver a platform event to the OWNING developer's webhooks only. Events are
// scoped to the developer who placed the order — never broadcast across
// developers (privacy / no cross-developer data bleed).
// Signed with HMAC-SHA256; the signature header carries the `sha256=` scheme
// prefix so receivers can identify the algorithm (matches the portal test event).
export async function fireDeveloperWebhook(
  eventType: string,
  payload: Record<string, unknown>,
  developerId: string | null | undefined
): Promise<void> {
  if (!developerId) return
  const webhooks = await getWebhooksForEventAndDeveloper(eventType, developerId)
  if (webhooks.length === 0) return

  const body = JSON.stringify({
    event: eventType,
    timestamp: new Date().toISOString(),
    data: payload,
  })

  for (const webhook of webhooks) {
    const signature = `sha256=${createHmac('sha256', webhook.secret).update(body).digest('hex')}`
    fireWithRetry(webhook.id, webhook.url, body, signature, eventType).catch(() => {})
  }
}

// Deliver with up to 3 attempts total (initial + 2 retries) and exponential
// backoff. Never throws — webhook delivery must not affect the main order flow.
// Records the final attempt's status on the webhook row (0 = network failure).
async function fireWithRetry(
  webhookId: string,
  url: string,
  body: string,
  signature: string,
  eventType: string,
  attempt = 1
): Promise<void> {
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Stok-Signature': signature,
        'X-Stok-Event': eventType,
        'X-Stok-Event-Attempt': String(attempt),
      },
      body,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok && attempt < 3) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000))
      return fireWithRetry(webhookId, url, body, signature, eventType, attempt + 1)
    }
    recordWebhookDelivery(webhookId, response.status).catch(() => {})
  } catch {
    if (attempt < 3) {
      await new Promise((r) => setTimeout(r, Math.pow(2, attempt - 1) * 1000))
      return fireWithRetry(webhookId, url, body, signature, eventType, attempt + 1)
    }
    recordWebhookDelivery(webhookId, 0).catch(() => {})
  }
}
