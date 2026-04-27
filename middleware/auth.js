// middleware/auth.js
// ═══════════════════════════════════════════════════════
//  Firebase Authentication Middleware
//
//  How Firebase Auth works with this backend:
//  1. User signs in on frontend via Firebase Client SDK
//  2. Firebase issues an ID Token (JWT, valid 1 hour)
//  3. Frontend sends: Authorization: Bearer <idToken>
//  4. This middleware calls Firebase Admin to verify token
//  5. Attaches decoded user (uid, email) to req.user
//  6. Token auto-refreshes on frontend — transparent to user
// ═══════════════════════════════════════════════════════

'use strict';

const { getAuth, col, admin } = require('../config/firebase');

// ── Main Auth Middleware ──────────────────────────────────────────────────────
async function verifyToken(req, res, next) {
  try {
    const header = req.headers.authorization;

    // Check header format
    if (!header || !header.startsWith('Bearer ')) {
      return res.status(401).json({
        success: false,
        error:   'Unauthorized: Missing or invalid Authorization header',
        code:    'NO_TOKEN',
        hint:    'Send: Authorization: Bearer <firebase-id-token>',
      });
    }

    const idToken = header.split('Bearer ')[1]?.trim();
    if (!idToken) {
      return res.status(401).json({ success: false, error: 'Empty token', code: 'EMPTY_TOKEN' });
    }

    // Verify with Firebase Admin SDK
    // This checks: signature, expiry, issuer, audience
    const decoded = await getAuth().verifyIdToken(idToken);

    // Attach to request
    req.user = {
      uid:           decoded.uid,
      email:         decoded.email,
      emailVerified: decoded.email_verified,
      name:          decoded.name,
    };

    next();

  } catch (err) {
    // Map Firebase error codes to friendly responses
    const errorMap = {
      'auth/id-token-expired':    { status: 401, error: 'Token expired — please re-login', code: 'TOKEN_EXPIRED' },
      'auth/id-token-revoked':    { status: 401, error: 'Token revoked — please re-login', code: 'TOKEN_REVOKED' },
      'auth/invalid-id-token':    { status: 401, error: 'Invalid token',                   code: 'INVALID_TOKEN' },
      'auth/user-disabled':       { status: 403, error: 'Account disabled',                code: 'USER_DISABLED' },
      'auth/argument-error':      { status: 401, error: 'Malformed token',                 code: 'MALFORMED_TOKEN' },
    };

    const mapped = errorMap[err.code];
    if (mapped) {
      return res.status(mapped.status).json({ success: false, ...mapped });
    }

    console.error('Auth middleware error:', err.code, err.message);
    return res.status(401).json({ success: false, error: 'Authentication failed', code: 'AUTH_FAILED' });
  }
}

// ── Optional Auth ─────────────────────────────────────────────────────────────
// Attaches user if token present but doesn't fail if absent
async function optionalAuth(req, res, next) {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    req.user = null;
    return next();
  }
  try {
    const decoded = await getAuth().verifyIdToken(header.split('Bearer ')[1].trim());
    req.user = { uid: decoded.uid, email: decoded.email };
  } catch {
    req.user = null;
  }
  next();
}

// ── Plan Guard ────────────────────────────────────────────────────────────────
// Use after verifyToken. Checks if user has required plan.
// Usage: router.get('/pro-feature', verifyToken, requirePlan('pro'), handler)
function requirePlan(requiredPlan) {
  const hierarchy = { free: 0, pro: 1, enterprise: 2 };

  return async (req, res, next) => {
    try {
      const snap = await col.users().doc(req.user.uid).get();
      if (!snap.exists) {
        return res.status(404).json({ success: false, error: 'User not found' });
      }

      const data = snap.data();

      // Check if plan is expired
      if (data.plan !== 'free' && data.planExpiry) {
        const expiry = data.planExpiry.toDate?.() || new Date(data.planExpiry);
        if (expiry < new Date()) {
          // Auto-downgrade expired plan
          await col.users().doc(req.user.uid).update({
            plan:       'free',
            planExpiry: null,
            updatedAt:  admin.firestore.FieldValue.serverTimestamp(),
          });
          return res.status(403).json({
            success: false,
            error:   'Your subscription has expired. Please renew.',
            code:    'PLAN_EXPIRED',
          });
        }
      }

      const userLevel     = hierarchy[data.plan]     ?? 0;
      const requiredLevel = hierarchy[requiredPlan]  ?? 0;

      if (userLevel < requiredLevel) {
        return res.status(403).json({
          success:       false,
          error:         `This feature requires the ${requiredPlan} plan`,
          code:          'INSUFFICIENT_PLAN',
          required:      requiredPlan,
          current:       data.plan,
          upgradeUrl:    `${process.env.FRONTEND_URL}/pages/pricing.html`,
        });
      }

      // Attach plan to request for downstream use
      req.userPlan = data.plan;
      next();

    } catch (err) {
      next(err);
    }
  };
}

module.exports = { verifyToken, optionalAuth, requirePlan };
