// config/maishapay.js
module.exports = {
  PUBLIC_KEY: "MP-LIVEPK-lEJDf$BlmyFx8Dzi0tysYOI2Onw2Fhn/HnVs1W3b.DD2jm3kPXWjjHoDHj9UA0X9221Mny$adAzV1EkX.SUYVVy5yxWA$Ux$0J6SA$NEbgEUOILFate3q$P4",
  SECRET_KEY: "MP-LIVESK-FYr7cbf$30W4I$VjcdIFAxu.E2l1TnObj4A.jyeJRky4Vp0f29Yr4Y$Z1$gI.20QVo$mZmnQpOoozApe6XZE$0WjHnKlUxtyMG0RnJ3.sTjbyPzOJWz7foPF",
  BASE_URL: "https://www.maishapay.net/merchant/api/v1",
  GATEWAY_MODE: process.env.NODE_ENV === 'production' ? '1' : '0' // 0 for sandbox
};