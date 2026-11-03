const { Redis } = require('@upstash/redis');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;

module.exports = async (req, res) => {
  try {
    if (!redis) return res.status(500).json({ error: 'Variabel database belum terbaca.' });
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    const raw = (await redis.hgetall('pdam:harian')) || {};
    const harian = {};
    for (const [tgl, v] of Object.entries(raw)) harian[tgl] = typeof v === 'string' ? JSON.parse(v) : v;
    return res.status(200).json({ harian });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
