import cron from "node-cron";
import process from "node:process";
import { Jadwal } from "./lib/Jadwal.js";
import { Login } from "./lib/Login.js";
import { Presensi } from "./lib/Presensi.js";
import axios from "axios";

const TZ = "Asia/Jakarta";
const DAYS_ID = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jum'at", "Sabtu"];

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
  const y = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric" }).format(new Date());
  const m = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, month: "2-digit" }).format(new Date());
  const d = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, day: "2-digit" }).format(new Date());
  return `${y}-${m}-${d}`; // YYYY-MM-DD
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

/** ==== Global state ==== */
const state = {
  login: null,
  jadwal: null,
  presensi: null,

  jadwalToday: [],
  done: false,

  running: false, // mutex anti overlap
  highFreqEnabled: false, // mode 3 menit
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
  } catch (error) {
    console.error("❌ gagal getJadwalToday :", error);
  }
}

/** ==== Domain helpers ==== */
async function getJadwalToday() {
  const data = await state.jadwal.populate(state.login.ST, state.login.token);
  if (!Array.isArray(data)) return [];
  const hari = DAYS_ID[new Date().getDay()];
  return data.filter((j) => j.hari === hari && j.jamMulai && j.jamSelesai);
}

function isNowInRange(j) {
  const now = nowHHMM();
  return now >= j.jamMulai && now <= j.jamSelesai;
}

function currentClass(jadwalHariIni) {
  return jadwalHariIni.find(isNowInRange) || null;
}

async function alreadySubmittedToday(nomor, jenisSchemaMk, keyPresensi) {
  const riwayatPresensi = await withTokenRefresh(state.login, () =>
    state.presensi.getRiwayatPresensi(
      state.login.ST,
      state.login.token,
      nomor,
      jenisSchemaMk,
      state.login.nomorMhs
    )
  );

  const today = new Date().toISOString().split("T")[0];
  const match = riwayatPresensi.find((r) => {
    const [dd, mm, yyyy] = r.tanggal.split(" ")[0].split("-");
    const tanggalRiwayat = `${yyyy}-${mm}-${dd}`;
    return tanggalRiwayat === today && r.key === keyPresensi;
  });
  return match;
}

async function tryAbsenForClass() {
  const notifikasi = await withTokenRefresh(state.login, () =>
    state.presensi.getNotifikasi(state.login.ST, state.login.token)
  );

  const [noMatkul, jenisSchemaMk] = notifikasi[0].dataTerkait.split("-");
  const matkul = state.jadwal.data.find((j) => j.nomor == noMatkul);

  const infoPresensi = await withTokenRefresh(state.login, () =>
    state.presensi.lastKulliah(state.login.ST, state.login.token, noMatkul, jenisSchemaMk)
  );
  if (!infoPresensi?.open) {
    console.log(`[PRESENSI] Belum dibuka: ${matkul.matakuliah.nama}`);
    return { done: false, reason: "not_open" };
  }

  if (await alreadySubmittedToday(noMatkul, jenisSchemaMk, infoPresensi.key)) {
    console.log("[PRESENSI] Sudah melakukan presensi.");
    return { done: true, reason: "already_submitted" };
  }

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
  if (state.running) return console.log("[TICK] Skip (running).");
  state.running = true;
  try {
    const list = state.jadwalToday;
    const cur = currentClass(list);

    if (cur) {
      if (state.done) return console.log("[TICK] Skip (Sudah Absen).");
      console.log(
        `[KELAS] Sedang kuliah: ${cur.matakuliah.nama} (${cur.jamMulai}–${cur.jamSelesai})`
      );
      startHighFreq(); // hidupkan mode 3 menit
    } else {
      stopHighFreq(); // pastikan mati jika tidak ada kelas
      console.log("[TICK] Tidak ada kelas saat ini. Check Absen di luar jam matkul");
      state.done = false;
      await tryAbsenForClass();
    }
  } catch (e) {
    console.error("[ERROR] normalTick:", e);
  } finally {
    state.running = false;
  }
}

async function highFreqTick() {
  if (state.running) return console.log("[HF] Skip (running).");
  state.running = true;
  try {
    console.log("[HF] mode 3 menit berjalan");
    const list = state.jadwalToday;
    const cur = currentClass(list);
    if (!cur) {
      console.log("[HF] Kelas berakhir. Matikan mode 3 menit.");
      state.done = false;
      return stopHighFreq();
    }
    const res = await tryAbsenForClass();
    if (res.done) {
      console.log("[HF] Presensi terpenuhi. Matikan mode 3 menit.");
      state.done = true;
      stopHighFreq();
    }
  } catch (e) {
    console.error("[ERROR] highFreqTick:", e);
  } finally {
    state.running = false;
  }
}

function startHighFreq() {
  if (state.highFreqEnabled) return;
  state.highFreqEnabled = true;
  state.highFreqJob = cron.schedule("*/3 * * * *", () => highFreqTick(), { timezone: TZ });
  console.log("[SCHED] High-frequency ON (*/3 menit).");
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

/** ==== Cron utama: tiap 15 menit pada 08–17 (WIB) ==== */
const normalJob = cron.schedule("*/15 8-17 * * *", () => normalTick(), {
  timezone: TZ,
  scheduled: false,
});

/** ==== Boot & Shutdown ==== */
async function bootstrap() {
  await init();
  await normalTick(); // kick-off sekali saat start
  normalJob.start();
  console.log("[SCHED] Cron 15-menit (08–17) aktif. TZ:", TZ);
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
