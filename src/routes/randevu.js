const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const subscriptionCheck = require("../middleware/subscriptionCheck");
const { smsGonder } = require("../services/smsService");

const router = express.Router();

// Hizmet tipleri ve süreleri (dakika) - güvenlik için süre burada sabit tutulur
const HIZMET_SURELERI = { sakal: 15, sac: 30, sac_sakal: 45 };

// Postgres'ten gelen "2026-09-24 09:00:00" biçimindeki ham metni, hiçbir TZ dönüşümü
// yapmadan "2026-09-24T09:00:00" biçimine çevirir (mobil tarafta güvenle Date'e çevrilebilsin diye)
function normalizeTarih(pgDegeri) {
  return pgDegeri ? pgDegeri.replace(" ", "T") : pgDegeri;
}

// Belirli bir gün için dolu saat ARALIKLARINI döndürür (başlangıç + süre).
// Mobil uygulama, seçilen hizmetin süresine göre hangi saatlerin çakıştığını buradan hesaplar.
router.get("/dolu-saatler", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { tarih } = req.query; // 'YYYY-MM-DD' formatında beklenir
    if (!tarih) {
      return res
        .status(400)
        .json({ hata: "tarih query parametresi zorunlu (YYYY-MM-DD)" });
    }

    const result = await pool.query(
      `SELECT tarih_saat, sure_dk FROM randevu
             WHERE berber_id = $1
               AND tarih_saat::date = $2::date
               AND durum != 'iptal'
             ORDER BY tarih_saat`,
      [req.berberId, tarih],
    );

    const doluAraliklar = result.rows.map((r) => ({
      baslangic: r.tarih_saat.slice(11, 16), // 'HH:MM' - TZ dönüşümüne hiç girmeden
      sure_dk: r.sure_dk,
    }));

    res.json(doluAraliklar);
  } catch (err) {
    next(err);
  }
});

// Yeni randevu oluştur -> onay SMS'i otomatik gider
router.post("/", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { musteri_id, tarih_saat, hizmet } = req.body;
    if (!musteri_id || !tarih_saat || !hizmet) {
      return res
        .status(400)
        .json({ hata: "musteri_id, tarih_saat ve hizmet zorunlu" });
    }

    const sureDk = HIZMET_SURELERI[hizmet];
    if (!sureDk) {
      return res
        .status(400)
        .json({ hata: "hizmet sac, sakal veya sac_sakal olmalı" });
    }

    // Süre aralığı çakışma kontrolü: yeni randevunun [başlangıç, bitiş) aralığı
    // mevcut herhangi bir randevunun aralığıyla kesişiyorsa reddet
    const cakisma = await pool.query(
      `SELECT id FROM randevu
             WHERE berber_id = $1
               AND durum != 'iptal'
               AND tarih_saat < $2::timestamp + ($3 || ' minutes')::interval
               AND tarih_saat + (sure_dk || ' minutes')::interval > $2::timestamp`,
      [req.berberId, tarih_saat, sureDk],
    );
    if (cakisma.rows.length > 0) {
      return res
        .status(409)
        .json({
          hata: "Bu saat aralığı başka bir randevuyla çakışıyor, lütfen başka bir saat seçin",
        });
    }

    let randevu;
    try {
      const result = await pool.query(
        `INSERT INTO randevu (berber_id, musteri_id, tarih_saat, hizmet, sure_dk)
                 VALUES ($1, $2, $3, $4, $5)
                 RETURNING id, musteri_id, tarih_saat, durum, hizmet, sure_dk`,
        [req.berberId, musteri_id, tarih_saat, hizmet, sureDk],
      );
      randevu = result.rows[0];
    } catch (err) {
      if (err.code === "23505") {
        return res
          .status(409)
          .json({
            hata: "Bu saat az önce başka bir randevu için alındı, lütfen başka bir saat seçin",
          });
      }
      throw err;
    }

    const musteriRes = await pool.query(
      "SELECT ad FROM musteri WHERE id = $1",
      [musteri_id],
    );
    const musteriAd = musteriRes.rows[0]?.ad || "";
    const saatStr = tarih_saat.slice(11, 16);

    const mesaj = `Sayın ${musteriAd}, randevunuz ${saatStr} için oluşturuldu.`;
    smsGonder(req.berberId, musteri_id, "onay", mesaj).catch((e) =>
      console.error("Onay SMS hatası:", e.message),
    );

    res
      .status(201)
      .json({ ...randevu, tarih_saat: normalizeTarih(randevu.tarih_saat) });
  } catch (err) {
    next(err);
  }
});

// Randevu iptali
router.patch("/:id/iptal", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const result = await pool.query(
      `UPDATE randevu SET durum = 'iptal'
             WHERE id = $1 AND berber_id = $2
             RETURNING id, durum`,
      [req.params.id, req.berberId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ hata: "Randevu bulunamadı" });
    }
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// Belirli bir gün için randevu listesi (takvim ekranı için)
router.get("/", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { tarih } = req.query;
    const params = [req.berberId];
    let query = `
            SELECT r.id, r.tarih_saat, r.durum, r.hizmet, r.sure_dk, m.ad AS musteri_ad, m.telefon AS musteri_telefon
            FROM randevu r
            JOIN musteri m ON m.id = r.musteri_id
            WHERE r.berber_id = $1`;

    if (tarih) {
      query += " AND r.tarih_saat::date = $2::date";
      params.push(tarih);
    }
    query += " ORDER BY r.tarih_saat";

    const result = await pool.query(query, params);
    const randevular = result.rows.map((r) => ({
      ...r,
      tarih_saat: normalizeTarih(r.tarih_saat),
    }));
    res.json(randevular);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
