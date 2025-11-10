import cron from "node-cron";
import process from "node:process";
import { Jadwal } from "./lib/Jadwal.js";
import { Login } from "./lib/Login.js";
import { Presensi } from "./lib/Presensi.js";
import axios from "axios";

const TZ = "Asia/Jakarta";
const DAYS_ID = [
  "Minggu",
  "Senin",
  "Selasa",
  "Rabu",
  "Kamis",
  "Jum'at",
  "Sabtu",
];

axios.interceptors.request.use((config) => {
  console.log(`[AXIOS] ${config.method?.toUpperCase()} ${config.url}`);
  return config;
});

/** ==== Utils ==== */
function nowHHMM() {
  const fmt = new Intl.DateTimeFormat("id-ID", {
    timeZone: TZ,
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date());
  return fmt.replace(".", ":"); // "HH:MM"
}

function todayId() {
  const y = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    year: "numeric",
  }).format(new Date());
  const m = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    month: "2-digit",
  }).format(new Date());
  const d = new Intl.DateTimeFormat("en-CA", {
    timeZone: TZ,
    day: "2-digit",
  }).format(new Date());
  return `${y}-${m}-${d}`; // YYYY-MM-DD
}

function randomDelay(min, max) {
  const randomMinutes = Math.random() * (max - min) + min;
  const delayMs = randomMinutes * 60 * 1000;
  const delaySeconds = (delayMs / 1000).toFixed(1);
  console.log(
    `[RANDOM_DELAY] tunggu ${randomMinutes.toFixed(2)} menit (${delaySeconds}s)`
  );

  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

async function withTokenRefresh(login, apiCall) {
  try {
    return await apiCall();
  } catch (error) {
    const expired =
      error?.response?.data?.pesan?.includes("Token tidak valid") ||
      error?.response?.status === false;
    if (expired) {
      console.log("[AUTH] Token expired, refreshing...");
      await login.getAuth();
      return await apiCall();
    }
    throw error;
  }
}

// Wrapper untuk timeout API calls
async function withTimeout(promise, timeoutMs = 30000, operation = "API call") {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(new Error(`Timeout: ${operation} exceeded ${timeoutMs}ms`)),
        timeoutMs
      )
    ),
  ]);
}

/** ==== Global state ==== */
const state = {
  login: null,
  jadwal: null,
  presensi: null,

  jadwalToday: [],
  today_id: "",
  done: false,
  lastClassNomor: null, // track kelas terakhir yang di-presensi

  running: false, // mutex anti overlap
  runningStartTime: 0, // timestamp kapan running dimulai
  highFreqEnabled: false, // mode 5 menit
  highFreqJob: null,
};

/** ==== Start up ==== */
async function init() {
  state.login = new Login();
  let ok = await state.login.getAuth();
  if (!ok) {
    console.log("[AUTH] Login ulang...");
    ok = await state.login.getAuth();
  }
  state.jadwal = new Jadwal();
  state.presensi = new Presensi();

  try {
    state.jadwalToday = await getJadwalToday();
    state.today_id = todayId();
  } catch (error) {
    console.error("❌ gagal getJadwalToday :", error);
  }
}

/** ==== Domain helpers ==== */
async function getJadwalToday() {
  console.log("[DEBUG] Mengambil jadwal hari ini...");
  const data = await state.jadwal.populate(state.login.ST, state.login.token);
  if (!Array.isArray(data)) {
    console.log("[DEBUG] Data jadwal bukan array");
    return [];
  }
  const hari = DAYS_ID[new Date().getDay()];
  const filtered = data.filter(
    (j) => j.hari === hari && j.jamMulai && j.jamSelesai
  );
  console.log(
    `[DEBUG] Hari: ${hari}, Total jadwal hari ini: ${filtered.length}`
  );
  filtered.forEach((j, idx) => {
    console.log(
      `[DEBUG]   ${idx + 1}. ${j.matakuliah.nama} (${j.jamMulai}–${
        j.jamSelesai
      }) | Nomor: ${j.nomor}`
    );
  });
  return filtered;
}

function isNowInRange(j) {
  const now = nowHHMM();
  return now >= j.jamMulai && now <= j.jamSelesai;
}

function currentClass(jadwalHariIni) {
  const now = nowHHMM();
  console.log(`[DEBUG] Waktu sekarang: ${now}`);
  const cur = jadwalHariIni.find(isNowInRange);
  if (cur) {
    console.log(
      `[DEBUG] Kelas aktif: ${cur.matakuliah.nama} (${cur.jamMulai}–${cur.jamSelesai}) | Nomor: ${cur.nomor}`
    );
  } else {
    console.log(`[DEBUG] Tidak ada kelas yang sedang berjalan`);
  }
  return cur || null;
}

