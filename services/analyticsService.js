// services/analyticsService.js
// ═══════════════════════════════════════════════════════
//  Analytics Service
//  Tracks views, clicks, referrers in Firestore
//  Real-time updates using FieldValue.increment()
// ═══════════════════════════════════════════════════════

'use strict';

const { col, admin } = require('../config/firebase');

// ── Track Portfolio View ──────────────────────────────────────────────────────
async function trackView(uid, { referrer, userAgent, ip } = {}) {
  const today = new Date().toISOString().split('T')[0];

  const update = {
    totalViews:              admin.firestore.FieldValue.increment(1),
    [`dailyViews.${today}`]: admin.firestore.FieldValue.increment(1),
    updatedAt:               admin.firestore.FieldValue.serverTimestamp(),
  };

  // Track referrer domain if available
  if (referrer) {
    try {
      const domain = new URL(referrer).hostname.replace('www.', '');
      if (domain) {
        update[`referrers.${domain.replace(/\./g, '_')}`] = admin.firestore.FieldValue.increment(1);
      }
    } catch {}
  }

  await col.analytics().doc(uid).set(update, { merge: true });
}

// ── Track Link Click ──────────────────────────────────────────────────────────
async function trackClick(uid, type = 'unknown') {
  const safeType = type.replace(/[^a-z0-9_]/gi, '_').toLowerCase();

  await col.analytics().doc(uid).set({
    totalClicks:              admin.firestore.FieldValue.increment(1),
    [`clicks.${safeType}`]:   admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

// ── Get Analytics (by plan) ───────────────────────────────────────────────────
async function getAnalytics(uid, plan = 'free') {
  const snap = await col.analytics().doc(uid).get();
  const data = snap.data() || {};
  const isPro = ['pro', 'enterprise'].includes(plan);

  // Base stats (available to all)
  const base = {
    totalViews:  data.totalViews  || 0,
    totalClicks: data.totalClicks || 0,
    weekViews:   getWeekViews(data.dailyViews || {}),
  };

  if (!isPro) {
    return { ...base, isPro: false };
  }

  // Pro analytics
  const last30 = getLast30Days(data.dailyViews || {});
  const last7  = getLast7Days(data.dailyViews  || {});

  // Denormalize referrer keys (we stored dots as underscores)
  const referrers = {};
  for (const [k, v] of Object.entries(data.referrers || {})) {
    referrers[k.replace(/_/g, '.')] = v;
  }

  return {
    ...base,
    isPro:         true,
    monthViews:    last30.total,
    dailyViews:    last30.breakdown,
    last7Days:     last7,
    referrers,
    topReferrers:  getTopN(referrers, 5),
    clicksByType:  data.clicks || {},
    topClicks:     getTopN(data.clicks || {}, 5),
    avgDailyViews: last30.total > 0 ? Math.round(last30.total / 30) : 0,
  };
}

// ── Get Analytics for Subdomain (public, no auth) ─────────────────────────────
async function getPublicStats(subdomain) {
  const subSnap = await col.subdoms().doc(subdomain).get();
  if (!subSnap.exists) return null;

  const uid  = subSnap.data().uid;
  const snap = await col.analytics().doc(uid).get();
  const data = snap.data() || {};

  return {
    totalViews: data.totalViews || 0,
  };
}

// ── Batch Track (for import/migration) ───────────────────────────────────────
async function batchTrackViews(uid, viewsByDate) {
  const update = { updatedAt: admin.firestore.FieldValue.serverTimestamp() };
  let total = 0;

  for (const [date, count] of Object.entries(viewsByDate)) {
    update[`dailyViews.${date}`] = admin.firestore.FieldValue.increment(count);
    total += count;
  }

  update.totalViews = admin.firestore.FieldValue.increment(total);

  await col.analytics().doc(uid).set(update, { merge: true });
  return { tracked: total };
}

// ── Reset Analytics ───────────────────────────────────────────────────────────
async function resetAnalytics(uid) {
  await col.analytics().doc(uid).set({
    totalViews:  0,
    totalClicks: 0,
    dailyViews:  {},
    referrers:   {},
    clicks:      {},
    updatedAt:   admin.firestore.FieldValue.serverTimestamp(),
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekViews(dailyViews) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    total += dailyViews[d.toISOString().split('T')[0]] || 0;
  }
  return total;
}

function getLast7Days(dailyViews) {
  const result = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().split('T')[0];
    result.push({
      date:  key,
      views: dailyViews[key] || 0,
      day:   d.toLocaleDateString('en-IN', { weekday: 'short' }),
    });
  }
  return result;
}

function getLast30Days(dailyViews) {
  let total = 0;
  const breakdown = {};
  for (let i = 29; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key   = d.toISOString().split('T')[0];
    const views = dailyViews[key] || 0;
    breakdown[key] = views;
    total += views;
  }
  return { total, breakdown };
}

function getTopN(obj, n) {
  return Object.entries(obj)
    .sort(([, a], [, b]) => b - a)
    .slice(0, n)
    .map(([key, count]) => ({ key, count }));
}

module.exports = {
  trackView,
  trackClick,
  getAnalytics,
  getPublicStats,
  batchTrackViews,
  resetAnalytics,
};
