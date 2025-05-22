const dotenv = require("dotenv");
const path = require("path");
const cron = require('node-cron');
const Listing = require('./models/Listing');

dotenv.config({ path: path.resolve(__dirname, "./.env") });

console.log("Environment variables loaded:");
console.log("NODE_ENV:", process.env.NODE_ENV);
console.log(
  "AWS Keys present:",
  !!process.env.MY_AWS_ACCESS_KEY_ID,
  !!process.env.MY_AWS_ACCESS_KEY_ID
);

const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const userRoutes = require("./routes/user-routes");
const listingRoutes = require("./routes/listing-routes");
const adminRoutes = require("./routes/adminRoutes");
const paymentRoutes = require("./routes/paymentRoutes");
const whatsappRoutes = require("./routes/whatsappRoutes");
const whatsappService = require("./services/whatsappService");
const winston = require("winston");
const fs = require("fs");

const logsDir = path.join(__dirname, "logs");
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isServerless = process.env.NETLIFY || false;

const logger = winston.createLogger({
  level: "info",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${typeof message === "object" ? JSON.stringify(message, null, 2) : message
        }`;
    })
  ),
  defaultMeta: { service: "listing-service" },
  transports: [
    new winston.transports.Console(),
  ],
});

function logMetric(metricName, metricData) {
  logger.info(`METRIC: ${metricName}`, metricData);
}

function sendAlert(alertTitle, alertData) {
  logger.error(`ALERT: ${alertTitle}`, alertData);
}

const updateExpiredSubscriptions = async () => {
  const startTime = Date.now();
  let success = false;
  let error = null;
  let updatedCount = 0;
  
  try {
    const currentDate = new Date();
    
    const result = await Listing.updateMany(
      { expiryDate: { $lt: currentDate }, activeSubscription: true },
      { $set: { activeSubscription: false } }
    );
    
    updatedCount = result.modifiedCount;
    success = true;
  } catch (err) {
    error = err;
    logger.error('Error updating subscriptions:', err);
  }
  
  const duration = Date.now() - startTime;
  
  logMetric('subscription_update_job', {
    success,
    duration,
    updatedCount,
    errorMessage: error ? error.message : null
  });
  
  if (!success || duration > 300000) {
    sendAlert('Subscription update job issue', {
      success,
      duration,
      updatedCount,
      error: error ? `${error.message}\n${error.stack}` : null
    });
  }
  
  return { success, updatedCount, duration };
};

const logListingData = (req, res, next) => {
  if (req.path.includes("/listings/add") && req.method === "POST") {
    logger.info("==== RECEIVED LISTING DATA ON SERVER ====");
    logger.info({
      requestBody: req.body,
      files: req.files
        ? req.files.map((file) => ({
          fieldname: file.fieldname,
          originalname: file.originalname,
          mimetype: file.mimetype,
          size: file.size,
        }))
        : "No files",
    });

    const originalJson = res.json;
    const originalSend = res.send;

    res.json = function (data) {
      logger.info("==== DATABASE SAVED LISTING DATA ====");
      logger.info({ response: data });
      return originalJson.call(this, data);
    };

    res.send = function (data) {
      if (typeof data === "object") {
        logger.info("==== DATABASE SAVED LISTING DATA ====");
        logger.info({ response: data });
      }
      return originalSend.call(this, data);
    };
  }

  if (req.path.includes("/listings") || req.path.includes("/payments")) {
    const originalSend = res.send;
    const originalJson = res.json;
    const originalStatus = res.status;

    let currentStatus = 200;

    res.status = function (code) {
      currentStatus = code;
      return originalStatus.call(this, code);
    };

    res.json = function (data) {
      if (currentStatus >= 400) {
        logger.error(
          `API Error (${currentStatus}) at ${req.method} ${req.originalUrl}`,
          {
            error: data,
            requestBody: req.body,
          }
        );
      }
      return originalJson.call(this, data);
    };

    res.send = function (data) {
      if (currentStatus >= 400 && typeof data === "object") {
        logger.error(
          `API Error (${currentStatus}) at ${req.method} ${req.originalUrl}`,
          {
            error: data,
            requestBody: req.body,
          }
        );
      }
      return originalSend.call(this, data);
    };
  }

  next();
};

const app = express();

app.use(cors());
app.use(express.json());
app.use("/uploads", express.static("uploads"));

app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  next();
});
app.use(logListingData);

console.log('Registering payment routes at /api/payments');
app.use("/api/payments", paymentRoutes);
app.use("/api/users", userRoutes);
app.use("/api/listings", listingRoutes);
app.use("/api/admin", adminRoutes);
app.use("/api/whatsapp", whatsappRoutes);
app.use("/payments", paymentRoutes);
app.use("/listing", require("./routes/listing-routes"));

app.use("/api", (req, res) => {
  res.status(404).json({ error: "API endpoint not found" });
});

// if (process.env.NODE_ENV === "production") {
//   const reactBuildPath = path.join(__dirname, "../frontend/dist");
//   app.use(express.static(reactBuildPath));
//   app.get("*", (req, res) => {
//     res.sendFile(path.join(reactBuildPath, "index.html"));
//   });
// }

const PORT = process.env.PORT || 5002;
const MONGO_URI = process.env.MONGODB_URI;

process.on("uncaughtException", (error) => {
  logger.error("Uncaught Exception:", error);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logger.error("Unhandled Rejection at:", {
    promise: promise,
    reason: reason,
  });
});

// console.log = function () {
//   logger.info.apply(logger, arguments);
// };
// console.error = function () {
//   logger.error.apply(logger, arguments);
// };
// console.info = function () {
//   logger.info.apply(logger, arguments);
// };
// console.warn = function () {
//   logger.warn.apply(logger, arguments);
// };

const setupJobSystem = () => {
  if (process.env.NODE_ENV === 'production') {
    if (process.env.WORKER_PROCESS === 'true') {
      cron.schedule('0 1 * * *', async () => {
        logger.info('Running subscription update job (production worker)');
        await updateExpiredSubscriptions();
      });
      logger.info('Worker process: Subscription update job scheduled');
    }
  } else {
    cron.schedule('0 1 * * *', async () => {
      logger.info('Running subscription update job (development)');
      await updateExpiredSubscriptions();
    });
    logger.info('Development: Subscription update job scheduled');
  }
};

mongoose
  .connect(MONGO_URI)
  .then(() => {
    logger.info("✅ Connected to MongoDB");
    
    if (process.env.ENABLE_WHATSAPP !== 'false') {
      logger.info("🔄 Initializing WhatsApp service...");
      whatsappService.initialize().catch(error => {
        logger.error("❌ WhatsApp service initialization failed:", error);
      });
    }
    
    app.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT}`));
    
    if (process.env.DISABLE_CRON_JOBS !== 'true') {
      setupJobSystem();
    }
  })
  .catch((err) => {
    logger.error("❌ MongoDB connection error:", err.message);
    process.exit(1);
  });

process.on('SIGTERM', async () => {
  logger.info('🔄 Gracefully shutting down...');
  await whatsappService.destroy();
  process.exit(0);
});

process.on('SIGINT', async () => {
  logger.info('🔄 Gracefully shutting down...');
  await whatsappService.destroy();
  process.exit(0);
});
