require('dotenv').config({ path: process.env.HOME + '/workspace/anchorfashionprisma/.env.local' });
const crypto = require('crypto');
const fs = require('fs');
const { neon } = require('@neondatabase/serverless');
const sql = neon(process.env.DATABASE_URL);
(async () => {
  const rows = await sql`select id, email, code_hash, expires_at, attempts, verified_at, created_at
                         from cod_verifications order by created_at desc limit 3`;
  for (const r of rows) console.log('ROW', r.email, 'hash', String(r.code_hash).slice(0, 12), 'exp', r.expires_at, 'att', r.attempts, 'verified', r.verified_at);
  const pending = rows.find(r => !r.verified_at && r.attempts < 5);
  if (!pending) { console.log('NO_PENDING'); return; }
  const envTxt = fs.readFileSync(process.env.HOME + '/workspace/aso_diag/anchor-production.env', 'utf8');
  const m = envTxt.match(/NEXTAUTH_SECRET\s*=\s*"?([^"\n]+)"?/);
  const h = envTxt.match(/COD_OTP_HMAC_SECRET\s*=\s*"?([^"\n]+)"?/);
  const secret = (h && h[1].trim()) || (m && m[1].trim());
  if (!secret) { console.log('NO_SECRET'); return; }
  for (let i = 100000; i <= 999999; i++) {
    const code = String(i);
    const digest = crypto.createHmac('sha256', secret).update(code).digest('hex');
    if (digest === pending.code_hash) { console.log('CODE_IS', code); return; }
  }
  console.log('NO_MATCH');
})().catch(e => { console.error('FAIL', e.message); process.exit(1); });
