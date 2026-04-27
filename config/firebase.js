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

let _db   = null;
let _auth = null;

function initFirebase() {
  // Prevent re-initialization
  if (admin.apps.length > 0) {
    _db   = admin.firestore();
    _auth = admin.auth();
    return { db: _db, auth: _auth };
  }

  // Validate required env vars
  const required = ['FIREBASE_PROJECT_ID', 'FIREBASE_CLIENT_EMAIL', 'FIREBASE_PRIVATE_KEY'];
  const missing  = required.filter(k => !process.env[k]);
  if (missing.length > 0) {
    console.error('\n❌ Firebase Admin SDK: Missing environment variables:');
    missing.forEach(k => console.error(`   - ${k}`));
    console.error('\n   Copy .env.example to .env and fill in your Firebase credentials.\n');
    process.exit(1);
  }

  const serviceAccount = {
    type:          'service_account',
    project_id:    process.env.FIREBASE_PROJECT_ID,
    client_email:  process.env.FIREBASE_CLIENT_EMAIL,
    // .env stores \n as literal chars — convert back to real newlines
    private_key:   process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
  };

  admin.initializeApp({
    credential:    admin.credential.cert(serviceAccount),
    databaseURL:   process.env.FIREBASE_DATABASE_URL,
    storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  });

  _db   = admin.firestore();
  _auth = admin.auth();

  // Disable deprecated timestamp behavior
  _db.settings({ ignoreUndefinedProperties: true });

  console.log(`✅ Firebase Admin initialized → Project: ${process.env.FIREBASE_PROJECT_ID}`);
  return { db: _db, auth: _auth };
}

// Collection references — call these after initFirebase()
function getDB()   { return _db   || admin.firestore(); }
function getAuth() { return _auth || admin.auth(); }

// Shorthand collection getters
const col = {
  users:     () => getDB().collection('users'),
  orders:    () => getDB().collection('orders'),
  analytics: () => getDB().collection('analytics'),
  sites:     () => getDB().collection('generated_sites'),
  subdoms:   () => getDB().collection('subdomains'),
};

module.exports = { initFirebase, getDB, getAuth, col, admin };
