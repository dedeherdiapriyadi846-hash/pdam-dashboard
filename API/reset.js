const { Redis } = require('@upstash/redis');

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL,
  token: process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN,
});

const K = { data: 'pdam:data', vol: 'pdam:volume', base: 'pdam:pulsa_base', tv: 'pdam:t_vol', tp: 'pdam:t_pul', rs: 'pdam:resets' };
const parse = i => (typeof i === 'string' ? JSON.parse(i) : i);

module.exports = async (req, res) => {
  try {
    // Daftar riwayat reset
    if (req.method === 'GET') {
      const items = await redis.lrange(K.rs, 0, 49);
      return res.status(200).json(items.map(parse));
    }

    if (req.method === 'POST') {
      const b = req.body || {};
      const pin = process.env.RESET_PIN;            // opsional, atur di Vercel > Settings > Environment Variables
      if (pin && b.pin !== pin) return res.status(401).json({ error: 'PIN salah' });

      const target = ['debit', 'pulsa', 'semua'].includes(b.target) ? b.target : 'semua';
      const now = new Date().toISOString();

      const p = redis.pipeline();
      p.mget(K.vol, K.base);
      p.lindex(K.data, 0);
      const [m, lastRaw] = await p.exec();
      const last = lastRaw ? parse(lastRaw) : null;
      const pulsaMentah = last ? Number(last.pulsa) || 0 : 0;
      const volume = Number(m[0]) || 0;
      const pulsa = Math.max(0, pulsaMentah - (Number(m[1]) || 0));

      // Simpan nilai sebelum reset ke riwayat
      const w = redis.pipeline();
      w.lpush(K.rs, JSON.stringify({ waktu: now, target, volume: +volume.toFixed(2), pulsa }));
      w.ltrim(K.rs, 0, 999);
      if (target !== 'pulsa') { w.set(K.vol, 0); w.set(K.tv, now); }
      if (target !== 'debit') { w.set(K.base, pulsaMentah); w.set(K.tp, now); }
      await w.exec();

      return res.status(200).json({ ok: true });
    }

    return res.status(405).json({ error: 'Method not allowed' });
  } catch (e) {
    return res.status(500).json({ error: String(e) });
  }
};
