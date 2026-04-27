// routes/sites.js
// Serves generated portfolio HTML from Firestore
'use strict';

const express = require('express');
const { col }        = require('../config/firebase');
const { asyncHandler } = require('../utils/helpers');

const router = express.Router();

// ── GET /site/:subdomain ──────────────────────────────────────────────────────
// Serves the generated HTML for a portfolio
// In production: put a CDN (Cloudflare) in front of this
router.get('/:subdomain', asyncHandler(async (req, res) => {
  const { subdomain } = req.params;

  if (!subdomain || !/^[a-z0-9][a-z0-9-]*[a-z0-9]$/.test(subdomain)) {
    return res.status(400).send('<h2>Invalid subdomain</h2>');
  }

  const snap = await col.sites().doc(subdomain).get();

  if (!snap.exists) {
    return res.status(404).send(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1.0"/>
  <title>Portfolio Not Found — FolioOS</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:sans-serif;background:#07090f;color:#e2e8f0;display:flex;align-items:center;justify-content:center;min-height:100vh;text-align:center;padding:24px;}
    h2{font-size:28px;margin-bottom:12px}p{color:#64748b;margin-bottom:24px}
    a{display:inline-block;padding:12px 28px;background:#6366f1;color:#fff;border-radius:10px;text-decoration:none;font-weight:600;}
  </style>
</head>
<body>
  <div>
    <h2>Portfolio not found</h2>
    <p>This portfolio doesn't exist or hasn't been generated yet.</p>
    <a href="${process.env.FRONTEND_URL || '/'}">Go to FolioOS →</a>
  </div>
</body>
</html>`);
  }

  const { html } = snap.data();

  res.setHeader('Content-Type',  'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
  res.setHeader('X-Powered-By',  'FolioOS Template Engine');
  res.send(html);
}));

module.exports = router;
