import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(__dirname, '../artifacts/api-server/package.json'));
const PDFDocument = require('pdfkit');
const fs = require('node:fs');

const C = {
  ink:    '#0f172a',
  body:   '#1e293b',
  muted:  '#64748b',
  gold:   '#C9A450',
  goldDk: '#8a6d20',
  sky:    '#0ea5e9',
  line:   '#e2e8f0',
  codeBg: '#0f172a',
  codeTx: '#7dd3fc',
  chip:   '#f1f5f9',
};

const outPath = path.join(__dirname, '../docs/OmniCore-Client-Guide.pdf');
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const doc = new PDFDocument({
  size: 'A4',
  margins: { top: 56, bottom: 48, left: 56, right: 56 },
  bufferPages: true,
  info: {
    Title: 'Atelier OmniCore — Client Guide',
    Author: 'Atelier OmniCore',
    Subject: 'Getting started with OmniCore for your business',
  },
});
doc.pipe(fs.createWriteStream(outPath));

const PAGE_W = doc.page.width;
const ML = doc.page.margins.left;
const CW = PAGE_W - ML - doc.page.margins.right;

function gap(h = 6) { doc.y += h; }

function h1(text) {
  gap(10);
  doc.rect(ML, doc.y, 3, 22).fill(C.gold);
  doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(20)
     .text(text, ML + 12, doc.y + 1);
  gap(5);
  doc.moveTo(ML, doc.y).lineTo(ML + CW, doc.y).lineWidth(0.8).strokeColor(C.line).stroke();
  gap(10);
}

function h2(text) {
  gap(8);
  doc.fillColor(C.goldDk).font('Helvetica-Bold').fontSize(13).text(text, ML);
  gap(5);
}

function h3(text) {
  gap(6);
  doc.fillColor(C.sky).font('Helvetica-Bold').fontSize(10.5).text(text, ML);
  gap(3);
}

function para(text, opts = {}) {
  doc.fillColor(opts.color || C.body).font(opts.font || 'Helvetica')
     .fontSize(opts.size || 9.5)
     .text(text, ML, doc.y, { width: CW, align: 'left', lineGap: 2 });
  gap(5);
}

function bullet(text, opts = {}) {
  const x = ML + (opts.indent || 0);
  const startY = doc.y;
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(9.5).text('•', x, startY, { width: 10 });
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(text, x + 12, startY, { width: CW - 12 - (opts.indent || 0), lineGap: 1.5 });
  gap(3);
}

function kv(key, value) {
  const startY = doc.y;
  doc.fillColor(C.goldDk).font('Helvetica-Bold').fontSize(9).text(key, ML, startY, { width: 140 });
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(value, ML + 145, startY, { width: CW - 145, lineGap: 1.5 });
  gap(3);
}

function code(lines) {
  const text = Array.isArray(lines) ? lines.join('\n') : lines;
  const h = doc.heightOfString(text, { width: CW - 20, lineGap: 1.5 }) + 14;
  const y = doc.y;
  doc.roundedRect(ML, y, CW, h, 4).fill(C.codeBg);
  doc.fillColor(C.codeTx).font('Courier').fontSize(8)
     .text(text, ML + 10, y + 7, { width: CW - 20, lineGap: 1.5 });
  doc.y = y + h;
  gap(6);
}

function callout(title, text) {
  doc.font('Helvetica').fontSize(9);
  const bodyH = doc.heightOfString(text, { width: CW - 32, lineGap: 1.5 });
  const h = bodyH + 26;
  const y = doc.y;
  doc.roundedRect(ML, y, CW, h, 4).fillOpacity(0.07).fill(C.gold).fillOpacity(1);
  doc.rect(ML, y, 3, h).fill(C.gold);
  doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(9).text(title, ML + 12, y + 7);
  doc.fillColor(C.body).font('Helvetica').fontSize(9)
     .text(text, ML + 12, doc.y + 1, { width: CW - 24, lineGap: 1.5 });
  doc.y = y + h;
  gap(8);
}

// ═══ COVER ═══════════════════════════════════════════════════════════════════════
doc.rect(0, 0, PAGE_W, doc.page.height).fill('#F5EDE0');
doc.rect(0, 0, PAGE_W, 6).fill(C.gold);
doc.rect(0, doc.page.height - 6, PAGE_W, 6).fill(C.gold);

doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(12)
   .text('ATELIER', ML, 140, { characterSpacing: 3 });
doc.fillColor(C.gold).font('Helvetica-Bold').fontSize(48)
   .text('OmniCore', ML, 158);
doc.fillColor(C.ink).font('Helvetica-Bold').fontSize(26)
   .text('Client Guide', ML, 220);
doc.fillColor(C.muted).font('Helvetica').fontSize(11)
   .text('Getting your business set up with OmniCore — agents, chat widget,\nand AI-powered support in minutes.',
     ML, 262, { lineGap: 3 });

doc.moveTo(ML, 330).lineTo(ML + 180, 330).lineWidth(1.5).strokeColor(C.gold).stroke();

doc.fillColor(C.muted).font('Helvetica').fontSize(8)
   .text('Generated ' + new Date().toISOString().slice(0, 10) + '  ·  Atelier OmniCore',
     ML, doc.page.height - 80);

// ═══ 1. WHAT IS OMNICORE ══════════════════════════════════════════════════════
doc.addPage();

h1('1 · What Is OmniCore?');
para('OmniCore is an AI-powered, multi-channel customer support platform built for modern businesses. It gives your team a unified inbox to handle conversations from live chat, email, and more — all in one place. An AI assistant helps answer common questions automatically, so your human agents focus on what matters.');

