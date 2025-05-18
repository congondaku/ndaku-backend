const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const Payment = require('../models/paymentSchema');
const Listing = require('../models/Listing');
const logger = require('../config/logger');

// Configuration
const CONFIG = {
  PUBLIC_KEY: process.env.MAISHAPAY_PUBLIC_KEY,
  SECRET_KEY: process.env.MAISHAPAY_SECRET_KEY,
  BASE_URL: process.env.MAISHAPAY_BASE_URL || 'https://marchand.maishapay.online/api',
  GATEWAY_MODE: process.env.NODE_ENV === 'production' ? '1' : '0', // 1 for Production, 0 for Sandbox
  CALLBACK_URL: process.env.API_BASE_URL ? `${process.env.API_BASE_URL}/api/payments/callback` : 'https://yourdomain.com/callback',
  USD_TO_CDF_RATE: 2902.50,
  SUBSCRIPTION_PLANS: {
    '1_month': { duration: 1, priceUSD: 10 },
    '2_months': { duration: 2, priceUSD: 15 },
    '3_months': { duration: 3, priceUSD: 20 },
    '6_months': { duration: 6, priceUSD: 40 },
    '12_months': { duration: 12, priceUSD: 70 }
  }
};

// Helper functions
const generateTransactionReference = () => `NDAKU-${crypto.randomBytes(4).toString('hex').substring(0, 8)}`;
const generateExternalId = () => `NDAKU-${Date.now()}-${crypto.randomBytes(4).toString('hex').substring(0, 8)}`;
const convertUSDtoCDF = (amountUSD) => Math.round(amountUSD * CONFIG.USD_TO_CDF_RATE);
const formatPhone = (phone) => {
  if (phone.startsWith('+243')) return phone;
  if (phone.startsWith('243')) return `+${phone}`;
  return `+243${phone.replace(/\D/g, '').slice(-9)}`;
};

/**
 * Initialize a mobile money payment
 */
