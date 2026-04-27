// services/paymentService.js
// Payment business logic — Cashfree integration
'use strict';

const { col, admin } = require('../config/firebase');
const {
  PLANS, createOrder, verifyPayment, initiateRefund
} = require('../config/cashfree');
const { generateOrderId, getPlanExpiry, serializeFirestore } = require('../utils/helpers');

// ── Create Payment Order ──────────────────────────────────────────────────────
async function createPaymentOrder(uid, email, plan, phone) {
  const planConfig = PLANS[plan];
  if (!planConfig) throw Object.assign(new Error(`Invalid plan: ${plan}`), { status: 400 });

  const userSnap = await col.users().doc(uid).get();
  if (!userSnap.exists) throw Object.assign(new Error('User not found'), { status: 404 });

  const userData = userSnap.data();
  if (userData.plan === plan) {
    throw Object.assign(new Error(`Already on ${plan} plan`), { status: 400 });
  }

  const orderId = generateOrderId();
  const name    = userData.profile?.name || userData.displayName || '';

  // Create on Cashfree
  const cfResult = await createOrder({ orderId, uid, email, name, phone, plan });

  // Save to Firestore
  const orderDoc = {
    orderId,
    uid, email, plan,
    amount:           planConfig.amount,
    currency:         planConfig.currency,
    status:           'CREATED',
    cashfreeOrderId:  cfResult.cashfreeOrderId,
    paymentSessionId: cfResult.paymentSessionId,
    environment:      require('../config/cashfree').CF_ENV,
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    paidAt:           null,
  };
  await col.orders().doc(orderId).set(orderDoc);

  return {
    orderId,
    paymentSessionId: cfResult.paymentSessionId,
    cashfreeOrderId:  cfResult.cashfreeOrderId,
    amount:           planConfig.amount,
    currency:         planConfig.currency,
    plan:             planConfig,
  };
}

// ── Verify & Activate ─────────────────────────────────────────────────────────
async function verifyAndActivate(uid, orderId, cashfreeOrderId) {
  const snap = await col.orders().doc(orderId).get();
  if (!snap.exists) throw Object.assign(new Error('Order not found'), { status: 404 });

  const order = snap.data();
  if (order.uid !== uid) throw Object.assign(new Error('Unauthorized'), { status: 403 });
  if (order.status === 'PAID') return { status: 'PAID', alreadyProcessed: true };

  const cfStatus = await verifyPayment(cashfreeOrderId);

  if (cfStatus.status === 'PAID') {
    const expiry = getPlanExpiry(PLANS[order.plan]?.durationDays || 30);
    const batch  = col.users().firestore.batch();

    batch.update(col.users().doc(uid), {
      plan: order.plan,
      planExpiry: admin.firestore.Timestamp.fromDate(expiry),
      updatedAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    batch.update(col.orders().doc(orderId), {
      status: 'PAID',
      paidAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { status: 'PAID', plan: order.plan, planExpiry: expiry.toISOString() };
  }

  await col.orders().doc(orderId).update({ status: cfStatus.status });
  return { status: cfStatus.status };
}

// ── Handle Webhook ────────────────────────────────────────────────────────────
async function handleWebhookEvent(event) {
  const eventType = event.type;
  const orderId   = event.data?.order?.order_id;

  switch (eventType) {
    case 'PAYMENT_SUCCESS_WEBHOOK': {
      if (!orderId) return;
      const snap = await col.orders().doc(orderId).get();
      if (!snap.exists || snap.data().status === 'PAID') return;

      const order   = snap.data();
      const expiry  = getPlanExpiry(PLANS[order.plan]?.durationDays || 30);
      const cfPid   = event.data?.payment?.cf_payment_id || null;
      const batch   = col.users().firestore.batch();

      batch.update(col.users().doc(order.uid), {
        plan: order.plan,
        planExpiry: admin.firestore.Timestamp.fromDate(expiry),
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      const upd = { status: 'PAID', paidAt: admin.firestore.FieldValue.serverTimestamp() };
      if (cfPid) upd.cashfreePaymentId = cfPid;
      batch.update(col.orders().doc(orderId), upd);
      await batch.commit();

      console.log(`✅ Plan activated: ${order.plan} for uid ${order.uid}`);
      break;
    }
    case 'PAYMENT_FAILED_WEBHOOK':
      if (orderId) {
        await col.orders().doc(orderId).update({
          status: 'FAILED',
          failedAt: admin.firestore.FieldValue.serverTimestamp(),
          failReason: event.data?.payment?.payment_message || 'Payment failed',
        });
      }
      break;
    case 'PAYMENT_USER_DROPPED_WEBHOOK':
      if (orderId) await col.orders().doc(orderId).update({ status: 'DROPPED' });
      break;
    default:
      console.log(`ℹ️  Unhandled webhook: ${eventType}`);
  }
}

// ── Get Payment History ───────────────────────────────────────────────────────
async function getPaymentHistory(uid) {
  const snap = await col.orders()
    .where('uid', '==', uid)
    .orderBy('createdAt', 'desc')
    .limit(20)
    .get();
  return snap.docs.map(d => serializeFirestore(d.data()));
}

// ── Request Refund ────────────────────────────────────────────────────────────
async function requestRefund(uid, orderId, reason) {
  const snap = await col.orders().doc(orderId).get();
  if (!snap.exists) throw Object.assign(new Error('Order not found'), { status: 404 });

  const order = snap.data();
  if (order.uid !== uid)         throw Object.assign(new Error('Unauthorized'), { status: 403 });
  if (order.status !== 'PAID')   throw Object.assign(new Error('Only PAID orders can be refunded'), { status: 400 });
  if (order.status === 'REFUNDED') throw Object.assign(new Error('Already refunded'), { status: 400 });

  const refundId = 'ref_' + Date.now();
  await initiateRefund({
    cashfreeOrderId: order.cashfreeOrderId,
    refundId,
    amount: order.amount,
    note: reason || 'User requested refund',
  });

  await col.orders().doc(orderId).update({
    status:    'REFUND_REQUESTED',
    refundId,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  return { refundId, message: 'Refund initiated. 5–7 business days.' };
}

module.exports = {
  createPaymentOrder, verifyAndActivate,
  handleWebhookEvent, getPaymentHistory, requestRefund,
};
