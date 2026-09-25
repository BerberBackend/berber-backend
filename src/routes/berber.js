const express = require("express");
const crypto = require("crypto");
const axios = require("axios");
const pool = require("../db");
const auth = require("../middleware/auth");

const router = express.Router();

function sifreHashle(sifre) {
  return crypto.createHash("sha256").update(sifre).digest("hex");
}

function yeniOturumTokeni() {
  return crypto.randomBytes(32).toString("hex");
}

// Yeni berber kaydı (hesap "durduruldu" durumunda başlar, ödeme alınınca admin aktif eder)
router.post("/kayit", async (req, res, next) => {
  try {
    const { ad, telefon, sube_adi, sifre } = req.body;

    if (!ad || !telefon || !sifre) {
      return res.status(400).json({ hata: "ad, telefon ve sifre zorunlu" });
    }

    const kota = parseInt(process.env.DEFAULT_SMS_QUOTA || "500", 10);
    const token = yeniOturumTokeni();

    const result = await pool.query(
      `INSERT INTO berber (ad, telefon, sube_adi, sifre_hash, abonelik_durum, donem_baslangic, donem_bitis, sms_kotasi_toplam, session_token)
             VALUES ($1, $2, $3, $4, 'durduruldu', NOW(), NOW(), $5, $6)
             RETURNING id, ad, telefon, sube_adi, abonelik_durum, donem_bitis, sms_kotasi_toplam`,
      [ad, telefon, sube_adi || null, sifreHashle(sifre), kota, token],
    );

    res.status(201).json({ ...result.rows[0], sessionToken: token });
  } catch (err) {
    if (err.code === "23505") {
      return res
        .status(409)
        .json({ hata: "Bu telefon numarasıyla kayıtlı bir berber zaten var" });
    }
    next(err);
  }
});

// Giriş (yeni token üretir, önceki cihazın oturumunu otomatik geçersiz kılar)
router.post("/giris", async (req, res, next) => {
  try {
    const { telefon, sifre } = req.body;
    const result = await pool.query(
      `SELECT id, ad, telefon, sube_adi, abonelik_durum, donem_bitis, sms_kotasi_toplam, sms_kotasi_kullanilan
             FROM berber WHERE telefon = $1 AND sifre_hash = $2`,
      [telefon, sifreHashle(sifre)],
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ hata: "Telefon veya şifre hatalı" });
    }

    const berber = result.rows[0];
    const token = yeniOturumTokeni();

    await pool.query("UPDATE berber SET session_token = $1 WHERE id = $2", [
      token,
      berber.id,
    ]);

    res.json({ ...berber, sessionToken: token });
  } catch (err) {
    next(err);
  }
});

// Şifre değiştir: mevcut şifre doğrulanır, yeni şifre kaydedilir ve yeni bir oturum token'ı üretilir.
// Böylece bu hesapla açık olan DİĞER cihazların oturumu düşer; isteği atan cihaz yeni token'ı alıp devam eder.
router.put("/sifre-degistir", auth, async (req, res, next) => {
  try {
    const { mevcut_sifre, yeni_sifre } = req.body;

    if (!mevcut_sifre || !yeni_sifre) {
      return res
        .status(400)
        .json({ hata: "mevcut_sifre ve yeni_sifre zorunlu" });
    }
    if (typeof yeni_sifre !== "string" || yeni_sifre.length < 6) {
      return res
        .status(400)
        .json({ hata: "Yeni şifre en az 6 karakter olmalı" });
    }
    if (yeni_sifre === mevcut_sifre) {
      return res
        .status(400)
        .json({ hata: "Yeni şifre mevcut şifreden farklı olmalı" });
    }

    const result = await pool.query(
      "SELECT sifre_hash FROM berber WHERE id = $1",
      [req.berberId],
    );
    const kayitliHash = result.rows[0]?.sifre_hash;
    const girilenHash = sifreHashle(String(mevcut_sifre));

    const eslesiyor =
      kayitliHash &&
      kayitliHash.length === girilenHash.length &&
      crypto.timingSafeEqual(
        Buffer.from(kayitliHash),
        Buffer.from(girilenHash),
      );

    if (!eslesiyor) {
      return res.status(400).json({ hata: "Mevcut şifre hatalı" });
    }

    const yeniToken = yeniOturumTokeni();
    await pool.query(
      "UPDATE berber SET sifre_hash = $1, session_token = $2 WHERE id = $3",
      [sifreHashle(yeni_sifre), yeniToken, req.berberId],
    );

    res.json({ basarili: true, sessionToken: yeniToken });
  } catch (err) {
    next(err);
  }
});

