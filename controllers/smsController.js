const PhoneVerification = require('../models/PhoneVerification');
const smsService = require('../services/smsService');
const winston = require('winston');

// Generate 6-digit verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Phone number normalization function
const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return '';
  
  // Remove all non-digit characters except the + sign
  let normalized = phoneNumber.replace(/[^\d+]/g, '');
  
  // Ensure it starts with + if it doesn't already
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  
  return normalized;
};

// Validate phone number format
const isValidPhoneNumber = (phoneNumber) => {
  const normalized = normalizePhoneNumber(phoneNumber);
  const e164Regex = /^\+[1-9]\d{1,14}$/;
  return e164Regex.test(normalized);
};

// Send verification code via SMS
const sendVerificationCode = async (req, res) => {
  try {
    let { phoneNumber } = req.body;

    // Validate input
    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    // NORMALIZE the phone number
    phoneNumber = normalizePhoneNumber(phoneNumber);
    console.log(`📞 Original: ${req.body.phoneNumber} → Normalized: ${phoneNumber}`);

    // Validate phone number format
    if (!isValidPhoneNumber(phoneNumber)) {
      return res.status(400).json({
        success: false,
        message: 'invalid_number'
      });
    }

    // Check if SMS service is ready
    const serviceStatus = smsService.getStatus();
    if (!serviceStatus.isReady) {
      return res.status(503).json({
        success: false,
        message: 'sms_unavailable',
        error: serviceStatus.lastError?.message
      });
    }

    // Check for existing verification
    const existingVerification = await PhoneVerification.findByPhone(phoneNumber);
    
    if (existingVerification) {
      // Check if blocked
      if (existingVerification.isBlocked()) {
        return res.status(429).json({
          success: false,
          message: 'rate_limit',
          blockedUntil: existingVerification.blockedUntil
        });
      }

      // Check if recent code was sent (rate limiting)
      const timeSinceLastAttempt = Date.now() - existingVerification.lastAttemptAt;
      if (timeSinceLastAttempt < 60000) { // 1 minute
        return res.status(429).json({
          success: false,
          message: 'rate_limit',
          retryAfter: Math.ceil((60000 - timeSinceLastAttempt) / 1000)
        });
      }
    }

    // Generate new verification code
    const verificationCode = generateVerificationCode();

    // Save to database
    await PhoneVerification.createVerification(phoneNumber, verificationCode);

    // Send via SMS
    await smsService.sendVerificationCode(phoneNumber, verificationCode);

    // Log the action
    winston.info('SMS verification code sent', {
      phoneNumber: phoneNumber.substring(0, 7) + '***',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Verification code sent via SMS'
    });

  } catch (error) {
    winston.error('Error sending SMS verification code:', error);

    let errorMessage = 'unknown_error';
    let statusCode = 500;

    if (error.message.includes('Invalid phone number')) {
      errorMessage = 'invalid_number';
      statusCode = 400;
    } else if (error.message.includes('rate limit')) {
      errorMessage = 'rate_limit';
      statusCode = 429;
    } else if (error.message.includes('not ready')) {
      errorMessage = 'sms_unavailable';
      statusCode = 503;
    } else if (error.message.includes('not a valid mobile number')) {
      errorMessage = 'invalid_mobile_number';
      statusCode = 400;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage,
      error: error.message
    });
  }
};

// Verify code
const verifyCode = async (req, res) => {
  try {
    let { phoneNumber, code } = req.body;

    // Validate input
    if (!phoneNumber || !code) {
      return res.status(400).json({
        success: false,
        message: 'Phone number and code are required'
      });
    }

    // NORMALIZE the phone number
    phoneNumber = normalizePhoneNumber(phoneNumber);

    // Find verification record
    const verification = await PhoneVerification.findByPhone(phoneNumber);

    if (!verification) {
      return res.status(400).json({
        success: false,
        message: 'expired'
      });
    }

    // Check if blocked
    if (verification.isBlocked()) {
      return res.status(429).json({
        success: false,
        message: 'max_attempts',
        blockedUntil: verification.blockedUntil
      });
    }

    // Check if already verified
    if (verification.isVerified) {
      return res.json({
        success: true,
        message: 'Phone number already verified'
      });
    }

    // Check code
    if (verification.verificationCode !== code) {
      await verification.incrementAttempts();
      
      return res.status(400).json({
        success: false,
        message: 'invalid_code',
        attemptsLeft: Math.max(0, 5 - verification.attempts)
      });
    }

    // Code is correct
    await verification.markAsVerified();

    // Clean up - remove the verification record
    await PhoneVerification.deleteOne({ _id: verification._id });

    // Log successful verification
    winston.info('SMS verification successful', {
      phoneNumber: phoneNumber.substring(0, 7) + '***',
      timestamp: new Date().toISOString()
    });

    res.json({
      success: true,
      message: 'Phone number verified successfully',
      verified: true
    });

  } catch (error) {
    winston.error('Error verifying SMS code:', error);

    res.status(500).json({
      success: false,
      message: 'verification_error'
    });
  }
};

// Get verification status
const getVerificationStatus = async (req, res) => {
  try {
    let { phoneNumber } = req.params;

    // NORMALIZE the phone number
    phoneNumber = normalizePhoneNumber(phoneNumber);

    const verification = await PhoneVerification.findByPhone(phoneNumber);

    if (!verification) {
      return res.json({
        exists: false,
        verified: false
      });
    }

    res.json({
      exists: true,
      verified: verification.isVerified,
      attempts: verification.attempts,
      blocked: verification.isBlocked(),
      blockedUntil: verification.blockedUntil,
      createdAt: verification.createdAt
    });

  } catch (error) {
    winston.error('Error getting verification status:', error);
    res.status(500).json({
      success: false,
      message: 'server_error'
    });
  }
};

// Get SMS service status
const getServiceStatus = async (req, res) => {
  try {
    const status = smsService.getStatus();
    
    res.json({
      smsReady: status.isReady,
      initializing: status.isInitializing,
      retryCount: status.retryCount,
      phoneNumber: status.phoneNumber,
      lastError: status.lastError,
      timestamp: new Date().toISOString()
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'server_error'
    });
  }
};

// Resend verification code
const resendVerificationCode = async (req, res) => {
  return sendVerificationCode(req, res);
};

module.exports = {
  sendVerificationCode,
  verifyCode,
  getVerificationStatus,
  getServiceStatus,
  resendVerificationCode
};
