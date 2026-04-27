// utils/helpers.js
// Shared utility functions used across routes and services
'use strict';

const { v4: uuidv4 } = require('uuid');
const { admin }      = require('../config/firebase');

// ── Serialize Firestore data ──────────────────────────────────────────────────
// Converts Firestore Timestamps → ISO strings for JSON responses
function serializeFirestore(data) {
  if (!data) return data;
  if (data && typeof data.toDate === 'function') return data.toDate().toISOString();
  if (Array.isArray(data)) return data.map(serializeFirestore);
  if (data && typeof data === 'object') {
    return Object.fromEntries(
      Object.entries(data).map(([k, v]) => [k, serializeFirestore(v)])
    );
  }
  return data;
}

// ── Add IDs to array items ────────────────────────────────────────────────────
function ensureIds(arr) {
  return (arr || []).map(item => ({ ...item, id: item.id || uuidv4() }));
}

// ── Sanitize profile ──────────────────────────────────────────────────────────
// Ensures all array items have IDs before saving to Firestore
function sanitizeProfile(profile) {
  if (!profile) return profile;
  return {
    ...profile,
    education:    ensureIds(profile.education),
    experience:   ensureIds(profile.experience),
    projects:     ensureIds(profile.projects),
    saas:         ensureIds(profile.saas),
    hosting:      ensureIds(profile.hosting),
    testimonials: (profile.testimonials || []).map(t => ({ ...t })),
  };
}

// ── Generate subdomain from name/email ───────────────────────────────────────
function generateSubdomain(nameOrEmail) {
  return (nameOrEmail || 'user')
    .split('@')[0]
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 25) || 'user' + Date.now().toString().slice(-5);
}

// ── Create default user document ─────────────────────────────────────────────
function createDefaultUserDoc(firebaseUser) {
  const displayName = firebaseUser.name || firebaseUser.displayName || firebaseUser.email?.split('@')[0] || '';
  const subdomain   = generateSubdomain(displayName || firebaseUser.email);

  return {
    uid:              firebaseUser.uid,
    email:            firebaseUser.email || '',
    displayName,
    plan:             'free',
    planExpiry:       null,
    template:         'nova',
    subdomain,
    customDomain:     null,
    websiteGenerated: false,
    websiteVersion:   0,
    createdAt:        admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:        admin.firestore.FieldValue.serverTimestamp(),
    profile: {
      name:         displayName,
      title:        '',
      tagline:      '',
      bio:          '',
      location:     '',
      available:    true,
      skills:       [],
      achievements: [],
      education:    [],
      experience:   [],
      contact: {
        email:    firebaseUser.email || '',
        github:   '',
        linkedin: '',
        twitter:  '',
        website:  '',
      },
      projects:     [],
      saas:         [],
      hosting:      [],
      testimonials: [],
    },
  };
}

// ── Reserved subdomains ───────────────────────────────────────────────────────
const RESERVED_SUBDOMAINS = new Set([
  'www','api','app','admin','dashboard','blog','docs','mail','smtp',
  'ftp','dev','test','staging','cdn','static','assets','media',
  'support','help','status','health','login','signup','register',
  'account','billing','pricing','about','contact','terms','privacy',
]);

function isReservedSubdomain(sub) {
  return RESERVED_SUBDOMAINS.has(sub.toLowerCase());
}

// ── Calculate plan expiry ─────────────────────────────────────────────────────
function getPlanExpiry(durationDays = 30) {
  const expiry = new Date();
  expiry.setDate(expiry.getDate() + durationDays);
  return expiry;
}

// ── Async error wrapper ───────────────────────────────────────────────────────
// Wraps async route handlers to automatically pass errors to next()
function asyncHandler(fn) {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

// ── Generate order ID ─────────────────────────────────────────────────────────
function generateOrderId() {
  return `folioos_${uuidv4().replace(/-/g, '').slice(0, 20)}`;
}

module.exports = {
  serializeFirestore,
  sanitizeProfile,
  generateSubdomain,
  createDefaultUserDoc,
  isReservedSubdomain,
  getPlanExpiry,
  asyncHandler,
  generateOrderId,
  ensureIds,
};
