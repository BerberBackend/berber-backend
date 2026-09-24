const express = require("express");
const pool = require("../db");
const auth = require("../middleware/auth");
const subscriptionCheck = require("../middleware/subscriptionCheck");

const router = express.Router();

// Yeni müşteri kaydı
router.post("/", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { ad, telefon } = req.body;
    if (!ad || !telefon) {
      return res.status(400).json({ hata: "ad ve telefon zorunlu" });
    }

    const result = await pool.query(
      `INSERT INTO musteri (berber_id, ad, telefon) VALUES ($1, $2, $3)
             RETURNING id, ad, telefon, kayit_tarihi`,
      [req.berberId, ad, telefon],
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ hata: "Bu telefon numarasıyla kayıtlı bir müşteri zaten var" });
    }
    next(err);
  }
});

// Berbere ait müşterileri listele (opsiyonel ?arama= ile isme göre ILIKE arama)
router.get("/", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { arama } = req.query;

    let query =
      "SELECT id, ad, telefon, kayit_tarihi FROM musteri WHERE berber_id = $1";
    const params = [req.berberId];

    if (arama && arama.trim()) {
      query += " AND ad ILIKE $2";
      params.push(`%${arama.trim()}%`);
    }

    query += " ORDER BY LOWER(ad) ASC";

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    next(err);
  }
});

// Müşteri bilgilerini güncelle
router.put("/:id", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const { ad, telefon } = req.body;
    if (!ad || !telefon) {
      return res.status(400).json({ hata: "ad ve telefon zorunlu" });
    }

    const result = await pool.query(
      `UPDATE musteri SET ad = $1, telefon = $2
             WHERE id = $3 AND berber_id = $4
             RETURNING id, ad, telefon, kayit_tarihi`,
      [ad, telefon, req.params.id, req.berberId],
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ hata: "Müşteri bulunamadı" });
    }

    res.json(result.rows[0]);
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ hata: "Bu telefon numarasıyla kayıtlı başka bir müşteri var" });
    }
    next(err);
  }
});

// Müşteriyi sil (DİKKAT: şemada ON DELETE CASCADE var, bu müşterinin randevu geçmişi de silinir)
router.delete("/:id", auth, subscriptionCheck, async (req, res, next) => {
  try {
    const result = await pool.query(
      "DELETE FROM musteri WHERE id = $1 AND berber_id = $2 RETURNING id",
      [req.params.id, req.berberId],
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ hata: "Müşteri bulunamadı" });
    }
    res.json({ basarili: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
