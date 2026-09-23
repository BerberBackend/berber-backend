const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const subscriptionCheck = require("../middleware/subscriptionCheck");
const { smsGonder } = require("../services/smsService");

const router = express.Router();

// Hizmet tipleri ve süreleri (dakika) - güvenlik için süre burada sabit tutulur, mobilden gelen değer güvenilmez
const HIZMET_SURELERI = { sakal: 15, sac: 30, sac_sakal: 45 };

// Belirli bir gün için dolu saatleri döndür (mobil uygulama bunlarla saatleri disable eder)
router.get("/dolu-saatler", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { tarih } = req.query; // 'YYYY-MM-DD' formatında beklenir
    if (!tarih) {
      return res
        .status(400)
        .json({ hata: "tarih query parametresi zorunlu (YYYY-MM-DD)" });
    }

    const result = await pool.query(
      `SELECT tarih_saat FROM randevu
             WHERE berber_id = $1
               AND tarih_saat::date = $2::date
               AND durum != 'iptal'
             ORDER BY tarih_saat`,
      [req.berberId, tarih],
    );

    res.json(result.rows.map((r) => r.tarih_saat));
  } catch (err) {
    next(err);
  }
});

// Bu gün için önerilecek bir sonraki boş saati hesaplar
// (son randevunun bitiş saati, hiç randevu yoksa berberin günlük başlangıç saati)
router.get("/sonraki-saat", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { tarih } = req.query;
    if (!tarih) {
      return res
        .status(400)
        .json({ hata: "tarih query parametresi zorunlu (YYYY-MM-DD)" });
    }

    const berberRes = await pool.query(
      "SELECT gun_baslangic_saati FROM berber WHERE id = $1",
      [req.berberId],
    );
    const baslangicSaati = berberRes.rows[0]?.gun_baslangic_saati || 9;

    const sonRandevu = await pool.query(
      `SELECT tarih_saat, sure_dk FROM randevu
             WHERE berber_id = $1 AND tarih_saat::date = $2::date AND durum != 'iptal'
             ORDER BY tarih_saat DESC LIMIT 1`,
      [req.berberId, tarih],
    );

    let sonrakiSaat;
    if (sonRandevu.rows.length === 0) {
      sonrakiSaat = `${tarih}T${String(baslangicSaati).padStart(2, "0")}:00:00`;
    } else {
      const { tarih_saat, sure_dk } = sonRandevu.rows[0];
      sonrakiSaat = new Date(
        new Date(tarih_saat).getTime() + sure_dk * 60000,
      ).toISOString();
    }

    res.json({ sonraki_saat: sonrakiSaat });
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
      // UNIQUE (berber_id, tarih_saat) ihlali -> bu saat başka biri tarafından az önce alınmış
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
    const saatStr = new Date(tarih_saat).toLocaleString("tr-TR", {
      day: "2-digit",
      month: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

    const mesaj = `Sayın ${musteriAd}, randevunuz ${saatStr} için oluşturuldu.`;
    smsGonder(req.berberId, musteri_id, "onay", mesaj).catch((e) =>
      console.error("Onay SMS hatası:", e.message),
    );

    res.status(201).json(randevu);
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
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

module.exports = router;
