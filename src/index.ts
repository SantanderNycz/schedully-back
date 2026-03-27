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

app.use(
  cors({
    origin: (origin, callback) => {
      const allowed = [
        process.env.CLIENT_URL,
        "http://localhost:5173",
        "http://localhost:3000",
      ].filter(Boolean);

      // Allow requests with no origin (mobile apps, Postman, etc.)
      if (!origin) return callback(null, true);

      if (allowed.includes(origin)) {
        callback(null, true);
      } else {
        console.log("CORS blocked:", origin);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
  }),
);

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
