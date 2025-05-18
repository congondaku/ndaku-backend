const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const Payment = require('../models/paymentSchema');
const Listing = require('../models/Listing');
const logger = require('../config/logger');
const maishapayConfig = require('../config/maishapay');

// Generate a unique transaction reference
const generateTransactionReference = () => {
  return `NDAKU-${crypto.randomBytes(4).toString('hex')}-${Date.now()}`;
};

// Enhanced Maishapay configuration with proper TLS settings
const MAISHAPAY_CONFIG = {
  PUBLIC_KEY: process.env.MAISHAPAY_PUBLIC_KEY || maishapayConfig.PUBLIC_KEY,
  SECRET_KEY: process.env.MAISHAPAY_SECRET_KEY || maishapayConfig.SECRET_KEY,
  BASE_URL: process.env.MAISHAPAY_BASE_URL || 'https://www.maishapay.net/merchant/api/v1',
  GATEWAY_MODE: process.env.NODE_ENV === 'production' ? '1' : '0',

  HTTPS_AGENT: new https.Agent({
    rejectUnauthorized: true,
    ciphers: [
      'TLS_AES_256_GCM_SHA384',
      'TLS_CHACHA20_POLY1305_SHA256',
      'TLS_AES_128_GCM_SHA256',
      'ECDHE-RSA-AES128-GCM-SHA256',
      'ECDHE-ECDSA-AES128-GCM-SHA256'
    ].join(':'),
    honorCipherOrder: true
  })
};

const USD_TO_CDF_RATE = 2902.50;

const SUBSCRIPTION_PLANS = {
  '1_month': { duration: 1, priceUSD: 10 },
  '2_months': { duration: 2, priceUSD: 15 },
  '3_months': { duration: 3, priceUSD: 20 },
  '6_months': { duration: 6, priceUSD: 40 },
  '12_months': { duration: 12, priceUSD: 70 }
};

// Generate a unique external ID for the payment
const generateExternalId = () => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(4).toString('hex');
  return `NDAKU${timestamp}${randomString}`;
};

// Convert USD to CDF
const convertUSDtoCDF = (amountUSD) => {
  return Math.round(amountUSD * USD_TO_CDF_RATE);
};

// Helper to normalize phone numbers to Maishapay's expected format
const formatPhoneNumber = (phone) => {
  // Ensure phone starts with +243
  if (phone.startsWith('+243')) return phone;
  if (phone.startsWith('243')) return `+${phone}`;
  return `+243${phone.replace(/\D/g, '').slice(-9)}`;
};

// Map internal payment methods to Maishapay payment methods
const mapPaymentMethodToMaishapay = (method) => {
  const methodMap = {
    'orange': 'ORANGE_MONEY',
    'airtel': 'AIRTEL_MONEY',
    'mpesa': 'MPESA',
    'card': 'CARD'
  };

  return methodMap[method] || method.toUpperCase();
};

/**
 * Initialize a payment transaction
 */
