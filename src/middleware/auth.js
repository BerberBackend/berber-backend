const pool = require('../db');

/**
 * Her istekte X-Berber-Id ve X-Session-Token header'larını kontrol eder.
 * Token, veritabanındaki session_token ile eşleşmiyorsa (yani başka bir cihazdan
 * daha sonra giriş yapılmışsa) isteği 401 ile reddeder. Bu, "aynı anda tek oturum"
 * kuralını uygular.
 */
async function auth(req, res, next) {
    try {
        const berberId = req.header('X-Berber-Id');
        const sessionToken = req.header('X-Session-Token');

        if (!berberId || !sessionToken) {
            return res.status(401).json({ hata: 'yetkisiz', mesaj: 'Giriş yapmanız gerekiyor' });
        }

        const result = await pool.query('SELECT session_token FROM berber WHERE id = $1', [berberId]);

        if (result.rows.length === 0) {
            return res.status(401).json({ hata: 'yetkisiz', mesaj: 'Hesap bulunamadı' });
        }

        if (result.rows[0].session_token !== sessionToken) {
            return res.status(401).json({
                hata: 'oturum_gecersiz',
                mesaj: 'Bu hesapla başka bir cihazdan giriş yapıldı. Devam etmek için tekrar giriş yapın.',
            });
        }

        req.berberId = parseInt(berberId, 10);
        next();
    } catch (err) {
        next(err);
    }
}

module.exports = auth;
