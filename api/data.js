const { Redis } = require('@upstash/redis');

const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const redis = url && token ? new Redis({ url, token }) : null;
const BELUM_TERSAMBUNG = 'Variabel database (KV_REST_API_URL dan KV_REST_API_TOKEN) belum terbaca. Tambahkan di Vercel > Settings > Environment Variables, lalu Redeploy.';

const K = { data: 'pdam:data', vol: 'pdam:volume', base: 'pdam:pulsa_base', tv: 'pdam:t_vol', tp: 'pdam:t_pul', hr: 'pdam:harian' };
const MAX = 5000; // jumlah data mentah yang disimpan
const parse = i => (typeof i === 'string' ? JSON.parse(i) : i);

module.exports = async (req, res) => {
  try {
    if (!redis) return res.status(500).json({ error: BELUM_TERSAMBUNG });
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

      // Rekap harian (WIB) untuk laporan dan kesehatan baterai
      const tgl = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
      const teg = Number(b.tegangan);
      const cur = await redis.hget(K.hr, tgl);
      const h = cur ? parse(cur) : { v: 0, n: 0, s: 0, mn: null, mx: null };
      h.v += dv;
      if (Number.isFinite(teg)) {
        h.n += 1; h.s += teg;
        h.mn = h.mn == null ? teg : Math.min(h.mn, teg);
        h.mx = h.mx == null ? teg : Math.max(h.mx, teg);
      }
      await redis.hset(K.hr, { [tgl]: JSON.stringify(h) });
      return res.status(200).json({ ok: true });
    }

    if (req.method === 'GET') {
      const n = Math.min(parseInt(req.query.n) || 100, 5000);
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
