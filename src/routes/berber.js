const express = require('express');
const crypto = require('crypto');
const axios = require('axios');
const pool = require('../db');
const auth = require('../middleware/auth');

const router = express.Router();

function sifreHashle(sifre) {
    return crypto.createHash('sha256').update(sifre).digest('hex');
}

function yeniOturumTokeni() {
    return crypto.randomBytes(32).toString('hex');
}

// Yeni berber kaydı (hesap "durduruldu" durumunda başlar, ödeme alınınca admin aktif eder)
router.post('/kayit', async (req, res, next) => {
    try {
        const { ad, telefon, sube_adi, sifre } = req.body;

        if (!ad || !telefon || !sifre) {
            return res.status(400).json({ hata: 'ad, telefon ve sifre zorunlu' });
        }

        const kota = parseInt(process.env.DEFAULT_SMS_QUOTA || '500', 10);
        const token = yeniOturumTokeni();

        const result = await pool.query(
            `INSERT INTO berber (ad, telefon, sube_adi, sifre_hash, abonelik_durum, donem_baslangic, donem_bitis, sms_kotasi_toplam, session_token)
             VALUES ($1, $2, $3, $4, 'durduruldu', NOW(), NOW(), $5, $6)
             RETURNING id, ad, telefon, sube_adi, abonelik_durum, donem_bitis, sms_kotasi_toplam`,
            [ad, telefon, sube_adi || null, sifreHashle(sifre), kota, token]
        );

        res.status(201).json({ ...result.rows[0], sessionToken: token });
    } catch (err) {
        if (err.code === '23505') {
            return res.status(409).json({ hata: 'Bu telefon numarasıyla kayıtlı bir berber zaten var' });
        }
        next(err);
    }
});

// Giriş (yeni token üretir, önceki cihazın oturumunu otomatik geçersiz kılar)
router.post('/giris', async (req, res, next) => {
    try {
        const { telefon, sifre } = req.body;
        const result = await pool.query(
            `SELECT id, ad, telefon, sube_adi, abonelik_durum, donem_bitis, sms_kotasi_toplam, sms_kotasi_kullanilan
             FROM berber WHERE telefon = $1 AND sifre_hash = $2`,
            [telefon, sifreHashle(sifre)]
        );

        if (result.rows.length === 0) {
            return res.status(401).json({ hata: 'Telefon veya şifre hatalı' });
        }

        const berber = result.rows[0];
        const token = yeniOturumTokeni();

        await pool.query('UPDATE berber SET session_token = $1 WHERE id = $2', [token, berber.id]);

        res.json({ ...berber, sessionToken: token });
    } catch (err) {
        next(err);
    }
});

// Çıkış (oturum token'ını temizler)
router.post('/cikis', auth, async (req, res, next) => {
    try {
        await pool.query('UPDATE berber SET session_token = NULL WHERE id = $1', [req.berberId]);
        res.json({ basarili: true });
    } catch (err) {
        next(err);
    }
});

// Kendi abonelik/kota durumunu görüntüle
router.get('/durum', auth, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT abonelik_durum, donem_baslangic, donem_bitis, sms_kotasi_toplam, sms_kotasi_kullanilan
             FROM berber WHERE id = $1`,
            [req.berberId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// NetGSM ayarlarını görüntüle (GÜVENLİK: şifre asla geri döndürülmez, sadece girilip girilmediği bilgisi)
router.get('/sms-ayarlari', auth, async (req, res, next) => {
    try {
        const result = await pool.query(
            `SELECT netgsm_usercode, netgsm_msgheader, (netgsm_password IS NOT NULL) AS sifre_girilmis
             FROM berber WHERE id = $1`,
            [req.berberId]
        );
        res.json(result.rows[0]);
    } catch (err) {
        next(err);
    }
});

// NetGSM ayarlarını kaydet/güncelle
router.put('/sms-ayarlari', auth, async (req, res, next) => {
    try {
        const { netgsm_usercode, netgsm_password, netgsm_msgheader } = req.body;

        if (!netgsm_usercode || !netgsm_msgheader) {
            return res.status(400).json({ hata: 'netgsm_usercode ve netgsm_msgheader zorunlu' });
        }

        if (netgsm_password) {
            await pool.query(
                `UPDATE berber SET netgsm_usercode = $1, netgsm_password = $2, netgsm_msgheader = $3 WHERE id = $4`,
                [netgsm_usercode, netgsm_password, netgsm_msgheader, req.berberId]
            );
        } else {
            await pool.query(
                `UPDATE berber SET netgsm_usercode = $1, netgsm_msgheader = $2 WHERE id = $3`,
                [netgsm_usercode, netgsm_msgheader, req.berberId]
            );
        }

        res.json({ basarili: true });
    } catch (err) {
        next(err);
    }
});

// NetGSM'den GERÇEK kalan SMS bakiyesini sorgular
router.get('/sms-bakiye', auth, async (req, res, next) => {
    try {
        const result = await pool.query(
            'SELECT netgsm_usercode, netgsm_password FROM berber WHERE id = $1',
            [req.berberId]
        );
        const { netgsm_usercode, netgsm_password } = result.rows[0] || {};

        if (!netgsm_usercode || !netgsm_password) {
            return res.json({ mevcut: false, mesaj: 'NetGSM bilgileri girilmemiş' });
        }

        // NOT: Bu, NetGSM'in bakiye/kredi sorgulama uç noktasıdır. Hesap tipine göre
        // (paket bazlı / kontör bazlı) yanıt formatı değişebilir — ilk denemede beklenmedik
        // bir formatla karşılaşırsak ham yanıtı (raw) loglara bakıp birlikte ayarlarız.
        const response = await axios.get('https://api.netgsm.com.tr/balance/list/get', {
            params: { usercode: netgsm_usercode, password: netgsm_password },
        });

        res.json({ mevcut: true, raw: String(response.data).trim() });
    } catch (err) {
        console.error('NetGSM bakiye sorgu hatası:', err.message);
        res.json({ mevcut: false, mesaj: 'Bakiye sorgulanamadı' });
    }
});

module.exports = router;
