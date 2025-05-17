const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/paymentController');
const { authenticate } = require('../middleware/auth');

// Test route to check if payment routes are mounted correctly
router.get('/test', (req, res) => {
  return res.status(200).json({
    success: true,
    message: 'Payment routes are working!',
    timestamp: new Date().toISOString()
  });
});

// Simple plans endpoint that doesn't require any external services
const getSubscriptionPlansSimple = (req, res) => {
  // Current exchange rate - hardcoded for simplicity
  const USD_TO_CDF_RATE = 2900;

  // Subscription plans in USD
  const SUBSCRIPTION_PLANS = {
    '1_month': { duration: 1, priceUSD: 10 },
    '2_months': { duration: 2, priceUSD: 15 },
    '3_months': { duration: 3, priceUSD: 20 },
    '6_months': { duration: 6, priceUSD: 40 },
    '12_months': { duration: 12, priceUSD: 70 }
  };

  // Format plans for frontend
  const plansWithCDFPrices = Object.entries(SUBSCRIPTION_PLANS).map(([id, plan]) => ({
    id,
    durationMonths: plan.duration,
    priceUSD: plan.priceUSD,
    priceCDF: Math.round(plan.priceUSD * USD_TO_CDF_RATE)
  }));

  return res.status(200).json({
    success: true,
    data: {
      plans: plansWithCDFPrices,
      exchangeRate: USD_TO_CDF_RATE
    }
  });
};

// Public routes (no authentication required)
router.get('/plans', paymentController.getSubscriptionPlans);
router.get('/plans-simple', getSubscriptionPlansSimple);

// Webhook callback (must be public - no auth)
router.post('/callback', paymentController.handlePaymentWebhook);

// Protected routes (authentication required)
router.post('/initialize', authenticate, paymentController.initializePayment);
router.get('/status/:transactionId', authenticate, paymentController.checkPaymentStatus);
router.get('/history', authenticate, paymentController.getPaymentHistory);

// For development purposes only
router.get('/test-env', (req, res) => {
  res.json({
    maishapayConfigured: !!process.env.MAISHAPAY_PUBLIC_KEY,
    mapsConfigured: !!process.env.MAPS_API_KEY,
    awsConfigured: !!process.env.MY_AWS_ACCESS_KEY_ID,
    NODE_ENV: process.env.NODE_ENV
  });
});

module.exports = router;