const initializePayment = async (req, res) => {
  try {
    const { planId, paymentMethod, phoneNumber, listingId } = req.body;
    const user = req.user;

    // Validation
    if (!planId || !paymentMethod || !phoneNumber || !listingId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // Get plan details
    const plan = CONFIG.SUBSCRIPTION_PLANS[planId];
    if (!plan) return res.status(400).json({ error: 'Invalid plan ID' });
    
    // Get listing
    const listing = await Listing.findById(listingId);
    if (!listing) return res.status(404).json({ error: 'Listing not found' });

    // Calculate amount and prepare data
    const amountCDF = convertUSDtoCDF(plan.priceUSD);
    const transactionReference = `NDAKU-${Date.now().toString().substring(6)}`;
    const formattedPhone = formatPhone(phoneNumber);

    // Create the exact payload that works with MaishaPay
    const maishapayPayload = {
      transactionReference,
      gatewayMode: "0", // Use "1" for production
      publicApiKey: CONFIG.PUBLIC_KEY,
      secretApiKey: CONFIG.SECRET_KEY,
      amount: amountCDF,
      currency: "CDF",
      chanel: "MOBILEMONEY",
      provider: paymentMethod.toUpperCase(),
      walletID: formattedPhone
    };

    // Call MaishaPay API
    const response = await axios.post(
      'https://marchand.maishapay.online/api/payment/rest/vers1.0/merchant',
      maishapayPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    // Create payment record
    const payment = new Payment({
      userId: user._id,
      listingId,
      planId,
      duration: plan.duration,
      amountUSD: plan.priceUSD,
      amountCDF,
      amount: amountCDF,
      currency: 'CDF',
      paymentMethod,
      phoneNumber: formattedPhone,
      transactionId: response.data.data?.transactionId || '',
      externalId: transactionReference,
      status: getPaymentStatus(response.data.status, response.data.data?.statusCode),
      responseData: response.data
    });
    await payment.save();

    // Update listing status
    await Listing.findByIdAndUpdate(listingId, {
      paymentStatus: 'pending',
      status: 'pending_payment'
    });

    // Return response to frontend
    return res.json({
      success: true,
      data: response.data
    });
  } catch (error) {
    console.error('Payment error:', error.message, error.response?.data);
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

// Helper function to determine payment status
function getPaymentStatus(status, statusCode) {
  if (status === 200 || statusCode === '200' || statusCode === 200) return 'success';
  if (status === 201 || statusCode === '201' || statusCode === 201) return 'pending';
  if (status === 400 || statusCode === '400' || statusCode === 400) return 'failed';
  return 'pending';
}

// Update the status mapping function
function mapMaishapayStatus(statusCode) {
  switch (statusCode) {
    case '200':
      return 'success';
    case '201':
    case '202':
      return 'pending';
    case '400':
    case '500':
      return 'failed';
    default:
      return 'pending';
  }
}

// Map MaishaPay status to our payment status
function mapMaishapayStatus(maishapayStatus) {
  const statusMap = {
    'SUCCESS': 'success',
    'APPROVED': 'success',
    'PENDING': 'pending',
    'DECLINED': 'failed',
    'FAILED': 'failed',
    'CANCELED': 'canceled'
  };
  return statusMap[maishapayStatus] || 'pending';
}

/**
 * Check payment status
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;
    if (!transactionId) {
      return res.status(400).json({ error: 'Transaction ID is required' });
    }

    // Find payment
    const payment = await Payment.findOne({
      $or: [{ transactionId }, { externalId: transactionId }]
    });
    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    // For development, simulate success
    if (process.env.NODE_ENV === 'development') {
      if (payment.status !== 'success') {
        payment.status = 'success';
        await payment.save();
        await updateListingAfterPayment(payment);
      }

      return res.json({
        success: true,
        data: {
          transactionId: payment.transactionId,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.paymentMethod,
          createdAt: payment.createdAt
        }
      });
    }

    // In production, check with MaishaPay
    try {
      const response = await axios.get(
        `${CONFIG.BASE_URL}/payment/transaction/status/${payment.transactionId}`,
        {
          headers: {
            'Authorization': `Bearer ${CONFIG.SECRET_KEY}`,
            'Content-Type': 'application/json'
          },
          timeout: 10000
        }
      );

      // Update payment status
      if (response.data.data) {
        const oldStatus = payment.status;
        const newStatus = mapMaishapayStatus(response.data.data.status);
        payment.status = newStatus;
        payment.responseData = { ...payment.responseData, statusCheck: response.data };
        await payment.save();

        // Activate listing if payment successful
        if (oldStatus !== 'success' && newStatus === 'success') {
          await updateListingAfterPayment(payment);
        }
      }

      return res.json({
        success: true,
        data: {
          transactionId: payment.transactionId,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.paymentMethod,
          createdAt: payment.createdAt
        }
      });

    } catch (apiError) {
      logger.error('Payment gateway status check error:', {
        error: apiError.message,
        transactionId: payment.transactionId
      });

      return res.json({
        success: true,
        data: {
          transactionId: payment.transactionId,
          status: payment.status,
          amount: payment.amount,
          currency: payment.currency,
          paymentMethod: payment.paymentMethod,
          createdAt: payment.createdAt,
          note: 'Unable to check latest status with payment gateway'
        }
      });
    }
  } catch (error) {
    logger.error('Payment status check error:', { error: error.message });
    return res.status(500).json({ error: 'Failed to check payment status' });
  }
};

/**
 * Handle webhook from MaishaPay
 */
const handlePaymentWebhook = async (req, res) => {
  try {
    logger.info('Webhook received:', req.body);

    // MaishaPay can send different webhook formats
    const transactionId = req.body.transactionId || req.body.data?.transactionId;
    const status = req.body.transactionStatus || req.body.data?.status;

    if (!transactionId) {
      logger.warn('Webhook missing transaction ID', req.body);
      return res.status(400).json({ error: 'Missing transaction ID' });
    }

    // Find the payment
    const payment = await Payment.findOne({ transactionId });
    if (!payment) {
      logger.warn('Payment not found for transaction ID', { transactionId });
      return res.status(404).json({ error: 'Payment not found' });
    }

    // Always acknowledge webhook quickly
    res.status(200).json({ success: true });

    // Process asynchronously
    try {
      // Update payment status
      const oldStatus = payment.status;
      const newStatus = mapMaishapayStatus(status);
      payment.status = newStatus;
      payment.webhookData = req.body;
      await payment.save();

      // Update listing if payment successful
      if (newStatus === 'success' && oldStatus !== 'success') {
        await updateListingAfterPayment(payment);
      }

      logger.info('Webhook processed successfully', {
        transactionId,
        newStatus,
        listingId: payment.listingId
      });
    } catch (err) {
      logger.error('Error processing webhook:', { error: err.message });
    }
  } catch (error) {
    logger.error('Webhook handler error:', { error: error.message });
    return res.status(200).json({ success: true }); // Always acknowledge
  }
};

/**
 * Update listing after successful payment
 */
const updateListingAfterPayment = async (payment) => {
  try {
    const listing = await Listing.findById(payment.listingId);
    if (!listing) {
      throw new Error(`Listing not found: ${payment.listingId}`);
    }

    // Calculate expiry date
    const planDuration = payment.duration ||
      (CONFIG.SUBSCRIPTION_PLANS[payment.planId]?.duration || 3);
    const currentDate = new Date();
    const expiryDate = new Date();
    expiryDate.setMonth(currentDate.getMonth() + planDuration);

    // Update listing
    listing.status = 'available';
    listing.isDeleted = false;
    listing.expiryDate = expiryDate;
    listing.paymentStatus = 'paid';
    listing.paymentId = payment.transactionId;
    listing.subscriptionPlan = payment.planId;
    listing.subscriptionStartDate = currentDate;
    await listing.save();

    logger.info('Listing activated after payment:', {
      listingId: listing._id,
      paymentId: payment._id,
      expiryDate
    });

    return listing;
  } catch (error) {
    logger.error('Error updating listing:', { error: error.message });
    throw error;
  }
};

/**
 * Get payment history for a user
 */
const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('listingId', 'title images status paymentStatus expiryDate');

    return res.json({
      success: true,
      data: payments
    });
  } catch (error) {
    logger.error('Error fetching payment history:', { error: error.message });
    return res.status(500).json({ error: 'Failed to fetch payment history' });
  }
};

/**
 * Get subscription plans
 */
const getSubscriptionPlans = async (req, res) => {
  try {
    const plans = Object.entries(CONFIG.SUBSCRIPTION_PLANS).map(([id, plan]) => ({
      id,
      durationMonths: plan.duration,
      priceUSD: plan.priceUSD,
      priceCDF: convertUSDtoCDF(plan.priceUSD)
    }));

    return res.json({
      success: true,
      data: {
        plans,
        exchangeRate: CONFIG.USD_TO_CDF_RATE
      }
    });
  } catch (error) {
    return res.status(500).json({ error: 'Failed to fetch subscription plans' });
  }
};

/**
 * Development helper to activate a listing
 */
const devActivateListing = async (req, res) => {
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({ error: 'Only available in development mode' });
  }

  try {
    const { listingId } = req.params;
    if (!listingId) {
      return res.status(400).json({ error: 'Listing ID is required' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Create mock payment
    const externalId = generateExternalId();
    const transactionId = `DEV-${Date.now()}`;

    const payment = new Payment({
      userId: listing.createdBy,
      listingId,
      planId: '3_months',
      duration: 3,
      amountUSD: 20,
      amountCDF: convertUSDtoCDF(20),
      amount: 58050,
      currency: 'CDF',
      paymentMethod: 'mpesa',
      phoneNumber: '+243810000000',
      transactionId,
      externalId,
      status: 'success'
    });

    await payment.save();

    // Activate listing
    await updateListingAfterPayment(payment);

    return res.json({
      success: true,
      message: 'Listing activated in development mode',
      data: {
        listing: await Listing.findById(listingId),
        payment
      }
    });
  } catch (error) {
    logger.error('Dev activation error:', { error: error.message });
    return res.status(500).json({ error: 'Failed to activate listing' });
  }
};

module.exports = {
  initializePayment,
  checkPaymentStatus,
  handlePaymentWebhook,
  getPaymentHistory,
  getSubscriptionPlans,
  devActivateListing,
  updateListingAfterPayment
};
