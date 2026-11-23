'use strict';
/**
 * PIVETA PINTURAS INDUSTRIAIS - Regras do servidor (Vercel + Neon Postgres)
 * Todas as permissões são validadas AQUI (servidor). O navegador só exibe.
 */
const crypto = require('crypto');
const { getDb, withTx, secretSeed } = require('./db');

const KINDS = ['paints', 'movements', 'clients', 'orders', 'company'];
const DESC_KINDS = ['orders', 'movements'];         // mais novo primeiro
const WEAK = ['admin', '123', '1234', '12345', '123456', 'senha', 'piveta', 'operador'];
const COOKIE = 'pv_sess';
const MAX_CHANGES = 500;
const MAX_RECORD_BYTES = 200 * 1024;

class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra || {}; }
}
const bad = (m) => new HttpError(400, m);
const forbidden = (m) => new HttpError(403, m || 'Sem permissão para esta ação.');

/* ----------------------------- Esquema ----------------------------- */
let _schemaPromise = null;
function ensureSchema() {
  if (!_schemaPromise) {
    _schemaPromise = withTx(async (c) => {
      await c.query('SELECT pg_advisory_xact_lock(727001)');
      await c.query(`CREATE TABLE IF NOT EXISTS app_users (
        id text PRIMARY KEY, username text UNIQUE NOT NULL, name text NOT NULL,
        role text NOT NULL, pass_hash text NOT NULL, must_change boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now())`);
      await c.query(`CREATE TABLE IF NOT EXISTS app_records (
        kind text NOT NULL, id text NOT NULL, data jsonb NOT NULL, ver integer NOT NULL DEFAULT 1,
        ord bigint NOT NULL DEFAULT 0, updated_at timestamptz NOT NULL DEFAULT now(),
        PRIMARY KEY (kind, id))`);
      await c.query(`CREATE TABLE IF NOT EXISTS app_meta (key text PRIMARY KEY, n bigint NOT NULL DEFAULT 0)`);
      await c.query(`INSERT INTO app_meta (key, n) VALUES ('rev', 0) ON CONFLICT (key) DO NOTHING`);
      await c.query(`CREATE TABLE IF NOT EXISTS app_login_fails (
        k text PRIMARY KEY, cnt integer NOT NULL DEFAULT 0, until_ts bigint NOT NULL DEFAULT 0)`);
    }).catch((e) => { _schemaPromise = null; throw e; });
  }
  return _schemaPromise;
}
function _resetSchemaCache() { _schemaPromise = null; }

/* ------------------------ Senhas / sessão ------------------------- */
function scryptAsync(pw, salt) {
  return new Promise((res, rej) => crypto.scrypt(pw, salt, 32, { N: 16384, r: 8, p: 1 }, (e, k) => e ? rej(e) : res(k)));
}
async function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const key = await scryptAsync(String(pw), salt);
  return `scrypt$${salt.toString('base64')}$${key.toString('base64')}`;
}
async function verifyPassword(pw, stored) {
  try {
    const [alg, s, k] = String(stored).split('$');
    if (alg !== 'scrypt') return false;
    const key = await scryptAsync(String(pw), Buffer.from(s, 'base64'));
    const want = Buffer.from(k, 'base64');
    return key.length === want.length && crypto.timingSafeEqual(key, want);
  } catch (e) { return false; }
}
function validateNewPassword(pw) {
  if (!pw || String(pw).length < 6) return 'A senha deve ter pelo menos 6 caracteres.';
  if (String(pw).length > 100) return 'Senha muito longa.';
  if (WEAK.includes(String(pw).toLowerCase())) return 'Senha muito fácil. Escolha outra.';
  return null;
}
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const secretKey = () => crypto.createHash('sha256').update(secretSeed()).digest();
const sign = (s) => b64u(crypto.createHmac('sha256', secretKey()).update(s).digest());
const stamp = (passHash) => crypto.createHash('sha256').update(String(passHash)).digest('hex').slice(0, 12);

