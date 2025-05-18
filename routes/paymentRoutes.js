const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Test route (public)
router.get('/test', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Payment routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Public routes
router.get('/plans', paymentController.getSubscriptionPlans);
router.post('/callback', paymentController.handlePaymentWebhook);

// Test MaishaPay connection (public for easy testing)
router.get('/test-maishapay', paymentController.testMaishapayConnection);

// Protected routes (require authentication)
router.post('/initialize', authenticate, paymentController.initializePayment);
router.get('/status/:transactionId', authenticate, paymentController.checkPaymentStatus);
router.get('/history', authenticate, paymentController.getPaymentHistory);

// Emergency fix routes
router.get('/emergency-fix/:paymentId/:listingId?', authenticate, paymentController.emergencyFixListing);
router.get('/fix-transaction-78452', authenticate, paymentController.fixSpecificTransaction);

// Environment info route
router.get('/test-env', (req, res) => {
  res.json({
    maishapayConfigured: !!process.env.MAISHAPAY_PUBLIC_KEY,
    NODE_ENV: process.env.NODE_ENV,
    apiBaseUrl: process.env.API_BASE_URL || 'Not configured'
  });
});

// Development routes - make available in all environments for emergency fixes
router.get('/dev-activate/:listingId', authenticate, paymentController.devActivateListing);

module.exports = router;