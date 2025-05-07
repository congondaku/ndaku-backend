// routes/communes-routes.js
const express = require("express");
const communesRouter = express.Router();

// Dummy data for now
const communes = [
  { id: 1, name: "Kinshasa" },
  { id: 2, name: "Gombe" },
  { id: 3, name: "Kasa-Vubu" },
  { id: 4, name: "Ngaliema" },
  { id: 5, name: "Limete" },
];

// GET /api/communes
communesRouter.get("/", (req, res) => {
  res.json({ communes });
});

module.exports = communesRouter;