async function alreadySubmittedToday(nomor, jenisSchemaMk, keyPresensi) {
  console.log(
    `[DEBUG] Cek riwayat presensi untuk nomor: ${nomor}, key: ${keyPresensi}`
  );

  try {
    const riwayatPresensi = await withTimeout(
      withTokenRefresh(state.login, () =>
        state.presensi.getRiwayatPresensi(
          state.login.ST,
          state.login.token,
          nomor,
          jenisSchemaMk,
          state.login.nomorMhs
        )
      ),
      15000,
      "getRiwayatPresensi"
    );

    const today = new Date().toISOString().split("T")[0];
    console.log(`[DEBUG] Tanggal hari ini: ${today}`);
    const match = riwayatPresensi.find((r) => {
      const [dd, mm, yyyy] = r.tanggal.split(" ")[0].split("-");
      const tanggalRiwayat = `${yyyy}-${mm}-${dd}`;
      return tanggalRiwayat === today && r.key === keyPresensi;
    });
    console.log(`[DEBUG] Sudah presensi hari ini? ${match ? "YA" : "TIDAK"}`);
    return match;
  } catch (error) {
    console.error("[ERROR] alreadySubmittedToday:", error.message);
    // Jika error saat cek riwayat, asumsikan belum presensi (fail-safe)
    return null;
  }
}

async function tryAbsenForClass(kelasSekarang = null) {
  console.log(`[DEBUG] === tryAbsenForClass dipanggil ===`);
  console.log(
    `[DEBUG] Kelas sekarang: ${
      kelasSekarang
        ? kelasSekarang.matakuliah.nama +
          " (nomor: " +
          kelasSekarang.nomor +
          ")"
        : "TIDAK ADA"
    }`
  );

  const notifikasi = await withTimeout(
    withTokenRefresh(state.login, () =>
      state.presensi.getNotifikasi(state.login.ST, state.login.token)
    ),
    15000,
    "getNotifikasi"
  );

  // Jika tidak ada notifikasi presensi
  if (!notifikasi || notifikasi.length === 0) {
    console.log("[PRESENSI] Tidak ada notifikasi presensi.");
    return { done: false, reason: "no_notification" };
  }

  console.log(`[DEBUG] Total notifikasi: ${notifikasi.length}`);
  notifikasi.forEach((n, idx) => {
    const [noMatkul, schema] = n.dataTerkait.split("-");
    console.log(
      `[DEBUG]   ${idx + 1}. Notifikasi nomor: ${noMatkul}, schema: ${schema}`
    );
  });

  // Jika ada kelas yang sedang berjalan, validasi bahwa notifikasi untuk kelas tersebut
  let targetNotif = notifikasi[0];
  if (kelasSekarang) {
    console.log(
      `[DEBUG] Mencari notifikasi untuk kelas nomor: ${kelasSekarang.nomor}`
    );
    targetNotif = notifikasi.find((n) => {
      const [noMatkul] = n.dataTerkait.split("-");
      return noMatkul == kelasSekarang.nomor;
    });

    if (!targetNotif) {
      console.log(
        `[PRESENSI] Tidak ada notifikasi untuk kelas saat ini: ${kelasSekarang.matakuliah.nama}`
      );
      return { done: false, reason: "no_notification_for_current_class" };
    }
    console.log(
      `[DEBUG] Target notifikasi ditemukan untuk kelas: ${kelasSekarang.matakuliah.nama}`
    );
  } else {
    console.log(`[DEBUG] Tidak ada kelas aktif, gunakan notifikasi pertama`);
  }

  const [noMatkul, jenisSchemaMk] = targetNotif.dataTerkait.split("-");
  console.log(
    `[DEBUG] Target notifikasi: nomor=${noMatkul}, schema=${jenisSchemaMk}`
  );

  const matkul = state.jadwal.data.find((j) => j.nomor == noMatkul);

  if (!matkul) {
    console.log(
      `[PRESENSI] Matkul dengan nomor ${noMatkul} tidak ditemukan di jadwal.`
    );
    return { done: false, reason: "matkul_not_found" };
  }

  console.log(
    `[PRESENSI] Mencoba presensi untuk: ${matkul.matakuliah.nama} (nomor: ${noMatkul})`
  );

  const infoPresensi = await withTimeout(
    withTokenRefresh(state.login, () =>
      state.presensi.lastKulliah(
        state.login.ST,
        state.login.token,
        noMatkul,
        jenisSchemaMk
      )
    ),
    15000,
    "lastKulliah"
  );

  console.log(
    `[DEBUG] Info presensi - open: ${infoPresensi?.open}, key: ${infoPresensi?.key}`
  );

  if (await alreadySubmittedToday(noMatkul, jenisSchemaMk, infoPresensi.key)) {
    console.log("[PRESENSI] Sudah melakukan presensi.");
    return { done: true, reason: "already_submitted" };
  }

  if (!infoPresensi?.open) {
    console.log(`[PRESENSI] Belum dibuka: ${matkul.matakuliah.nama}`);
    return { done: false, reason: "not_open" };
  }

  console.log(`[DEBUG] Presensi terbuka! Akan submit presensi...`);

  const push = await withTokenRefresh(state.login, () =>
    state.presensi.sumbitPresensi(
      state.login.ST,
      state.login.token,
      noMatkul,
      state.login.nomorMhs,
      jenisSchemaMk,
      matkul.kuliah_asal,
      infoPresensi.key
    )
  );

  if (push?.sukses) {
    console.log("[PRESENSI] Berhasil:", push);
    return { done: true, reason: "submitted" };
  } else {
    console.log("[PRESENSI] Gagal submit:", push);
    return { done: false, reason: "submit_failed" };
  }
}

