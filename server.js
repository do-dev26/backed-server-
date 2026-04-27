// server.js
// ═══════════════════════════════════════════════════════
//  FolioOS Backend Server
//  Express + Firebase Admin SDK + Cashfree Payments
//
//  Quick Start:
//    1. cp .env.example .env
//    2. Fill in Firebase and Cashfree credentials
//    3. npm install
//    4. npm run dev
// ═══════════════════════════════════════════════════════

'use strict';

require('dotenv').config();

const express      = require('express');
const cors         = require('cors');
const helmet       = require('helmet');
const morgan       = require('morgan');
const rateLimit    = require('express-rate-limit');
const compression  = require('compression');

// ── 1. Initialize Firebase BEFORE importing routes ────────────────────────────
const { initFirebase } = require('./config/firebase');
initFirebase();

// ── 2. Import Routes ──────────────────────────────────────────────────────────
const usersRouter     = require('./routes/users');
const paymentsRouter  = require('./routes/payments');
const analyticsRouter = require('./routes/analytics');
const sitesRouter     = require('./routes/sites');

// ── 3. Import Middleware ──────────────────────────────────────────────────────
const { errorHandler, notFound } = require('./middleware/errorHandler');

// ── 4. Create App ─────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 5000;
const IS_PROD = process.env.NODE_ENV === 'production';

// ── 5. Trust Proxy (required for Render.com / Railway) ───────────────────────
app.set('trust proxy', 1);

// ── 6. CORS Configuration ────────────────────────────────────────────────────
const allowedOrigins = [
  process.env.FRONTEND_URL,       // Netlify URL
  'http://localhost:3000',         // Local dev React
  'http://localhost:5500',         // VS Code Live Server
  'http://127.0.0.1:5500',
  /\.netlify\.app$/,               // All Netlify preview URLs
  /\.folio\.dev$/,                 // All folio.dev subdomains
].filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow same-origin (no origin header) and Render health checks
    if (!origin) return callback(null, true);

    const allowed = allowedOrigins.some(o =>
      typeof o === 'string' ? o === origin : o instanceof RegExp ? o.test(origin) : false
    );

    if (allowed) return callback(null, true);
    callback(new Error(`CORS blocked: ${origin}`));
  },
  methods:         ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders:  ['Content-Type', 'Authorization'],
  credentials:     true,
  maxAge:          86400, // Preflight cache: 24h
}));

// ── 7. Security Headers ───────────────────────────────────────────────────────
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  contentSecurityPolicy:     false, // Handled by Netlify
  crossOriginEmbedderPolicy: false,
}));

// ── 8. Compression ────────────────────────────────────────────────────────────
app.use(compression());

// ── 9. Request Logging ────────────────────────────────────────────────────────
app.use(morgan(IS_PROD ? 'combined' : 'dev'));

// ── 10. Rate Limiting ─────────────────────────────────────────────────────────
const makeRateLimit = (max, windowMs = 15 * 60 * 1000) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders:   false,
  message:         { success: false, error: 'Too many requests. Try again later.', code: 'RATE_LIMITED' },
});

const globalLimit  = makeRateLimit(parseInt(process.env.RATE_LIMIT_MAX_REQUESTS) || 200);
const authLimit    = makeRateLimit(parseInt(process.env.AUTH_RATE_LIMIT_MAX)     || 30);
const paymentLimit = makeRateLimit(parseInt(process.env.PAYMENT_RATE_LIMIT_MAX)  || 10, 60 * 60 * 1000);

app.use(globalLimit);

// ── 11. Body Parsing ──────────────────────────────────────────────────────────
// IMPORTANT: Cashfree webhook needs raw body — skip JSON parse for that route
app.use((req, res, next) => {
  if (req.originalUrl === '/api/payments/webhook') return next();
  express.json({ limit: '2mb' })(req, res, next);
});
app.use(express.urlencoded({ extended: true, limit: '2mb' }));

