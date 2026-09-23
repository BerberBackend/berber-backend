const pool = require('../db');
const { kullanimaAcikMi } = require('../services/subscriptionService');

/**
 * İstek üzerindeki req.berberId'ye bakarak aboneliğin aktif olup olmadığını kontrol eder.
 * Bu middleware'i auth middleware'inden SONRA kullan (req.berberId set edilmiş olmalı).
 */
async function subscriptionCheck(req, res, next) {
    try {
        const result = await pool.query(
            'SELECT abonelik_durum, donem_bitis FROM berber WHERE id = $1',
            [req.berberId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({ hata: 'Berber bulunamadı' });
        }

        const { abonelik_durum, donem_bitis } = result.rows[0];

        if (!kullanimaAcikMi(abonelik_durum)) {
            return res.status(403).json({
                hata: 'abonelik_durduruldu',
                mesaj: 'Aboneliğiniz sona erdi. Devam etmek için ödeme yapmanız gerekiyor.',
            });
        }

        req.abonelikDurum = abonelik_durum;
        req.donemBitis = donem_bitis;
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = subscriptionCheck;
