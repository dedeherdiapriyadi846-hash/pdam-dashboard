const express = require('express');
const app = express();
app.use(express.json());
app.use(express.static('public'));

let data = [];

// ESP32 kirim data ke sini
app.post('/api/data', (req, res) => {
  const d = { ...req.body, waktu: new Date().toISOString() };
  data.push(d);
  if (data.length > 500) data.shift(); // simpan 500 data terakhir
  console.log(d);
  res.json({ ok: true });
});

// Dashboard ambil data dari sini
app.get('/api/data', (req, res) => res.json(data));

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => console.log('Server jalan di port ' + PORT));