h2('Key features');
bullet('Unified inbox — chat, email, and tickets in one dashboard');
bullet('AI auto-reply — Gemini-powered answers trained on your knowledge base');
bullet('Embeddable chat widget — drop a single script tag onto your website');
bullet('Multi-brand support — manage multiple business identities from one account');
bullet('Real-time collaboration — see who is online, typing, and what page visitors are on');
bullet('CSAT surveys — collect star ratings after every conversation');

h2('Your workspace');
para('When you sign up, you create a tenant workspace. Inside it you can set up one or more brands. Each brand gets its own chat widget, AI knowledge base, and custom settings. Agents are invited to the workspace and can be scoped to specific brands.');

// ═══ 2. GETTING STARTED ══════════════════════════════════════════════════════
h1('2 · Getting Started');

h2('Sign in');
kv('Dashboard URL', 'https://<your-domain>/dashboard/');
kv('Default admin', 'admin@omnicore.test / Admin123! (development)');
para('Use your workspace email and password. If you forgot it, click Forgot Password on the login screen to receive a reset link via email.');

h2('Create your first brand');
para('Once logged in, go to the Brands section in the sidebar. Click Add Brand, give it a name, upload a logo, and set the widget colour. This creates the identity your customers will see in the chat widget.');

h2('Set up your knowledge base (for AI)');
para('Go to AI Training in the sidebar. Here you can:');
bullet('Write knowledge articles that the AI uses to answer questions');
bullet('Crawl your existing website or help docs to auto-populate articles');
bullet('Set per-brand AI prompts and confidence thresholds');
para('The more detailed your articles, the better the AI responses. You can always edit or remove articles later.');

h2('Invite agents');
para('Go to Team in the sidebar. Click Invite Agent, enter their email, and choose a role:');
bullet('Admin — full access to billing, settings, and all brands');
bullet('Agent — handles conversations and can view assigned brands');
bullet('Supervisor — oversees performance and can adjust priorities');
para('Invited agents receive an email with a set-password link. You can restrict an agent to specific brands using the Brand Access setting.');

// ═══ 3. THE CHAT WIDGET ══════════════════════════════════════════════════════
h1('3 · The Chat Widget');
para('The widget is a small floating chat bubble that appears on your website. Visitors click it to start a conversation with your team (or the AI). It works on any site — no framework required.');

h2('Embed code');
para('Copy the embed snippet from the Brands page for any brand you created:');
code('<script src="https://<your-domain>/api/widget/widget.js"\n        data-brand-id="<YOUR_BRAND_UUID>"\n        defer></script>');
para('Paste this just before the closing </body> tag on every page where you want the widget to appear.');

h2('How it works for visitors');
bullet('A visitor opens your site and sees the chat bubble');
bullet('They click it, enter their name/email, and start chatting');
bullet('If AI auto-reply is on for that brand, the AI answers first; a human can take over anytime');
bullet('When the visitor closes the chat, a quick 1–5 star CSAT survey appears (optional)');

h2('Widget customisation');
para('From the Brands page you can change:');
bullet('Primary colour and logo');
bullet('Welcome message and offline message');
bullet('Allowed domains (security) — restrict which websites can load your widget');
bullet('AI auto-reply toggle per brand');

// ═══ 4. THE DASHBOARD ══════════════════════════════════════════════════════
h1('4 · Using the Dashboard');

h2('Inbox');
para('The Inbox is where conversations live. You can:');
bullet('Filter by status (Open, Resolved, Pending, AI Handling)');
bullet('Filter by brand, assigned agent, priority, or search by keyword');
bullet('Assign conversations to specific agents');
bullet('Convert a chat into a long-running ticket (moves to email channel)');
bullet('Send internal notes that visitors cannot see');

h2('Chat panel');
para('Click any conversation to open the chat panel. Here you see the full message history, visitor details (page they are on, location), and a compose box. You can attach files, use canned responses (pre-written shortcuts), and see typing indicators.');

h2('CSAT & performance');
para('The CSAT section shows satisfaction scores and response times. Use this to spot training needs or celebrate top performers.');

h2('Settings');
para('The Settings page lets you update:');
bullet('Your profile and password');
bullet('Workspace SMTP / outbound email settings');
bullet('Webhook endpoints for inbound email routing');
bullet('Inbound email prefix per brand (e.g. support@yourdomain.com)');

// ═══ 5. PLANS & NEXT STEPS ═════════════════════════════════════════════════════
h1('5 · Plans & Next Steps');

para('OmniCore offers tiered plans with different limits on brands, agents, conversations, and AI features. Contact your account manager or visit the Pricing page to view current plans and upgrade when you are ready.');

h2('Quick checklist');
bullet('Create your first brand and customise the widget');
bullet('Add at least 3–5 knowledge articles for the AI');
bullet('Embed the widget script on your website');
bullet('Invite your support team');
bullet('Monitor the inbox and CSAT scores weekly');

h2('Need help?');
para('Visit the Help Centre on the marketing site for step-by-step guides. For technical issues or feature requests, email support or reach out through the in-app chat.');

// ═══ FOOTERS ════════════════════════════════════════════════════════─══════════════════════════
const range = doc.bufferedPageRange();
for (let i = range.start; i < range.start + range.count; i++) {
  if (i === 0) continue;
  doc.switchToPage(i);
  const fy = doc.page.height - 38;
  doc.moveTo(ML, fy).lineTo(ML + CW, fy).lineWidth(0.5).strokeColor(C.line).stroke();
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text('Atelier OmniCore — Client Guide', ML, fy + 6, { width: CW / 2, align: 'left' });
  doc.fillColor(C.muted).font('Helvetica').fontSize(7.5)
     .text('Page ' + i, ML + CW / 2, fy + 6, { width: CW / 2, align: 'right' });
}

doc.end();
console.log('Client guide PDF written to ' + outPath);
