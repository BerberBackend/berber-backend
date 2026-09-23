require('dotenv').config();
const express = require('express');
const cors = require('cors');

const berberRoutes = require('./routes/berber');
const musteriRoutes = require('./routes/musteri');
const randevuRoutes = require('./routes/randevu');

const hatirlatmaJobBaslat = require('./jobs/reminderJob');
const abonelikJobBaslat = require('./jobs/subscriptionJob');

const app = express();
app.use(cors());
app.use(express.json());

app.use('/api/berber', berberRoutes);
app.use('/api/musteri', musteriRoutes);
app.use('/api/randevu', randevuRoutes);

app.get('/api/saglik', (req, res) => res.json({ durum: 'ayakta' }));

// Genel hata yakalayıcı
app.use((err, req, res, next) => {
    console.error(err);
    res.status(500).json({ hata: 'Sunucu hatası', detay: err.message });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`🚀 Sunucu ${PORT} portunda çalışıyor`);
    hatirlatmaJobBaslat();
    abonelikJobBaslat();
});
