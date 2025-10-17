import axios from "axios";

import { URL_ETHOL } from "../utils/url.js";

class Presensi {
  constructor() {
    this.key = null;
    this.kuliah = null;
    this.jenisSchema = null;
    this.hakAktif = "mahasiswa";
  }

  lastKulliah = async (ST, Token, nomor_kuliah, jenisSchema) => {
    const res = await axios.get(`${URL_ETHOL}/api/presensi/terakhir-kuliah`, {
      params: {
        kuliah: nomor_kuliah,
        jenis_schema: jenisSchema,
      },
      headers: {
        Cookie: `PHPSESSID=${ST}; token=${Token}; hakAktif=${this.hakAktif}`,
        "Sec-Ch-Ua-Platform": '"Linux"',
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Dnt: 1,
        "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        "Sec-Ch-Ua-Mobile": "?0",
        Token: Token,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    // console.log(res.data);
    this.key = res.data.key;
    this.kuliah = res.data.kuliah;
    this.jenisSchema = res.data.jenisSchema;
    return res.data;
  };

  sumbitPresensi = async (ST, Token, nomor_kuliah, nomor_mhs, jenis_schema, kuliah_asal, key) => {
    if (!this.key || !this.kuliah || !this.jenisSchema) {
      throw new Error("Data presensi belum diinisialisasi. Panggil lastKulliah terlebih dahulu.");
    }
    const payload = {
      kuliah: nomor_kuliah,
      mahasiswa: nomor_mhs,
      jenis_schema: jenis_schema,
      kuliah_asal: kuliah_asal,
      key: key,
    };
    const res = await axios.post(`${URL_ETHOL}/api/presensi/mahasiswa`, payload, {
      headers: {
        Cookie: `PHPSESSID=${ST}; token=${Token}; hakAktif=${this.hakAktif}`,
        "Sec-Ch-Ua-Platform": '"Linux"',
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Dnt: 1,
        "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        "Sec-Ch-Ua-Mobile": "?0",
        Token: Token,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    console.log("Response Presensi:", res.data);
    if (res.data.sukses == true && res.data.pesan === "Presensi berhasil disimpan") {
      return res.data;
    }
    return { status: "error", message: res.data.pesan || "Presensi gagal" };
  };

  getNotifikasi = async (ST, Token) => {
    const res = await axios.get(`${URL_ETHOL}/api/notifikasi/mahasiswa`, {
      params: {
        filterNotif: "PRESENSI",
      },
      headers: {
        Cookie: `PHPSESSID=${ST}; token=${Token}; hakAktif=${this.hakAktif}`,
        "Sec-Ch-Ua-Platform": '"Linux"',
        "User-Agent":
          "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        Accept: "application/json, text/plain, */*",
        Dnt: 1,
        "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
        "Sec-Ch-Ua-Mobile": "?0",
        Token: Token,
        "Sec-Fetch-Site": "same-origin",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Dest": "empty",
      },
    });
    // console.log(res.data);
    return res.data;
  };

  getRiwayatPresensi = async (ST, Token, nomor_kuliah, jenis_schema, nomor_mhs) => {
    try {
      const res = await axios.get(`${URL_ETHOL}/api/presensi/riwayat`, {
        params: {
          kuliah: nomor_kuliah,
          jenis_schema: jenis_schema,
          nomor: nomor_mhs,
        },
        headers: {
          Cookie: `PHPSESSID=${ST}; token=${Token}; hakAktif=${this.hakAktif}`,
          "Sec-Ch-Ua-Platform": '"Linux"',
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Dnt: 1,
          "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          "Sec-Ch-Ua-Mobile": "?0",
          Token: Token,
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
        },
      });
      return res.data;
    } catch (error) {
      console.error("Error fetching riwayat presensi:", error);
      return { status: "error", message: "Gagal mengambil riwayat presensi" };
    }
  };
}

export { Presensi };
