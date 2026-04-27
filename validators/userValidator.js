// validators/userValidator.js
// ═══════════════════════════════════════════════════════
//  Joi validation schemas for all user input
//  Used in routes to validate request bodies before DB ops
// ═══════════════════════════════════════════════════════

'use strict';

const Joi = require('joi');

// ── Reusable field validators ─────────────────────────────────────────────────
const urlOrEmpty = Joi.string().uri({ scheme: ['http', 'https'] }).allow('').max(300);
const strOrEmpty = (max = 200) => Joi.string().max(max).allow('').trim();

// ── Profile Schema ────────────────────────────────────────────────────────────
const profileSchema = Joi.object({
  name:        strOrEmpty(100),
  title:       strOrEmpty(150),
  tagline:     strOrEmpty(200),
  bio:         strOrEmpty(1200),
  location:    strOrEmpty(100),
  available:   Joi.boolean(),
  skills:      Joi.array().items(Joi.string().max(50)).max(40),
  achievements:Joi.array().items(Joi.string().max(100)).max(15),

  education: Joi.array().items(Joi.object({
    id:     Joi.string().max(50),
    degree: strOrEmpty(200),
    school: strOrEmpty(200),
    year:   strOrEmpty(20),
    gpa:    strOrEmpty(15),
  })).max(10),

  experience: Joi.array().items(Joi.object({
    id:      Joi.string().max(50),
    role:    strOrEmpty(150),
    company: strOrEmpty(150),
    period:  strOrEmpty(60),
    desc:    strOrEmpty(800),
    tech:    Joi.array().items(Joi.string().max(60)).max(20),
  })).max(20),

  contact: Joi.object({
    email:    Joi.string().email().allow('').max(200),
    github:   strOrEmpty(300),
    linkedin: strOrEmpty(300),
    twitter:  strOrEmpty(100),
    website:  strOrEmpty(300),
  }),

  projects: Joi.array().items(Joi.object({
    id:       Joi.string().max(50),
    title:    strOrEmpty(200),
    desc:     strOrEmpty(1200),
    stack:    Joi.array().items(Joi.string().max(60)).max(20),
    github:   urlOrEmpty,
    live:     urlOrEmpty,
    video:    urlOrEmpty,
    featured: Joi.boolean(),
  })).max(100),

  saas: Joi.array().items(Joi.object({
    id:       Joi.string().max(50),
    name:     strOrEmpty(150),
    desc:     strOrEmpty(800),
    platform: urlOrEmpty,
    demo:     urlOrEmpty,
    badge:    strOrEmpty(40),
  })).max(30),

  hosting: Joi.array().items(Joi.object({
    id:   Joi.string().max(50),
    name: strOrEmpty(150),
    url:  urlOrEmpty,
  })).max(30),

  testimonials: Joi.array().items(Joi.object({
    name: strOrEmpty(150),
    role: strOrEmpty(200),
    text: strOrEmpty(700),
  })).max(15),

}).options({ stripUnknown: true, allowUnknown: false });

// ── Subdomain Schema ──────────────────────────────────────────────────────────
const subdomainSchema = Joi.object({
  subdomain: Joi.string()
    .min(3).max(32)
    .pattern(/^[a-z0-9][a-z0-9-]+[a-z0-9]$/)
    .required()
    .messages({
      'string.pattern.base': 'Subdomain must be lowercase letters, numbers, and hyphens only',
      'string.min': 'Subdomain must be at least 3 characters',
      'string.max': 'Subdomain cannot exceed 32 characters',
    }),
});

// ── Template Schema ───────────────────────────────────────────────────────────
const templateSchema = Joi.object({
  template: Joi.string().valid('nova', 'aurora', 'eclipse').required(),
});

// ── Plan/Payment Schema ───────────────────────────────────────────────────────
const createOrderSchema = Joi.object({
  plan:  Joi.string().valid('pro', 'enterprise').required(),
  phone: Joi.string().pattern(/^[6-9]\d{9}$/).allow('').optional()
    .messages({ 'string.pattern.base': 'Enter a valid 10-digit Indian mobile number' }),
});

const verifyPaymentSchema = Joi.object({
  orderId:        Joi.string().required(),
  cashfreeOrderId:Joi.string().required(),
});

// ── Validation Helper ─────────────────────────────────────────────────────────
function validate(schema, data) {
  const { error, value } = schema.validate(data, { abortEarly: false });
  if (error) {
    const err = new Error('Validation failed');
    err.isJoi   = true;
    err.details = error.details;
    throw err;
  }
  return value;
}

module.exports = {
  profileSchema,
  subdomainSchema,
  templateSchema,
  createOrderSchema,
  verifyPaymentSchema,
  validate,
};
