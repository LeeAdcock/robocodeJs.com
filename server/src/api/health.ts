import express from "express";

const app = express();

// Health
app.get("/health", (req, res) => {
  res.json({ status: "ok" });
});

export default app;
