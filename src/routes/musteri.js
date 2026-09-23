const express = require('express');
const pool = require('../db');
const auth = require('../middleware/auth');
const subscriptionCheck = require('../middleware/subscriptionCheck');
const { smsGonder } = require('../services/smsService');

const router = express.Router();

// Yeni müşteri kaydı -> hoşgeldin SMS'i otomatik gider
router.post('/', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const { ad, telefon } = req.body;
        if (!ad || !telefon) {
            return res.status(400).json({ hata: 'ad ve telefon zorunlu' });
        }

        const result = await pool.query(
            `INSERT INTO musteri (berber_id, ad, telefon) VALUES ($1, $2, $3)
             RETURNING id, ad, telefon, kayit_tarihi`,
            [req.berberId, ad, telefon]
        );

        const musteri = result.rows[0];

        const mesaj = `Merhaba ${ad}, kaydınız oluşturuldu! Randevu almak için bizi arayabilirsiniz.`;
        smsGonder(req.berberId, musteri.id, 'hosgeldin', mesaj).catch((e) =>
            console.error('Hoşgeldin SMS hatası:', e.message)
        );

        res.status(201).json(musteri);
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ hata: 'Bu telefon numarasıyla kayıtlı bir müşteri zaten var' });
        }
        next(err);
    }
});

// Berbere ait müşterileri listele (opsiyonel ?arama= ile isme göre ILIKE arama)
router.get('/', auth, subscriptionCheck, async (req, res, next) => {
    try {
        const { arama } = req.query;

        let query = 'SELECT id, ad, telefon, kayit_tarihi FROM musteri WHERE berber_id = $1';
        const params = [req.berberId];

        if (arama && arama.trim()) {
            query += ' AND ad ILIKE $2';
            params.push(`%${arama.trim()}%`);
        }

        query += ' ORDER BY kayit_tarihi DESC';

        const result = await pool.query(query, params);
        res.json(result.rows);
    } catch (err) {
        next(err);
    }
});

module.exports = router;
