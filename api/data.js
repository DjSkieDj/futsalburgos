'use strict';
// Función serverless (Vercel/Netlify-compatible): GET /api/data
const { getData } = require('../lib/fetcher');

module.exports = async (req, res) => {
  try {
    const data = await getData();
    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.status(200).send(JSON.stringify(data));
  } catch (err) {
    res.status(502).json({ error: String(err.message || err) });
  }
};
