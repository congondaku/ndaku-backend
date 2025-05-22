// routes/test.js - Add these test routes for debugging
const express = require('express');
const router = express.Router();
const whatsappService = require('../services/whatsappService');

// Test Twilio credentials
router.get('/twilio-status', async (req, res) => {
  try {
    const status = whatsappService.getStatus();
    
    // Try to test connection if service claims to be ready
    let connectionTest = null;
    if (status.isReady) {
      try {
        connectionTest = await whatsappService.testConnection();
      } catch (error) {
        connectionTest = { success: false, error: error.message };
      }
    }
    
    res.json({
      service: status,
      connectionTest,
      environment: {
        hasAccountSid: !!process.env.TWILIO_ACCOUNT_SID,
        hasAuthToken: !!process.env.TWILIO_AUTH_TOKEN,
        whatsappNumber: process.env.TWILIO_WHATSAPP_NUMBER || 'Using default sandbox',
        nodeEnv: process.env.NODE_ENV
      }
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

// Test sending a WhatsApp message (for debugging only)
router.post('/test-whatsapp', async (req, res) => {
  try {
    const { phoneNumber, message } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }
    
    const testMessage = message || '🧪 Test message from Ndaku\n\nThis is a test to verify WhatsApp integration is working.';
    
    const result = await whatsappService.sendMessage(phoneNumber, testMessage);
    
    res.json({
      success: true,
      message: 'Test message sent successfully',
      result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
      code: error.code
    });
  }
});

// Test verification code flow
router.post('/test-verification', async (req, res) => {
  try {
    const { phoneNumber } = req.body;
    
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }
    
    const testCode = '123456';
    const result = await whatsappService.sendVerificationCode(phoneNumber, testCode);
    
    res.json({
      success: true,
      message: 'Test verification code sent',
      testCode, // In production, never return the actual code!
      result
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      message: error.message,
      code: error.code
    });
  }
});

module.exports = router;