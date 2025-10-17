import axios from "axios";
import * as cheerio from "cheerio";
import { USERNAME, PASSWORD } from "../utils/account.js";
import { URL_ETHOL, URL_LOGIN } from "../utils/url.js";

export class Login {
  constructor() {
    this.JSESSIONID = null;
    this.LT = null;
    this.formAction = null;
    this.CASTGC = null;
    this.token = null;
    this.ST = null;
    this.PHPSESSID = null;
    this.hakAktif = null;
    this.nrp = null;
    this.nama = null;
    this.nomorMhs = null;
  }

  #getPHPSESSID = async () => {
    try {
      const response = await axios.get(`${URL_ETHOL}/cas/`, {
        headers: {
          Host: "ethol.pens.ac.id",
          "Sec-Ch-Ua-Platform": '"Linux"',
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.7",
          Dnt: "1",
          "Upgrade-Insecure-Requests": "1",
          "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          "Sec-Ch-Ua-Mobile": "?0",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "navigate",
          "Sec-Fetch-Dest": "empty",
          Referer: `${URL_ETHOL}/`,
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 302 || status === 200,
      });

      // console.log(response.headers);
      if (response.headers["set-cookie"]) {
        this.PHPSESSID = response.headers["set-cookie"][0].split(";")[0].split("=")[1];
        console.log("PHPSESSID:", this.PHPSESSID);
        return this.PHPSESSID;
      } else {
        console.error("PHPSESSID not found in response headers");
        return null;
      }
    } catch (error) {
      console.error("Error getPHPSESSID:", error.message);
      return null;
    }
  };

  #getLoginPage = async () => {
    try {
      const response = await axios.get(
        `${URL_LOGIN}/cas/login?service=http%3A%2F%2Fethol.pens.ac.id%2Fcas%2F`,
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          },
        }
      );

      this.JSESSIONID = response.headers["set-cookie"][0].split(";")[0].split("=")[1];

      const $ = cheerio.load(response.data);
      this.LT = $("input[name=lt]").val();
      this.formAction = $("#fm1").attr("action");

      console.log("✅ JSESSIONID:", this.JSESSIONID);
      console.log("✅ LT:", this.LT);
      console.log("✅ formAction:", this.formAction);

      if (!this.JSESSIONID || !this.LT || !this.formAction) {
        throw new Error("Gagal parsing login page");
      }
      return true;
    } catch (error) {
      console.error("❌ Error getLoginPage:", error.message);
      return false;
    }
  };

  #postLoginEthol = async () => {
    try {
      const response = await axios.post(
        `${URL_LOGIN}${this.formAction}`,
        new URLSearchParams({
          username: USERNAME,
          password: PASSWORD,
          lt: this.LT,
          _eventId: "submit",
          submit: "LOGIN",
        }),
        {
          headers: {
            Cookie: `JSESSIONID=${this.JSESSIONID}`,
            "Content-Type": "application/x-www-form-urlencoded",
            Origin: `${URL_LOGIN}`,
            Referer: `${URL_LOGIN}${this.formAction}`,
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          },
          maxRedirects: 0,
          validateStatus: (status) => status >= 200 && status < 400,
        }
      );
      this.CASTGC = response.headers["set-cookie"]
        .find((cookie) => cookie.startsWith("CASTGC="))
        ?.split(";")[0]
        ?.split("=")[1];
      this.ST = response.headers.location.split("ticket=")[1];
      if (!this.ST) {
        throw new Error("Gagal mendapatkan ST");
      }
      console.log("✅ ST:", this.ST);
      if (!this.CASTGC) {
        throw new Error("Gagal mendapatkan CASTGC");
      }
      // console.log(response.status, response.headers);
      console.log("✅ CASTGC:", this.CASTGC);
      console.log("Login response OK");
      return true;
    } catch (error) {
      console.error("Error postLoginEthol:", error.response?.status, error.message);
      return false;
    }
  };

  #getCas = async () => {
    console.log("iki st neee", this.ST);
    try {
      const res = await axios.get(`${URL_ETHOL}/cas/?ticket=${this.ST}`, {
        headers: {
          cookie: `PHPSESSID=${this.PHPSESSID}`,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
        },
        maxRedirects: 0,
        validateStatus: (status) => status === 302 || status === 200,
      });
      if (res.status === 302) {
        const getToken = await axios.get(`${URL_ETHOL}/cas/`, {
          headers: {
            cookie: `PHPSESSID=${this.ST}`,
            "User-Agent":
              "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          },
        });
        this.token = getToken.data.match(/localStorage\.setItem\('token', '([^']+)'/)[1];
        if (!this.token) {
          throw new Error("Gagal mendapatkan token dari localStorage");
        }
      }
      console.log("✅ Token:", this.token);
      return true;
    } catch (error) {
      console.error("Error getCas:", error.message);
      return null;
    }
  };

  #getvalidateToken = async () => {
    try {
      const res = await axios.get(`${URL_ETHOL}/api/auth/validasi-token`, {
        headers: {
          Cookie: `PHPSESSID=${this.PHPSESSID}; token=${this.token}`,
          "User-Agent":
            "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/132.0.0.0 Safari/537.36",
          Accept: "application/json, text/plain, */*",
          Token: this.token,
          Referer: `${URL_ETHOL}/`,
          "Sec-Ch-Ua": '"Not A(Brand";v="8", "Chromium";v="132", "Google Chrome";v="132"',
          "Sec-Ch-Ua-Platform": '"Linux"',
          "Sec-Ch-Ua-Mobile": "?0",
          Dnt: "1",
          "Sec-Fetch-Site": "same-origin",
          "Sec-Fetch-Mode": "cors",
          "Sec-Fetch-Dest": "empty",
          "Accept-Encoding": "gzip, deflate, br",
          "Accept-Language": "id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7",
        },
      });
      if (res.status === 200) {
        {
          console.log(res.data);
          this.hakAktif = res.data.hakAkses[0];
          this.nrp = res.data.nipnrp;
          this.nama = res.data.nama;
          this.nomorMhs = res.data.nomor;
        }

        console.log("✅ Token valid");
        return true;
      }
    } catch (error) {
      console.error("Error getvalidateToken:", error.message);
      return false;
    }
  };

  getAuth = async () => {
    try {
      if (!(await this.#getPHPSESSID())) throw new Error("Gagal mendapatkan PHPSESSID");
      console.log("✅ Berhasil mendapatkan PHPSESSID");

      if (!(await this.#getLoginPage())) throw new Error("Gagal mendapatkan halaman login");
      console.log("✅ Berhasil mendapatkan halaman login");

      if (!(await this.#postLoginEthol()))
        throw new Error("Gagal login (username/password atau lt salah)");
      console.log("✅ Berhasil login (CASTGC didapat)");

      if (!(await this.#getCas())) throw new Error("Gagal akses service dengan ST");
      console.log("✅ Berhasil akses ke ethol.pens.ac.id pakai ST");

      if (!(await this.#getvalidateToken())) throw new Error("Gagal validasi token");
      console.log("✅ Berhasil validasi token");

      return this;
    } catch (err) {
      console.error("❌", err.message);
    }
  };
}
