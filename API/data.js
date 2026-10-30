const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const KEY = 'pdam:data';

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const d = { ...(req.body || {}), waktu: new Date().toISOString() };
      await redis.lpush(KEY, JSON.stringify(d));
      await redis.ltrim(KEY, 0, 499); // simpan 500 data terakhir
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const items = await redis.lrange(KEY, 0, 99); // 100 data terbaru
      const data = items
        .map(i => (typeof i === 'string' ? JSON.parse(i) : i))
        .reverse(); // urut dari lama ke baru
      return res.status(200).json(data);
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};