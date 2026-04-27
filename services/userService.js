// services/userService.js
// ═══════════════════════════════════════════════════════
//  User Service — Business logic layer
//  All Firestore DB operations go through here
//  Routes call services, services call DB
// ═══════════════════════════════════════════════════════
'use strict';

const { col, admin } = require('../config/firebase');
const {
  createDefaultUserDoc, sanitizeProfile,
  isReservedSubdomain, serializeFirestore, getPlanExpiry
} = require('../utils/helpers');

// ── Get or Create User ────────────────────────────────────────────────────────
async function getOrCreateUser(firebaseUser) {
  const snap = await col.users().doc(firebaseUser.uid).get();

  if (!snap.exists) {
    const newUser = createDefaultUserDoc(firebaseUser);

    // Batch: create user + reserve subdomain
    const batch = col.users().firestore.batch();
    batch.set(col.users().doc(firebaseUser.uid), newUser);
    batch.set(col.subdoms().doc(newUser.subdomain), {
      uid: firebaseUser.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });
    await batch.commit();

    return { user: serializeFirestore(newUser), isNew: true };
  }

  let data = snap.data();

  // Check plan expiry
  if (data.plan !== 'free' && data.planExpiry) {
    const expiry = data.planExpiry.toDate ? data.planExpiry.toDate() : new Date(data.planExpiry);
    if (expiry < new Date()) {
      await col.users().doc(firebaseUser.uid).update({
        plan: 'free', planExpiry: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      data.plan = 'free';
      data.planExpiry = null;
    }
  }

  return { user: serializeFirestore(data), isNew: false };
}

// ── Update Profile ────────────────────────────────────────────────────────────
async function updateProfile(uid, profileData) {
  const sanitized = sanitizeProfile(profileData);
  await col.users().doc(uid).update({
    profile: sanitized,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  const updated = await col.users().doc(uid).get();
  return serializeFirestore(updated.data());
}

// ── Update Template ───────────────────────────────────────────────────────────
async function updateTemplate(uid, template) {
  await col.users().doc(uid).update({
    template,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  return { template };
}

// ── Change Subdomain ──────────────────────────────────────────────────────────
async function changeSubdomain(uid, newSubdomain) {
  if (isReservedSubdomain(newSubdomain)) {
    throw Object.assign(new Error('Subdomain is reserved'), { code: 'RESERVED', status: 400 });
  }

  // Check availability
  const existing = await col.subdoms().doc(newSubdomain).get();
  if (existing.exists && existing.data().uid !== uid) {
    throw Object.assign(new Error('Subdomain already taken'), { code: 'TAKEN', status: 409 });
  }

  const userSnap = await col.users().doc(uid).get();
  const oldSub   = userSnap.data()?.subdomain;

  const batch = col.users().firestore.batch();
  batch.update(col.users().doc(uid), {
    subdomain: newSubdomain,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (oldSub && oldSub !== newSubdomain) {
    batch.delete(col.subdoms().doc(oldSub));
  }
  batch.set(col.subdoms().doc(newSubdomain), {
    uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  await batch.commit();

  return {
    subdomain: newSubdomain,
    url: `https://${newSubdomain}.${process.env.BASE_DOMAIN || 'folio.dev'}`,
  };
}

// ── Activate Plan ─────────────────────────────────────────────────────────────
async function activatePlan(uid, plan, orderId, cfPaymentId = null) {
  const { PLANS } = require('../config/cashfree');
  const expiry = getPlanExpiry(PLANS[plan]?.durationDays || 30);

  const batch = col.users().firestore.batch();
  batch.update(col.users().doc(uid), {
    plan,
    planExpiry: admin.firestore.Timestamp.fromDate(expiry),
    updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
  });

  const orderUpdate = {
    status: 'PAID',
    paidAt: admin.firestore.FieldValue.serverTimestamp(),
  };
  if (cfPaymentId) orderUpdate.cashfreePaymentId = cfPaymentId;
  batch.update(col.orders().doc(orderId), orderUpdate);

  await batch.commit();
  return { plan, planExpiry: expiry.toISOString() };
}

// ── Get User Stats ────────────────────────────────────────────────────────────
async function getUserStats(uid) {
  const [userSnap, analyticsSnap] = await Promise.all([
    col.users().doc(uid).get(),
    col.analytics().doc(uid).get(),
  ]);
  const p = userSnap.data()?.profile || {};
  const a = analyticsSnap.data() || {};
  const dailyViews = a.dailyViews || {};

  let weekViews = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    weekViews += dailyViews[d.toISOString().split('T')[0]] || 0;
  }

  return {
    projects:   (p.projects   || []).length,
    saas:       (p.saas       || []).length,
    hosting:    (p.hosting    || []).length,
    totalViews: a.totalViews  || 0,
    totalClicks:a.totalClicks || 0,
    weekViews,
  };
}

// ── Delete Account ────────────────────────────────────────────────────────────
async function deleteUserAccount(uid) {
  const snap      = await col.users().doc(uid).get();
  const subdomain = snap.data()?.subdomain;

  const batch = col.users().firestore.batch();
  batch.delete(col.users().doc(uid));
  batch.delete(col.analytics().doc(uid));
  if (subdomain) {
    batch.delete(col.subdoms().doc(subdomain));
    batch.delete(col.sites().doc(subdomain));
  }
  await batch.commit();

  // Delete from Firebase Auth
  const { getAuth } = require('../config/firebase');
  await getAuth().deleteUser(uid);
}

// ── Track View ────────────────────────────────────────────────────────────────
async function trackView(uid) {
  const today = new Date().toISOString().split('T')[0];
  await col.analytics().doc(uid).set({
    totalViews:              admin.firestore.FieldValue.increment(1),
    [`dailyViews.${today}`]: admin.firestore.FieldValue.increment(1),
    updatedAt:               admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

module.exports = {
  getOrCreateUser, updateProfile, updateTemplate,
  changeSubdomain, activatePlan, getUserStats,
  deleteUserAccount, trackView,
};
