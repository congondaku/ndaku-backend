const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path');
const userRoutes = require('./routes/user-routes');
const listingRoutes = require('./routes/listing-routes');
const adminRoutes = require('./routes/adminRoutes');
const winston = require('winston');

// Config
dotenv.config();

// Configure Winston logger for serverless environment (no file logging)
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
    new winston.transports.Console() // Only log to console in serverless
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

// Conditionally use static files - not available in serverless
if (!process.env.NETLIFY) {
  app.use('/uploads', express.static('uploads'));
}

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

// Don't start the server here for serverless - just export the app
module.exports = app;