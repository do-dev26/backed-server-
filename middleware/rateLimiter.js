// middleware/rateLimiter.js
// Centralized rate limiting configuration
'use strict';

const rateLimit = require('express-rate-limit');

const make = (max, windowMs = 15 * 60 * 1000, message = 'Too many requests.') =>
  rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders:   false,
    message: { success: false, error: message, code: 'RATE_LIMITED' },
  });

module.exports = {
  global:   make(200),
  auth:     make(30,              15 * 60 * 1000, 'Too many auth attempts.'),
  payment:  make(10,              60 * 60 * 1000, 'Too many payment attempts.'),
  generate: make(20,              60 * 60 * 1000, 'Too many generation requests.'),
  public:   make(500, 15 * 60 * 1000),
};
