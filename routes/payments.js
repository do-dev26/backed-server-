// routes/payments.js
// ═══════════════════════════════════════════════════════
//  Cashfree Payment Routes
//
//  PAYMENT FLOW:
//  1. POST /create-order  → Create order in Cashfree + Firestore
//  2. Frontend loads Cashfree SDK → opens payment UI
//  3. User pays → Cashfree webhooks /webhook
//  4. POST /verify        → Frontend verifies after redirect
//  5. GET  /history       → User's past payments
//
//  WEBHOOK FLOW (server-to-server, most reliable):
//  Cashfree → POST /webhook → verify signature → update Firestore plan
// ═══════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { col, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const {
  PLANS, CF_ENV,
  createOrder, verifyPayment, verifyWebhookSignature,
  initiateRefund,
} = require('../config/cashfree');
const {
  createOrderSchema, verifyPaymentSchema, validate,
} = require('../validators/userValidator');
const {
  serializeFirestore, getPlanExpiry, asyncHandler, generateOrderId,
} = require('../utils/helpers');

const router = express.Router();

// ── POST /api/payments/create-order ──────────────────────────────────────────
// Step 1: Create a new payment order
// Returns: { orderId, paymentSessionId, cashfreeOrderId }
router.post('/create-order', verifyToken, asyncHandler(async (req, res) => {
  const { plan, phone } = validate(createOrderSchema, req.body);

  const planConfig = PLANS[plan];
  if (!planConfig) {
    return res.status(400).json({ success: false, error: 'Invalid plan' });
  }

  // Check user isn't already on this plan
  const userSnap = await col.users().doc(req.user.uid).get();
  if (!userSnap.exists) {
    return res.status(404).json({ success: false, error: 'User not found' });
  }

  const userData   = userSnap.data();
  const userName   = userData.profile?.name || userData.displayName || '';

  if (userData.plan === plan) {
    return res.status(400).json({ success: false, error: `You are already on the ${plan} plan` });
  }

  // Generate unique order ID
  const orderId = generateOrderId();

  // Create order in Cashfree
  const cfResult = await createOrder({
    orderId,
    uid:   req.user.uid,
    email: req.user.email,
    name:  userName,
    phone: phone || userData.phone || '9999999999',
    plan,
  });

  // Save order to Firestore
  const orderDoc = {
    orderId,
    uid:              req.user.uid,
    email:            req.user.email,
    plan,
    amount:           planConfig.amount,
    currency:         planConfig.currency,
    status:           'CREATED',
    cashfreeOrderId:  cfResult.cashfreeOrderId,
    paymentSessionId: cfResult.paymentSessionId,
    environment:      CF_ENV,
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    paidAt:           null,
    failedAt:         null,
  };

  await col.orders().doc(orderId).set(orderDoc);

  res.json({
    success:         true,
    orderId,
    paymentSessionId: cfResult.paymentSessionId,
    cashfreeOrderId:  cfResult.cashfreeOrderId,
    amount:          planConfig.amount,
    currency:        planConfig.currency,
    plan:            planConfig,
    environment:     CF_ENV,
  });
}));

// ── POST /api/payments/verify ─────────────────────────────────────────────────
// Step 4: Verify payment after Cashfree redirects user back
// Called from frontend after payment redirect
router.post('/verify', verifyToken, asyncHandler(async (req, res) => {
  const { orderId, cashfreeOrderId } = validate(verifyPaymentSchema, req.body);

  // Fetch order from Firestore
  const orderSnap = await col.orders().doc(orderId).get();
  if (!orderSnap.exists) {
    return res.status(404).json({ success: false, error: 'Order not found' });
  }

  const order = orderSnap.data();

  // Security: ensure order belongs to this user
  if (order.uid !== req.user.uid) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }

  // Already processed — idempotent
  if (order.status === 'PAID') {
    return res.json({ success: true, status: 'PAID', alreadyProcessed: true });
  }

  // Verify with Cashfree API
  const cfStatus = await verifyPayment(cashfreeOrderId);

  if (cfStatus.status === 'PAID') {
    await activatePlan(req.user.uid, orderId, order.plan);
    return res.json({
      success:    true,
      status:     'PAID',
      plan:       order.plan,
      planExpiry: getPlanExpiry(PLANS[order.plan].durationDays).toISOString(),
    });
  }

  // Update order status
  await col.orders().doc(orderId).update({
    status: cfStatus.status,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ success: false, status: cfStatus.status });
}));