/** ==== Schedulers ==== */
async function normalTick() {
  const tickStartTime = Date.now();
  console.log("\n[TICK] ========== normalTick() dijalankan ==========");
  console.log(
    `[TICK] State - done: ${state.done}, highFreq: ${state.highFreqEnabled}, running: ${state.running}`
  );

  if (state.running) {
    console.log(
      "[TICK] Skip (running). Sudah berjalan sejak:",
      tickStartTime - state.runningStartTime,
      "ms"
    );
    // Safety: Reset running jika stuck lebih dari 5 menit
    if (Date.now() - state.runningStartTime > 5 * 60 * 1000) {
      console.warn("[TICK] ⚠️ State running stuck > 5 menit! Force reset.");
      state.running = false;
    }
    return;
  }

  state.running = true;
  state.runningStartTime = Date.now();

  try {
    const currentDate = todayId();
    console.log(
      `[DEBUG] Tanggal sekarang: ${currentDate}, state.today_id: ${state.today_id}`
    );

    if (state.today_id != currentDate) {
      console.log("[DEBUG] Hari baru terdeteksi! Refresh jadwal...");
      state.jadwalToday = await getJadwalToday();
      state.today_id = currentDate;
      state.done = false; // Reset status done untuk hari baru
      state.lastClassNomor = null; // Reset kelas terakhir
    }
    const list = state.jadwalToday;
    console.log(`[DEBUG] Total jadwal hari ini: ${list.length}`);
    const cur = currentClass(list);

    if (cur) {
      // Ada kelas yang sedang berjalan

      // Reset status done jika ini kelas berbeda dari yang terakhir di-presensi
      if (state.lastClassNomor && state.lastClassNomor !== cur.nomor) {
        console.log(
          `[TICK] Kelas berganti dari ${state.lastClassNomor} ke ${cur.nomor}. Reset status done.`
        );
        state.done = false;
      }

      if (state.done) {
        console.log("[TICK] Skip (Sudah Absen untuk kelas ini).");
        state.running = false;
        return;
      }
      console.log(
        `[KELAS] Sedang kuliah: ${cur.matakuliah.nama} (${cur.jamMulai}–${cur.jamSelesai})`
      );
      startHighFreq(); // hidupkan mode 5 menit
    } else {
      // Tidak ada kelas yang sedang berjalan
      stopHighFreq(); // pastikan mati jika tidak ada kelas
      console.log("[TICK] Tidak ada kelas saat ini.");

      // Check notifikasi presensi yang terbuka di luar jam jadwal
      console.log("[TICK] Check notifikasi presensi di luar jam...");
      try {
        const res = await tryAbsenForClass(null); // null = tidak ada kelas aktif, cek semua notifikasi
        if (res.done) {
          console.log("[TICK] Berhasil presensi di luar jam jadwal.");
          state.done = true;
        } else {
          console.log(
            `[TICK] Tidak ada presensi yang perlu dilakukan (${res.reason}).`
          );
        }
      } catch (err) {
        console.error("[ERROR] tryAbsenForClass di luar jam:", err);
      }
    }
  } catch (e) {
    console.error("[ERROR] normalTick:", e);
    console.error("[ERROR] Stack trace:", e.stack);
  } finally {
    state.running = false;
    const duration = Date.now() - tickStartTime;
    console.log(`[TICK] Selesai dalam ${duration}ms`);
  }
}

