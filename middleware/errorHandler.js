// middleware/errorHandler.js
// Global error handler — catches all unhandled errors from routes
'use strict';

function errorHandler(err, req, res, next) {
  const isDev = process.env.NODE_ENV !== 'production';

  // Log error
  console.error(`\n❌ [${new Date().toISOString()}] ${req.method} ${req.path}`);
  console.error(`   Code: ${err.code || 'UNKNOWN'}`);
  console.error(`   Message: ${err.message}`);
  if (isDev && err.stack) console.error(err.stack);

  // CORS error
  if (err.message?.startsWith('CORS blocked')) {
    return res.status(403).json({ success: false, error: err.message, code: 'CORS_ERROR' });
  }

  // Firebase Auth errors
  if (err.code?.startsWith('auth/')) {
    return res.status(401).json({ success: false, error: 'Authentication error', code: err.code });
  }

  // Firebase Firestore errors
  if (err.code?.startsWith('firestore/') || err.code === 5) {
    return res.status(503).json({ success: false, error: 'Database error', code: 'DB_ERROR' });
  }

  // Joi validation errors
  if (err.isJoi || err.name === 'ValidationError') {
    return res.status(400).json({
      success: false,
      error:  'Validation failed',
      details: err.details?.map(d => d.message) || [err.message],
    });
  }

  // Cashfree API errors
  if (err.response?.data) {
    return res.status(502).json({
      success: false,
      error:   'Payment gateway error',
      details: isDev ? err.response.data?.message : undefined,
    });
  }

  // Axios network error
  if (err.code === 'ECONNREFUSED' || err.code === 'ETIMEDOUT') {
    return res.status(503).json({ success: false, error: 'External service unavailable' });
  }

  // Default 500
  res.status(err.status || 500).json({
    success: false,
    error:   isDev ? err.message : 'Internal server error',
    code:    err.code || 'INTERNAL_ERROR',
  });
}

// 404 handler — route not found
function notFound(req, res) {
  res.status(404).json({
    success: false,
    error:   `Route not found: ${req.method} ${req.path}`,
    code:    'NOT_FOUND',
  });
}

module.exports = { errorHandler, notFound };
