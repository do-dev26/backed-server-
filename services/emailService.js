// services/emailService.js
// ═══════════════════════════════════════════════════════
//  Email Service — Transactional emails
//  Uses nodemailer with SMTP (Gmail / SendGrid / Mailgun)
//
//  Emails sent:
//  - Welcome email on signup
//  - Payment confirmation
//  - Plan expiry reminder
//  - Website generated notification
//  - Password reset (handled by Firebase — no need here)
// ═══════════════════════════════════════════════════════

'use strict';

// nodemailer is optional — add to package.json if needed:
// npm install nodemailer
let nodemailer;
try {
  nodemailer = require('nodemailer');
} catch {
  console.warn('⚠️  nodemailer not installed. Email sending disabled.');
  nodemailer = null;
}

// ── SMTP Transporter ──────────────────────────────────────────────────────────
let transporter = null;

function getTransporter() {
  if (!nodemailer) return null;
  if (transporter) return transporter;

  // Support multiple providers via environment variables
  const provider = process.env.EMAIL_PROVIDER || 'smtp';

  const configs = {
    gmail: {
      service: 'gmail',
      auth: {
        user: process.env.GMAIL_USER,
        pass: process.env.GMAIL_APP_PASSWORD, // App password, not account password
      },
    },
    smtp: {
      host:   process.env.SMTP_HOST || 'smtp.gmail.com',
      port:   parseInt(process.env.SMTP_PORT) || 587,
      secure: process.env.SMTP_SECURE === 'true',
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS,
      },
    },
    sendgrid: {
      host: 'smtp.sendgrid.net',
      port: 587,
      auth: {
        user: 'apikey',
        pass: process.env.SENDGRID_API_KEY,
      },
    },
  };

  const config = configs[provider] || configs.smtp;

  if (!config.auth?.user && !config.auth?.pass) {
    console.warn('⚠️  Email credentials not set — emails will be skipped');
    return null;
  }

  transporter = nodemailer.createTransport(config);
  return transporter;
}

// ── Base Email Sender ─────────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, text }) {
  const t = getTransporter();
  if (!t) {
    console.log(`📧 [SKIPPED] Email to ${to}: ${subject}`);
    return { skipped: true };
  }

  try {
    const result = await t.sendMail({
      from: process.env.EMAIL_FROM || `"FolioOS" <noreply@folio.dev>`,
      to,
      subject,
      html,
      text: text || html.replace(/<[^>]+>/g, ''),
    });
    console.log(`📧 Email sent to ${to}: ${subject}`);
    return result;
  } catch (err) {
    console.error(`📧 Email failed to ${to}:`, err.message);
    // Don't throw — email failure shouldn't break the main flow
    return { error: err.message };
  }
}

