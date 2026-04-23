import { NextRequest, NextResponse } from "next/server"
import crypto from "crypto"

// PLAIDEX MERCHANT API Integration for SBP Payments
// Dashboard: https://plaidprocessing.com/
// API Documentation: See 1222222222222222222.md

const PLAIDEX_API_URL = "https://plaidprocessing.com/api/public"

// API credentials - MUST be set via environment variables only
// Set PLAIDEX_API_KEY in your .env.local file
const PLAIDEX_API_KEY = process.env.PLAIDEX_API_KEY || ""
const PLAIDEX_WEBHOOK_SECRET = process.env.PLAIDEX_API_SECRET || "" // For webhook signature verification

// Site URL for callbacks
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://moneycas.live"

// Check if we have valid API credentials
const hasValidCredentials = PLAIDEX_API_KEY && PLAIDEX_API_KEY !== "YOUR_API_KEY_HERE" && PLAIDEX_API_KEY.length > 20

interface PaymentRequest {
  amount: number
  currency?: string
  description?: string
  method?: "sbp" | "card"
  telegramId?: string  // Telegram user ID for identification
  userId?: string      // Legacy support
  metadata?: Record<string, string>
}

interface PlaidexPaymentResponse {
  payment_id: string
  shop_id: number
  amount: number
  currency: string
  status: string // invoice, pending, success, cancelled, expired, dispute
  external_id: string
  requisite?: {
    bank?: string
    card?: string
    owner?: string
    payment_way?: string
    payment_way_en?: string
    qr_url?: string
  }
  created_at: string
  expired_at?: string
  paid_at?: string
}

interface PlaidexInvoiceResponse {
  success: boolean
  payment_id?: string
  payment_url?: string
  qr_url?: string
  requisite?: {
    card?: string
    owner?: string
    bank?: string
    qr_url?: string
  }
  status?: string
  expires_at?: string
  error?: string
  message?: string
}

// PLAIDEX uses X-API-Key header, no signature needed for requests
// Signature is only used for webhook verification

// Create SBP payment via PLAIDEX
async function createSBPPayment(
  amount: number,
  externalId: string,
  telegramId?: string
): Promise<PlaidexInvoiceResponse> {
  try {
    const payload = {
      amount: amount, // Amount in rubles (not kopecks!)
      currency: "RUB",
      payment_way: "SBP", // Use canonical name from docs
      external_id: externalId,
      customer_data: {
        telegram_id: telegramId || "",
      }
    }

    console.log("[PLAIDEX] Creating payment:", payload)

    const response = await fetch(`${PLAIDEX_API_URL}/payment`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-Key": PLAIDEX_API_KEY,
      },
      body: JSON.stringify(payload),
    })

    const responseText = await response.text()
    let data: PlaidexPaymentResponse
    
    try {
      data = JSON.parse(responseText)
    } catch {
      console.error("PLAIDEX: Failed to parse response:", responseText)
      return { success: false, error: "Invalid response from payment provider" }
    }

    if (!response.ok) {
      console.error("PLAIDEX API Error:", response.status, data)
      return { 
        success: false, 
        error: (data as any).message || (data as any).error || `API Error: ${response.status}` 
      }
    }

    // Handle successful response
    // Status can be: invoice, pending, success
    if (data.payment_id) {
      return {
        success: true,
        payment_id: data.payment_id,
        status: data.status,
        qr_url: data.requisite?.qr_url,
        requisite: data.requisite,
        expires_at: data.expired_at,
      }
    }

    return { 
      success: false, 
      error: "No payment_id in response" 
    }
  } catch (error) {
    console.error("PLAIDEX createSBPPayment error:", error)
    return { success: false, error: "Network error connecting to payment provider" }
  }
}

// Check payment status
async function checkPaymentStatus(paymentId: string): Promise<{ 
  status: string
  paid: boolean
  amount?: number
  paidAt?: string 
}> {
  try {
    const response = await fetch(`${PLAIDEX_API_URL}/payment/${paymentId}`, {
      method: "GET",
      headers: {
        "X-API-Key": PLAIDEX_API_KEY,
      },
    })

    if (!response.ok) {
      return { status: "error", paid: false }
    }

    const data: PlaidexPaymentResponse = await response.json()
    const isPaid = data.status === "success"
    
    return {
      status: data.status || "unknown",
      paid: isPaid,
      amount: data.amount,
      paidAt: data.paid_at,
    }
  } catch (error) {
    console.error("PLAIDEX checkPaymentStatus error:", error)
    return { status: "error", paid: false }
  }
}

// Input validation and sanitization
function sanitizeInput(input: string, maxLength = 100): string {
  return input
    .replace(/[<>'";&|`$(){}[\]\\]/g, "") // Remove potentially dangerous characters
    .substring(0, maxLength)
    .trim()
}

function validateAmount(amount: unknown): number | null {
  const num = typeof amount === "number" ? amount : parseFloat(String(amount))
  if (isNaN(num) || num < 100 || num > 500000) {
    return null
  }
  return Math.round(num * 100) / 100 // Round to 2 decimal places
}

export async function POST(request: NextRequest) {
  try {
    const body: PaymentRequest = await request.json()
    
    // Validate amount
    const validatedAmount = validateAmount(body.amount)
    if (validatedAmount === null) {
      return NextResponse.json(
        { success: false, error: "Сумма должна быть от 100 до 500 000 рублей" },
        { status: 400 }
      )
    }

    // Sanitize inputs
    const telegramId = body.telegramId ? sanitizeInput(String(body.telegramId), 50) : undefined

    // Generate unique external ID (your order ID)
    const externalId = `order_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`
    
    // Check if API key is configured
    if (!PLAIDEX_API_KEY || PLAIDEX_API_KEY.length < 20) {
      return NextResponse.json(
        { success: false, error: "Payment system not configured" },
        { status: 500 }
      )
    }
    
    // Log API call for debugging
    console.log("[PLAIDEX] Creating payment:", { amount: validatedAmount, externalId, telegramId })

    // Create SBP payment via PLAIDEX
    const payment = await createSBPPayment(
      validatedAmount,
      externalId,
      telegramId
    )

    if (payment.success) {
      return NextResponse.json({
        success: true,
        paymentId: payment.payment_id,
        externalId,
        status: payment.status,
        qrUrl: payment.qr_url,
        requisite: payment.requisite,
        expiresAt: payment.expires_at,
      })
    }

    return NextResponse.json(
      { success: false, error: payment.error || "Ошибка создания платежа" },
      { status: 500 }
    )

  } catch (error) {
    console.error("Payment creation error:", error)
    return NextResponse.json(
      { success: false, error: "Внутренняя ошибка сервера" },
      { status: 500 }
    )
  }
}

// GET method for checking payment status
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const paymentId = searchParams.get("paymentId")

  if (!paymentId) {
    return NextResponse.json(
      { success: false, error: "Payment ID required" },
      { status: 400 }
    )
  }

  // Sanitize input
  const id = sanitizeInput(paymentId, 100)
  
  if (!id) {
    return NextResponse.json(
      { success: false, error: "Invalid payment ID format" },
      { status: 400 }
    )
  }

  const status = await checkPaymentStatus(id)
  
  return NextResponse.json({
    success: true,
    paymentId: id,
    ...status,
  })
}
