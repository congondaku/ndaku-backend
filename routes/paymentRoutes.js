const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Test route
router.get('/test', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Payment routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Public routes
router.get('/plans', paymentController.getSubscriptionPlans);
router.post('/callback', paymentController.handlePaymentWebhook); // MaishaPay webhook

// Protected routes (require authentication)
router.post('/initialize', paymentController.initializePayment);
router.get('/status/:transactionId', authenticate, paymentController.checkPaymentStatus);
router.get('/history', authenticate, paymentController.getPaymentHistory);

// Development routes
if (process.env.NODE_ENV === 'development') {
  router.get('/dev-activate/:listingId', authenticate, paymentController.devActivateListing);
  
  router.get('/test-env', (req, res) => {
    res.json({
      maishapayConfigured: !!process.env.MAISHAPAY_PUBLIC_KEY,
      NODE_ENV: process.env.NODE_ENV,
      apiBaseUrl: process.env.API_BASE_URL || 'Not configured'
    });
  });
}

module.exports = router;