// ── POST /api/payments/webhook ────────────────────────────────────────────────
// Cashfree calls this on every payment event (server-to-server)
// IMPORTANT: Configure this URL in Cashfree Dashboard → Developers → Webhooks
// IMPORTANT: This route uses raw body — do NOT apply JSON middleware
router.post(
  '/webhook',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-webhook-signature'];
    const timestamp = req.headers['x-webhook-timestamp'];
    const rawBody   = req.body.toString('utf8');

    // Verify Cashfree signature
    const isValid = verifyWebhookSignature(rawBody, signature, timestamp);
    if (!isValid) {
      console.warn(`⚠️  Invalid webhook signature from ${req.ip}`);
      return res.status(401).json({ error: 'Invalid signature' });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return res.status(400).json({ error: 'Invalid JSON' });
    }

    const eventType = event.type;
    const orderId   = event.data?.order?.order_id;

    console.log(`📩 Webhook: ${eventType} | Order: ${orderId}`);

    switch (eventType) {
      case 'PAYMENT_SUCCESS_WEBHOOK': {
        if (!orderId) break;

        const snap = await col.orders().doc(orderId).get();
        if (!snap.exists) {
          console.warn(`Webhook: Order ${orderId} not found in Firestore`);
          break;
        }

        const order = snap.data();
        if (order.status === 'PAID') break; // Already processed

        await activatePlan(order.uid, orderId, order.plan, event.data?.payment?.cf_payment_id);
        console.log(`✅ Webhook: Plan activated for order ${orderId}`);
        break;
      }

      case 'PAYMENT_FAILED_WEBHOOK': {
        if (orderId) {
          await col.orders().doc(orderId).update({
            status:     'FAILED',
            failedAt:   admin.firestore.FieldValue.serverTimestamp(),
            failReason: event.data?.payment?.payment_message || 'Payment failed',
          });
        }
        break;
      }

      case 'PAYMENT_USER_DROPPED_WEBHOOK': {
        if (orderId) {
          await col.orders().doc(orderId).update({ status: 'DROPPED' });
        }
        break;
      }

      default:
        console.log(`ℹ️  Unhandled webhook event: ${eventType}`);
    }

    // Always return 200 to Cashfree (prevents retry)
    res.status(200).json({ success: true });
  })
);

// ── GET /api/payments/history ─────────────────────────────────────────────────
// Get user's payment history from Firestore
router.get('/history', verifyToken, asyncHandler(async (req, res) => {
  const snap = await col.orders()
    .where('uid', '==', req.user.uid)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();

  const orders = snap.docs.map(d => serializeFirestore(d.data()));
  res.json({ success: true, orders });
}));

// ── GET /api/payments/plans ───────────────────────────────────────────────────
// Public — Get available plans
router.get('/plans', (req, res) => {
  res.json({ success: true, plans: PLANS, environment: CF_ENV });
});

// ── POST /api/payments/refund ─────────────────────────────────────────────────
// Request refund for a paid order (Admin use or user request)
router.post('/refund', verifyToken, asyncHandler(async (req, res) => {
  const { orderId, reason } = req.body;
  if (!orderId) return res.status(400).json({ success: false, error: 'orderId required' });

  const snap = await col.orders().doc(orderId).get();
  if (!snap.exists) return res.status(404).json({ success: false, error: 'Order not found' });

  const order = snap.data();
  if (order.uid !== req.user.uid) {
    return res.status(403).json({ success: false, error: 'Unauthorized' });
  }
  if (order.status !== 'PAID') {
    return res.status(400).json({ success: false, error: 'Can only refund PAID orders' });
  }

  const refundId = 'ref_' + Date.now();
  await initiateRefund({
    cashfreeOrderId: order.cashfreeOrderId,
    refundId,
    amount: order.amount,
    note:   reason || 'User requested refund',
  });

  await col.orders().doc(orderId).update({
    status:    'REFUND_REQUESTED',
    refundId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ success: true, refundId, message: 'Refund initiated. 5-7 business days.' });
}));

// ── Helper: Activate Plan in Firestore ───────────────────────────────────────
async function activatePlan(uid, orderId, plan, cfPaymentId = null) {
  const planConfig = PLANS[plan];
  const expiry     = getPlanExpiry(planConfig?.durationDays || 30);

  const batch = col.users().firestore.batch();

  // Update user plan
  batch.update(col.users().doc(uid), {
    plan:       plan,
    planExpiry: admin.firestore.Timestamp.fromDate(expiry),
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  // Update order status
  const orderUpdate = {
    status: 'PAID',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (cfPaymentId) orderUpdate.cashfreePaymentId = cfPaymentId;
  batch.update(col.orders().doc(orderId), orderUpdate);

  await batch.commit();
}

module.exports = router;
