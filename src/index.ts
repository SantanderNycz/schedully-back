import express from "express";
import cors from "cors";
import * as dotenv from "dotenv";
import authRoutes from "./routes/auth";
import servicesRoutes from "./routes/services";
import availabilityRoutes from "./routes/availability";
import bookingsRoutes from "./routes/bookings";
import billingRoutes, { webhookHandler } from "./routes/billing";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Handle preflight requests explicitly
app.options("*", (req, res) => {
  res.header("Access-Control-Allow-Origin", req.headers.origin || "*");
  res.header(
    "Access-Control-Allow-Methods",
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  res.header("Access-Control-Allow-Headers", "Content-Type,Authorization");
  res.header("Access-Control-Allow-Credentials", "true");
  res.sendStatus(200);
});

app.use(cors({ origin: true, credentials: true }));

// Webhook must receive raw body — register before express.json()
app.post(
  "/api/billing/webhook",
  express.raw({ type: "application/json" }),
  webhookHandler,
);

app.use(express.json());

app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.use("/api/auth", authRoutes);
app.use("/api/services", servicesRoutes);
app.use("/api/availability", availabilityRoutes);
app.use("/api/bookings", bookingsRoutes);
app.use("/api/billing", billingRoutes);

app.use(
  (
    err: Error,
    _req: express.Request,
    res: express.Response,
    _next: express.NextFunction,
  ) => {
    console.error(err.stack);
    res.status(500).json({ error: "Something went wrong" });
  },
);

app.listen(PORT, () => {
  console.log(`🚀 Schedully API running on port ${PORT}`);
});

export default app;
