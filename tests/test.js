// tests/test.js
// Basic API test suite — run with: npm test
// Tests all endpoints without requiring real Firebase/Cashfree credentials

'use strict';

const http = require('http');

const BASE = `http://localhost:${process.env.PORT || 5000}`;
let passed = 0;
let failed = 0;

// ── HTTP Helper ───────────────────────────────────────────────────────────────
function request(method, path, body = null, headers = {}) {
  return new Promise((resolve, reject) => {
    const url  = new URL(path, BASE);
    const opts = {
      hostname: url.hostname,
      port:     url.port || 80,
      path:     url.pathname + url.search,
      method,
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
    };

    const req = http.request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ── Test Runner ───────────────────────────────────────────────────────────────
async function test(name, fn) {
  try {
    await fn();
    console.log(`  ✅ ${name}`);
    passed++;
  } catch (err) {
    console.log(`  ❌ ${name}`);
    console.log(`     ${err.message}`);
    failed++;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message || 'Assertion failed');
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    throw new Error(message || `Expected ${expected}, got ${actual}`);
  }
}

// ── Test Suites ───────────────────────────────────────────────────────────────
async function runTests() {
  console.log('\n═══════════════════════════════════════');
  console.log('  FolioOS Backend — API Tests');
  console.log('═══════════════════════════════════════\n');

  // ── Health ────────────────────────────────────────────────────────────────
  console.log('📋 Health & Status');
  await test('GET /health returns 200', async () => {
    const res = await request('GET', '/health');
    assertEqual(res.status, 200, `Expected 200, got ${res.status}`);
    assert(res.body.status === 'ok', 'status should be ok');
    assert(res.body.service === 'folioos-backend', 'service name check');
    assert(res.body.uptime, 'uptime should be present');
  });

  await test('GET /health has firebase and cashfree fields', async () => {
    const res = await request('GET', '/health');
    assert('firebase' in res.body, 'firebase field missing');
    assert('cashfree' in res.body, 'cashfree field missing');
  });

  // ── Templates ─────────────────────────────────────────────────────────────
  console.log('\n📋 Templates API');
  await test('GET /api/templates returns all templates', async () => {
    const res = await request('GET', '/api/templates');
    assertEqual(res.status, 200);
    assert(res.body.success === true);
    assert(Array.isArray(res.body.templates), 'templates should be an array');
    assertEqual(res.body.templates.length, 3, 'should have 3 templates');
  });

  await test('Templates have required fields', async () => {
    const res = await request('GET', '/api/templates');
    for (const t of res.body.templates) {
      assert(t.id,          `Template missing id`);
      assert(t.name,        `Template missing name`);
      assert(t.accentColor, `Template missing accentColor`);
      assert(Array.isArray(t.plans), `Template missing plans array`);
    }
  });

  await test('Nova template is on free plan', async () => {
    const res  = await request('GET', '/api/templates');
    const nova = res.body.templates.find(t => t.id === 'nova');
    assert(nova, 'Nova template not found');
    assert(nova.plans.includes('free'), 'Nova should be on free plan');
  });

  await test('Aurora and Eclipse are Pro-only', async () => {
    const res     = await request('GET', '/api/templates');
    const aurora  = res.body.templates.find(t => t.id === 'aurora');
    const eclipse = res.body.templates.find(t => t.id === 'eclipse');
    assert(!aurora.plans.includes('free'),  'Aurora should NOT be on free plan');
    assert(!eclipse.plans.includes('free'), 'Eclipse should NOT be on free plan');
  });

  // ── Plans ─────────────────────────────────────────────────────────────────
  console.log('\n📋 Payment Plans');
  await test('GET /api/payments/plans returns plans', async () => {
    const res = await request('GET', '/api/payments/plans');
    assertEqual(res.status, 200);
    assert(res.body.success);
    assert(res.body.plans.pro,        'Pro plan missing');
    assert(res.body.plans.enterprise, 'Enterprise plan missing');
    assert(typeof res.body.environment === 'string');
  });

  await test('Plans have correct pricing (INR)', async () => {
    const res = await request('GET', '/api/payments/plans');
    assertEqual(res.body.plans.pro.amount,        999,  'Pro should be ₹999');
    assertEqual(res.body.plans.enterprise.amount, 2999, 'Enterprise should be ₹2,999');
    assertEqual(res.body.plans.pro.currency,        'INR');
    assertEqual(res.body.plans.enterprise.currency, 'INR');
  });

  // ── Subdomain Check ────────────────────────────────────────────────────────
  console.log('\n📋 Subdomain Validation');
  await test('GET /api/users/check-subdomain/:sub works', async () => {
    const res = await request('GET', '/api/users/check-subdomain/available-sub-test');
    assertEqual(res.status, 200);
    assert('available' in res.body, 'available field missing');
  });

  await test('Reserved subdomains are not available', async () => {
    for (const sub of ['www', 'api', 'admin', 'app']) {
      const res = await request('GET', `/api/users/check-subdomain/${sub}`);
      assert(res.body.available === false, `${sub} should be reserved`);
    }
  });

  await test('Invalid subdomain format returns not available', async () => {
    const res = await request('GET', '/api/users/check-subdomain/a'); // too short
    assert(res.body.available === false);
  });

  // ── Auth Required Routes ──────────────────────────────────────────────────
  console.log('\n📋 Auth Guard Tests');
  const protectedRoutes = [
    ['GET',    '/api/users/me'],
    ['PUT',    '/api/users/me/profile'],
    ['PUT',    '/api/users/me/template'],
    ['PUT',    '/api/users/me/subdomain'],
    ['POST',   '/api/users/me/generate-website'],
    ['POST',   '/api/payments/create-order'],
    ['POST',   '/api/payments/verify'],
    ['GET',    '/api/payments/history'],
    ['GET',    '/api/analytics/me'],
  ];

  for (const [method, path] of protectedRoutes) {
    await test(`${method} ${path} requires auth (401)`, async () => {
      const res = await request(method, path, {});
      assertEqual(res.status, 401, `Expected 401, got ${res.status} for ${method} ${path}`);
      assert(res.body.success === false, 'success should be false');
      assert(res.body.code, 'error code should be present');
    });
  }

  await test('Auth with invalid token returns 401', async () => {
    const res = await request('GET', '/api/users/me', null, {
      'Authorization': 'Bearer invalid.token.here',
    });
    assertEqual(res.status, 401);
    assert(res.body.success === false);
  });

  // ── Public Routes ─────────────────────────────────────────────────────────
  console.log('\n📋 Public Routes');
  await test('GET /api/users/public/:subdomain returns 404 for unknown sub', async () => {
    const res = await request('GET', '/api/users/public/nonexistent-portfolio-test-xyz');
    assertEqual(res.status, 404);
    assert(res.body.success === false);
  });

  await test('GET /site/:subdomain returns 404 for unknown sub', async () => {
    const res = await request('GET', '/site/nonexistent-xyz-test');
    assertEqual(res.status, 404);
    assert(typeof res.body === 'string' || res.status === 404);
  });

  // ── 404 Routes ────────────────────────────────────────────────────────────
  console.log('\n📋 404 Handling');
  await test('Unknown route returns 404', async () => {
    const res = await request('GET', '/api/nonexistent');
    assertEqual(res.status, 404);
    assert(res.body.success === false);
    assert(res.body.code === 'NOT_FOUND');
  });

  // ── Validation ────────────────────────────────────────────────────────────
  console.log('\n📋 Input Validation');
  await test('POST /api/payments/create-order with no auth returns 401 not 500', async () => {
    const res = await request('POST', '/api/payments/create-order', { plan: 'invalid-plan' });
    assertEqual(res.status, 401); // Auth check happens before validation
  });

  // ── Analytics Public Routes ───────────────────────────────────────────────
  console.log('\n📋 Analytics Public Routes');
  await test('POST /api/analytics/view with missing subdomain returns 400', async () => {
    const res = await request('POST', '/api/analytics/view', {});
    assertEqual(res.status, 400);
  });

  await test('POST /api/analytics/click with missing subdomain returns 400', async () => {
    const res = await request('POST', '/api/analytics/click', {});
    assertEqual(res.status, 400);
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n═══════════════════════════════════════');
  console.log(`  Results: ${passed} passed, ${failed} failed`);
  console.log('═══════════════════════════════════════\n');

  if (failed > 0) {
    console.log('  ⚠️  Some tests failed. Check server logs above.\n');
    process.exit(1);
  } else {
    console.log('  🎉 All tests passed!\n');
  }
}

// Wait a moment for server to be ready, then run tests
setTimeout(runTests, 1000);
