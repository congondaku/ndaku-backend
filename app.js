const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const userRoutes = require('./routes/user-routes');
const listingRoutes = require('./routes/listing-routes');
const adminRoutes = require('./routes/adminRoutes');
const winston = require('winston');
const fs = require('fs');

// Config
dotenv.config();

// Ensure logs directory exists
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const isServerless = process.env.NETLIFY || false;

// Configure Winston logger
const logger = winston.createLogger({
  level: 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.printf(({ level, message, timestamp }) => {
      return `${timestamp} ${level}: ${typeof message === 'object' ? JSON.stringify(message, null, 2) : message}`;
    })
  ),
  defaultMeta: { service: 'listing-service' },
  transports: [
    new winston.transports.Console() // Log to console always
  ]
});

// Logging middleware for listing operations
const logListingData = (req, res, next) => {
  if (req.path.includes('/listings/add') && req.method === 'POST') {
    logger.info('==== RECEIVED LISTING DATA ON SERVER ====');
    logger.info({
      requestBody: req.body,
      files: req.files ? req.files.map(file => ({
        fieldname: file.fieldname,
        originalname: file.originalname,
        mimetype: file.mimetype,
        size: file.size
      })) : 'No files'
    });
    
    // Store original response methods
    const originalJson = res.json;
    const originalSend = res.send;
    
    // Override response methods to log what's being sent back
    res.json = function(data) {
      logger.info('==== DATABASE SAVED LISTING DATA ====');
      logger.info({ response: data });
      return originalJson.call(this, data);
    };
    
    res.send = function(data) {
      if (typeof data === 'object') {
        logger.info('==== DATABASE SAVED LISTING DATA ====');
        logger.info({ response: data });
      }
      return originalSend.call(this, data);
    };
  }
  
  // Add error logging for listings endpoints
  if (req.path.includes('/listings')) {
    const originalSend = res.send;
    const originalJson = res.json;
    const originalStatus = res.status;
    
    let currentStatus = 200;
    
    res.status = function(code) {
      currentStatus = code;
      return originalStatus.call(this, code);
    };
    
    res.json = function(data) {
      if (currentStatus >= 400) {
        logger.error(`API Error (${currentStatus}) at ${req.method} ${req.originalUrl}`, {
          error: data,
          requestBody: req.body
        });
      }
      return originalJson.call(this, data);
    };
    
    res.send = function(data) {
      if (currentStatus >= 400 && typeof data === 'object') {
        logger.error(`API Error (${currentStatus}) at ${req.method} ${req.originalUrl}`, {
          error: data,
          requestBody: req.body
        });
      }
      return originalSend.call(this, data);
    };
  }
  
  next();
};

// App setup
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// Add logging middleware
app.use(logListingData);

// API routes
app.use('/api/users', userRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/admin', adminRoutes);
app.use('/listing', require('./routes/listing-routes'));
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'API endpoint not found' });
});

// Serve React in production
if (process.env.NODE_ENV === 'production') {
  // Adjust this path to where your React build is located
  const reactBuildPath = path.join(__dirname, '../frontend/dist');
  
  // Serve static files
  app.use(express.static(reactBuildPath));
  
  // Handle React routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(reactBuildPath, 'index.html'));
  });
}

// Database & Server connection
const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGODB_URI;

// Add error handling for uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', {
    promise: promise,
    reason: reason
  });
});

// Override console methods to use Winston
console.log = function() {
  logger.info.apply(logger, arguments);
};
console.error = function() {
  logger.error.apply(logger, arguments);
};
console.info = function() {
  logger.info.apply(logger, arguments);
};
console.warn = function() {
  logger.warn.apply(logger, arguments);
};

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    logger.info('✅ Connected to MongoDB');
    app.listen(PORT, () => logger.info(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    logger.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
  