// ── Email Templates ───────────────────────────────────────────────────────────
function baseTemplate(content) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<style>
  body{font-family:'Segoe UI',Arial,sans-serif;background:#07090f;color:#e2e8f0;margin:0;padding:0}
  .wrap{max-width:560px;margin:40px auto;background:#0c0f1c;border:1px solid rgba(255,255,255,.08);border-radius:16px;overflow:hidden}
  .header{background:linear-gradient(135deg,#6366f1,#818cf8);padding:32px;text-align:center}
  .logo{font-size:24px;font-weight:700;color:#fff;letter-spacing:-.5px}
  .body{padding:36px}
  h2{font-size:22px;font-weight:700;color:#f1f5f9;margin-bottom:16px}
  p{color:#94a3b8;font-size:15px;line-height:1.7;margin-bottom:16px}
  .btn{display:inline-block;padding:13px 28px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:10px;font-weight:700;font-size:14px;text-decoration:none}
  .info-box{background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:10px;padding:16px;margin:20px 0}
  .info-row{display:flex;justify-content:space-between;padding:6px 0;font-size:14px;border-bottom:1px solid rgba(255,255,255,.05)}
  .info-row:last-child{border:none}
  .info-label{color:#64748b}
  .info-val{color:#a5b4fc;font-weight:600}
  .footer{background:rgba(0,0,0,.2);padding:20px 36px;text-align:center;font-size:12px;color:#334155}
  .footer a{color:#6366f1}
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="logo">FolioOS</div>
    <div style="color:rgba(255,255,255,.7);font-size:13px;margin-top:4px">Professional Portfolio Platform</div>
  </div>
  <div class="body">${content}</div>
  <div class="footer">
    © ${new Date().getFullYear()} FolioOS · <a href="${process.env.FRONTEND_URL}">folioos.netlify.app</a><br>
    You're receiving this because you have an account with FolioOS.
  </div>
</div>
</body>
</html>`;
}

// ── Welcome Email ─────────────────────────────────────────────────────────────
async function sendWelcomeEmail({ to, name, subdomain }) {
  const portfolioUrl = `https://${subdomain}.folio.dev`;

  return sendEmail({
    to,
    subject: '🎉 Welcome to FolioOS — Build your portfolio!',
    html: baseTemplate(`
      <h2>Welcome aboard, ${name}! 👋</h2>
      <p>Your FolioOS account is ready. You're now just minutes away from having a stunning portfolio website.</p>

      <div class="info-box">
        <div class="info-row"><span class="info-label">Your Portfolio URL</span><span class="info-val">${portfolioUrl}</span></div>
        <div class="info-row"><span class="info-label">Current Plan</span><span class="info-val">Free</span></div>
        <div class="info-row"><span class="info-label">Template</span><span class="info-val">Nova (Dark Cosmic)</span></div>
      </div>

      <p>Here's how to get started:</p>
      <p>① Go to your dashboard → Build Portfolio<br>
         ② Fill in your details, projects, and skills<br>
         ③ Click "Generate Website" — done! 🚀</p>

      <p style="text-align:center;margin-top:28px">
        <a href="${process.env.FRONTEND_URL}/pages/dashboard.html" class="btn">Open Dashboard →</a>
      </p>

      <p style="font-size:13px;color:#475569;margin-top:24px">
        Upgrade to <strong style="color:#a5b4fc">Pro (₹999/mo)</strong> for custom domain, 
        all 3 templates, analytics, and more.
      </p>
    `),
  });
}

// ── Payment Confirmation Email ────────────────────────────────────────────────
async function sendPaymentConfirmationEmail({ to, name, plan, amount, orderId, expiry }) {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const expiryStr = new Date(expiry).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return sendEmail({
    to,
    subject: `✅ Payment Confirmed — FolioOS ${planName} Plan Activated`,
    html: baseTemplate(`
      <h2>Payment Successful! 🎉</h2>
      <p>Hi ${name}, your <strong style="color:#a5b4fc">FolioOS ${planName}</strong> plan is now active.</p>

      <div class="info-box">
        <div class="info-row"><span class="info-label">Order ID</span><span class="info-val">${orderId}</span></div>
        <div class="info-row"><span class="info-label">Plan</span><span class="info-val">FolioOS ${planName}</span></div>
        <div class="info-row"><span class="info-label">Amount Paid</span><span class="info-val">₹${amount}</span></div>
        <div class="info-row"><span class="info-label">Billing</span><span class="info-val">Monthly</span></div>
        <div class="info-row"><span class="info-label">Next Renewal</span><span class="info-val">${expiryStr}</span></div>
        <div class="info-row"><span class="info-label">Payment via</span><span class="info-val">Cashfree</span></div>
      </div>

      <p>You now have access to:</p>
      <p>✓ All 3 portfolio templates (Nova, Aurora, Eclipse)<br>
         ✓ Custom domain connection<br>
         ✓ Unlimited projects<br>
         ✓ Full analytics dashboard<br>
         ✓ Priority support</p>

      <p style="text-align:center;margin-top:28px">
        <a href="${process.env.FRONTEND_URL}/pages/dashboard.html" class="btn">Go to Dashboard →</a>
      </p>

      <p style="font-size:12px;color:#334155;margin-top:20px">
        Keep this email for your records. For billing support, contact us at support@folio.dev
      </p>
    `),
  });
}

// ── Plan Expiry Reminder ──────────────────────────────────────────────────────
async function sendExpiryReminderEmail({ to, name, plan, expiry, daysLeft }) {
  const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
  const expiryStr = new Date(expiry).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'long', year: 'numeric',
  });

  return sendEmail({
    to,
    subject: `⚠️ Your FolioOS ${planName} plan expires in ${daysLeft} days`,
    html: baseTemplate(`
      <h2>Your plan expires soon 📅</h2>
      <p>Hi ${name}, your <strong style="color:#fbbf24">FolioOS ${planName}</strong> plan expires on <strong>${expiryStr}</strong> (${daysLeft} days left).</p>

      <p>After expiry, you'll be automatically moved to the Free plan and lose access to:</p>
      <p style="color:#ef4444">✗ Custom domain<br>
         ✗ Aurora & Eclipse templates<br>
         ✗ Full analytics<br>
         ✗ Priority support</p>

      <p>Renew now to keep all your Pro features.</p>

      <p style="text-align:center;margin-top:28px">
        <a href="${process.env.FRONTEND_URL}/pages/dashboard.html?tab=billing" class="btn">Renew ${planName} Plan →</a>
      </p>
    `),
  });
}

// ── Website Generated Email ───────────────────────────────────────────────────
async function sendWebsiteGeneratedEmail({ to, name, subdomain, template, version }) {
  const portfolioUrl = `https://${subdomain}.folio.dev`;
  const tmplName = template.charAt(0).toUpperCase() + template.slice(1);

  return sendEmail({
    to,
    subject: `🚀 Your portfolio is live — ${portfolioUrl}`,
    html: baseTemplate(`
      <h2>Your portfolio is live! 🚀</h2>
      <p>Hi ${name}, your portfolio website has been generated and is now live!</p>

      <div class="info-box">
        <div class="info-row"><span class="info-label">Portfolio URL</span><span class="info-val">${portfolioUrl}</span></div>
        <div class="info-row"><span class="info-label">Template</span><span class="info-val">${tmplName}</span></div>
        <div class="info-row"><span class="info-label">Version</span><span class="info-val">v${version}</span></div>
        <div class="info-row"><span class="info-label">Generated</span><span class="info-val">${new Date().toLocaleString('en-IN')}</span></div>
      </div>

      <p>Share this link with recruiters, clients, and on your social profiles:</p>
      <p style="font-size:18px;color:#a5b4fc;font-weight:700;text-align:center">${portfolioUrl}</p>

      <p style="text-align:center;margin-top:28px">
        <a href="${portfolioUrl}" class="btn">View My Portfolio →</a>
      </p>

      <p style="font-size:13px;color:#475569;margin-top:20px">
        To update your portfolio, go to your dashboard → Edit → Regenerate.
      </p>
    `),
  });
}

module.exports = {
  sendWelcomeEmail,
  sendPaymentConfirmationEmail,
  sendExpiryReminderEmail,
  sendWebsiteGeneratedEmail,
};
