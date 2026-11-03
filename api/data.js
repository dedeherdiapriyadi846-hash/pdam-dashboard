const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const K = { data: 'pdam:data', vol: 'pdam:volume', base: 'pdam:pulsa_base', tv: 'pdam:t_vol', tp: 'pdam:t_pul' };
const MAX = 5000; // jumlah data mentah yang disimpan
const parse = i => (typeof i === 'string' ? JSON.parse(i) : i);

module.exports = async (req, res) => {
  try {
    if (req.method === 'POST') {
      const b = req.body || {};
      const d = { ...b, waktu: new Date().toISOString() };
      const dt = Math.min(Math.max(Number(b.dt) || 30, 0), 600);   // detik sejak kirim sebelumnya
      const dv = (Number(b.debit) || 0) * dt / 60;                 // liter

      const p = redis.pipeline();
      p.lpush(K.data, JSON.stringify(d));
      p.incrbyfloat(K.vol, dv);
      const r = await p.exec();
      if (r[0] > MAX + 200) await redis.ltrim(K.data, 0, MAX - 1);
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const n = Math.min(parseInt(req.query.n) || 100, 500);
      const p = redis.pipeline();
      p.lrange(K.data, 0, n - 1);
      p.mget(K.vol, K.base, K.tv, K.tp);
      const [rows, m] = await p.exec();
      return res.status(200).json({
        data: rows.map(parse).reverse(),   // urut lama ke baru
        volume: Number(m[0]) || 0,
        pulsaBase: Number(m[1]) || 0,
        sejakVol: m[2] || null,
        sejakPul: m[3] || null,
      });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
