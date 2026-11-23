// Adaptador: transforma a função (req,res) da Vercel no formato usado por lib/core.js
const { handle } = require('./core');

module.exports = function makeHandler(name) {
  return async function (req, res) {
    let body = req.body;
    if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { body = {}; } }
    const out = await handle(name, {
      method: req.method,
      query: req.query || {},
      body: body && typeof body === 'object' ? body : {},
      headers: req.headers || {}
    });
    res.setHeader('Cache-Control', 'no-store');
    Object.keys(out.headers || {}).forEach((k) => res.setHeader(k, out.headers[k]));
    res.status(out.status).json(out.body);
  };
};
