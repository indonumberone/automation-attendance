import axios from "axios";
import { URL_ETHOL } from "../utils/url.js";
import { SEMESTER } from "../utils/account.js";

export class Jadwal {
  constructor() {
    this.hakAktif = "mahasiswa";
    this.data = [];
  }

  #getMatkul = async (ST, Token) => {
    try {
      const res = await axios.get(`${URL_ETHOL}/api/kuliah`, {
        params: {
          tahun: new Date().getFullYear(),
          semester: SEMESTER,
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
      console.error("Error getJadwal:", error.message);
      throw error;
    }
  };

  #getJadwal = async (ST, Token, matkul) => {
    try {
      const res = await axios.post(
        `${URL_ETHOL}/api/kuliah/hari-kuliah-in`,
        {
          kuliahs: matkul,
          tahun: new Date().getFullYear(),
          semester: SEMESTER,
        },
        {
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
        }
      );

      return res.data;
    } catch (error) {
      console.error("Error getJadwalHarian:", error.message);
      throw error;
    }
  };

  populate = async (ST, Token) => {
    try {
      const matkul = await this.#getMatkul(ST, Token);
      if (matkul.length === 0) {
        throw new Error("Matkul kosong, silakan ambil jadwal terlebih dahulu.");
      }

      const jadwal = await this.#getJadwal(ST, Token, matkul);
      const merged = matkul.map((m) => {
        const harian = jadwal.find((j) => j.kuliah === m.nomor);
        return {
          ...m,
          hari: harian?.hari || null,
          jamMulai: harian?.jam_awal || null,
          jamSelesai: harian?.jam_akhir || null,
        };
      });

      this.data = merged;
      return merged;
    } catch (error) {
      console.error("Error mergeJadwal:", error.message);
      return [];
    }
  };
}
