// routes/analytics.js
// Real-time analytics stored in Firestore
'use strict';

const express = require('express');
const { col, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// ── GET /api/analytics/me ─────────────────────────────────────────────────────
// Get analytics for logged-in user
// Free users: totals only | Pro users: full breakdown
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const [userSnap, analyticsSnap] = await Promise.all([
    col.users().doc(req.user.uid).get(),
    col.analytics().doc(req.user.uid).get(),
  ]);

  const plan  = userSnap.data()?.plan || 'free';
  const isPro = ['pro', 'enterprise'].includes(plan);
  const data  = analyticsSnap.data() || {};

  const base = {
    totalViews:  data.totalViews  || 0,
    totalClicks: data.totalClicks || 0,
    weekViews:   getWeekViews(data.dailyViews || {}),
  };

  if (!isPro) {
    return res.json({ success: true, isPro: false, analytics: base });
  }

  // Pro: full data
  const last30 = getLast30Days(data.dailyViews || {});
  return res.json({
    success: true,
    isPro:   true,
    analytics: {
      ...base,
      monthViews:    last30.total,
      dailyViews:    last30.breakdown,
      referrers:     data.referrers || {},
      topReferrers:  getTopReferrers(data.referrers || {}, 5),
      clicksByType:  data.clicks || {},
    },
  });
}));

// ── POST /api/analytics/view ──────────────────────────────────────────────────
// Track a portfolio page view (called from portfolio site JS)
router.post('/view', asyncHandler(async (req, res) => {
  const { subdomain } = req.body;
  if (!subdomain) return res.status(400).json({ success: false });

  const subSnap = await col.subdoms().doc(subdomain).get();
  if (!subSnap.exists) return res.json({ success: false });

  const uid   = subSnap.data().uid;
  const today = new Date().toISOString().split('T')[0];

  await col.analytics().doc(uid).set({
    totalViews:              admin.firestore.FieldValue.increment(1),
    [`dailyViews.${today}`]: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  res.json({ success: true });
}));

// ── POST /api/analytics/click ─────────────────────────────────────────────────
// Track a link click on portfolio (github, live demo etc.)
router.post('/click', asyncHandler(async (req, res) => {
  const { subdomain, type } = req.body;
  if (!subdomain) return res.status(400).json({ success: false });

  const subSnap = await col.subdoms().doc(subdomain).get();
  if (!subSnap.exists) return res.json({ success: false });

  const uid      = subSnap.data().uid;
  const linkType = type || 'unknown';

  await col.analytics().doc(uid).set({
    totalClicks:                   admin.firestore.FieldValue.increment(1),
    [`clicks.${linkType}`]:        admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  res.json({ success: true });
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
function getWeekViews(dailyViews) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    total += dailyViews[d.toISOString().split('T')[0]] || 0;
  }
  return total;
}

function getLast30Days(dailyViews) {
  let total = 0;
  const breakdown = {};
  for (let i = 0; i < 30; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    const key   = d.toISOString().split('T')[0];
    const views = dailyViews[key] || 0;
    breakdown[key] = views;
    total += views;
  }
  return { total, breakdown };
}

function getTopReferrers(referrers, limit) {
  return Object.entries(referrers)
    .sort(([, a], [, b]) => b - a)
    .slice(0, limit)
    .map(([domain, count]) => ({ domain, count }));
}

module.exports = router;
