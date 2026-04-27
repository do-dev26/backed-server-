// engine/templateEngine.js
// ═══════════════════════════════════════════════════════
//  FolioOS Template Engine
//  Generates complete standalone HTML portfolio sites
//  from user Firestore profile data.
//
//  Each template is self-contained:
//  - All CSS embedded
//  - All JS embedded
//  - No external dependencies (fonts via Google CDN only)
//  - Mobile responsive
//  - Project detail modals included
// ═══════════════════════════════════════════════════════

'use strict';

const { col, admin } = require('../config/firebase');

// ── Template Registry ─────────────────────────────────────────────────────────
const TEMPLATES = {
  nova: {
    id:          'nova',
    name:        'Nova',
    description: 'Dark cosmic glassmorphism with indigo accents',
    accentColor: '#6366f1',
    plans:       ['free', 'pro', 'enterprise'],
    generate:    generateNova,
  },
  aurora: {
    id:          'aurora',
    name:        'Aurora',
    description: 'Vibrant gradient mesh with animated background',
    accentColor: '#06b6d4',
    plans:       ['pro', 'enterprise'],
    generate:    generateAurora,
  },
  eclipse: {
    id:          'eclipse',
    name:        'Eclipse',
    description: 'Editorial dark with Playfair typography and gold accents',
    accentColor: '#f59e0b',
    plans:       ['pro', 'enterprise'],
    generate:    generateEclipse,
  },
};

// ── Main Entry — Generate & Save to Firestore ─────────────────────────────────
async function generateWebsite(uid) {
  // 1. Fetch user from Firestore
  const snap = await col.users().doc(uid).get();
  if (!snap.exists) throw new Error('User not found');

  const userData = snap.data();
  const { profile, template: tmplId, plan, subdomain } = userData;

  // 2. Validate template access
  const tmpl = TEMPLATES[tmplId] || TEMPLATES.nova;
  if (!tmpl.plans.includes(plan)) {
    throw new Error(`Template "${tmplId}" requires Pro plan. User is on "${plan}".`);
  }

  // 3. Generate HTML
  const html = tmpl.generate(profile, subdomain);

  // 4. Firestore batch write — atomic
  const batch = col.users().firestore.batch();

  // Update user document
  batch.update(col.users().doc(uid), {
    websiteGenerated:  true,
    websiteVersion:    admin.firestore.FieldValue.increment(1),
    generatedTemplate: tmplId,
    lastGeneratedAt:   admin.firestore.FieldValue.serverTimestamp(),
    updatedAt:         admin.firestore.FieldValue.serverTimestamp(),
  });

  // Save generated HTML
  batch.set(col.sites().doc(subdomain), {
    uid,
    subdomain,
    template:    tmplId,
    html,
    generatedAt: admin.firestore.FieldValue.serverTimestamp(),
    version:     (userData.websiteVersion || 0) + 1,
  });

  await batch.commit();

  // Return updated version
  const updated = await col.users().doc(uid).get();
  return {
    url:      `https://${subdomain}.${process.env.BASE_DOMAIN || 'folio.dev'}`,
    version:  updated.data().websiteVersion,
    template: tmplId,
    subdomain,
  };
}

// ── Fetch Generated HTML ──────────────────────────────────────────────────────
async function getSiteBySubdomain(subdomain) {
  const snap = await col.sites().doc(subdomain).get();
  return snap.exists ? snap.data() : null;
}

// ════════════════════════════════════════════════════════
//  SHARED HELPERS
// ════════════════════════════════════════════════════════

