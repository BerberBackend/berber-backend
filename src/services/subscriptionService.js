const pool = require("../db");

/**
 * Dönemi dolan tüm berberleri kontrol eder:
 * - Ödeme alınmışsa -> dönemi 1 ay ileri kaydırır, SMS kotasını sıfırlar, durumu "aktif" yapar
 * - Ödeme alınmamışsa -> durumu "durduruldu" yapar
 *
 * Bu fonksiyon her gün cron job ile çağrılmalı.
 */
async function donemleriKontrolEt() {
  const suresiDolanlar = await pool.query(
    `SELECT id, odeme_bu_donem_alindi, abonelik_durum
         FROM berber
         WHERE donem_bitis <= NOW() AND abonelik_durum != 'durduruldu'`,
  );

  for (const berber of suresiDolanlar.rows) {
    if (berber.odeme_bu_donem_alindi) {
      await pool.query(
        `UPDATE berber
                 SET donem_baslangic = donem_bitis,
                     donem_bitis = donem_bitis + INTERVAL '1 month',
                     odeme_bu_donem_alindi = FALSE,
                     sms_kotasi_kullanilan = 0,
                     abonelik_durum = 'aktif'
                 WHERE id = $1`,
        [berber.id],
      );
      console.log(`Berber #${berber.id} dönemi yenilendi.`);
    } else {
      await pool.query(
        `UPDATE berber SET abonelik_durum = 'durduruldu' WHERE id = $1`,
        [berber.id],
      );
      console.log(`Berber #${berber.id} ödeme alınmadığı için durduruldu.`);
    }
  }
} // <- Eksik olan kapanış süslü parantezi eklendi

/**
 * Bir berberin aktif olarak uygulamayı kullanıp kullanamayacağını döner.
 * Middleware'de her istekte çağrılır.
 */
function kullanimaAcikMi(abonelikDurum) {
  return abonelikDurum === "aktif";
}

module.exports = { donemleriKontrolEt, kullanimaAcikMi };