const initializePayment = async (req, res) => {
  try {
    const { planId, paymentMethod, phoneNumber, listingId } = req.body;
    const user = req.user;

    // 1. Validate input
    if (!planId || !paymentMethod || !phoneNumber || !listingId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    // 2. Get plan details
    const plan = SUBSCRIPTION_PLANS[planId];
    if (!plan) {
      return res.status(400).json({ error: 'Invalid plan ID' });
    }

    // 3. Get listing and validate
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // 4. Calculate amounts
    const amountUSD = plan.priceUSD;
    const amountCDF = convertUSDtoCDF(amountUSD);

    // 5. Create identifiers
    const transactionReference = generateTransactionReference();
    const externalId = generateExternalId();
    const formattedPhone = formatPhoneNumber(phoneNumber);
    const mappedPaymentMethod = mapPaymentMethodToMaishapay(paymentMethod);

    // 6. Prepare Maishapay payload
    const payload = {
      transactionReference,
      gatewayMode: MAISHAPAY_CONFIG.GATEWAY_MODE,
      publicApiKey: MAISHAPAY_CONFIG.PUBLIC_KEY,
      secretApiKey: MAISHAPAY_CONFIG.SECRET_KEY,
      order: {
        motif: `Payment for listing: ${listing.title || listingId}`,
        amount: amountCDF.toString(),
        currency: "CDF",
        customerFullName: user.name || `${listing.listerFirstName} ${listing.listerLastName}` || "Customer",
        customerEmailAdress: user.email || listing.listerEmailAddress || "user@example.com"
      },
      paymentChannel: {
        provider: mappedPaymentMethod,
        walletID: formattedPhone,
        callbackUrl: `${process.env.API_BASE_URL || 'https://api.ndaku.com'}/api/payments/callback`
      }
    };

    logger.info('Initializing payment:', {
      listingId,
      planId,
      amountUSD,
      amountCDF,
      paymentMethod: mappedPaymentMethod
    });

    // 7. Call Maishapay API
    const response = await axios.post(
      `${MAISHAPAY_CONFIG.BASE_URL}/transaction/initialize`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${MAISHAPAY_CONFIG.SECRET_KEY}`
        },
        httpsAgent: MAISHAPAY_CONFIG.HTTPS_AGENT,
        timeout: 15000 // 15 second timeout
      }
    );

    logger.info('Payment initialized successfully:', {
      transactionId: response.data.transactionId,
      status: response.data.transactionStatus,
      cost: response.data.cost
    });

    // 8. Save payment record with complete information
    const payment = new Payment({
      userId: user._id,
      listingId,
      planId,
      duration: plan.duration,
      amountUSD,
      amountCDF,
      amount: response.data.cost.total,
      currency: response.data.cost.currency,
      paymentMethod,
      phoneNumber: formattedPhone,
      transactionId: response.data.transactionId,
      externalId,
      transactionReference,
      status: 'pending',
      responseData: response.data
    });
    await payment.save();

    // 9. Update listing status to pending payment
    await Listing.findByIdAndUpdate(listingId, {
      paymentStatus: 'pending',
      status: 'pending_payment'
    });

    // 10. Return success response
    return res.json({
      success: true,
      transactionId: response.data.transactionId,
      status: response.data.transactionStatus,
      data: response.data,
      paymentId: payment._id
    });

  } catch (error) {
    logger.error('Payment initialization error:', {
      message: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

/**
 * Handle webhook notifications from MaishaPay
 */
const handlePaymentWebhook = async (req, res) => {
  try {
    logger.info('Received payment webhook:', req.body);

    const {
      transaction_id,
      external_id,
      status,
      amount
    } = req.body;

    // 1. Validate webhook data
    if (!transaction_id && !external_id) {
      logger.warn('Invalid webhook data: missing identifiers', req.body);
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook data: Missing transaction_id or external_id'
      });
    }

    // 2. Find the payment record
    const payment = await Payment.findOne({
      $or: [
        { transactionId: transaction_id },
        { externalId: external_id }
      ]
    });

    if (!payment) {
      logger.error('Payment not found for webhook', {
        transaction_id,
        external_id
      });

      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // 3. Always acknowledge the webhook ASAP to prevent retries
    res.status(200).json({
      success: true,
      message: 'Webhook received'
    });

    // 4. Process the webhook asynchronously
    try {
      // Record previous status
      const oldStatus = payment.status;

      // Update payment status
      payment.status = status || payment.status;
      payment.webhookData = req.body;
      await payment.save();

      // If payment is successful and status just changed, update listing
      if (status === 'success' && oldStatus !== 'success') {
        await updateListingAfterPayment(payment);
      }

      logger.info('Webhook processing completed successfully', {
        paymentId: payment._id,
        status
      });
    } catch (processingError) {
      logger.error('Error processing webhook after acknowledgment:', {
        error: processingError.message,
        stack: processingError.stack,
        paymentId: payment._id
      });
    }
  } catch (error) {
    logger.error('Payment webhook error:', {
      error: error.message,
      stack: error.stack
    });

    // Always acknowledge the webhook, even on error
    return res.status(200).json({
      success: true,
      message: 'Webhook received but encountered processing error'
    });
  }
};

/**
 * Check the status of a payment
 */
const checkPaymentStatus = async (req, res) => {
  try {
    const { transactionId } = req.params;

    if (!transactionId) {
      return res.status(400).json({
        success: false,
        message: 'Transaction ID is required'
      });
    }

    // Find payment in our database
    const payment = await Payment.findOne({
      $or: [
        { transactionId },
        { externalId: transactionId }
      ]
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: 'Payment not found'
      });
    }

    // In development mode, simulate success for easy testing
    if (process.env.NODE_ENV === 'development') {
      // Update status to success
      const oldStatus = payment.status;
      payment.status = 'success';
      await payment.save();

      // If status changed, update listing
      if (oldStatus !== 'success') {
        await updateListingAfterPayment(payment);
      }

      return res.status(200).json({
        success: true,
        data: {
          status: 'success',
          paymentDetails: {
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            externalId: payment.externalId,
            transactionId: payment.transactionId,
            createdAt: payment.createdAt
          }
        }
      });
    }

    // In production, call payment gateway API
    try {
      // Call Maishapay API to check status with improved error handling
      const response = await axios.get(
        `${MAISHAPAY_CONFIG.BASE_URL}/transaction/status/${payment.transactionId}`,
        {
          headers: {
            'Authorization': `Bearer ${MAISHAPAY_CONFIG.SECRET_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: MAISHAPAY_CONFIG.HTTPS_AGENT,
          timeout: 10000
        }
      );

      logger.info('Payment status check response:', {
        transactionId: payment.transactionId,
        status: response.status,
        data: response.data
      });

      // Update payment status in database
      if (response.data && response.data.status) {
        const oldStatus = payment.status;
        payment.status = response.data.status.toLowerCase();
        payment.responseData = {
          ...payment.responseData,
          statusCheck: response.data
        };

        // If payment status changed to success, update listing
        if (oldStatus !== 'success' && payment.status === 'success') {
          await updateListingAfterPayment(payment);
          logger.info('Payment successful, listing activated', {
            paymentId: payment._id,
            listingId: payment.listingId
          });
        }

        await payment.save();
      }

      return res.status(200).json({
        success: true,
        data: {
          status: payment.status,
          paymentDetails: {
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            externalId: payment.externalId,
            transactionId: payment.transactionId,
            createdAt: payment.createdAt
          },
          gateway: response.data
        }
      });
    } catch (apiError) {
      logger.error('Payment gateway status check error:', {
        error: apiError.message,
        transactionId: payment.transactionId,
        response: apiError.response?.data
      });

      // Return current status from our database
      return res.status(200).json({
        success: true,
        data: {
          status: payment.status,
          paymentDetails: {
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            externalId: payment.externalId,
            transactionId: payment.transactionId,
            createdAt: payment.createdAt
          },
          gatewayError: 'Unable to check status with payment gateway'
        }
      });
    }
  } catch (error) {
    logger.error('Payment status check error:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to check payment status',
      error: error.message
    });
  }
};