// HTML escape — prevent XSS
function e(str) {
  if (!str && str !== 0) return '';
  return String(str)
    .replace(/&/g,  '&amp;')
    .replace(/</g,  '&lt;')
    .replace(/>/g,  '&gt;')
    .replace(/"/g,  '&quot;')
    .replace(/'/g,  '&#039;');
}

// Render skill tags
function skillTags(skills = [], bg = 'rgba(99,102,241,.1)', color = '#a5b4fc', border = 'rgba(99,102,241,.2)') {
  return skills.map(s =>
    `<span style="display:inline-block;background:${bg};border:1px solid ${border};color:${color};border-radius:6px;padding:3px 11px;font-size:11px;font-family:monospace;margin:2px;">${e(s)}</span>`
  ).join('');
}

// Project modals (shared across templates)
function renderModals(projects = []) {
  return projects.map(p => `
<div id="modal-${e(p.id)}" style="display:none;position:fixed;inset:0;z-index:999;align-items:center;justify-content:center;padding:20px;background:rgba(0,0,0,.85);backdrop-filter:blur(8px);" onclick="if(event.target===this)this.style.display='none'">
  <div style="position:relative;background:#0d1117;border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:36px;max-width:560px;width:100%;max-height:88vh;overflow-y:auto;">
    <button onclick="document.getElementById('modal-${e(p.id)}').style.display='none'" style="position:absolute;top:14px;right:14px;background:rgba(255,255,255,.07);border:1px solid rgba(255,255,255,.1);border-radius:8px;padding:5px 12px;color:rgba(255,255,255,.5);cursor:pointer;font-size:13px;">✕</button>
    <h2 style="font-size:22px;font-weight:700;margin-bottom:12px;color:#f1f5f9;">${e(p.title)}</h2>
    <p style="color:rgba(255,255,255,.55);line-height:1.8;margin-bottom:18px;font-size:14px;">${e(p.desc)}</p>
    <div style="margin-bottom:18px;">${skillTags(p.stack || [])}</div>
    ${p.video ? `<div style="margin-bottom:16px;"><div style="font-size:11px;color:rgba(255,255,255,.3);margin-bottom:5px;font-family:monospace;letter-spacing:.08em;">VIDEO DEMO</div><a href="${e(p.video)}" target="_blank" rel="noopener" style="color:#818cf8;font-size:13px;">${e(p.video)}</a></div>` : ''}
    <div style="display:flex;gap:10px;flex-wrap:wrap;">
      ${p.live ? `<a href="${e(p.live)}" target="_blank" rel="noopener" style="display:inline-flex;padding:10px 20px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:9px;font-size:13px;font-weight:600;text-decoration:none;">View Live ↗</a>` : ''}
      ${p.github ? `<a href="${e(p.github)}" target="_blank" rel="noopener" style="display:inline-flex;padding:10px 20px;background:rgba(255,255,255,.06);color:rgba(255,255,255,.7);border:1px solid rgba(255,255,255,.12);border-radius:9px;font-size:13px;text-decoration:none;">GitHub</a>` : ''}
    </div>
  </div>
</div>`).join('\n');
}

// ════════════════════════════════════════════════════════
//  TEMPLATE 1: NOVA — Dark Cosmic Glassmorphism
// ════════════════════════════════════════════════════════
function generateNova(profile, subdomain) {
  const p = profile || {};

  const experienceHTML = (p.experience || []).map(ex => `
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:22px;margin-bottom:14px;">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:8px;">
        <div>
          <div style="font-weight:700;font-size:15px;color:#f1f5f9;">${e(ex.role)}</div>
          <div style="color:#818cf8;font-size:13px;margin-top:2px;">${e(ex.company)}</div>
        </div>
        <div style="font-family:monospace;font-size:11px;color:rgba(226,232,240,.3);white-space:nowrap;padding-left:10px;">${e(ex.period)}</div>
      </div>
      ${ex.desc ? `<p style="font-size:13.5px;color:rgba(226,232,240,.5);margin-bottom:10px;line-height:1.7;">${e(ex.desc)}</p>` : ''}
      <div>${skillTags(ex.tech || [])}</div>
    </div>`).join('');

  const projectsHTML = (p.projects || []).map(proj => `
    <div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:24px;display:flex;flex-direction:column;transition:all .25s;" onmouseover="this.style.borderColor='rgba(99,102,241,.35)';this.style.transform='translateY(-4px)'" onmouseout="this.style.borderColor='rgba(255,255,255,.07)';this.style.transform=''">
      ${proj.featured ? `<div style="display:inline-block;margin-bottom:10px;background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.25);border-radius:6px;padding:2px 10px;font-size:11px;color:#fbbf24;font-family:monospace;">★ Featured</div>` : ''}
      <h3 style="font-size:18px;font-weight:700;margin-bottom:10px;color:#f1f5f9;">${e(proj.title)}</h3>
      <p style="font-size:13.5px;color:rgba(226,232,240,.5);line-height:1.7;flex:1;margin-bottom:16px;">${e(proj.desc)}</p>
      <div style="margin-bottom:16px;">${skillTags(proj.stack || [])}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${proj.live ? `<a href="${e(proj.live)}" target="_blank" rel="noopener" style="padding:8px 16px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:9px;font-size:12px;font-weight:600;text-decoration:none;">Live ↗</a>` : ''}
        ${proj.github ? `<a href="${e(proj.github)}" target="_blank" rel="noopener" style="padding:8px 16px;background:rgba(255,255,255,.05);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.1);border-radius:9px;font-size:12px;text-decoration:none;">GitHub</a>` : ''}
        <button onclick="document.getElementById('modal-${e(proj.id)}').style.display='flex'" style="padding:8px 16px;background:rgba(255,255,255,.05);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.1);border-radius:9px;font-size:12px;cursor:pointer;">Details</button>
      </div>
    </div>`).join('');

  const saasHTML = (p.saas || []).map(s => `
    <div style="background:rgba(6,182,212,.04);border:1px solid rgba(6,182,212,.12);border-radius:16px;padding:24px;display:flex;flex-direction:column;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px;">
        <div style="width:42px;height:42px;border-radius:10px;background:linear-gradient(135deg,#0891b2,#06b6d4);display:flex;align-items:center;justify-content:center;font-weight:700;font-size:17px;color:#fff;">${e((s.name || '?').charAt(0))}</div>
        ${s.badge ? `<span style="font-size:11px;background:rgba(6,182,212,.12);border:1px solid rgba(6,182,212,.25);color:#67e8f9;border-radius:6px;padding:2px 9px;font-family:monospace;">${e(s.badge)}</span>` : ''}
      </div>
      <h3 style="font-size:18px;font-weight:700;margin-bottom:8px;color:#f1f5f9;">${e(s.name)}</h3>
      <p style="font-size:13.5px;color:rgba(226,232,240,.5);flex:1;margin-bottom:18px;line-height:1.7;">${e(s.desc)}</p>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${s.platform ? `<a href="${e(s.platform)}" target="_blank" rel="noopener" style="padding:8px 16px;background:linear-gradient(135deg,#0891b2,#06b6d4);color:#fff;border-radius:9px;font-size:12px;font-weight:600;text-decoration:none;">Get Access ↗</a>` : ''}
        ${s.demo ? `<a href="${e(s.demo)}" target="_blank" rel="noopener" style="padding:8px 16px;background:rgba(255,255,255,.05);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.1);border-radius:9px;font-size:12px;text-decoration:none;">Demo</a>` : ''}
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0">
<meta name="description" content="${e((p.bio || '').slice(0, 160))}">
<title>${e(p.name)} — Portfolio</title>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Clash+Display:wght@400;600;700&family=Cabinet+Grotesk:wght@300;400;500;700&family=Fira+Code:wght@400;500&display=swap" rel="stylesheet">
<style>
*,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
html{scroll-behavior:smooth}
body{font-family:'Cabinet Grotesk',sans-serif;background:#060a12;color:#e2e8f0;overflow-x:hidden;line-height:1.6}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(99,102,241,.4);border-radius:3px}
.sec{max-width:960px;margin:0 auto;padding:80px 24px 0}
.g2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.g3{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:20px}
.grid-bg{background-image:linear-gradient(rgba(99,102,241,.04)1px,transparent 1px),linear-gradient(90deg,rgba(99,102,241,.04)1px,transparent 1px);background-size:44px 44px}
.mono-label{font-family:monospace;font-size:11px;color:#818cf8;letter-spacing:.15em;text-transform:uppercase;margin-bottom:10px}
.sec-title{font-family:'Clash Display',sans-serif;font-size:clamp(1.8rem,3vw,2.4rem);font-weight:700;margin-bottom:32px;color:#f1f5f9}
a{text-decoration:none}button{font-family:'Cabinet Grotesk',sans-serif}
@keyframes fadeIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@keyframes pulse{0%,100%{box-shadow:0 0 0 0 rgba(16,185,129,.4)}50%{box-shadow:0 0 0 6px rgba(16,185,129,0)}}
@media(max-width:768px){.g2{grid-template-columns:1fr}.hide-mob{display:none!important}.hero-title{font-size:clamp(2.2rem,8vw,3.5rem)!important}}
</style>
</head>
<body>
<!-- Mesh BG -->
<div style="position:fixed;inset:0;pointer-events:none;z-index:0;" class="grid-bg"></div>
<div style="position:fixed;inset:0;pointer-events:none;z-index:0;background:radial-gradient(ellipse 70% 50% at 15% 10%,rgba(99,102,241,.08) 0%,transparent 60%),radial-gradient(ellipse 50% 40% at 85% 85%,rgba(6,182,212,.06) 0%,transparent 60%);"></div>

<!-- NAV -->
<nav style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(6,10,18,.9);backdrop-filter:blur(16px);border-bottom:1px solid rgba(255,255,255,.06);padding:0 40px;height:60px;display:flex;align-items:center;justify-content:space-between;">
  <div style="font-family:'Clash Display',sans-serif;font-weight:700;font-size:18px;color:#f1f5f9;">${e((p.name || '').split(' ')[0])}<span style="color:#818cf8;">.</span></div>
  <div class="hide-mob" style="display:flex;gap:28px;">
    ${['About','Skills','Projects','Products','Contact'].map(n => `<a href="#nv-${n.toLowerCase()}" style="color:rgba(226,232,240,.5);font-size:13px;transition:color .2s;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='rgba(226,232,240,.5)'">${n}</a>`).join('')}
  </div>
  ${p.available !== false ? `<div style="display:flex;align-items:center;gap:6px;font-size:12px;color:#6ee7b7;"><span style="width:7px;height:7px;background:#10b981;border-radius:50%;animation:pulse 2s infinite;display:inline-block;"></span>Open to work</div>` : ''}
</nav>

<!-- HERO -->
<section id="nv-hero" style="min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:80px 24px;position:relative;z-index:1;animation:fadeIn .7s ease;">
  <div style="position:absolute;inset:0;background:radial-gradient(ellipse 80% 60% at 50% 0%,rgba(99,102,241,.13) 0%,transparent 60%);pointer-events:none;"></div>
  <div>
    <div style="width:88px;height:88px;border-radius:50%;margin:0 auto 28px;background:linear-gradient(135deg,#6366f1,#818cf8);display:flex;align-items:center;justify-content:center;font-family:'Clash Display',sans-serif;font-weight:700;font-size:32px;color:#fff;box-shadow:0 0 50px rgba(99,102,241,.35);">${e((p.name || 'U').charAt(0))}</div>
    ${(p.achievements || []).length ? `<div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:24px;">${(p.achievements || []).map(a => `<span style="background:rgba(99,102,241,.1);border:1px solid rgba(99,102,241,.25);color:#a5b4fc;border-radius:100px;padding:5px 14px;font-size:12px;font-family:monospace;">${e(a)}</span>`).join('')}</div>` : ''}
    <h1 class="hero-title" style="font-family:'Clash Display',sans-serif;font-size:clamp(2.8rem,8vw,5.5rem);font-weight:700;line-height:1.05;margin-bottom:16px;color:#f1f5f9;">${e(p.name)}</h1>
    <p style="font-size:clamp(1rem,2.5vw,1.3rem);color:rgba(226,232,240,.5);margin-bottom:10px;">${e(p.title)}</p>
    ${p.tagline ? `<p style="font-size:16px;color:#818cf8;font-style:italic;margin-bottom:32px;">"${e(p.tagline)}"</p>` : ''}
    <p style="font-size:15px;color:rgba(226,232,240,.4);max-width:500px;margin:0 auto 48px;line-height:1.8;">${e(p.bio)}</p>
    <div style="display:flex;gap:14px;justify-content:center;flex-wrap:wrap;">
      <a href="#nv-projects" style="padding:13px 28px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:10px;font-size:14px;font-weight:600;box-shadow:0 4px 24px rgba(99,102,241,.3);" onmouseover="this.style.transform='translateY(-2px)'" onmouseout="this.style.transform=''">View Projects</a>
      <a href="mailto:${e(p.contact?.email)}" style="padding:13px 28px;background:rgba(255,255,255,.05);color:rgba(226,232,240,.8);border:1px solid rgba(255,255,255,.1);border-radius:10px;font-size:14px;">Contact Me</a>
    </div>
    <div style="margin-top:52px;display:flex;gap:28px;justify-content:center;flex-wrap:wrap;">
      ${Object.entries(p.contact || {}).filter(([,v])=>v).map(([k,v]) => `<a href="${k==='email'?'mailto:'+v:'https://'+v}" target="_blank" style="font-size:12px;color:rgba(226,232,240,.3);font-family:monospace;transition:color .2s;" onmouseover="this.style.color='#818cf8'" onmouseout="this.style.color='rgba(226,232,240,.3)'">${e(v)}</a>`).join('')}
    </div>
  </div>
</section>

<!-- ABOUT -->
<section id="nv-about" class="sec">
  <div class="mono-label">About Me</div>
  <h2 class="sec-title">Background & Experience</h2>
  <div class="g2">
    <div>
      <p style="color:rgba(226,232,240,.55);line-height:1.9;font-size:15px;margin-bottom:28px;">${e(p.bio)}</p>
      ${(p.education || []).map(ed => `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:12px;padding:18px;margin-bottom:12px;"><div style="font-weight:700;font-size:15px;color:#f1f5f9;">${e(ed.degree)}</div><div style="color:#818cf8;font-size:13px;margin-top:2px;">${e(ed.school)} · ${e(ed.year)}</div>${ed.gpa ? `<div style="font-size:12px;color:rgba(226,232,240,.35);margin-top:2px;">GPA: ${e(ed.gpa)}</div>` : ''}</div>`).join('')}
    </div>
    <div>${experienceHTML || '<p style="color:rgba(226,232,240,.3);font-size:14px;">No experience added yet.</p>'}</div>
  </div>
</section>

<!-- SKILLS -->
<section id="nv-skills" class="sec">
  <div class="mono-label">Skills</div>
  <h2 class="sec-title">Tech Stack</h2>
  <div style="display:flex;flex-wrap:wrap;gap:12px;">
    ${(p.skills || []).map(s => `<div style="background:rgba(99,102,241,.08);border:1px solid rgba(99,102,241,.2);border-radius:12px;padding:12px 22px;font-size:14px;font-family:monospace;color:#a5b4fc;transition:all .2s;cursor:default;" onmouseover="this.style.background='rgba(99,102,241,.18)';this.style.transform='translateY(-3px)'" onmouseout="this.style.background='rgba(99,102,241,.08)';this.style.transform=''">${e(s)}</div>`).join('')}
  </div>
</section>

<!-- PROJECTS -->
<section id="nv-projects" class="sec">
  <div class="mono-label">Projects</div>
  <h2 class="sec-title">Featured Work</h2>
  <div class="g3">${projectsHTML || '<p style="color:rgba(226,232,240,.3)">No projects added yet.</p>'}</div>
</section>

${(p.saas || []).length ? `
<!-- PRODUCTS -->
<section id="nv-products" class="sec">
  <div class="mono-label">SaaS & Products</div>
  <h2 class="sec-title">Products & Tools</h2>
  <div class="g3">${saasHTML}</div>
</section>` : ''}

${(p.hosting || []).length ? `
<!-- HOSTING -->
<section class="sec">
  <div class="mono-label">Hosting</div>
  <h2 class="sec-title">Hosted Projects</h2>
  ${(p.hosting || []).map(h => `<a href="${e(h.url)}" target="_blank" rel="noopener" style="display:flex;justify-content:space-between;align-items:center;background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:14px;padding:18px 22px;margin-bottom:12px;transition:all .2s;" onmouseover="this.style.borderColor='rgba(99,102,241,.35)'" onmouseout="this.style.borderColor='rgba(255,255,255,.07)'"><div><div style="font-weight:600;color:#f1f5f9;margin-bottom:4px;">${e(h.name)}</div><div style="font-size:13px;color:#818cf8;font-family:monospace;">${e(h.url)}</div></div><span style="color:rgba(255,255,255,.3);font-size:18px;">↗</span></a>`).join('')}
</section>` : ''}

${(p.testimonials || []).length ? `
<!-- TESTIMONIALS -->
<section class="sec">
  <div class="mono-label">Testimonials</div>
  <h2 class="sec-title">What People Say</h2>
  <div class="g3">
    ${(p.testimonials || []).map(t => `<div style="background:rgba(255,255,255,.03);border:1px solid rgba(255,255,255,.07);border-radius:16px;padding:26px;"><div style="font-size:30px;color:#818cf8;margin-bottom:12px;font-family:serif;">"</div><p style="color:rgba(226,232,240,.6);font-size:14px;line-height:1.8;margin-bottom:16px;">${e(t.text)}</p><div style="font-weight:700;font-size:14px;color:#f1f5f9;">${e(t.name)}</div><div style="font-size:12px;color:#818cf8;">${e(t.role)}</div></div>`).join('')}
  </div>
</section>` : ''}

<!-- CONTACT -->
<section id="nv-contact" class="sec" style="padding-bottom:100px;text-align:center;">
  <div class="mono-label" style="display:inline-block;">Contact</div>
  <h2 class="sec-title">Let's Build Together</h2>
  <p style="color:rgba(226,232,240,.4);margin-bottom:40px;font-size:15px;">Open to freelance, full-time, and interesting collaborations.</p>
  <a href="mailto:${e(p.contact?.email)}" style="display:inline-flex;align-items:center;padding:15px 40px;background:linear-gradient(135deg,#6366f1,#818cf8);color:#fff;border-radius:10px;font-size:15px;font-weight:600;box-shadow:0 4px 24px rgba(99,102,241,.3);">Send a Message →</a>
  <div style="margin-top:48px;display:flex;gap:28px;justify-content:center;flex-wrap:wrap;">
    ${Object.entries(p.contact || {}).filter(([,v])=>v).map(([k,v]) => `<div style="text-align:center;"><div style="font-size:10px;color:rgba(99,102,241,.6);font-family:monospace;margin-bottom:4px;letter-spacing:.1em;">${k.toUpperCase()}</div><div style="font-size:13px;color:rgba(226,232,240,.5);">${e(v)}</div></div>`).join('')}
  </div>
</section>

<footer style="border-top:1px solid rgba(255,255,255,.05);padding:28px 24px;text-align:center;color:rgba(226,232,240,.18);font-size:12px;font-family:monospace;position:relative;z-index:1;">
  Built with FolioOS Nova · ${e(p.name)} © ${new Date().getFullYear()}
</footer>

${renderModals(p.projects || [])}
</body>
</html>`;
}

// ════════════════════════════════════════════════════════
//  TEMPLATE 2: AURORA — Gradient Mesh (Pro)
// ════════════════════════════════════════════════════════
function generateAurora(profile, subdomain) {
  const p = profile || {};

  const projectsHTML = (p.projects || []).map(proj => `
    <div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:20px;padding:28px;display:flex;flex-direction:column;backdrop-filter:blur(10px);transition:all .3s;" onmouseover="this.style.borderColor='rgba(6,182,212,.4)';this.style.transform='translateY(-5px)'" onmouseout="this.style.borderColor='rgba(255,255,255,.08)';this.style.transform=''">
      <h3 style="font-weight:700;font-size:18px;margin-bottom:10px;color:#e2e8f0;">${e(proj.title)}</h3>
      <p style="font-size:13.5px;color:rgba(226,232,240,.5);flex:1;margin-bottom:16px;line-height:1.7;">${e(proj.desc)}</p>
      <div style="margin-bottom:16px;">${(proj.stack||[]).map(t=>`<span style="display:inline-block;background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(139,92,246,.12));border:1px solid rgba(6,182,212,.2);border-radius:100px;padding:4px 12px;font-size:11px;color:#67e8f9;margin:2px;font-family:monospace;">${e(t)}</span>`).join('')}</div>
      <div style="display:flex;gap:8px;flex-wrap:wrap;">
        ${proj.live?`<a href="${e(proj.live)}" target="_blank" style="padding:8px 16px;background:linear-gradient(135deg,#06b6d4,#0284c7);color:#fff;border-radius:100px;font-size:12px;font-weight:600;text-decoration:none;">Live ↗</a>`:''}
        ${proj.github?`<a href="${e(proj.github)}" target="_blank" style="padding:8px 16px;background:rgba(255,255,255,.06);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.12);border-radius:100px;font-size:12px;text-decoration:none;">GitHub</a>`:''}
        <button onclick="document.getElementById('modal-${e(proj.id)}').style.display='flex'" style="padding:8px 16px;background:rgba(255,255,255,.06);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.12);border-radius:100px;font-size:12px;cursor:pointer;">Details</button>
      </div>
    </div>`).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${e(p.name)} — Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@300;400;500;600;700&family=Fira+Code&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:'Space Grotesk',sans-serif;background:#020817;color:#e2e8f0;overflow-x:hidden}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(6,182,212,.4);border-radius:3px}
.sec{max-width:1000px;margin:0 auto;padding:90px 24px 0;position:relative;z-index:1}
.g3{display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:20px}
.aurora-gt{background:linear-gradient(135deg,#06b6d4,#818cf8,#10b981);-webkit-background-clip:text;-webkit-text-fill-color:transparent;background-clip:text}
@keyframes fadeUp{from{opacity:0;transform:translateY(24px)}to{opacity:1;transform:translateY(0)}}
a{text-decoration:none}button{font-family:'Space Grotesk',sans-serif}
@media(max-width:768px){.hide-mob{display:none!important}}
</style>
</head>
<body>
<div style="position:fixed;inset:0;z-index:0;pointer-events:none;background:radial-gradient(ellipse 80% 60% at 10% 10%,rgba(6,182,212,.14) 0%,transparent 50%),radial-gradient(ellipse 60% 50% at 90% 80%,rgba(139,92,246,.11) 0%,transparent 50%);"></div>

<nav style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(2,8,23,.88);backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.06);padding:0 48px;height:64px;display:flex;align-items:center;justify-content:space-between;">
  <div style="font-weight:700;font-size:18px;" class="aurora-gt">${e((p.name||'').split(' ')[0])}.dev</div>
  <div class="hide-mob" style="display:flex;gap:28px;">${['About','Projects','Products','Contact'].map(n=>`<a href="#ar-${n.toLowerCase()}" style="font-size:13.5px;color:rgba(226,232,240,.5);transition:color .2s;" onmouseover="this.style.color='#67e8f9'" onmouseout="this.style.color='rgba(226,232,240,.5)'">${n}</a>`).join('')}</div>
  <a href="mailto:${e(p.contact?.email)}" style="padding:9px 20px;background:linear-gradient(135deg,#06b6d4,#0284c7);color:#fff;border-radius:100px;font-size:13px;font-weight:600;">Hire Me</a>
</nav>

<section style="min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:80px 24px;position:relative;z-index:1;animation:fadeUp .7s ease;">
  <div style="display:flex;flex-wrap:wrap;gap:8px;justify-content:center;margin-bottom:24px;">${(p.achievements||[]).map(a=>`<span style="background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(139,92,246,.12));border:1px solid rgba(6,182,212,.2);border-radius:100px;padding:5px 14px;font-size:12px;color:#67e8f9;font-family:monospace;">${e(a)}</span>`).join('')}</div>
  <h1 style="font-size:clamp(3rem,9vw,6rem);font-weight:700;line-height:1.05;margin-bottom:20px;" class="aurora-gt">${e(p.name)}</h1>
  <p style="font-size:22px;color:rgba(226,232,240,.55);margin-bottom:12px;font-weight:300;">${e(p.title)}</p>
  <p style="font-size:16px;color:rgba(6,182,212,.7);margin-bottom:36px;">${e(p.tagline)}</p>
  <p style="max-width:500px;margin:0 auto 48px;color:rgba(226,232,240,.4);font-size:15px;line-height:1.8;">${e(p.bio)}</p>
  <div style="display:flex;gap:14px;flex-wrap:wrap;justify-content:center;">
    <a href="#ar-projects" style="padding:13px 32px;background:linear-gradient(135deg,#06b6d4,#0284c7);color:#fff;border-radius:100px;font-size:15px;font-weight:600;box-shadow:0 4px 24px rgba(6,182,212,.3);">Explore Work ↓</a>
    <a href="mailto:${e(p.contact?.email)}" style="padding:13px 32px;background:rgba(255,255,255,.06);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.12);border-radius:100px;font-size:15px;">Get In Touch</a>
  </div>
</section>

<section id="ar-about" class="sec">
  <div style="display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-bottom:60px;">
    <div>
      <div style="font-size:11px;color:#67e8f9;font-family:monospace;letter-spacing:.12em;margin-bottom:12px;">EXPERIENCE</div>
      ${(p.experience||[]).map(ex=>`<div style="background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);border-radius:18px;padding:22px;margin-bottom:14px;"><div style="display:flex;justify-content:space-between;margin-bottom:8px;"><div><div style="font-weight:700;color:#e2e8f0;">${e(ex.role)}</div><div style="color:#67e8f9;font-size:13px;">${e(ex.company)}</div></div><div style="font-size:11px;color:rgba(226,232,240,.3);font-family:monospace;">${e(ex.period)}</div></div><p style="font-size:13px;color:rgba(226,232,240,.5);">${e(ex.desc)}</p></div>`).join('')}
    </div>
    <div>
      <div style="font-size:11px;color:#67e8f9;font-family:monospace;letter-spacing:.12em;margin-bottom:12px;">SKILLS</div>
      <div style="display:flex;flex-wrap:wrap;gap:10px;">${(p.skills||[]).map(s=>`<span style="background:linear-gradient(135deg,rgba(6,182,212,.12),rgba(139,92,246,.12));border:1px solid rgba(6,182,212,.2);border-radius:100px;padding:8px 18px;font-size:13px;color:#67e8f9;font-family:monospace;">${e(s)}</span>`).join('')}</div>
    </div>
  </div>
</section>

<section id="ar-projects" class="sec" style="padding-top:0;">
  <div style="font-size:11px;color:#67e8f9;font-family:monospace;letter-spacing:.12em;margin-bottom:10px;">PROJECTS</div>
  <h2 style="font-size:clamp(1.8rem,3vw,2.4rem);font-weight:700;margin-bottom:36px;color:#e2e8f0;">What I've Built</h2>
  <div class="g3">${projectsHTML}</div>
</section>

${(p.saas||[]).length ? `
<section id="ar-products" class="sec" style="padding-top:60px;">
  <div style="font-size:11px;color:#67e8f9;font-family:monospace;letter-spacing:.12em;margin-bottom:10px;">SAAS</div>
  <h2 style="font-size:clamp(1.8rem,3vw,2.4rem);font-weight:700;margin-bottom:36px;color:#e2e8f0;">Products & Tools</h2>
  <div class="g3">${(p.saas||[]).map(s=>`<div style="background:rgba(6,182,212,.04);border:1px solid rgba(6,182,212,.12);border-radius:20px;padding:28px;display:flex;flex-direction:column;"><h3 style="font-weight:700;font-size:17px;margin-bottom:8px;color:#e2e8f0;">${e(s.name)}</h3><p style="font-size:13.5px;color:rgba(226,232,240,.5);flex:1;margin-bottom:18px;">${e(s.desc)}</p><div style="display:flex;gap:8px;">${s.platform?`<a href="${e(s.platform)}" target="_blank" style="padding:8px 16px;background:linear-gradient(135deg,#06b6d4,#0284c7);color:#fff;border-radius:100px;font-size:12px;font-weight:600;">Get Access ↗</a>`:''} ${s.demo?`<a href="${e(s.demo)}" target="_blank" style="padding:8px 16px;background:rgba(255,255,255,.06);color:rgba(226,232,240,.7);border:1px solid rgba(255,255,255,.12);border-radius:100px;font-size:12px;">Demo</a>`:''}</div></div>`).join('')}</div>
</section>` : ''}

<section id="ar-contact" class="sec" style="padding-bottom:100px;text-align:center;padding-top:60px;">
  <h2 style="font-size:clamp(2rem,4vw,3rem);font-weight:700;margin-bottom:16px;" class="aurora-gt">Ready to collaborate?</h2>
  <p style="color:rgba(226,232,240,.4);margin-bottom:40px;">Let's build something extraordinary together.</p>
  <a href="mailto:${e(p.contact?.email)}" style="display:inline-flex;padding:14px 40px;background:linear-gradient(135deg,#06b6d4,#0284c7);color:#fff;border-radius:100px;font-size:15px;font-weight:600;">Send a Message →</a>
</section>

<footer style="border-top:1px solid rgba(255,255,255,.05);padding:28px 24px;text-align:center;color:rgba(226,232,240,.18);font-size:12px;font-family:monospace;position:relative;z-index:1;">
  Built with FolioOS Aurora · ${e(p.name)} © ${new Date().getFullYear()}
</footer>

${renderModals(p.projects||[])}
</body></html>`;
}

// ════════════════════════════════════════════════════════
//  TEMPLATE 3: ECLIPSE — Editorial Minimal (Pro)
// ════════════════════════════════════════════════════════
function generateEclipse(profile, subdomain) {
  const p = profile || {};

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0">
<title>${e(p.name)} — Portfolio</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:ital,wght@0,700;1,700&family=Cabinet+Grotesk:wght@300;400;500;700&family=Fira+Code&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box;margin:0;padding:0}html{scroll-behavior:smooth}
body{font-family:'Cabinet Grotesk',sans-serif;background:#0a0705;color:#e8e0d0;overflow-x:hidden}
::-webkit-scrollbar{width:5px}::-webkit-scrollbar-thumb{background:rgba(245,158,11,.4);border-radius:3px}
.sec{max-width:900px;margin:0 auto;padding:0 24px}
.layout{display:grid;grid-template-columns:200px 1fr;gap:48px;align-items:start}
.ecl-lbl{font-family:'Playfair Display',serif;font-size:clamp(22px,3vw,32px);font-weight:700;font-style:italic;color:rgba(232,224,208,.12);line-height:1.1}
.ecl-tag{display:inline-block;background:rgba(245,158,11,.1);color:#fbbf24;border:1px solid rgba(245,158,11,.2);border-radius:3px;padding:2px 9px;font-size:11px;font-family:monospace;margin:2px}
.ecl-card{background:rgba(245,158,11,.03);border:1px solid rgba(245,158,11,.08);border-radius:4px;padding:24px;transition:all .3s}
.ecl-card:hover{border-color:rgba(245,158,11,.3)}
.ecl-hr{border:none;border-top:1px solid rgba(245,158,11,.1);margin:60px 0 0}
a{text-decoration:none}
@keyframes fadeIn{from{opacity:0;transform:translateY(18px)}to{opacity:1;transform:translateY(0)}}
@media(max-width:768px){.layout{grid-template-columns:1fr}.ecl-lbl{font-size:22px}.hide-mob{display:none!important}}
</style>
</head>
<body>

<div style="position:fixed;right:0;top:50%;transform:translateY(-50%);width:280px;height:280px;border-radius:50%;background:radial-gradient(circle,rgba(245,158,11,.07) 0%,transparent 70%);pointer-events:none;z-index:0;"></div>

<nav style="position:fixed;top:0;left:0;right:0;z-index:100;background:rgba(10,7,5,.96);backdrop-filter:blur(16px);border-bottom:1px solid rgba(245,158,11,.1);padding:0 56px;height:62px;display:flex;align-items:center;justify-content:space-between;">
  <div style="font-family:'Playfair Display',serif;font-weight:700;font-size:20px;font-style:italic;color:#f59e0b;">${e(p.name)}</div>
  <div class="hide-mob" style="display:flex;gap:32px;">${['About','Projects','Products','Contact'].map(n=>`<a href="#ecl-${n.toLowerCase()}" style="font-size:13px;color:rgba(232,224,208,.4);letter-spacing:.06em;transition:color .2s;" onmouseover="this.style.color='#fbbf24'" onmouseout="this.style.color='rgba(232,224,208,.4)'">${n.toUpperCase()}</a>`).join('')}</div>
  <a href="mailto:${e(p.contact?.email)}" style="padding:8px 20px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;border-radius:4px;font-size:12px;font-weight:700;letter-spacing:.04em;">HIRE ME</a>
</nav>

<!-- HERO -->
<section style="min-height:100vh;display:flex;align-items:flex-end;padding:80px 56px 80px;position:relative;z-index:1;animation:fadeIn .8s ease;">
  <div style="max-width:700px;">
    <div style="font-family:monospace;font-size:11px;color:rgba(245,158,11,.5);letter-spacing:.2em;margin-bottom:24px;">PORTFOLIO — ${new Date().getFullYear()}</div>
    <h1 style="font-family:'Playfair Display',serif;font-size:clamp(3.5rem,9vw,6rem);font-weight:700;font-style:italic;line-height:1.05;margin-bottom:24px;color:#e8e0d0;">${e(p.name)}</h1>
    <div style="width:80px;height:2px;background:linear-gradient(90deg,#f59e0b,transparent);margin-bottom:24px;"></div>
    <p style="font-size:20px;color:rgba(232,224,208,.5);margin-bottom:12px;font-weight:300;">${e(p.title)}</p>
    <p style="font-size:16px;color:#f59e0b;margin-bottom:36px;font-style:italic;">"${e(p.tagline)}"</p>
    <p style="font-size:15px;color:rgba(232,224,208,.4);max-width:480px;line-height:1.9;margin-bottom:48px;">${e(p.bio)}</p>
    <div style="display:flex;gap:14px;flex-wrap:wrap;">
      <a href="#ecl-projects" style="padding:13px 32px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;border-radius:4px;font-size:14px;font-weight:700;letter-spacing:.02em;">VIEW WORK →</a>
      <a href="mailto:${e(p.contact?.email)}" style="padding:13px 32px;background:transparent;border:1px solid rgba(245,158,11,.3);color:rgba(232,224,208,.7);border-radius:4px;font-size:14px;">CONTACT</a>
    </div>
  </div>
</section>

<!-- ABOUT -->
<section id="ecl-about" class="sec">
  <hr class="ecl-hr">
  <div class="layout" style="margin-top:60px;">
    <div class="ecl-lbl">About Me</div>
    <div>
      <p style="color:rgba(232,224,208,.55);line-height:1.9;margin-bottom:32px;font-size:15px;">${e(p.bio)}</p>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
        ${(p.experience||[]).map(ex=>`<div class="ecl-card"><div style="font-family:'Playfair Display',serif;font-style:italic;font-size:15px;font-weight:700;color:#fbbf24;margin-bottom:4px;">${e(ex.company)}</div><div style="font-weight:700;margin-bottom:4px;color:#e8e0d0;">${e(ex.role)}</div><div style="font-size:12px;color:rgba(232,224,208,.35);font-family:monospace;margin-bottom:8px;">${e(ex.period)}</div><p style="font-size:13px;color:rgba(232,224,208,.45);">${e(ex.desc)}</p></div>`).join('')}
      </div>
    </div>
  </div>
</section>

<section class="sec">
  <hr class="ecl-hr">
  <div class="layout" style="margin-top:60px;">
    <div class="ecl-lbl">Stack</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;">${(p.skills||[]).map(s=>`<span class="ecl-tag">${e(s)}</span>`).join('')}</div>
  </div>
</section>

<!-- PROJECTS -->
<section id="ecl-projects" class="sec">
  <hr class="ecl-hr">
  <div class="layout" style="margin-top:60px;">
    <div class="ecl-lbl">Projects</div>
    <div>
      ${(p.projects||[]).map((proj,i)=>`
        <div class="ecl-card" style="display:flex;justify-content:space-between;align-items:flex-start;gap:20px;margin-bottom:16px;">
          <div style="flex:1;">
            <div style="display:flex;gap:12px;align-items:baseline;margin-bottom:10px;">
              <span style="font-family:monospace;font-size:11px;color:rgba(245,158,11,.4);">0${i+1}</span>
              <span style="font-family:'Playfair Display',serif;font-size:19px;font-weight:700;font-style:italic;color:#e8e0d0;">${e(proj.title)}</span>
            </div>
            <p style="font-size:13.5px;color:rgba(232,224,208,.45);line-height:1.7;margin-bottom:12px;">${e(proj.desc)}</p>
            <div>${(proj.stack||[]).map(t=>`<span class="ecl-tag">${e(t)}</span>`).join('')}</div>
          </div>
          <div style="display:flex;flex-direction:column;gap:8px;flex-shrink:0;">
            ${proj.live?`<a href="${e(proj.live)}" target="_blank" style="padding:7px 14px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;border-radius:4px;font-size:11px;font-weight:700;display:inline-block;text-align:center;">LIVE ↗</a>`:''}
            ${proj.github?`<a href="${e(proj.github)}" target="_blank" style="padding:7px 14px;background:transparent;border:1px solid rgba(245,158,11,.3);color:rgba(232,224,208,.7);border-radius:4px;font-size:11px;display:inline-block;text-align:center;">GITHUB</a>`:''}
            <button onclick="document.getElementById('modal-${e(proj.id)}').style.display='flex'" style="padding:7px 14px;background:transparent;border:1px solid rgba(245,158,11,.3);color:rgba(232,224,208,.7);border-radius:4px;font-size:11px;cursor:pointer;">DETAILS</button>
          </div>
        </div>`).join('')}
    </div>
  </div>
</section>

${(p.saas||[]).length ? `
<section id="ecl-products" class="sec">
  <hr class="ecl-hr">
  <div class="layout" style="margin-top:60px;">
    <div class="ecl-lbl">Products</div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;">
      ${(p.saas||[]).map(s=>`<div class="ecl-card"><div style="font-family:'Playfair Display',serif;font-size:17px;font-weight:700;font-style:italic;color:#fbbf24;margin-bottom:8px;">${e(s.name)}</div><p style="font-size:13px;color:rgba(232,224,208,.45);margin-bottom:16px;">${e(s.desc)}</p><div style="display:flex;gap:8px;">${s.platform?`<a href="${e(s.platform)}" target="_blank" style="padding:6px 12px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;border-radius:4px;font-size:11px;font-weight:700;">ACCESS</a>`:''} ${s.demo?`<a href="${e(s.demo)}" target="_blank" style="padding:6px 12px;background:transparent;border:1px solid rgba(245,158,11,.3);color:rgba(232,224,208,.7);border-radius:4px;font-size:11px;">DEMO</a>`:''}</div></div>`).join('')}
    </div>
  </div>
</section>` : ''}

<!-- CONTACT -->
<section id="ecl-contact" class="sec" style="padding-bottom:100px;">
  <hr class="ecl-hr">
  <div class="layout" style="margin-top:60px;">
    <div class="ecl-lbl">Contact</div>
    <div>
      <h2 style="font-family:'Playfair Display',serif;font-size:clamp(1.8rem,3vw,2.4rem);font-weight:700;font-style:italic;margin-bottom:12px;color:#e8e0d0;">Let's create something timeless.</h2>
      <p style="color:rgba(232,224,208,.4);margin-bottom:32px;">Available for select projects and full-time opportunities.</p>
      <a href="mailto:${e(p.contact?.email)}" style="display:inline-flex;padding:13px 32px;background:linear-gradient(135deg,#d97706,#f59e0b);color:#000;border-radius:4px;font-size:14px;font-weight:700;letter-spacing:.02em;">SEND MESSAGE →</a>
      <div style="margin-top:40px;display:flex;gap:28px;flex-wrap:wrap;">
        ${Object.entries(p.contact||{}).filter(([,v])=>v).map(([k,v])=>`<div><div style="font-size:10px;color:rgba(245,158,11,.5);font-family:monospace;margin-bottom:3px;letter-spacing:.1em;">${k.toUpperCase()}</div><div style="font-size:13px;color:rgba(232,224,208,.5);">${e(v)}</div></div>`).join('')}
      </div>
    </div>
  </div>
</section>

<footer style="border-top:1px solid rgba(245,158,11,.08);padding:28px 56px;display:flex;justify-content:space-between;align-items:center;color:rgba(232,224,208,.18);font-size:12px;font-family:monospace;">
  <span>FOLIOOS ECLIPSE · ${e(p.name)}</span>
  <span>© ${new Date().getFullYear()}</span>
</footer>

${renderModals(p.projects||[])}
</body></html>`;
}

module.exports = { generateWebsite, getSiteBySubdomain, TEMPLATES };
