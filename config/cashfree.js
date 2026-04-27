// config/cashfree.js
// ═══════════════════════════════════════════════════════
//  Cashfree Payments Integration
//  Docs: https://docs.cashfree.com/docs/nodejs-integration
//  API Version: 2023-08-01
// ═══════════════════════════════════════════════════════

'use strict';

const axios  = require('axios');
const crypto = require('crypto');

// ── Environment ───────────────────────────────────────────────────────────────
const CF_ENV        = process.env.CASHFREE_ENV || 'TEST';
const CF_APP_ID     = process.env.CASHFREE_APP_ID;
const CF_SECRET_KEY = process.env.CASHFREE_SECRET_KEY;
const CF_API_VER    = '2023-08-01';

// Cashfree base URLs
const CF_BASE = CF_ENV === 'PROD'
  ? 'https://api.cashfree.com/pg'
  : 'https://sandbox.cashfree.com/pg';

// Warn if keys are missing (don't crash — let routes handle it)
if (!CF_APP_ID || !CF_SECRET_KEY) {
  console.warn('⚠️  Cashfree keys not set. Payment routes will fail.');
}

// ── Axios instance ────────────────────────────────────────────────────────────
const cfAxios = axios.create({
  baseURL: CF_BASE,
  timeout: 30000,
  headers: {
    'Content-Type':    'application/json',
    'x-client-id':     CF_APP_ID     || '',
    'x-client-secret': CF_SECRET_KEY || '',
    'x-api-version':   CF_API_VER,
  },
});

// ── Plan Definitions ──────────────────────────────────────────────────────────
const PLANS = {
  pro: {
    id:          'pro',
    name:        'FolioOS Pro',
    amount:      999,
    currency:    'INR',
    description: 'FolioOS Pro — Custom domain, all templates, analytics, priority support',
    durationDays: 30,
    features: [
      'Custom domain',
      'Unlimited projects',
      'All 3 templates (Nova, Aurora, Eclipse)',
      'Full analytics dashboard',
      'Priority support',
      'Remove FolioOS branding',
      'Password protection',
    ],
  },
  enterprise: {
    id:          'enterprise',
    name:        'FolioOS Enterprise',
    amount:      2999,
    currency:    'INR',
    description: 'FolioOS Enterprise — All Pro features + team features',
    durationDays: 30,
    features: [
      'Everything in Pro',
      '5 portfolio websites',
      'Team admin dashboard',
      'White-label solution',
      'SLA 99.9% uptime',
      'Dedicated account manager',
      'Custom templates',
    ],
  },
};

// ── Create Order ──────────────────────────────────────────────────────────────
// Returns: { cashfreeOrderId, paymentSessionId }
async function createOrder({ orderId, uid, email, name, phone, plan }) {
  const planConfig = PLANS[plan];
  if (!planConfig) throw new Error(`Invalid plan: ${plan}`);

  const payload = {
    order_id:       orderId,
    order_amount:   planConfig.amount,
    order_currency: planConfig.currency,
    order_note:     planConfig.description,

    customer_details: {
      customer_id:    uid,
      customer_email: email,
      customer_name:  name || email.split('@')[0],
      customer_phone: phone || '9999999999', // Required by Cashfree
    },

    order_meta: {
      return_url: `${process.env.FRONTEND_URL}/pages/payment-status.html?order_id={order_id}&order_token={order_token}`,
      notify_url: `${process.env.BACKEND_URL || 'http://localhost:5000'}/api/payments/webhook`,
    },

    order_tags: { plan, uid, app: 'folioos' },
  };

  try {
    const res = await cfAxios.post('/orders', payload);
    return {
      cashfreeOrderId:  res.data.cf_order_id,
      paymentSessionId: res.data.payment_session_id,
      status:           res.data.order_status,
    };
  } catch (err) {
    const msg = err.response?.data?.message || err.message;
    throw new Error(`Cashfree createOrder failed: ${msg}`);
  }
}

// ── Verify Payment ────────────────────────────────────────────────────────────
// Called after user completes payment — check real status with Cashfree
async function verifyPayment(cashfreeOrderId) {
  try {
    const res = await cfAxios.get(`/orders/${cashfreeOrderId}`);
    return {
      status:   res.data.order_status,   // PAID | ACTIVE | EXPIRED
      amount:   res.data.order_amount,
      currency: res.data.order_currency,
    };
  } catch (err) {
    throw new Error(`Cashfree verifyPayment failed: ${err.response?.data?.message || err.message}`);
  }
}

// ── Get Payment Details ────────────────────────────────────────────────────────
async function getPayments(cashfreeOrderId) {
  try {
    const res = await cfAxios.get(`/orders/${cashfreeOrderId}/payments`);
    return res.data;
  } catch (err) {
    throw new Error(`Cashfree getPayments failed: ${err.message}`);
  }
}

// ── Verify Webhook Signature ──────────────────────────────────────────────────
// Cashfree sends webhook events — verify signature for security
// Docs: https://docs.cashfree.com/docs/webhook-signature-verification
function verifyWebhookSignature(rawBody, signature, timestamp) {
  const secret = process.env.CASHFREE_WEBHOOK_SECRET;
  if (!secret) {
    console.warn('⚠️  CASHFREE_WEBHOOK_SECRET not set — skipping verification');
    return true; // Allow in dev, enforce in prod
  }

  const signedPayload = `${timestamp}${rawBody}`;
  const expected = crypto
    .createHmac('sha256', secret)
    .update(signedPayload)
    .digest('base64');

  return expected === signature;
}

// ── Initiate Refund ───────────────────────────────────────────────────────────
async function initiateRefund({ cashfreeOrderId, refundId, amount, note }) {
  try {
    const res = await cfAxios.post(`/orders/${cashfreeOrderId}/refunds`, {
      refund_amount: amount,
      refund_id:     refundId,
      refund_note:   note || 'Customer requested refund',
    });
    return res.data;
  } catch (err) {
    throw new Error(`Cashfree refund failed: ${err.response?.data?.message || err.message}`);
  }
}

module.exports = {
  PLANS,
  CF_ENV,
  createOrder,
  verifyPayment,
  getPayments,
  verifyWebhookSignature,
  initiateRefund,
};