/**
 * Enhanced function to update listing after payment
 */
const updateListingAfterPayment = async (payment) => {
  try {
    if (!payment) {
      throw new Error('Payment is not defined');
    }

    const listing = await Listing.findById(payment.listingId);

    if (!listing) {
      logger.error('Listing not found for payment', {
        listingId: payment.listingId,
        paymentId: payment._id
      });
      throw new Error(`Listing not found with ID: ${payment.listingId}`);
    }

    // Get plan duration - fallback to payment.duration if available
    const planDuration = payment.duration ||
      (SUBSCRIPTION_PLANS[payment.planId]?.duration || 3);

    // Calculate new expiry date
    const currentDate = new Date();
    const newExpiryDate = new Date(currentDate);
    newExpiryDate.setMonth(currentDate.getMonth() + planDuration);

    // Update listing fields 
    listing.status = 'available';
    listing.isDeleted = false;  
    listing.expiryDate = newExpiryDate;
    listing.paymentStatus = 'paid';
    listing.paymentId = payment.transactionId || payment.externalId;
    listing.subscriptionPlan = payment.planId;
    listing.subscriptionStartDate = currentDate;

    await listing.save();

    logger.info('Listing updated after successful payment', {
      listingId: listing._id,
      expiryDate: newExpiryDate,
      duration: planDuration,
      paymentId: payment._id
    });

    return listing;
  } catch (error) {
    logger.error('Error updating listing after payment', {
      error: error.message,
      stack: error.stack,
      paymentId: payment?._id,
      listingId: payment?.listingId
    });
    throw error;
  }
};

