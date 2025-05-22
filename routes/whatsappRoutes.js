const express = require('express');
const router = express.Router();
const whatsappController = require('../controllers/whatsappController');

// Rate limiting middleware (optional but recommended)
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
 * @route POST /api/whatsapp/send-verification
 * @desc Send verification code via WhatsApp
 * @access Public
 */
router.post('/send-verification', sendCodeLimiter, whatsappController.sendVerificationCode);

/**
 * @route POST /api/whatsapp/verify-code
 * @desc Verify the WhatsApp verification code
 * @access Public
 */
router.post('/verify-code', verifyCodeLimiter, whatsappController.verifyCode);

/**
 * @route POST /api/whatsapp/resend-code
 * @desc Resend verification code via WhatsApp
 * @access Public
 */
router.post('/resend-code', sendCodeLimiter, whatsappController.resendVerificationCode);

/**
 * @route GET /api/whatsapp/status/:phoneNumber
 * @desc Get verification status for a phone number
 * @access Public
 */
router.get('/status/:phoneNumber', whatsappController.getVerificationStatus);

/**
 * @route GET /api/whatsapp/service-status
 * @desc Get WhatsApp service status
 * @access Public
 */
router.get('/service-status', whatsappController.getServiceStatus);

module.exports = router;