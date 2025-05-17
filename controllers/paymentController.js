const axios = require('axios');
const crypto = require('crypto');
const https = require('https');
const Payment = require('../models/paymentSchema');
const Listing = require('../models/Listing');
const logger = require('../config/logger');

// Enhanced Maishapay configuration with proper TLS settings
const MAISHAPAY_CONFIG = {
  PUBLIC_KEY: process.env.MAISHAPAY_PUBLIC_KEY,
  SECRET_KEY: process.env.MAISHAPAY_SECRET_KEY,
  BASE_URL: 'https://www.maishapay.net/merchant/api/v1',
  // Create a custom HTTPS agent for Maishapay requests
  HTTPS_AGENT: new https.Agent({
    rejectUnauthorized: true, // Keep secure in production
    secureProtocol: 'TLSv1_2_method', // Force TLS 1.2 which is widely supported
    ciphers: 'HIGH:!aNULL:!MD5', // Use strong ciphers
    honorCipherOrder: true,
    minVersion: 'TLSv1.2'
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

const generateExternalId = () => {
  const timestamp = Date.now();
  const randomString = crypto.randomBytes(4).toString('hex');
  return `NDAKU${timestamp}${randomString}`;
};

const convertUSDtoCDF = (amountUSD) => {
  return Math.round(amountUSD * USD_TO_CDF_RATE);
};

// Helper to normalize phone numbers to Maishapay's expected format
const formatPhoneNumber = (phone) => {
  if (!phone) return '';
  
  // Remove all non-digit characters
  let digits = phone.replace(/\D/g, '');
  
  // Handle different formats
  if (digits.startsWith('00243')) {
    digits = digits.substring(5); // Remove 00243
  } else if (digits.startsWith('243')) {
    digits = digits.substring(3); // Remove 243
  } else if (digits.startsWith('0')) {
    digits = digits.substring(1); // Remove leading 0
  }
  
  // Ensure it starts with 243 as per Maishapay requirements
  return `243${digits}`;
};

// Map internal payment methods to Maishapay payment methods
const mapPaymentMethodToMaishapay = (method) => {
  const methodMap = {
    'orange': 'orange_money',
    'airtel': 'airtel_money',
    'mpesa': 'mpesa',
    'card': 'card'
  };
  
  return methodMap[method] || method;
};

const initializePayment = async (req, res) => {
  try {
    const { 
      planId, 
      paymentMethod, 
      phoneNumber, 
      currency,
      listingId,
    } = req.body;

    logger.info("Payment initialization request received", {
      planId, paymentMethod, currency, listingId,
      userId: req.user._id
    });

    // Validate required fields
    if (!planId || !paymentMethod || (!phoneNumber && paymentMethod !== 'card') || !currency || !listingId) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields: planId, paymentMethod, phoneNumber, currency, and listingId are required'
      });
    }

    // Validate plan exists
    const plan = SUBSCRIPTION_PLANS[planId];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: 'Invalid plan selected'
      });
    }

    // Validate listing exists
    const listing = await Listing.findById(listingId);
    if (!listing) {
      logger.error("Listing not found for payment", { listingId });
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    // Check if user owns the listing
    if (listing.createdBy.toString() !== req.user._id.toString() && req.user.role !== 'admin') {
      logger.warn("Unauthorized payment attempt", {
        userId: req.user._id,
        listingId,
        listingOwner: listing.createdBy
      });
      return res.status(403).json({
        success: false,
        message: 'You can only pay for your own listings'
      });
    }

    // Check if listing already has an active payment
    const existingPayment = await Payment.findOne({
      listingId,
      status: { $in: ['success', 'pending'] }
    });

    if (existingPayment && existingPayment.status === 'success') {
      logger.info("Listing already has a successful payment", {
        listingId, paymentId: existingPayment._id
      });
      return res.status(400).json({
        success: false,
        message: 'This listing has already been paid for'
      });
    }

    // Validate payment method
    if (!['orange', 'airtel', 'mpesa', 'card'].includes(paymentMethod)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid payment method. Supported methods: orange, airtel, mpesa, card'
      });
    }

    // Validate currency
    if (!['USD', 'CDF'].includes(currency)) {
      return res.status(400).json({
        success: false,
        message: 'Invalid currency. Supported currencies: USD, CDF'
      });
    }

    // Generate unique external ID
    const externalId = generateExternalId();

    // Calculate amount based on currency
    let amount;
    if (currency === 'USD') {
      amount = plan.priceUSD;
    } else {
      amount = convertUSDtoCDF(plan.priceUSD);
    }

    // Format phone number for payment
    const formattedPhoneNumber = formatPhoneNumber(phoneNumber);

    // Create payment record in database
    const payment = new Payment({
      userId: req.user._id,
      listingId,
      planId,
      duration: plan.duration,
      amountUSD: plan.priceUSD,
      amountCDF: convertUSDtoCDF(plan.priceUSD),
      currency,
      amount,
      paymentMethod,
      phoneNumber: formattedPhoneNumber,
      externalId,
      status: 'pending'
    });

    await payment.save();

    // For development, generate a mock payment response
    if (process.env.NODE_ENV === 'development') {
      logger.info("Development mode: generating mock payment response");
      const mockTransactionId = `MOCK-${Date.now()}-${Math.floor(Math.random() * 1000)}`;
      payment.transactionId = mockTransactionId;
      await payment.save();
      
      // In development, also immediately mark the listing as active
      try {
        await updateListingAfterPayment(payment);
        logger.info("Development mode: automatically activated listing", { listingId });
      } catch (activationError) {
        logger.error("Failed to auto-activate listing in development mode", { 
          error: activationError.message, 
          stack: activationError.stack 
        });
      }
      
      return res.status(200).json({
        success: true,
        message: 'Payment initiated successfully (DEVELOPMENT MODE)',
        data: {
          paymentId: payment._id,
          transactionId: mockTransactionId,
          externalId,
          amount,
          currency,
          status: 'pending'
        }
      });
    }

    // In production, use the actual payment gateway
    try {
      // Map payment method to Maishapay format
      const maishapayMethod = mapPaymentMethodToMaishapay(paymentMethod);
      
      // Prepare payload for Maishapay according to their API docs
      const payload = {
        amount: amount.toString(), // Maishapay expects string
        currency: currency,
        external_id: externalId,
        client_number: formattedPhoneNumber,
        payment_method: maishapayMethod,
        public_key: MAISHAPAY_CONFIG.PUBLIC_KEY,
        callback_url: `${process.env.API_BASE_URL}/api/payments/webhook`, // Add your webhook endpoint
        redirect_url: `${process.env.FRONTEND_URL}/payment-success?id=${externalId}` // User redirect after payment
      };

      logger.info('Initializing Maishapay payment', { 
        payload: { ...payload, public_key: '[REDACTED]' } 
      });

      // Call Maishapay API to initialize payment with improved error handling
      const response = await axios.post(
        `${MAISHAPAY_CONFIG.BASE_URL}/transaction/initialize`, 
        payload,
        {
          headers: {
            'Authorization': `Bearer ${MAISHAPAY_CONFIG.SECRET_KEY}`,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
          },
          httpsAgent: MAISHAPAY_CONFIG.HTTPS_AGENT,
          timeout: 30000, // 30 second timeout
          maxContentLength: 50 * 1024 * 1024 // 50MB max content size
        }
      );

      logger.info('Maishapay API response:', {
        status: response.status,
        statusText: response.statusText,
        dataPreview: JSON.stringify(response.data).substring(0, 200)
      });

      // Update payment with transaction ID from Maishapay
      if (response.data && response.data.transaction_id) {
        payment.transactionId = response.data.transaction_id;
        payment.responseData = response.data;
        await payment.save();
        
        return res.status(200).json({
          success: true,
          message: 'Payment initiated successfully',
          data: {
            paymentId: payment._id,
            transactionId: response.data.transaction_id,
            externalId,
            amount,
            currency,
            redirectUrl: response.data.redirect_url || null,
            status: 'pending'
          }
        });
      } else {
        // Handle missing transaction ID or unexpected response format
        logger.warn('Maishapay response missing expected fields:', response.data);
        
        payment.status = 'failed';
        payment.responseData = response.data;
        await payment.save();
        
        return res.status(400).json({
          success: false,
          message: 'Payment provider returned an invalid response',
          error: 'Missing required fields in payment provider response'
        });
      }
    } catch (apiError) {
      // Enhanced error logging for debugging payment gateway issues
      logger.error('Payment API error:', {
        message: apiError.message,
        code: apiError.code,
        stack: apiError.stack.substring(0, 500),
        status: apiError.response?.status,
        statusText: apiError.response?.statusText,
        responseData: apiError.response?.data,
        request: {
          method: apiError.config?.method,
          url: apiError.config?.url,
          headers: apiError.config?.headers ? 
            {...apiError.config.headers, Authorization: '[REDACTED]'} : 
            'No headers'
        }
      });
      
      // Update payment status to failed
      payment.status = 'failed';
      payment.responseData = {
        error: apiError.message,
        code: apiError.code,
        status: apiError.response?.status
      };
      await payment.save();
      
      // Check for specific TLS errors
      if (apiError.message.includes('EPROTO') || 
          apiError.message.includes('SSL') || 
          apiError.message.includes('TLS')) {
        
        return res.status(500).json({
          success: false,
          message: 'Payment service connection error',
          error: 'There was a secure connection issue with the payment provider. Please try again later or contact support.'
        });
      }
      
      return res.status(apiError.response?.status || 500).json({
        success: false,
        message: 'Payment service currently unavailable',
        error: 'Unable to connect to payment gateway. Please try again later.'
      });
    }
  } catch (error) {
    logger.error('Payment initialization error:', {
      message: error.message,
      stack: error.stack
    });
    
    return res.status(error.response?.status || 500).json({
      success: false,
      message: 'Failed to initialize payment',
      error: error.message
    });
  }
};

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

    // In development mode, simulate success
    if (process.env.NODE_ENV === 'development') {
      // Update status to success
      payment.status = 'success';
      await payment.save();
      
      // Update listing with this payment
      await updateListingAfterPayment(payment);
      
      return res.status(200).json({
        success: true,
        data: {
          status: 'success',
          paymentDetails: {
            amount: payment.amount,
            currency: payment.currency,
            paymentMethod: payment.paymentMethod,
            externalId: payment.externalId,
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
        payment.status = response.data.status;
        payment.responseData = {
          ...payment.responseData,
          statusCheck: response.data
        };
        
        // If payment status changed to success, update listing
        if (oldStatus !== 'success' && response.data.status === 'success') {
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

const handlePaymentWebhook = async (req, res) => {
  try {
    logger.info('Received payment webhook:', req.body);
    
    const { 
      transaction_id, 
      external_id, 
      status, 
      amount 
    } = req.body;

    // Validate webhook data
    if (!transaction_id && !external_id) {
      logger.warn('Invalid webhook data: missing identifiers', req.body);
      return res.status(400).json({
        success: false,
        message: 'Invalid webhook data: Missing transaction_id or external_id'
      });
    }

    // Find the payment record
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

    // Always acknowledge the webhook ASAP to prevent retries
    res.status(200).json({
      success: true,
      message: 'Webhook received'
    });

    // Process the webhook asynchronously
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
        logger.info('Listing activated via webhook', {
          listingId: payment.listingId,
          paymentId: payment._id
        });
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

// Enhanced function to update listing after payment
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
    
    // Calculate new expiry date
    const currentDate = new Date();
    const newExpiryDate = new Date(currentDate);
    newExpiryDate.setMonth(currentDate.getMonth() + payment.duration);
    
    // Update listing fields
    listing.expiryDate = newExpiryDate;
    listing.isDeleted = false;
    listing.status = 'available';
    listing.paymentStatus = 'paid';
    listing.paymentId = payment.transactionId || payment.externalId;
    listing.subscriptionPlan = payment.planId;
    listing.subscriptionStartDate = currentDate;
    
    await listing.save();
    
    logger.info('Listing updated after successful payment', { 
      listingId: listing._id, 
      expiryDate: newExpiryDate,
      duration: payment.duration,
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

// New function to manually activate a listing in development mode
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
      // Create a mock payment
      payment = new Payment({
        userId: listing.createdBy,
        listingId: listing._id,
        planId: '3_months', // Default to 3 months
        duration: 3,
        amountUSD: 20,
        amountCDF: convertUSDtoCDF(20),
        currency: 'USD',
        amount: 20,
        paymentMethod: 'orange',
        phoneNumber: '243123456789',
        externalId: `DEV-${Date.now()}`,
        transactionId: `DEV-TRANS-${Date.now()}`,
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

const getPaymentHistory = async (req, res) => {
  try {
    const payments = await Payment.find({ userId: req.user._id })
      .sort({ createdAt: -1 })
      .populate('listingId', 'title images');

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

module.exports = {
  initializePayment,
  checkPaymentStatus,
  handlePaymentWebhook,
  getPaymentHistory,
  getSubscriptionPlans,
  updateListingAfterPayment,
  devActivateListing
};