// Çıkış (oturum token'ını temizler)
router.post("/cikis", auth, async (req, res, next) => {
  try {
    await pool.query("UPDATE berber SET session_token = NULL WHERE id = $1", [
      req.berberId,
    ]);
    res.json({ basarili: true });
  } catch (err) {
    next(err);
  }
});

// Kendi abonelik/kota durumunu görüntüle
router.get("/durum", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT abonelik_durum, donem_baslangic, donem_bitis, sms_kotasi_toplam, sms_kotasi_kullanilan, gun_baslangic_saati
 FROM berber WHERE id = $1`,
      [req.berberId],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// NetGSM ayarlarını görüntüle (GÜVENLİK: şifre asla geri döndürülmez, sadece girilip girilmediği bilgisi)
router.get("/sms-ayarlari", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      `SELECT netgsm_usercode, netgsm_msgheader, (netgsm_password IS NOT NULL) AS sifre_girilmis
             FROM berber WHERE id = $1`,
      [req.berberId],
    );
    res.json(result.rows[0]);
  } catch (err) {
    next(err);
  }
});

// NetGSM ayarlarını kaydet/güncelle
// NetGSM ayarlarını kaydet/güncelle -> önce NetGSM'e gerçek istek atıp bilgileri doğrular
router.put("/sms-ayarlari", auth, async (req, res, next) => {
  try {
    const { netgsm_usercode, netgsm_password, netgsm_msgheader } = req.body;

    if (!netgsm_usercode || !netgsm_msgheader) {
      return res
        .status(400)
        .json({ hata: "netgsm_usercode ve netgsm_msgheader zorunlu" });
    }

    // Doğrulamada kullanılacak şifre: yeni girildiyse onu, girilmediyse mevcut kayıtlı şifreyi kullan
    let dogrulamaSifresi = netgsm_password;
    if (!dogrulamaSifresi) {
      const mevcut = await pool.query(
        "SELECT netgsm_password FROM berber WHERE id = $1",
        [req.berberId],
      );
      dogrulamaSifresi = mevcut.rows[0]?.netgsm_password;
    }
    if (!dogrulamaSifresi) {
      return res
        .status(400)
        .json({ hata: "API şifresi zorunlu (daha önce girilmemiş)" });
    }

    // NetGSM'e gerçek bir sorgu atıp kullanıcı kodu/şifreyi doğruluyoruz
    let netgsmYaniti;
    try {
      const yanit = await axios.get(
        "https://api.netgsm.com.tr/balance/list/get",
        {
          params: { usercode: netgsm_usercode, password: dogrulamaSifresi },
        },
      );
      netgsmYaniti = String(yanit.data).trim();
    } catch (err) {
      console.error("NetGSM doğrulama isteği hatası:", err.message);
      return res.status(502).json({
        hata: "NetGSM'e ulaşılamadı, lütfen daha sonra tekrar deneyin",
      });
    }

    // NetGSM hatalı kullanıcı adı/şifre veya yetkisiz erişimde kısa bir hata kodu döner
    // (örn. "30", "40", "50", "51", "70"); başarılı sorguda bakiye/kontör bilgisi döner.
    const hataKoduMu =
      /^(30|40|50|51|70)\b/.test(netgsmYaniti) ||
      netgsmYaniti.toUpperCase().includes("HATA");
    if (hataKoduMu) {
      return res.status(400).json({
        hata: "NetGSM kullanıcı kodu veya şifre hatalı, lütfen bilgilerinizi kontrol edin",
      });
    }

    if (netgsm_password) {
      await pool.query(
        `UPDATE berber SET netgsm_usercode = $1, netgsm_password = $2, netgsm_msgheader = $3 WHERE id = $4`,
        [netgsm_usercode, netgsm_password, netgsm_msgheader, req.berberId],
      );
    } else {
      await pool.query(
        `UPDATE berber SET netgsm_usercode = $1, netgsm_msgheader = $2 WHERE id = $3`,
        [netgsm_usercode, netgsm_msgheader, req.berberId],
      );
    }

    res.json({ basarili: true });
  } catch (err) {
    next(err);
  }
});

// NetGSM'den GERÇEK kalan SMS bakiyesini sorgular
router.get("/sms-bakiye", auth, async (req, res, next) => {
  try {
    const result = await pool.query(
      "SELECT netgsm_usercode, netgsm_password FROM berber WHERE id = $1",
      [req.berberId],
    );
    const { netgsm_usercode, netgsm_password } = result.rows[0] || {};

    if (!netgsm_usercode || !netgsm_password) {
      return res.json({ mevcut: false, mesaj: "NetGSM bilgileri girilmemiş" });
    }

    // NOT: Bu, NetGSM'in bakiye/kredi sorgulama uç noktasıdır. Hesap tipine göre
    // (paket bazlı / kontör bazlı) yanıt formatı değişebilir — ilk denemede beklenmedik
    // bir formatla karşılaşırsak ham yanıtı (raw) loglara bakıp birlikte ayarlarız.
    const response = await axios.get(
      "https://api.netgsm.com.tr/balance/list/get",
      {
        params: { usercode: netgsm_usercode, password: netgsm_password },
      },
    );

    res.json({ mevcut: true, raw: String(response.data).trim() });
  } catch (err) {
    console.error("NetGSM bakiye sorgu hatası:", err.message);
    res.json({ mevcut: false, mesaj: "Bakiye sorgulanamadı" });
  }
});

router.put("/gun-baslangic", auth, async (req, res, next) => {
  try {
    const saat = Number(req.body.saat);
    if (![8, 9].includes(saat)) {
      return res.status(400).json({ hata: "saat 8 veya 9 olmalı" });
    }
    await pool.query(
      "UPDATE berber SET gun_baslangic_saati = $1 WHERE id = $2",
      [saat, req.berberId],
    );
    res.json({ basarili: true });
  } catch (err) {
    next(err);
  }
});

// Şifre değiştir
router.put("/sifre-degistir", auth, async (req, res, next) => {
  try {
    const { mevcut_sifre, yeni_sifre } = req.body;
    if (!mevcut_sifre || !yeni_sifre) {
      return res.status(400).json({ hata: "Mevcut ve yeni şifre zorunlu" });
    }
    if (yeni_sifre.length < 4) {
      return res
        .status(400)
        .json({ hata: "Yeni şifre en az 4 karakter olmalı" });
    }

    const result = await pool.query(
      "SELECT sifre_hash FROM berber WHERE id = $1",
      [req.berberId],
    );
    if (result.rows[0].sifre_hash !== sifreHashle(mevcut_sifre)) {
      return res.status(401).json({ hata: "Mevcut şifre hatalı" });
    }

    await pool.query("UPDATE berber SET sifre_hash = $1 WHERE id = $2", [
      sifreHashle(yeni_sifre),
      req.berberId,
    ]);
    res.json({ basarili: true });
  } catch (err) {
    next(err);
  }
});

module.exports = router;