function makeToken(user, remember) {
  const payload = b64u(JSON.stringify({ u: user.id, s: stamp(user.pass_hash), e: Date.now() + (remember ? 30 : 1) * 86400000 }));
  return payload + '.' + sign(payload);
}
function parseCookies(h) {
  const out = {};
  String(h || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function cookieHeader(token, remember, secure) {
  let c = `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax`;
  if (secure) c += '; Secure';
  if (remember) c += `; Max-Age=${30 * 86400}`;
  return c;
}
const clearCookie = (secure) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

const pubUser = (u) => ({ id: u.id, username: u.username, name: u.name, role: u.role, mustChangePassword: !!u.must_change });

async function userFromReq(ctx, c) {
  const raw = parseCookies(ctx.headers.cookie)[COOKIE];
  if (!raw) return null;
  const [payload, sig] = raw.split('.');
  if (!payload || !sig || sign(payload) !== sig) return null;
  let p; try { p = JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()); } catch (e) { return null; }
  if (!p || !p.u || p.e < Date.now()) return null;
  const { rows } = await (c || getDb()).query('SELECT * FROM app_users WHERE id = $1', [p.u]);
  const u = rows[0];
  if (!u || stamp(u.pass_hash) !== p.s) return null;
  return u;
}
async function requireUser(ctx, c) {
  const u = await userFromReq(ctx, c);
  if (!u) throw new HttpError(401, 'Sessão expirada. Faça login novamente.');
  return u;
}
const isSecure = (ctx) => /https/i.test(String(ctx.headers['x-forwarded-proto'] || ''));

/* ------------------------------ Dados ------------------------------ */
const num = (v) => Number(v);
const parseData = (d) => (typeof d === 'string' ? JSON.parse(d) : d);

async function currentRev(c) {
  const { rows } = await c.query(`SELECT n FROM app_meta WHERE key = 'rev'`);
  return rows[0] ? num(rows[0].n) : 0;
}

async function snapshot(user) {
  const db = getDb();
  const rev = await currentRev(db);
  const { rows } = await db.query('SELECT kind, id, data, ver, ord FROM app_records ORDER BY ord ASC, id ASC');
  const data = { paints: [], movements: [], clients: [], orders: [], company: null };
  rows.forEach((r) => {
    const rec = Object.assign({}, parseData(r.data), { _v: num(r.ver) });
    if (r.kind === 'company') data.company = rec;
    else if (data[r.kind]) data[r.kind].push(rec);
  });
  DESC_KINDS.forEach((k) => data[k].reverse());
  let users = [];
  if (user.role === 'admin') {
    const u = await db.query('SELECT * FROM app_users ORDER BY created_at ASC, id ASC');
    users = u.rows.map(pubUser);
  } else users = [pubUser(user)];
  return { rev, user: pubUser(user), data, users };
}

function sameExcept(a, b, ignore) {
  const ka = Object.keys(a || {}).filter((k) => !ignore.includes(k));
  const kb = Object.keys(b || {}).filter((k) => !ignore.includes(k));
  if (ka.length !== kb.length) return false;
  return ka.every((k) => JSON.stringify(a[k]) === JSON.stringify((b || {})[k]));
}

// Regras por perfil. Operador só pode: criar/editar OS e clientes, e mexer no saldo de tinta via OS.
function checkPermission(user, ch, existing) {
  if (user.role === 'admin') return;
  const { kind, op } = ch;
  if (kind === 'orders' && op === 'put') return;
  if (kind === 'clients' && op === 'put') return;
  if (kind === 'paints' && op === 'put' && existing && sameExcept(ch.record, parseData(existing.data), ['stockKg', 'updatedAt', '_v'])) return;
  if (kind === 'movements' && op === 'put' && !existing && ['SAIDA_OS', 'DEVOLUCAO_OS'].includes(ch.record && ch.record.type)) return;
  throw forbidden('Esta ação é permitida somente para Administradores.');
}

function validateChange(ch) {
  if (!ch || !KINDS.includes(ch.kind)) throw bad('Tipo de dado inválido.');
  if (ch.op !== 'put' && ch.op !== 'del') throw bad('Operação inválida.');
  if (typeof ch.id !== 'string' || !ch.id || ch.id.length > 80) throw bad('Identificador inválido.');
  if (ch.kind === 'company' && ch.id !== 'main') throw bad('Identificador inválido.');
  if (ch.op === 'put') {
    if (!ch.record || typeof ch.record !== 'object' || Array.isArray(ch.record)) throw bad('Registro inválido.');
    if (JSON.stringify(ch.record).length > MAX_RECORD_BYTES) throw bad('Registro grande demais.');
  }
}

async function saveChanges(user, changes) {
  if (!Array.isArray(changes) || !changes.length) return { rev: await currentRev(getDb()), vers: [] };
  if (changes.length > MAX_CHANGES) throw bad('Alterações demais de uma vez.');
  changes.forEach(validateChange);
  return withTx(async (c) => {
    // Trava global de escrita (todos pegam esta linha primeiro => sem deadlock, sem perda de atualização)
    const r = await c.query(`UPDATE app_meta SET n = n + 1 WHERE key = 'rev' RETURNING n`);
    const rev = num(r.rows[0].n);
    const vers = [];
    for (let i = 0; i < changes.length; i++) {
      const ch = changes[i];
      const sel = await c.query('SELECT data, ver FROM app_records WHERE kind = $1 AND id = $2 FOR UPDATE', [ch.kind, ch.id]);
      const row = sel.rows[0];
      checkPermission(user, ch, row);
      const clientVer = Number(ch.ver) || 0;
      if (ch.op === 'del') {
        if (row && num(row.ver) !== clientVer) throw new HttpError(409, 'Este registro foi alterado por outra pessoa.', { conflict: true });
        if (row) await c.query('DELETE FROM app_records WHERE kind = $1 AND id = $2', [ch.kind, ch.id]);
        vers.push({ kind: ch.kind, id: ch.id, ver: 0 });
        continue;
      }
      const rec = Object.assign({}, ch.record); delete rec._v;
      if (!row) {
        if (clientVer !== 0) throw new HttpError(409, 'Este registro foi removido por outra pessoa.', { conflict: true });
        await c.query('INSERT INTO app_records (kind, id, data, ver, ord) VALUES ($1, $2, $3::jsonb, 1, $4)',
          [ch.kind, ch.id, JSON.stringify(rec), rev * 1000 + i]);
        vers.push({ kind: ch.kind, id: ch.id, ver: 1 });
      } else {
        if (num(row.ver) !== clientVer) throw new HttpError(409, 'Este registro foi alterado por outra pessoa.', { conflict: true });
        await c.query('UPDATE app_records SET data = $3::jsonb, ver = ver + 1, updated_at = now() WHERE kind = $1 AND id = $2',
          [ch.kind, ch.id, JSON.stringify(rec)]);
        vers.push({ kind: ch.kind, id: ch.id, ver: clientVer + 1 });
      }
    }
    return { rev, vers };
  });
}

// Importação de backup (somente ADM): substitui os dados do sistema; usuários NÃO são alterados.
async function importBackup(user, payload) {
  if (user.role !== 'admin') throw forbidden('Apenas Administradores podem restaurar backup.');
  if (!payload || typeof payload !== 'object') throw bad('Arquivo de backup inválido.');
  const lists = {};
  ['paints', 'movements', 'clients', 'orders'].forEach((k) => {
    if (payload[k] != null && !Array.isArray(payload[k])) throw bad('Arquivo de backup inválido.');
    lists[k] = (payload[k] || []).filter((x) => x && typeof x === 'object');
  });
  if (!lists.paints.length && !lists.orders.length && !lists.clients.length) throw bad('O arquivo não contém dados para importar.');
  return withTx(async (c) => {
    const r = await c.query(`UPDATE app_meta SET n = n + 1 WHERE key = 'rev' RETURNING n`);
    const rev = num(r.rows[0].n);
    await c.query('DELETE FROM app_records');
    let n = 0;
    const seen = new Set();
    for (const kind of ['paints', 'movements', 'clients', 'orders']) {
      const arr = lists[kind].slice();
      if (DESC_KINDS.includes(kind)) arr.reverse();   // o mais novo recebe o maior "ord"
      for (const item of arr) {
        let id = String(item.id || '').slice(0, 80);
        if (!id || seen.has(kind + '|' + id)) id = kind.slice(0, 3) + '-imp-' + crypto.randomBytes(5).toString('hex');
        seen.add(kind + '|' + id);
        const rec = Object.assign({}, item, { id }); delete rec._v;
        await c.query('INSERT INTO app_records (kind, id, data, ver, ord) VALUES ($1, $2, $3::jsonb, 1, $4)',
          [kind, id, JSON.stringify(rec), rev * 100000 + (n++)]);
      }
    }
    if (payload.company && typeof payload.company === 'object' && !Array.isArray(payload.company)) {
      const co = Object.assign({}, payload.company, { id: 'main' }); delete co._v;
      await c.query('INSERT INTO app_records (kind, id, data, ver, ord) VALUES ($1, $2, $3::jsonb, 1, $4)',
        ['company', 'main', JSON.stringify(co), rev * 100000 + (n++)]);
    }
    return { rev, count: n };
  });
}

/* ------------------------------ Usuários --------------------------- */
const newId = () => 'usr-' + Date.now().toString(36) + crypto.randomBytes(3).toString('hex');

function cleanUserInput({ name, username, role, password }) {
  name = String(name || '').trim().slice(0, 80);
  username = String(username || '').trim().toLowerCase();
  if (!name || !username) throw bad('Informe nome e usuário.');
  if (!/^[a-z0-9._-]{3,30}$/.test(username)) throw bad('Usuário: mínimo 3 caracteres, só letras minúsculas, números, ponto, traço ou _.');
  const err = validateNewPassword(password);
  if (err) throw bad(err);
  return { name, username, role: role === 'admin' ? 'admin' : 'operador', password };
}

async function setupFirstAdmin(ctx) {
  const u = cleanUserInput({ ...ctx.body, role: 'admin' });
  const hash = await hashPassword(u.password);
  const user = await withTx(async (c) => {
    await c.query('LOCK TABLE app_users IN EXCLUSIVE MODE');
    const cnt = await c.query('SELECT count(*)::int AS n FROM app_users');
    if (num(cnt.rows[0].n) > 0) throw new HttpError(409, 'O sistema já foi configurado. Faça login.');
    const id = newId();
    await c.query('INSERT INTO app_users (id, username, name, role, pass_hash, must_change) VALUES ($1,$2,$3,$4,$5,false)',
      [id, u.username, u.name, 'admin', hash]);
    return { id, username: u.username, name: u.name, role: 'admin', pass_hash: hash, must_change: false };
  });
  return { user, remember: true };
}

async function login(ctx) {
  const username = String(ctx.body.username || '').trim().toLowerCase();
  const password = String(ctx.body.password || '');
  const db = getDb();
  const f = (await db.query('SELECT cnt, until_ts FROM app_login_fails WHERE k = $1', [username])).rows[0];
  if (f && num(f.until_ts) > Date.now()) {
    const s = Math.ceil((num(f.until_ts) - Date.now()) / 1000);
    throw new HttpError(429, `Muitas tentativas erradas. Aguarde ${s}s e tente de novo.`);
  }
  const u = (await db.query('SELECT * FROM app_users WHERE username = $1', [username])).rows[0];
  const ok = u ? await verifyPassword(password, u.pass_hash) : (await scryptAsync('x', Buffer.alloc(16)), false);
  if (!ok) {
    const cnt = (f ? Number(f.cnt) : 0) + 1;
    const lock = cnt >= 5;
    await db.query(`INSERT INTO app_login_fails (k, cnt, until_ts) VALUES ($1,$2,$3)
      ON CONFLICT (k) DO UPDATE SET cnt = EXCLUDED.cnt, until_ts = EXCLUDED.until_ts`,
      [username.slice(0, 60), lock ? 0 : cnt, lock ? Date.now() + 30000 : 0]);
    throw new HttpError(401, 'Usuário ou senha incorretos.');
  }
  await db.query('DELETE FROM app_login_fails WHERE k = $1', [username]);
  return { user: u, remember: ctx.body.remember !== false };
}

/* ------------------------------ Rotas ------------------------------ */
const ok = (body, headers) => ({ status: 200, body, headers: headers || {} });

async function route(name, ctx) {
  ctx.headers = ctx.headers || {};
  ctx.body = ctx.body || {};
  ctx.query = ctx.query || {};
  await ensureSchema();
  const db = getDb();
  const secure = isSecure(ctx);
  let action = ctx.query.action || ctx.body.action || '';
  // Gestão de usuários também pode ser chamada pela função "data" (action "user_add", "user_reset", "user_delete"),
  // assim o sistema não depende de existir um arquivo api/users.js separado.
  if (name === 'data' && ctx.method === 'POST' && /^user_/.test(String(ctx.body.action || ''))) {
    name = 'users';
    action = String(ctx.body.action).slice(5);
  }

  if (name === 'auth') {
    if (ctx.method === 'GET') {
      const cnt = (await db.query('SELECT count(*)::int AS n FROM app_users')).rows[0];
      const user = await userFromReq(ctx);
      return ok({ setupNeeded: num(cnt.n) === 0, user: user ? pubUser(user) : null });
    }
    if (ctx.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
    if (action === 'login' || action === 'setup') {
      const { user, remember } = action === 'login' ? await login(ctx) : await setupFirstAdmin(ctx);
      return ok({ user: pubUser(user) }, { 'Set-Cookie': cookieHeader(makeToken(user, remember), remember, secure) });
    }
    if (action === 'logout') return ok({ ok: true }, { 'Set-Cookie': clearCookie(secure) });
    if (action === 'password') {
      const me = await requireUser(ctx);
      const { current, next } = ctx.body;
      if (!(await verifyPassword(String(current || ''), me.pass_hash))) throw new HttpError(400, 'Senha atual incorreta.');
      if (String(current) === String(next)) throw bad('A nova senha deve ser diferente da atual.');
      const err = validateNewPassword(next); if (err) throw bad(err);
      const hash = await hashPassword(next);
      await db.query('UPDATE app_users SET pass_hash = $2, must_change = false WHERE id = $1', [me.id, hash]);
      const upd = Object.assign({}, me, { pass_hash: hash, must_change: false });
      return ok({ ok: true, user: pubUser(upd) }, { 'Set-Cookie': cookieHeader(makeToken(upd, true), true, secure) });
    }
    throw bad('Ação inválida.');
  }

  if (name === 'data') {
    const me = await requireUser(ctx);
    if (ctx.method === 'GET') {
      if (action === 'rev') return ok({ rev: await currentRev(db), user: pubUser(me) });
      return ok(await snapshot(me));
    }
    if (ctx.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
    if (action === 'save') return ok(await saveChanges(me, ctx.body.changes));
    if (action === 'import') return ok(await importBackup(me, ctx.body.backup));
    throw bad('Ação inválida.');
  }

  if (name === 'users') {
    const me = await requireUser(ctx);
    if (ctx.method !== 'POST') throw new HttpError(405, 'Método não permitido.');
    if (me.role !== 'admin') throw forbidden('Apenas Administradores.');
    if (action === 'add') {
      const u = cleanUserInput(ctx.body);
      const hash = await hashPassword(u.password);
      try {
        await db.query('INSERT INTO app_users (id, username, name, role, pass_hash, must_change) VALUES ($1,$2,$3,$4,$5,true)',
          [newId(), u.username, u.name, u.role, hash]);
      } catch (e) {
        if (e && (e.code === '23505' || /duplicate key|unique/i.test(String(e.message)))) throw new HttpError(409, 'Esse usuário já existe.');
        throw e;
      }
      await db.query(`UPDATE app_meta SET n = n + 1 WHERE key = 'rev'`);
      return ok({ ok: true });
    }
    if (action === 'reset') {
      const err = validateNewPassword(ctx.body.password); if (err) throw bad(err);
      const hash = await hashPassword(ctx.body.password);
      const r = await db.query('UPDATE app_users SET pass_hash = $2, must_change = true WHERE id = $1 RETURNING id', [String(ctx.body.id || ''), hash]);
      if (!r.rows.length) throw new HttpError(404, 'Usuário não encontrado.');
      return ok({ ok: true });
    }
    if (action === 'delete') {
      const id = String(ctx.body.id || '');
      if (id === me.id) throw bad('Você não pode excluir o próprio usuário.');
      await withTx(async (c) => {
        await c.query('LOCK TABLE app_users IN EXCLUSIVE MODE');
        const t = (await c.query('SELECT role FROM app_users WHERE id = $1', [id])).rows[0];
        if (!t) throw new HttpError(404, 'Usuário não encontrado.');
        if (t.role === 'admin') {
          const n = (await c.query(`SELECT count(*)::int AS n FROM app_users WHERE role = 'admin'`)).rows[0].n;
          if (num(n) <= 1) throw bad('Precisa existir pelo menos um Administrador.');
        }
        await c.query('DELETE FROM app_users WHERE id = $1', [id]);
      });
      await db.query(`UPDATE app_meta SET n = n + 1 WHERE key = 'rev'`);
      return ok({ ok: true });
    }
    throw bad('Ação inválida.');
  }
  throw new HttpError(404, 'Rota não encontrada.');
}

// Camada comum: trata erros e formata resposta
async function handle(name, ctx) {
  try {
    const m = ctx.method;
    if (m === 'POST') {
      const ct = String((ctx.headers || {})['content-type'] || '');
      if (!/application\/json/i.test(ct)) throw bad('Requisição inválida.');
    }
    return await route(name, ctx);
  } catch (e) {
    if (e instanceof HttpError) return { status: e.status, body: Object.assign({ error: e.message }, e.extra), headers: {} };
    console.error('[api]', name, e);
    if (e && e.code === 'NO_DB') return { status: 503, body: { error: e.message, code: 'NO_DB' }, headers: {} };
    return { status: 500, body: { error: 'Erro interno no servidor. Tente novamente.' }, headers: {} };
  }
}

module.exports = { handle, _resetSchemaCache, hashPassword, verifyPassword };
