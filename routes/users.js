// routes/users.js
// ═══════════════════════════════════════════════════════
//  User Routes — All Firestore CRUD operations
//  All routes except /public/:subdomain require Firebase Auth
// ═══════════════════════════════════════════════════════

'use strict';

const express = require('express');
const { col, admin } = require('../config/firebase');
const { verifyToken } = require('../middleware/auth');
const {
  profileSchema, subdomainSchema, templateSchema, validate,
} = require('../validators/userValidator');
const {
  serializeFirestore, sanitizeProfile, createDefaultUserDoc,
  isReservedSubdomain, asyncHandler,
} = require('../utils/helpers');
const { generateWebsite } = require('../engine/templateEngine');

const router = express.Router();

// ── GET /api/users/me ─────────────────────────────────────────────────────────
// Get current user's data from Firestore
// Creates user doc on first login if doesn't exist
router.get('/me', verifyToken, asyncHandler(async (req, res) => {
  const snap = await col.users().doc(req.user.uid).get();

  if (!snap.exists) {
    // First login — create default user document
    const newUser = createDefaultUserDoc(req.user);
    await col.users().doc(req.user.uid).set(newUser);

    // Reserve subdomain in index collection
    await col.subdoms().doc(newUser.subdomain).set({
      uid:       req.user.uid,
      createdAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    return res.json({ success: true, user: serializeFirestore(newUser), isNew: true });
  }

  const data = snap.data();

  // Auto-expire plan if needed
  if (data.plan !== 'free' && data.planExpiry) {
    const expiry = data.planExpiry.toDate?.() || new Date(data.planExpiry);
    if (expiry < new Date()) {
      await col.users().doc(req.user.uid).update({
        plan:      'free',
        planExpiry: null,
        updatedAt: admin.firestore.FieldValue.serverTimestamp(),
      });
      data.plan      = 'free';
      data.planExpiry = null;
    }
  }

  res.json({ success: true, user: serializeFirestore(data) });
}));

// ── PUT /api/users/me/profile ─────────────────────────────────────────────────
// Update user profile — validates then saves to Firestore
router.put('/me/profile', verifyToken, asyncHandler(async (req, res) => {
  // Validate input
  const profile = validate(profileSchema, req.body);
  const sanitized = sanitizeProfile(profile);

  await col.users().doc(req.user.uid).update({
    profile:   sanitized,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  const updated = await col.users().doc(req.user.uid).get();
  res.json({ success: true, user: serializeFirestore(updated.data()) });
}));

// ── PUT /api/users/me/template ────────────────────────────────────────────────
// Switch portfolio template — validates plan access
router.put('/me/template', verifyToken, asyncHandler(async (req, res) => {
  const { template } = validate(templateSchema, req.body);

  // Check plan for Pro-only templates
  const proTemplates = ['aurora', 'eclipse'];
  if (proTemplates.includes(template)) {
    const snap = await col.users().doc(req.user.uid).get();
    const plan = snap.data()?.plan || 'free';
    if (!['pro', 'enterprise'].includes(plan)) {
      return res.status(403).json({
        success:    false,
        error:      `Template "${template}" requires Pro plan`,
        code:       'INSUFFICIENT_PLAN',
        required:   'pro',
        current:    plan,
      });
    }
  }

  await col.users().doc(req.user.uid).update({
    template,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  res.json({ success: true, template });
}));

// ── PUT /api/users/me/subdomain ───────────────────────────────────────────────
// Change subdomain — checks availability, updates atomically
router.put('/me/subdomain', verifyToken, asyncHandler(async (req, res) => {
  const { subdomain } = validate(subdomainSchema, req.body);

  // Check reserved
  if (isReservedSubdomain(subdomain)) {
    return res.status(400).json({ success: false, error: 'This subdomain is reserved', code: 'RESERVED' });
  }

  // Check availability
  const existing = await col.subdoms().doc(subdomain).get();
  if (existing.exists && existing.data().uid !== req.user.uid) {
    return res.status(409).json({ success: false, error: 'Subdomain already taken', code: 'TAKEN' });
  }

  // Get current subdomain to release
  const userSnap = await col.users().doc(req.user.uid).get();
  const oldSub   = userSnap.data()?.subdomain;

  // Atomic batch write
  const batch = col.users().firestore.batch();
  batch.update(col.users().doc(req.user.uid), {
    subdomain,
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  });
  if (oldSub && oldSub !== subdomain) {
    batch.delete(col.subdoms().doc(oldSub));
  }
  batch.set(col.subdoms().doc(subdomain), {
    uid:       req.user.uid,
    createdAt: admin.firestore.FieldValue.serverTimestamp(),
  });

  await batch.commit();

  res.json({
    success:   true,
    subdomain,
    url:       `https://${subdomain}.${process.env.BASE_DOMAIN || 'folio.dev'}`,
  });
}));

// ── GET /api/users/check-subdomain/:sub ───────────────────────────────────────
// Public — Check if subdomain is available (no auth)
router.get('/check-subdomain/:sub', asyncHandler(async (req, res) => {
  const sub = req.params.sub.toLowerCase().trim();

  if (!/^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/.test(sub)) {
    return res.json({ available: false, reason: 'Invalid format' });
  }
  if (isReservedSubdomain(sub)) {
    return res.json({ available: false, reason: 'Reserved' });
  }

  const snap = await col.subdoms().doc(sub).get();
  res.json({ available: !snap.exists });
}));

// ── POST /api/users/me/generate-website ──────────────────────────────────────
// Run Template Engine → generate HTML → save to Firestore
router.post('/me/generate-website', verifyToken, asyncHandler(async (req, res) => {
  const result = await generateWebsite(req.user.uid);
  res.json({ success: true, ...result });
}));

// ── GET /api/users/public/:subdomain ─────────────────────────────────────────
// Public — Get portfolio profile for rendering (used by portfolio viewer)
router.get('/public/:subdomain', asyncHandler(async (req, res) => {
  const { subdomain } = req.params;

  const subSnap = await col.subdoms().doc(subdomain).get();
  if (!subSnap.exists) {
    return res.status(404).json({ success: false, error: 'Portfolio not found', code: 'NOT_FOUND' });
  }

  const uid     = subSnap.data().uid;
  const userSnap = await col.users().doc(uid).get();

  if (!userSnap.exists || !userSnap.data().websiteGenerated) {
    return res.status(404).json({ success: false, error: 'Portfolio not published yet', code: 'NOT_GENERATED' });
  }

  const data = userSnap.data();

  // Track view (fire-and-forget — don't await)
  trackView(uid).catch(() => {});

  res.json({
    success:   true,
    profile:   serializeFirestore(data.profile),
    template:  data.template,
    subdomain: data.subdomain,
  });
}));

// ── GET /api/users/me/stats ───────────────────────────────────────────────────
// Get user stats summary
router.get('/me/stats', verifyToken, asyncHandler(async (req, res) => {
  const [userSnap, analyticsSnap] = await Promise.all([
    col.users().doc(req.user.uid).get(),
    col.analytics().doc(req.user.uid).get(),
  ]);

  const u = userSnap.data()?.profile || {};
  const a = analyticsSnap.data() || {};

  res.json({
    success: true,
    stats: {
      projects:  (u.projects || []).length,
      saas:      (u.saas || []).length,
      hosting:   (u.hosting || []).length,
      totalViews: a.totalViews || 0,
      weekViews:  getWeekViews(a.dailyViews || {}),
    },
  });
}));

// ── DELETE /api/users/me ──────────────────────────────────────────────────────
// Delete user account and all Firestore data
router.delete('/me', verifyToken, asyncHandler(async (req, res) => {
  const snap = await col.users().doc(req.user.uid).get();
  const subdomain = snap.data()?.subdomain;

  // Delete all user data in batch
  const batch = col.users().firestore.batch();
  batch.delete(col.users().doc(req.user.uid));
  batch.delete(col.analytics().doc(req.user.uid));
  if (subdomain) {
    batch.delete(col.subdoms().doc(subdomain));
    batch.delete(col.sites().doc(subdomain));
  }
  await batch.commit();

  // Delete Firebase Auth user
  await require('../config/firebase').getAuth().deleteUser(req.user.uid);

  res.json({ success: true, message: 'Account deleted' });
}));

// ── Helpers ───────────────────────────────────────────────────────────────────
async function trackView(uid) {
  const today = new Date().toISOString().split('T')[0];
  await col.analytics().doc(uid).set({
    totalViews:              admin.firestore.FieldValue.increment(1),
    [`dailyViews.${today}`]: admin.firestore.FieldValue.increment(1),
    updatedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });
}

function getWeekViews(dailyViews) {
  let total = 0;
  for (let i = 0; i < 7; i++) {
    const d = new Date(); d.setDate(d.getDate() - i);
    total += dailyViews[d.toISOString().split('T')[0]] || 0;
  }
  return total;
}

module.exports = router;
