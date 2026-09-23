const cron = require('node-cron');
const { donemleriKontrolEt } = require('../services/subscriptionService');

/**
 * Her gün gece yarısı çalışır: süresi dolan abonelikleri kontrol eder,
 * ödeme alınmışsa yeniler, alınmamışsa durdurur.
 */
function abonelikJobBaslat() {
    cron.schedule('0 0 * * *', async () => {
        console.log('Günlük abonelik/dönem kontrolü başlıyor...');
        try {
            await donemleriKontrolEt();
        } catch (err) {
            console.error('Abonelik job hatası:', err);
        }
    });

    console.log('📅 Abonelik kontrol job başlatıldı (her gün 00:00).');
}

module.exports = abonelikJobBaslat;
