const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const subscriptionCheck = require('../middleware/subscriptionCheck');
const { smsGonder } = require('../services/smsService');

const router = express.Router();

// Belirli bir gün için dolu saatleri döndür (mobil uygulama bunlarla saatleri disable eder)
router.get('/dolu-saatler', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const { tarih } = req.query; // 'YYYY-MM-DD' formatında beklenir
        if (!tarih) {
            return res.status(400).json({ hata: 'tarih query parametresi zorunlu (YYYY-MM-DD)' });
        }

        const result = await pool.query(
            `SELECT tarih_saat FROM randevu
             WHERE berber_id = $1
               AND tarih_saat::date = $2::date
               AND durum != 'iptal'
             ORDER BY tarih_saat`,
            [req.berberId, tarih]
        );

        res.json(result.rows.map((r) => r.tarih_saat));
    } catch (err) {
        next(err);
    }
});

// Yeni randevu oluştur -> onay SMS'i otomatik gider
router.post('/', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const { musteri_id, tarih_saat } = req.body;
        if (!musteri_id || !tarih_saat) {
            return res.status(400).json({ hata: 'musteri_id ve tarih_saat zorunlu' });
        }

        let randevu;
        try {
            const result = await pool.query(
                `INSERT INTO randevu (berber_id, musteri_id, tarih_saat)
                 VALUES ($1, $2, $3)
                 RETURNING id, musteri_id, tarih_saat, durum`,
                [req.berberId, musteri_id, tarih_saat]
            );
            randevu = result.rows[0];
        } catch (err) {
            // UNIQUE (berber_id, tarih_saat) ihlali -> bu saat başka biri tarafından az önce alınmış
            if (err.code === '23505') {
                return res.status(409).json({ hata: 'Bu saat az önce başka bir randevu için alındı, lütfen başka bir saat seçin' });
            }
            throw err;
        }

        const musteriRes = await pool.query('SELECT ad FROM musteri WHERE id = $1', [musteri_id]);
        const musteriAd = musteriRes.rows[0]?.ad || '';
        const saatStr = new Date(tarih_saat).toLocaleString('tr-TR', {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit',
        });

        const mesaj = `Sayın ${musteriAd}, randevunuz ${saatStr} için oluşturuldu.`;
        smsGonder(req.berberId, musteri_id, 'onay', mesaj).catch((e) =>
            console.error('Onay SMS hatası:', e.message)
        );

        res.status(201).json(randevu);
    } catch (err) {
        next(err);
    }
});

// Randevu iptali
router.patch('/:id/iptal', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const result = await pool.query(
            `UPDATE randevu SET durum = 'iptal'
             WHERE id = $1 AND berber_id = $2
             RETURNING id, durum`,
            [req.params.id, req.berberId]
        );
        if (result.rows.length === 0) {
            return res.status(404).json({ hata: 'Randevu bulunamadı' });
        }
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// Belirli bir gün için randevu listesi (takvim ekranı için)
router.get('/', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const { tarih } = req.query;
        const params = [req.berberId];
        let query = `
            SELECT r.id, r.tarih_saat, r.durum, m.ad AS musteri_ad, m.telefon AS musteri_telefon
            FROM randevu r
            JOIN musteri m ON m.id = r.musteri_id
            WHERE r.berber_id = $1`;

        if (tarih) {
            query += ' AND r.tarih_saat::date = $2::date';
            params.push(tarih);
        }
        query += ' ORDER BY r.tarih_saat';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