/**
 * Function to manually activate a listing in development mode
 */
const devActivateListing = async (req, res) => {
  // Only available in development mode
  if (process.env.NODE_ENV !== 'development') {
    return res.status(403).json({
      success: false,
      message: 'This endpoint is only available in development mode'
    });
  }

  try {
    const { listingId } = req.params;

    if (!listingId) {
      return res.status(400).json({
        success: false,
        message: 'Listing ID is required'
      });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Find or create a mock payment
    let payment = await Payment.findOne({ listingId });

    if (!payment) {
      // Create a mock payment with all required fields
      const externalId = `DEV-${Date.now()}`;
      const transactionId = `DEV-TRANS-${Date.now()}`;
      
      payment = new Payment({
        userId: listing.createdBy,
        listingId: listing._id,
        planId: '3_months',
        duration: 3,
        amountUSD: 20,
        amountCDF: convertUSDtoCDF(20),
        currency: 'USD',
        amount: 20,
        paymentMethod: 'orange',
        phoneNumber: '243123456789',
        externalId,
        transactionId,
        status: 'success'
      });

      await payment.save();
    } else {
      // Update existing payment to success
      payment.status = 'success';
      await payment.save();
    }

    // Activate the listing
    await updateListingAfterPayment(payment);

    return res.status(200).json({
      success: true,
      message: 'Listing activated successfully in development mode',
      data: {
        listing: await Listing.findById(listingId),
        payment
      }
    });
  } catch (error) {
    logger.error('Dev listing activation error:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to activate listing',
      error: error.message
    });
  }
};

/**
 * Get user's payment history
 */
const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('listingId', 'title images status paymentStatus expiryDate');

    return res.status(200).json({
      success: true,
      data: payments
    });
  } catch (error) {
    logger.error('Error fetching payment history:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch payment history',
      error: error.message
    });
  }
};

/**
 * Get available subscription plans
 */
const getSubscriptionPlans = async (req, res) => {
  try {
    const plansWithCDFPrices = Object.entries(SUBSCRIPTION_PLANS).map(([id, plan]) => ({
      id,
      durationMonths: plan.duration,
      priceUSD: plan.priceUSD,
      priceCDF: convertUSDtoCDF(plan.priceUSD)
    }));

    return res.status(200).json({
      success: true,
      data: {
        plans: plansWithCDFPrices,
        exchangeRate: USD_TO_CDF_RATE
      }
    });
  } catch (error) {
    logger.error('Error fetching subscription plans:', {
      error: error.message,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      message: 'Failed to fetch subscription plans',
      error: error.message
    });
  }
};

/**
 * Test MaishaPay connection
 */
