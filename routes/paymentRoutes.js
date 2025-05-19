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

// Test connections (public for easy testing)
router.get('/test-maishapay', paymentController.testMaishapayConnection);
router.get('/test-card-payment', paymentController.testCardPaymentConnection); 
router.get('/test-card-payment-v3', paymentController.testCardPaymentV3Connection); 

// Payment initialization routes
router.post('/initialize', authenticate, paymentController.initializePayment);
// Optional: Direct routes to specific payment methods if needed
router.post('/initialize-mobile', authenticate, paymentController.initializeMobileMoneyPayment);
router.post('/initialize-card', authenticate, paymentController.initializeCardPayment);
router.post('/initialize-card-v3', authenticate, paymentController.initializeCardPaymentV3); // Added V3 endpoint

// Payment status routes
router.get('/status/:transactionId', authenticate, paymentController.checkPaymentStatus);
router.get('/history', authenticate, paymentController.getPaymentHistory);

// Environment info route
router.get('/test-env', (req, res) => {
  res.json({
    maishapayConfigured: !!process.env.MAISHAPAY_PUBLIC_KEY,
    NODE_ENV: process.env.NODE_ENV,
    apiBaseUrl: process.env.API_BASE_URL || 'Not configured'
  });
});

// Maintenance and debugging routes
router.get('/dev-activate/:listingId', authenticate, paymentController.devActivateListing);
router.get('/emergency-fix/:paymentId/:listingId?', authenticate, paymentController.emergencyFixListing);
router.get('/fix-transaction-78452', authenticate, paymentController.fixSpecificTransaction);

module.exports = router;