// ── 12. Health Check ──────────────────────────────────────────────────────────
// Render.com pings /health to determine if service is alive
app.get('/health', (req, res) => {
  res.json({
    status:      'ok',
    service:     'folioos-backend',
    version:     require('./package.json').version,
    environment: process.env.NODE_ENV || 'development',
    firebase:    process.env.FIREBASE_PROJECT_ID ? '✅ connected' : '❌ not configured',
    cashfree:    require('./config/cashfree').CF_ENV,
    uptime:      `${Math.floor(process.uptime())}s`,
    timestamp:   new Date().toISOString(),
    memory:      `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
  });
});

// ── 13. Public Routes ─────────────────────────────────────────────────────────

// Templates list — no auth required
app.get('/api/templates', (req, res) => {
  const { TEMPLATES } = require('./engine/templateEngine');
  res.json({
    success:   true,
    templates: Object.values(TEMPLATES).map(t => ({
      id:          t.id,
      name:        t.name,
      description: t.description,
      accentColor: t.accentColor,
      plans:       t.plans,
    })),
  });
});

// Serve generated portfolio sites
app.use('/site', sitesRouter);

// ── 14. Protected API Routes ──────────────────────────────────────────────────
app.use('/api/users',     authLimit,    usersRouter);
app.use('/api/payments',  paymentLimit, paymentsRouter);
app.use('/api/analytics',               analyticsRouter);

// ── 15. 404 + Error Handlers ──────────────────────────────────────────────────
app.use(notFound);
app.use(errorHandler);

// ── 16. Graceful Shutdown ─────────────────────────────────────────────────────
process.on('SIGTERM', () => {
  console.log('\n🔻 SIGTERM received — shutting down gracefully...');
  server.close(() => {
    console.log('✅ Server closed');
    process.exit(0);
  });
});

process.on('uncaughtException', (err) => {
  console.error('💥 Uncaught Exception:', err.message);
  if (!IS_PROD) console.error(err.stack);
});

process.on('unhandledRejection', (reason) => {
  console.error('💥 Unhandled Rejection:', reason);
});

// ── 17. Start Server ──────────────────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('\n');
  console.log('╔═══════════════════════════════════════════════╗');
  console.log('║         FolioOS Backend Server                ║');
  console.log('╚═══════════════════════════════════════════════╝');
  console.log('');
  console.log(`  🚀 Server:    http://localhost:${PORT}`);
  console.log(`  🌍 Env:       ${process.env.NODE_ENV || 'development'}`);
  console.log(`  🔥 Firebase:  ${process.env.FIREBASE_PROJECT_ID || '⚠️  NOT CONFIGURED'}`);
  console.log(`  💳 Cashfree:  ${require('./config/cashfree').CF_ENV} mode`);
  console.log(`  🌐 Frontend:  ${process.env.FRONTEND_URL || 'http://localhost:3000'}`);
  console.log('');
  console.log('  API Routes:');
  console.log('  GET  /health');
  console.log('  GET  /api/templates');
  console.log('  GET  /site/:subdomain');
  console.log('  ─────────────────────────────');
  console.log('  GET  /api/users/me');
  console.log('  PUT  /api/users/me/profile');
  console.log('  PUT  /api/users/me/template');
  console.log('  PUT  /api/users/me/subdomain');
  console.log('  POST /api/users/me/generate-website');
  console.log('  GET  /api/users/public/:subdomain');
  console.log('  GET  /api/users/check-subdomain/:sub');
  console.log('  DELETE /api/users/me');
  console.log('  ─────────────────────────────');
  console.log('  POST /api/payments/create-order');
  console.log('  POST /api/payments/verify');
  console.log('  POST /api/payments/webhook');
  console.log('  POST /api/payments/refund');
  console.log('  GET  /api/payments/history');
  console.log('  GET  /api/payments/plans');
  console.log('  ─────────────────────────────');
  console.log('  GET  /api/analytics/me');
  console.log('  POST /api/analytics/view');
  console.log('  POST /api/analytics/click');
  console.log('');
});

module.exports = app; // For testing
