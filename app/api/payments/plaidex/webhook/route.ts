import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"
import { getUserByTelegramId, updateUserBalance, query } from "@/lib/db"

// PLAIDEX Webhook Handler
// Receives payment confirmations and updates user balances
// Documentation: See 1222222222222222222.md

const PLAIDEX_WEBHOOK_SECRET = process.env.PLAIDEX_API_SECRET || ""

interface WebhookPayload {
  payment_id: string
  shop_id: number
  amount: number
  currency: string
  status: string // pending, success, cancelled, expired, dispute
  external_id: string
  requisite?: {
    bank?: string
    card?: string
    owner?: string
    payment_way?: string
    qr_url?: string
  }
  created_at: string
  paid_at?: string
  expired_at?: string
}

// Verify webhook signature using HMAC SHA256
function verifyWebhookSignature(payload: string, signature: string): boolean {
  if (!PLAIDEX_WEBHOOK_SECRET) {
    console.warn("PLAIDEX: Webhook secret not configured, skipping signature verification")
    return true // Allow in demo mode
  }
  
  const expectedSignature = crypto
    .createHmac("sha256", PLAIDEX_WEBHOOK_SECRET)
    .update(payload)
    .digest("hex")
  
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    )
  } catch {
    return false
  }
}

// Process successful payment - update user balance
function processPayment(payload: WebhookPayload): boolean {
  try {
    const amountRubles = payload.amount

    console.log("Processing successful SBP payment:", {
      paymentId: payload.payment_id,
      externalId: payload.external_id,
      amount: amountRubles,
      paidAt: payload.paid_at,
    })

    // Extract telegram_id from external_id
    // We need to find the transaction record that was created when payment was initiated
    // For now, we'll need to store external_id -> telegram_id mapping
    // Or extract from external_id if we encode it there
    
    // TODO: Implement proper user lookup by external_id
    // For now, log the payment
    console.log(`Payment received: ${amountRubles} RUB, payment_id: ${payload.payment_id}`)

    // Record payment in database
    try {
      query(
        `INSERT INTO sbp_payments (order_id, amount, status, invoice_id, paid_at, created_at)
         VALUES (?, ?, 'confirmed', ?, ?, datetime('now'))
         ON CONFLICT(order_id) DO UPDATE SET status = 'confirmed', paid_at = ?`,
        [payload.external_id, amountRubles, payload.payment_id, payload.paid_at, payload.paid_at]
      )
    } catch (error) {
      console.error("Error recording payment:", error)
    }

    return true
  } catch (error) {
    console.error("Error processing SBP payment:", error)
    return false
  }
}

export async function POST(request: NextRequest) {
  try {
    // Get webhook headers
    const webhookEvent = request.headers.get("X-Webhook-Event") || ""
    const signature = request.headers.get("X-Webhook-Signature") || ""

    // Parse webhook payload
    const rawBody = await request.text()
    let payload: WebhookPayload
    
    try {
      payload = JSON.parse(rawBody)
    } catch {
      console.error("PLAIDEX Webhook: Invalid JSON payload")
      return NextResponse.json(
        { success: false, error: "Invalid JSON payload" },
        { status: 400 }
      )
    }

    // Verify signature if webhook secret is configured
    if (signature && PLAIDEX_WEBHOOK_SECRET) {
      const isValid = verifyWebhookSignature(rawBody, signature)
      if (!isValid) {
        console.error("PLAIDEX Webhook: Invalid signature")
        return NextResponse.json(
          { success: false, error: "Invalid signature" },
          { status: 401 }
        )
      }
    }

    // Log webhook receipt
    console.log("PLAIDEX Webhook received:", {
      event: webhookEvent,
      paymentId: payload.payment_id,
      status: payload.status,
      amount: payload.amount,
      externalId: payload.external_id,
    })

    // Handle payment status
    const status = payload.status?.toLowerCase()
    
    // Process based on event type
    if (webhookEvent === "payment.success" || status === "success") {
      const processed = processPayment(payload)
      if (!processed) {
        console.error("Failed to process payment, but acknowledging webhook")
      }
    } else if (webhookEvent === "payment.pending" || status === "pending") {
      console.log("Payment pending:", payload.payment_id)
    } else if (["payment.cancelled", "payment.expired"].includes(webhookEvent) || 
               ["cancelled", "expired"].includes(status)) {
      console.log("Payment cancelled/expired:", payload.payment_id)
      
      // Update payment status in database
      try {
        query(
          `UPDATE sbp_payments SET status = ? WHERE order_id = ?`,
          [status, payload.external_id]
        )
      } catch {}
    } else {
      console.log("Unknown webhook event:", webhookEvent, status)
    }

    // Always return 200 to acknowledge receipt
    return NextResponse.json({ 
      success: true, 
      message: "Webhook processed",
      paymentId: payload.payment_id,
      timestamp: new Date().toISOString(),
    })

  } catch (error) {
    console.error("Webhook processing error:", error)
    // Return 200 to prevent infinite retries
    return NextResponse.json(
      { success: false, error: "Internal error", acknowledged: true },
      { status: 200 }
    )
  }
}

// GET endpoint for webhook verification
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const challenge = searchParams.get("challenge")
  
  if (challenge) {
    return new NextResponse(challenge, {
      status: 200,
      headers: { "Content-Type": "text/plain" }
    })
  }
  
  return NextResponse.json({ 
    status: "active", 
    service: "MoneyCas Payment Webhook",
    provider: "PLAIDEX",
    timestamp: new Date().toISOString(),
  })
}