const testMaishapayConnection = async () => {
  const testPayload = {
    transactionReference: `TEST-${Date.now()}`,
    gatewayMode: MAISHAPAY_CONFIG.GATEWAY_MODE,
    publicApiKey: MAISHAPAY_CONFIG.PUBLIC_KEY,
    secretApiKey: MAISHAPAY_CONFIG.SECRET_KEY,
    order: {
      motif: "Connection test",
      amount: "100",
      currency: "CDF",
      customerFullName: "Test User",
      customerEmailAdress: "test@example.com"
    },
    paymentChannel: {
      provider: "MPESA",
      walletID: "+243810000000"
    }
  };

  const response = await axios.post(
    `${MAISHAPAY_CONFIG.BASE_URL}/transaction/initialize`,
    testPayload,
    {
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${MAISHAPAY_CONFIG.SECRET_KEY}`
      },
      httpsAgent: MAISHAPAY_CONFIG.HTTPS_AGENT
    }
  );

  return response.data;
};

/**
 * Direct test for MaishaPay API
 */
const directMaishapayTest = async (req, res) => {
  try {
    // Use the payload as-is
    const payload = req.body;
    
    // If listingId is provided, prepare for listing activation
    const { listingId } = req.body;
    let listing = null;
    
    if (listingId) {
      listing = await Listing.findById(listingId);
      if (!listing) {
        return res.status(404).json({
          success: false,
          message: 'Listing not found'
        });
      }
    }

    // Call MaishaPay API
    const response = await axios.post(
      `${MAISHAPAY_CONFIG.BASE_URL}/transaction/initialize`,
      payload,
      {
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${payload.secretApiKey}`
        },
        httpsAgent: MAISHAPAY_CONFIG.HTTPS_AGENT
      }
    );
    
    // If successful and we have a listing, create a payment and activate listing
    if (response.data.transactionStatus === 'SUCCESS' && listing) {
      const externalId = generateExternalId();
      
      // Create payment record
      const payment = new Payment({
        userId: listing.createdBy,
        listingId: listing._id,
        planId: '3_months',
        duration: 3,
        amountUSD: 20,
        amountCDF: convertUSDtoCDF(20),
        amount: response.data.cost.total,
        currency: response.data.cost.currency,
        paymentMethod: 'mpesa',
        phoneNumber: response.data.recipient?.walletID || '+243810000000',
        transactionId: response.data.transactionId,
        externalId,
        status: 'success',
        responseData: response.data
      });
      
      await payment.save();
      
      // Activate listing
      await updateListingAfterPayment(payment);
      
      return res.json({
        success: true,
        data: response.data,
        message: 'Test payment succeeded and listing updated',
        listingId,
        payment: {
          _id: payment._id,
          transactionId: payment.transactionId,
          externalId: payment.externalId
        }
      });
    }

    // Return MaishaPay response
    return res.json({
      success: true,
      data: response.data
    });

  } catch (error) {
    logger.error('Direct MaishaPay test error:', {
      message: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(error.response?.status || 500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

/**
 * Direct test with listing update
 */
const directTestWithListingUpdate = async (req, res) => {
  try {
    const { payload, listingId } = req.body;
    
    if (!listingId) {
      return res.status(400).json({
        success: false,
        message: 'Listing ID is required'
      });
    }
    
    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }
    
    // Create a mock successful payment
    const externalId = generateExternalId();
    const transactionId = `TEST-${Date.now()}`;
    
    const payment = new Payment({
      userId: listing.createdBy,
      listingId,
      planId: '3_months',
      duration: 3,
      amountUSD: 20,
      amountCDF: convertUSDtoCDF(20),
      amount: 58050, // 20 USD in CDF
      currency: 'CDF',
      paymentMethod: 'mpesa',
      phoneNumber: '+243810000000',
      transactionId,
      externalId,
      status: 'success'
    });
    
    await payment.save();
    
    // Activate the listing
    await updateListingAfterPayment(payment);
    
    return res.json({
      success: true,
      message: 'Test payment created and listing activated',
      data: {
        listing: await Listing.findById(listingId),
        payment
      }
    });
    
  } catch (error) {
    logger.error('Direct test with listing update error:', {
      message: error.message,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.message
    });
  }
};

// Legacy webhook handler for backward compatibility
const handleWebhook = async (req, res) => {
  return handlePaymentWebhook(req, res);
};

module.exports = {
  initializePayment,
  checkPaymentStatus,
  handlePaymentWebhook,
  getPaymentHistory,
  getSubscriptionPlans,
  updateListingAfterPayment,
  devActivateListing,
  handleWebhook,
  testMaishapayConnection,
  directMaishapayTest,
  directTestWithListingUpdate
};
