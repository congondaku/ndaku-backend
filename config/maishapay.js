// config/maishapay.js
module.exports = {
  PUBLIC_KEY: "MP-SBPK-i.f4dIANLyCTyyZlA81GLIV7WSKF2EZUElA2HOd5E1N2/NUuTVCL5qlbMosKu.0$n6$0OjCOW1$zQBeepF0/WWMwGPCQ7gp5BOvsCAmrBU2$Bg$BRAu6U$kW",
  SECRET_KEY: "MP-SBSK-qSTmd50Pr20md8DNSYy$wu$vEZYX2D95GLrcAkfcB1M1$nKfcwQdEO18GH02K0$iSceif1YkfIk8Gdasg$bxjBzgu9Rw$d.K6/pkz00ld2nyln8jeO6ko177",
  BASE_URL: "https://www.maishapay.net/merchant/api/v1",
  GATEWAY_MODE: process.env.NODE_ENV === 'production' ? '1' : '0' // 0 for sandbox
};