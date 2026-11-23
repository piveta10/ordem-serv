// Conexão com o banco (Neon Postgres via Vercel). Em testes, outro adaptador pode ser injetado.
let _pool = null;
let _override = null;

function connectionString() {
  const e = process.env;
  const known = e.DATABASE_URL || e.POSTGRES_URL || e.DATABASE_URL_UNPOOLED || e.POSTGRES_URL_NON_POOLING;
  if (known) return known;
  // A Vercel pode criar as variáveis com prefixo (ex.: STORAGE_DATABASE_URL, STORAGE_URL, NEON_POSTGRES_URL).
  // Procura qualquer variável cujo valor seja um endereço de Postgres, preferindo a "pooled".
  const found = Object.keys(e).filter((k) => /^postgres(ql)?:\/\//i.test(String(e[k] || '')));
  found.sort((a, b) => {
    const bad = (k) => (/UNPOOLED|NON_POOLING|NO_SSL/i.test(k) ? 1 : 0);
    const good = (k) => (/DATABASE_URL|POSTGRES_URL|_URL$/i.test(k) ? 0 : 1);
    return bad(a) - bad(b) || good(a) - good(b);
  });
  return found.length ? e[found[0]] : '';
}

function setDb(db) { _override = db; }

function getDb() {
  if (_override) return _override;
  if (_pool) return _pool;
  const cs = connectionString();
  if (!cs) {
    const err = new Error('Banco de dados não configurado (variável DATABASE_URL ausente).');
    err.code = 'NO_DB';
    throw err;
  }
  const { Pool } = require('pg');
  _pool = new Pool({
    connectionString: cs,
    max: 3,
    idleTimeoutMillis: 10000,
    connectionTimeoutMillis: 8000,
    ssl: /sslmode=disable/.test(cs) || /localhost|127\.0\.0\.1/.test(cs) ? false : { rejectUnauthorized: false }
  });
  _pool.on('error', () => { /* conexões ociosas podem cair; o pool reabre */ });
  return _pool;
}

function secretSeed() {
  return process.env.SESSION_SECRET || ('piveta|' + connectionString());
}

// Executa fn(client) dentro de uma transação. client.query(sql, params) -> { rows }
async function withTx(fn) {
  const db = getDb();
  const client = db.connect ? await db.connect() : db;
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch (_) {}
    throw e;
  } finally {
    if (client.release) client.release();
  }
}

module.exports = { getDb, setDb, withTx, secretSeed, connectionString };
