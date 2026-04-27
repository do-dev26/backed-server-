# FolioOS Backend

> Express.js + Firebase Admin SDK + Cashfree Payments + Template Engine

## Project Structure

```
folioos-backend/
├── server.js                    ← Entry point — Express app
├── package.json
├── render.yaml                  ← Render.com deployment config
├── .env.example                 ← Copy to .env and fill values
├── .gitignore
│
├── config/
│   ├── firebase.js              ← Firebase Admin SDK init + Firestore collections
│   └── cashfree.js              ← Cashfree API config + PLANS + helpers
│
├── middleware/
│   ├── auth.js                  ← Firebase token verification
│   └── errorHandler.js          ← Global error handler + 404
│
├── routes/
│   ├── users.js                 ← User CRUD (Firestore)
│   ├── payments.js              ← Cashfree orders + webhook + refunds
│   ├── analytics.js             ← View/click tracking
│   └── sites.js                 ← Serve generated HTML portfolios
│
├── engine/
│   └── templateEngine.js        ← HTML generator (Nova, Aurora, Eclipse)
│
├── validators/
│   └── userValidator.js         ← Joi validation schemas
│
├── utils/
│   └── helpers.js               ← Shared utility functions
│
└── tests/
    └── test.js                  ← API test suite (no external deps)
```

---

## Setup

### 1. Install Dependencies
```bash
npm install
```

### 2. Configure Environment
```bash
cp .env.example .env
# Open .env and fill in your Firebase and Cashfree credentials
```

### 3. Run Development Server
```bash
npm run dev        # With nodemon (auto-restart)
npm start          # Production
npm test           # Run API tests (start server first)
```

---

## API Reference

### Public Endpoints (no auth required)

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/health` | Server health + Firebase/Cashfree status |
| GET | `/api/templates` | List all 3 portfolio templates |
| GET | `/api/payments/plans` | Available subscription plans |
| GET | `/api/users/check-subdomain/:sub` | Check if subdomain is available |
| GET | `/api/users/public/:subdomain` | Get public portfolio data |
| GET | `/site/:subdomain` | Serve generated portfolio HTML |
| POST | `/api/analytics/view` | Track portfolio view |
| POST | `/api/analytics/click` | Track link click |

### Protected Endpoints (Firebase token required)

**Headers:** `Authorization: Bearer <firebase-id-token>`

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/users/me` | Get current user (creates if new) |
| PUT | `/api/users/me/profile` | Update profile in Firestore |
| PUT | `/api/users/me/template` | Switch portfolio template |
| PUT | `/api/users/me/subdomain` | Change subdomain (atomic) |
| POST | `/api/users/me/generate-website` | Run Template Engine |
| GET | `/api/users/me/stats` | Get profile stats |
| DELETE | `/api/users/me` | Delete account + all data |
| POST | `/api/payments/create-order` | Create Cashfree order |
| POST | `/api/payments/verify` | Verify payment after redirect |
| GET | `/api/payments/history` | Payment history |
| POST | `/api/payments/refund` | Request refund |
| GET | `/api/analytics/me` | Analytics (Pro: full, Free: basic) |

### Cashfree Webhook
| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/payments/webhook` | Cashfree payment event webhook |

---

## Firebase Firestore Schema

```
users/{uid}
  uid, email, displayName
  plan: "free"|"pro"|"enterprise"
  planExpiry: Timestamp|null
  template: "nova"|"aurora"|"eclipse"
  subdomain: string
  websiteGenerated: boolean
  websiteVersion: number
  profile: { name, title, bio, skills[], experience[], projects[], ... }

orders/{orderId}
  uid, email, plan, amount, currency
  status: "CREATED"|"PAID"|"FAILED"|"REFUNDED"
  cashfreeOrderId, paymentSessionId
  createdAt, paidAt

generated_sites/{subdomain}
  uid, html (full HTML string), template, version, generatedAt

analytics/{uid}
  totalViews, totalClicks
  dailyViews: { "YYYY-MM-DD": number }
  referrers: { "domain.com": number }

subdomains/{subdomain}
  uid  ← fast lookup index
```

---

## Template Engine

The Template Engine generates **complete standalone HTML files** from user profile data.

```
POST /api/users/me/generate-website
  ↓
engine/templateEngine.js
  ↓
Reads user profile from Firestore
  ↓
Calls template generator (Nova/Aurora/Eclipse)
  ↓
All CSS embedded — works offline
All JS embedded — no external deps
Mobile responsive — works on all devices
Project modals — click for details
  ↓
Saves HTML to Firestore: generated_sites/{subdomain}
  ↓
Returns: { url, version, template }
  ↓
GET /site/:subdomain → serves the HTML
```

---

## Cashfree Payment Flow

```
User clicks "Pay ₹999"
  ↓
Frontend → POST /api/payments/create-order
  ↓
Backend creates Cashfree order → returns paymentSessionId
  ↓
Frontend loads Cashfree JS SDK:
  const cashfree = Cashfree({ mode: "sandbox" })
  cashfree.checkout({ paymentSessionId })
  ↓
User pays via Card/UPI/NetBanking
  ↓
Cashfree sends webhook → POST /api/payments/webhook
  ↓
Backend verifies signature → activates plan in Firestore:
  users/{uid}.plan = "pro"
  users/{uid}.planExpiry = now + 30 days
  orders/{orderId}.status = "PAID"
  ↓
User plan activated ✅
```

---

## Deploy to Render.com

1. Push backend to GitHub
2. Go to https://render.com → New → Web Service
3. Connect your GitHub repo
4. Settings:
   - Build: `npm install`
   - Start: `node server.js`
   - Region: Singapore
5. Add environment variables from `.env.example`
6. Deploy → get URL: `https://folioos-backend.onrender.com`
7. Set `FRONTEND_URL` to your Netlify URL
8. Add webhook in Cashfree: `https://folioos-backend.onrender.com/api/payments/webhook`

---

## Firestore Security Rules

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /users/{uid} {
      allow read, write: if request.auth != null && request.auth.uid == uid;
    }
    match /generated_sites/{subdomain} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /subdomains/{sub} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    match /orders/{orderId} {
      allow read: if request.auth != null && resource.data.uid == request.auth.uid;
      allow write: if false;  // Backend only
    }
    match /analytics/{uid} {
      allow read: if request.auth != null && request.auth.uid == uid;
      allow write: if false;  // Backend only
    }
  }
}
```
