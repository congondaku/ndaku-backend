const express = require('express');
const router = express.Router();
const smsController = require('../controllers/smsController');

// Rate limiting middleware
const rateLimit = require('express-rate-limit');

// Rate limiter for sending codes
const sendCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 3, // limit each IP to 3 requests per windowMs
  message: {
    success: false,
    message: 'Too many verification attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Rate limiter for verifying codes
const verifyCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // limit each IP to 10 requests per windowMs
  message: {
    success: false,
    message: 'Too many verification attempts, please try again later.'
  },
  standardHeaders: true,
  legacyHeaders: false,
});

/**
 * @route POST /api/sms/send-verification
 * @desc Send verification code via SMS
 * @access Public
 */
router.post('/send-verification', sendCodeLimiter, smsController.sendVerificationCode);

/**
 * @route POST /api/sms/verify-code
 * @desc Verify the SMS verification code
 * @access Public
 */
router.post('/verify-code', verifyCodeLimiter, smsController.verifyCode);

/**
 * @route POST /api/sms/resend-code
 * @desc Resend verification code via SMS
 * @access Public
 */
router.post('/resend-code', sendCodeLimiter, smsController.resendVerificationCode);

/**
 * @route GET /api/sms/status/:phoneNumber
 * @desc Get verification status for a phone number
 * @access Public
 */
router.get('/status/:phoneNumber', smsController.getVerificationStatus);

/**
 * @route GET /api/sms/service-status
 * @desc Get SMS service status
 * @access Public
 */
router.get('/service-status', smsController.getServiceStatus);

module.exports = router;
