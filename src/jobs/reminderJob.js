const cron = require("node-cron");
const pool = require("../db");
const { smsGonder } = require("../services/smsService");

/**
 * Her 5 dakikada bir çalışır: randevusuna 2 saat kalan ve hatırlatması
 * daha önce gönderilmemiş randevuları bulup SMS gönderir.
 */
function hatirlatmaJobBaslat() {
  cron.schedule("*/5 * * * *", async () => {
    try {
      const result = await pool.query(`
                SELECT r.id, r.berber_id, r.musteri_id, r.tarih_saat, m.ad AS musteri_ad
                FROM randevu r
                JOIN musteri m ON m.id = r.musteri_id
                WHERE r.durum = 'planlandi'
                  AND r.hatirlatma_gonderildi = FALSE
                  AND r.tarih_saat <= NOW() + INTERVAL '2 hours'
                  AND r.tarih_saat > NOW()
            `);

      for (const randevu of result.rows) {
        const saatStr = randevu.tarih_saat.slice(11, 16); // 'YYYY-MM-DD HH:MM:SS' -> 'HH:MM'
        const mesaj = `Sayın ${randevu.musteri_ad}, bugün saat ${saatStr} randevunuzu hatırlatırız.`;

        const sonuc = await smsGonder(
          randevu.berber_id,
          randevu.musteri_id,
          "hatirlatma",
          mesaj,
        );

        // Kota dolu olsa bile tekrar tekrar denemesin diye işaretliyoruz
        if (sonuc.basarili || sonuc.sebep === "kota_doldu") {
          await pool.query(
            "UPDATE randevu SET hatirlatma_gonderildi = TRUE WHERE id = $1",
            [randevu.id],
          );
        }
      }
    } catch (err) {
      console.error("Hatırlatma job hatası:", err);
    }
  });

  console.log("⏰ Hatırlatma SMS job başlatıldı (her 5 dakikada bir kontrol).");
}

module.exports = hatirlatmaJobBaslat;
