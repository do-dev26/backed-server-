// config/firebase.js
// ═══════════════════════════════════════════════════════
//  Firebase Admin SDK Initialization
//  Handles: Firestore DB + Auth Token Verification
//
//  Firestore Collections Schema:
//
//  users/{uid}
//    ├── uid, email, displayName
//    ├── plan: "free"|"pro"|"enterprise"
//    ├── planExpiry: Timestamp|null
//    ├── template: "nova"|"aurora"|"eclipse"
//    ├── subdomain: string
//    ├── customDomain: string|null
//    ├── websiteGenerated: boolean
//    ├── websiteVersion: number
//    ├── createdAt, updatedAt: Timestamp
//    └── profile: { ...all user content }
//
//  orders/{orderId}
//    ├── uid, email, plan
//    ├── amount, currency
//    ├── status: "CREATED"|"PAID"|"FAILED"|"REFUNDED"
//    ├── cashfreeOrderId, paymentSessionId
//    └── createdAt, paidAt
//
//  generated_sites/{subdomain}
//    ├── uid, html (full generated HTML)
//    ├── template, generatedAt
//    └── version
//
//  analytics/{uid}
//    ├── totalViews, totalClicks
//    ├── dailyViews: { "YYYY-MM-DD": number }
//    └── referrers: { "domain": number }
//
//  subdomains/{subdomain}
//    └── uid (fast lookup index)
// ═══════════════════════════════════════════════════════
'use strict';

const admin = require('firebase-admin');

let _db = null;
let _auth = null;

function initFirebase() {
  // Already initialized check
  if (admin.apps.length > 0) {
    _db = admin.firestore();
    _auth = admin.auth();
    return { db: _db, auth: _auth };
  }

  // Env validation
  const required = [
    'FIREBASE_PROJECT_ID',
    'FIREBASE_CLIENT_EMAIL',
    'FIREBASE_PRIVATE_KEY'
  ];

  const missing = required.filter(k => !process.env[k]);

  if (missing.length > 0) {
    console.error('❌ Missing Firebase env variables:');
    missing.forEach(k => console.error(' - ' + k));
    process.exit(1);
  }

  // 🔥 SAFE PRIVATE KEY FIX
const rawKey = (process.env.FIREBASE_PRIVATE_KEY || '').replace(/^"|"$/g, '');
const privateKey = rawKey.replace(/\\n/g, '\n');

  const serviceAccount = {
    type: 'service_account',
    project_id: process.env.FIREBASE_PROJECT_ID,
    client_email: process.env.FIREBASE_CLIENT_EMAIL,
    private_key: privateKey,
  };

  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount),
  });

  _db = admin.firestore();
  _auth = admin.auth();

  console.log('✅ Firebase initialized successfully');
}

// Helpers
function getDB() {
  return _db || admin.firestore();
}

function getAuth() {
  return _auth || admin.auth();
}

const col = {
  users: () => getDB().collection('users'),
  orders: () => getDB().collection('orders'),
  analytics: () => getDB().collection('analytics'),
  sites: () => getDB().collection('generated_sites'),
  subdomains: () => getDB().collection('subdomains'),
};

module.exports = { initFirebase, getDB, getAuth, col, admin };