async function highFreqTick() {
  const tickStartTime = Date.now();
  console.log("\n[HF] ========== highFreqTick() dijalankan ==========");
  console.log(
    `[HF] State - done: ${state.done}, highFreq: ${state.highFreqEnabled}, running: ${state.running}`
  );

  if (state.running) {
    console.log(
      "[HF] Skip (running). Sudah berjalan sejak:",
      tickStartTime - state.runningStartTime,
      "ms"
    );
    // Safety: Reset running jika stuck lebih dari 5 menit
    if (Date.now() - state.runningStartTime > 5 * 60 * 1000) {
      console.warn("[HF] ⚠️ State running stuck > 5 menit! Force reset.");
      state.running = false;
    }
    return;
  }

  state.running = true;
  state.runningStartTime = Date.now();

  try {
    console.log("[HF] mode 5 menit berjalan");
    const list = state.jadwalToday;
    console.log(`[DEBUG] Total jadwal di highFreq: ${list.length}`);
    const cur = currentClass(list);
    if (!cur) {
      console.log("[HF] Kelas berakhir. Matikan mode 5 menit.");
      state.done = false;
      stopHighFreq();
      return;
    }
    // Delay singkat untuk randomisasi (10-60 detik)
    await randomDelay(0.15, 1); // 0.15-1 menit = 9-60 detik
    // Pass kelas sekarang ke tryAbsenForClass agar hanya presensi untuk kelas ini
    console.log(
      `[DEBUG] Memanggil tryAbsenForClass dengan kelas: ${cur.matakuliah.nama}`
    );
    const res = await tryAbsenForClass(cur);
    console.log(
      `[DEBUG] Hasil tryAbsenForClass - done: ${res.done}, reason: ${res.reason}`
    );
    if (res.done) {
      console.log("[HF] Presensi terpenuhi. Matikan mode 5 menit.");
      state.done = true;
      state.lastClassNomor = cur.nomor; // Simpan nomor kelas yang sudah di-presensi
      stopHighFreq();
    } else {
      console.log(
        `[HF] Presensi belum berhasil (${res.reason}). Coba lagi nanti.`
      );
    }
  } catch (e) {
    console.error("[ERROR] highFreqTick:", e);
    console.error("[ERROR] Stack trace:", e.stack);
  } finally {
    state.running = false;
    const duration = Date.now() - tickStartTime;
    console.log(`[HF] Selesai dalam ${duration}ms`);
  }
}

function startHighFreq() {
  if (state.highFreqEnabled) return;
  state.highFreqEnabled = true;
  state.highFreqJob = cron.schedule("*/5 * * * *", () => highFreqTick(), {
    timezone: TZ,
  });
  console.log("[SCHED] High-frequency ON (*/5 menit).");
}

function stopHighFreq() {
  if (!state.highFreqEnabled) return;
  try {
    state.highFreqJob?.stop();
    state.highFreqJob?.destroy?.();
  } catch {}
  state.highFreqJob = null;
  state.highFreqEnabled = false;
  console.log("[SCHED] High-frequency OFF.");
}

/** ==== Cron utama: tiap 15 menit pada 07–17 (WIB) ==== */
const normalJob = cron.schedule("*/15 7-17 * * 1-5", () => normalTick(), {
  timezone: TZ,
  scheduled: false,
});

/** ==== Boot & Shutdown ==== */
async function bootstrap() {
  console.log("\n[APP] ========== BOOTSTRAP START ==========");
  console.log(`[APP] Timezone: ${TZ}`);
  console.log(`[APP] Waktu sekarang: ${nowHHMM()}`);
  console.log(`[APP] Tanggal: ${todayId()}`);
  console.log(`[APP] Hari: ${DAYS_ID[new Date().getDay()]}`);

  await init();
  console.log("[APP] Init selesai. Login berhasil.");
  console.log(`[APP] Total jadwal tersimpan: ${state.jadwal.data.length}`);

  await normalTick(); // kick-off sekali saat start
  normalJob.start();
  console.log("[SCHED] Cron 15-menit (07–17) aktif. TZ:", TZ);
  console.log("[APP] ========== BOOTSTRAP COMPLETE ==========\n");
}

function shutdown() {
  console.log("\n[APP] Shutting down...");
  try {
    normalJob.stop();
  } catch {}
  stopHighFreq();
  process.exit(0);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

bootstrap().catch((err) => {
  console.error("[FATAL] Bootstrap:", err);
  process.exit(1);
});
