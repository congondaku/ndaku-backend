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
  MAISHAPAY_API_URL: 'https://marchand.maishapay.online/api/payment/rest/vers1.0/merchant',
  MAISHAPAY_CARD_API_URL: 'https://marchand.maishapay.online/api/collect/v2/store/card',
  BASE_URL: process.env.API_BASE_URL || 'http://localhost:5002',
  CALLBACK_URL: process.env.API_BASE_URL ? `${process.env.API_BASE_URL}/api/payments/callback` : `${process.env.API_BASE_URL}/api/payments/callback`,
  REDIRECT_URL: process.env.API_BASE_URL ? `${process.env.API_BASE_URL}/payment-complete` : `http://localhost:3000/payment-complete`,
  GATEWAY_MODE: process.env.NODE_ENV === 'production' ? '1' : '0',
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
 * Helper function to determine payment status
 */
function getPaymentStatus(status, statusCode, statusDescription) {
  // Log all parameters for debugging
  logger.info('Determining payment status from:', { status, statusCode, statusDescription });

  try {
    // First check statusCode if it exists
    if (statusCode !== undefined) {
      if (statusCode === '200' || statusCode === 200) return 'success';
      if (statusCode === '201' || statusCode === 201) return 'pending';
      if (statusCode === '400' || statusCode === 400) return 'failed';
    }

    // Then check main status
    if (status === 200) return 'success';
    if (status === 201) return 'pending';
    if (status === 400) return 'failed';

    // Check status description if available
    if (statusDescription) {
      const upperDesc = String(statusDescription).toUpperCase();
      if (upperDesc === "ACCEPTED" || upperDesc === "SUCCESS" || upperDesc.includes('SUCCESS') || upperDesc.includes('ACCEPT')) return 'success';
      if (upperDesc === "PENDING" || upperDesc.includes('PENDING') || upperDesc.includes('WAIT')) return 'pending';
      if (upperDesc === "FAILED" || upperDesc === "DECLINED" || upperDesc.includes('FAIL') || upperDesc.includes('DECLIN') || upperDesc.includes('REJECT') || upperDesc.includes('CANCEL')) return 'failed';
    }

    // Additional check for statusCode as string in another format
    if (typeof statusCode === 'string') {
      const trimmedCode = statusCode.trim();
      if (trimmedCode === '200' || trimmedCode === '0' || trimmedCode === 'OK') return 'success';
      if (trimmedCode === '201') return 'pending';
      if (trimmedCode === '400' || trimmedCode.startsWith('4') || trimmedCode.startsWith('5')) return 'failed';
    }

    // Default to pending if we can't determine
    logger.info('Could not determine status precisely, defaulting to pending', { status, statusCode, statusDescription });
    return 'pending';
  } catch (error) {
    // If any error occurs during status determination, log it and default to pending
    logger.error('Error determining payment status:', {
      error: error.message,
      status,
      statusCode,
      statusDescription
    });
    return 'pending';
  }
}

/**
 * Map MaishaPay status to our payment status
 */
function mapMaishapayStatus(status) {
  // Log incoming status for debugging
  logger.info('Mapping MaishaPay status:', { status, type: typeof status });

  if (typeof status === 'number' || (typeof status === 'string' && !isNaN(status))) {
    // If status is a number or numeric string, check by code
    switch (status.toString()) {
      case '200': return 'success';
      case '201':
      case '202': return 'pending';
      case '400':
      case '500': return 'failed';
      default: return 'pending';
    }
  } else if (typeof status === 'string') {
    // If status is a string, check by status name
    const upperStatus = status.toUpperCase();
    const statusMap = {
      'SUCCESS': 'success',
      'APPROVED': 'success',
      'ACCEPTED': 'success',
      'PENDING': 'pending',
      'DECLINED': 'failed',
      'FAILED': 'failed',
      'CANCELED': 'canceled'
    };

    // Check for exact matches first
    if (statusMap[upperStatus]) return statusMap[upperStatus];

    // Check for partial matches
    if (upperStatus.includes('SUCCESS') || upperStatus.includes('ACCEPT')) return 'success';
    if (upperStatus.includes('PENDING')) return 'pending';
    if (upperStatus.includes('FAIL') || upperStatus.includes('DECLINE') || upperStatus.includes('CANCEL')) return 'failed';
  }

  // Default to pending for unknown status
  return 'pending';
}

/**
 * Initialize a payment (mobile money or card)
 */
const initializePayment = async (req, res) => {
  try {
    const { paymentMethod, useV3 } = req.body;

    // Route to the correct payment handler based on method
    if (paymentMethod === 'card') {
      if (useV3) {
        return await initializeCardPaymentV3(req, res);
      }
      return await initializeCardPayment(req, res);
    } else {
      // Original mobile money payment flow
      return await initializeMobileMoneyPayment(req, res);
    }
  } catch (error) {
    logger.error('Payment initialization error:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

/**
 * Initialize a mobile money payment
 */
const initializeMobileMoneyPayment = async (req, res) => {
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
    const externalId = generateExternalId();
    const formattedPhone = formatPhone(phoneNumber);

    // Mobile money payment payload
    const maishapayPayload = {
      transactionReference,
      gatewayMode: CONFIG.GATEWAY_MODE,
      publicApiKey: CONFIG.PUBLIC_KEY,
      secretApiKey: CONFIG.SECRET_KEY,
      amount: amountCDF,
      currency: "CDF",
      chanel: "MOBILEMONEY",
      provider: paymentMethod.toUpperCase(),
      walletID: formattedPhone,
      callbackUrl: CONFIG.CALLBACK_URL
    };

    logger.info('Initializing mobile money payment with MaishaPay:', {
      transactionReference,
      amount: amountCDF,
      provider: paymentMethod.toUpperCase(),
      callbackUrl: CONFIG.CALLBACK_URL
    });

    // Call MaishaPay API
    const response = await axios.post(
      CONFIG.MAISHAPAY_API_URL,
      maishapayPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('MaishaPay response:', response.data);

    // Determine payment status
    const paymentStatus = getPaymentStatus(
      response.data.status,
      response.data.data?.statusCode,
      response.data.data?.statusDescription
    );
    const transactionId = response.data.data?.transactionId || '';

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
      transactionId,
      externalId,
      status: paymentStatus,
      responseData: response.data,
      lastStatusCheck: new Date()
    });
    await payment.save();

    // Update listing based on payment status
    if (paymentStatus === 'success') {
      // If payment is immediately successful, update listing accordingly
      await updateListingAfterPayment(payment);
    } else {
      // If payment is pending or failed, update listing to reflect that status
      await Listing.findByIdAndUpdate(listingId, {
        paymentStatus: paymentStatus,
        status: 'pending_payment'
      });
    }

    // Return response to frontend
    return res.json({
      success: true,
      data: response.data,
      paymentStatus,
      paymentId: payment._id,
      transactionId
    });
  } catch (error) {
    logger.error('Mobile money payment initialization error:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

/**
 * Initialize a card payment
 */
const initializeCardPayment = async (req, res) => {
  try {
    const { planId, listingId, customerName, customerEmail, customerPhone } = req.body;
    const user = req.user;

    // Validation
    if (!planId || !listingId) {
      return res.status(400).json({ error: 'Missing required fields: planId and listingId are required' });
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
    const externalId = generateExternalId();

    // Get customer info - use listing info if not provided
    const customerFullName = customerName || `${listing.listerFirstName} ${listing.listerLastName}`;
    const customerEmailAddress = customerEmail || listing.listerEmailAddress;
    
    // Format phone number specifically for MaishaPay's requirements
    let customerPhoneNumber = customerPhone || listing.listerPhoneNumber || '';

    // First, clean the number by removing non-digits
    customerPhoneNumber = customerPhoneNumber.replace(/\D/g, '');

    // If it's a 10-digit number without country code (like 9995292930)
    if (customerPhoneNumber.length === 10 || customerPhoneNumber.length === 9) {
      // Add DRC country code
      customerPhoneNumber = '243' + customerPhoneNumber.slice(-9);
    }
    // If it still doesn't have country code
    else if (!customerPhoneNumber.startsWith('243')) {
      customerPhoneNumber = '243' + customerPhoneNumber.slice(-9);
    }

    // Format as +XXXXXXXXXX (international format)
    if (!customerPhoneNumber.startsWith('+')) {
      customerPhoneNumber = '+' + customerPhoneNumber;
    }

    // Log the phone formatting for debugging
    logger.info('Phone formatting:', { 
      original: customerPhone || listing.listerPhoneNumber || '', 
      formatted: customerPhoneNumber 
    });

    // Card payment payload - exactly matching MaishaPay's expected structure
    const maishapayPayload = {
      "transactionReference": transactionReference,
      "gatewayMode": CONFIG.GATEWAY_MODE,
      "publicApiKey": CONFIG.PUBLIC_KEY,
      "secretApiKey": CONFIG.SECRET_KEY,
      "order": {
        "amount": amountCDF.toString(),
        "currency": "CDF",
        "customerFullName": customerFullName,
        "customerPhoneNumber": customerPhoneNumber,
        "customerEmailAdress": customerEmailAddress // Note the typo is in their API
      },
      "paymentChannel": {
        "channel": "CARD",
        "provider": "VISA", // Default to VISA
        "callbackUrl": CONFIG.CALLBACK_URL
      }
    };
    
    logger.info('Initializing card payment with MaishaPay:', {
      apiUrl: CONFIG.MAISHAPAY_CARD_API_URL,
      transactionReference,
      amount: amountCDF,
      phoneNumber: customerPhoneNumber, // Log the phone number for debugging
      callbackUrl: CONFIG.CALLBACK_URL
    });

    // Call MaishaPay Card API
    const response = await axios.post(
      CONFIG.MAISHAPAY_CARD_API_URL,
      maishapayPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('MaishaPay card payment response:', response.data);

    // Card API response handling
    const redirectUrl = response.data.paymentPage || '';
    const paymentStatus = 'pending'; // Card payments typically start as pending
    const transactionId = response.data.transactionId || response.data.originatingTransactionId || transactionReference;
    
    logger.info('Card payment initialized:', {
      redirectUrl,
      transactionId,
      paymentStatus
    });

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
      paymentMethod: 'card',
      phoneNumber: customerPhoneNumber, // Include phone even for card payments (for records)
      transactionId,
      externalId,
      status: paymentStatus,
      responseData: response.data,
      redirectUrl,
      lastStatusCheck: new Date()
    });
    await payment.save();

    // Update listing to pending_payment
    await Listing.findByIdAndUpdate(listingId, {
      paymentStatus: paymentStatus,
      status: 'pending_payment'
    });

    // Return response to frontend
    return res.json({
      success: true,
      data: response.data,
      paymentStatus,
      redirectUrl,
      paymentId: payment._id,
      transactionId
    });
  } catch (error) {
    logger.error('Card payment initialization error:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });
    
    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

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
        logger.info('Development mode: payment and listing updated to success');
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

    // Check if this is a card or mobile money payment
    const isCardPayment = payment.paymentMethod === 'card';

    // In production, check with MaishaPay
    try {
      let response;

      if (isCardPayment) {
        // Card payment status check
        response = await axios.get(
          `${CONFIG.MAISHAPAY_CARD_API_URL}/status/${payment.transactionId}`,
          {
            headers: {
              'Authorization': `Bearer ${CONFIG.SECRET_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
      } else {
        // Mobile money status check
        response = await axios.get(
          `${CONFIG.MAISHAPAY_API_URL}/transaction/status/${payment.transactionId}`,
          {
            headers: {
              'Authorization': `Bearer ${CONFIG.SECRET_KEY}`,
              'Content-Type': 'application/json'
            },
            timeout: 10000
          }
        );
      }

      logger.info('MaishaPay status check response:', response.data);

      // Update payment status
      const oldStatus = payment.status;
      let newStatus;

      if (isCardPayment) {
        // Card payments have a different response format
        newStatus = mapMaishapayStatus(response.data.status || response.data.statusCode);
      } else {
        // Mobile money uses the standard format
        newStatus = response.data.data ? mapMaishapayStatus(response.data.data.status) : oldStatus;
      }

      logger.info('Status update:', {
        oldStatus,
        newStatus,
        paymentMethod: payment.paymentMethod
      });

      payment.status = newStatus;
      payment.responseData = { ...payment.responseData, statusCheck: response.data };
      payment.lastStatusCheck = new Date();
      await payment.save();

      // Activate listing if payment successful
      if (oldStatus !== 'success' && newStatus === 'success') {
        await updateListingAfterPayment(payment);
        logger.info('Listing activated after status check success');
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

      // Even if API check fails, ensure listing is updated if payment is success
      if (payment.status === 'success') {
        try {
          const listing = await Listing.findById(payment.listingId);
          if (listing && (listing.status !== 'available' || listing.paymentStatus !== 'paid')) {
            await updateListingAfterPayment(payment);
            logger.info('Listing updated after API error - payment was already success');
          }
        } catch (updateError) {
          logger.error('Error updating listing after API error:', updateError);
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
 * Initialize a card payment using V3 API
 */
const initializeCardPaymentV3 = async (req, res) => {
  try {
    const { planId, listingId, customerName, customerEmail, customerAddress, customerCity } = req.body;
    const user = req.user;

    // Validation
    if (!planId || !listingId) {
      return res.status(400).json({ error: 'Missing required fields: planId and listingId are required' });
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
    const externalId = generateExternalId();

    // Get customer info - use listing info if not provided
    const nameParts = (customerName || `${listing.listerFirstName} ${listing.listerLastName}`).split(' ');
    const firstName = nameParts[0] || 'Customer';
    const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : 'User';
    const customerEmailAddress = customerEmail || listing.listerEmailAddress;
    const customerPhoneNumber = listing.listerPhoneNumber;
    const address = customerAddress || listing.address || 'Not provided';
    const city = customerCity || listing.ville || 'Kinshasa';

    // Card payment payload - using V3 format
    const maishapayPayload = {
      "transactionReference": transactionReference,
      "gatewayMode": CONFIG.GATEWAY_MODE,
      "publicApiKey": CONFIG.PUBLIC_KEY,
      "secretApiKey": CONFIG.SECRET_KEY,
      "order": {
        "amount": amountCDF.toString(),
        "currency": "CDF",
        "customerFirstname": firstName,
        "customerLastname": lastName,
        "customerAddress": address,
        "customerCity": city,
        "customerPhoneNumber": customerPhoneNumber,
        "customerEmailAdress": customerEmailAddress // Note the typo is in their API
      },
      "paymentChannel": {
        "channel": "CARD",
        "provider": "VISA", // Default to VISA
        "callbackUrl": CONFIG.CALLBACK_URL
      }
    };

    logger.info('Initializing card payment with MaishaPay V3:', {
      apiUrl: CONFIG.MAISHAPAY_CARD_API_URL_V3,
      transactionReference,
      amount: amountCDF,
      callbackUrl: CONFIG.CALLBACK_URL
    });

    // Call MaishaPay Card API V3
    const response = await axios.post(
      CONFIG.MAISHAPAY_CARD_API_URL_V3, // Using config variable instead of hardcoded URL
      maishapayPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    logger.info('MaishaPay card payment V3 response:', response.data);

    // Card API response handling
    const redirectUrl = response.data.paymentPage || '';
    const paymentStatus = 'pending'; // Card payments typically start as pending
    const transactionId = response.data.transactionId || response.data.originatingTransactionId || transactionReference;

    logger.info('Card payment initialized (V3):', {
      redirectUrl,
      transactionId,
      paymentStatus
    });

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
      paymentMethod: 'card',
      phoneNumber: customerPhoneNumber,
      transactionId,
      externalId,
      status: paymentStatus,
      responseData: response.data,
      redirectUrl,
      lastStatusCheck: new Date()
    });
    await payment.save();

    // Update listing to pending_payment
    await Listing.findByIdAndUpdate(listingId, {
      paymentStatus: paymentStatus,
      status: 'pending_payment'
    });

    // Return response to frontend
    return res.json({
      success: true,
      data: response.data,
      paymentStatus,
      redirectUrl,
      paymentId: payment._id,
      transactionId
    });
  } catch (error) {
    logger.error('Card payment V3 initialization error:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: error.response?.data || error.message
    });
  }
};

/**
 * Handle webhook from MaishaPay
 */
const handlePaymentWebhook = async (req, res) => {
  try {
    logger.info('Webhook received:', req.body);

    // Always acknowledge webhook quickly to prevent retries
    res.status(200).json({ success: true });

    // MaishaPay can send different webhook formats
    const transactionId = req.body.transactionId || req.body.data?.transactionId;
    const status = req.body.transactionStatus || req.body.data?.status || req.body.status;
    const statusCode = req.body.statusCode || req.body.data?.statusCode;
    const statusDescription = req.body.statusDescription || req.body.data?.statusDescription;

    // Enhanced logging of received data
    logger.info('Webhook data extracted:', {
      transactionId,
      status,
      statusCode,
      statusDescription,
      rawBody: JSON.stringify(req.body).substring(0, 200) + '...' // Log truncated body for debugging
    });

    if (!transactionId) {
      logger.warn('Webhook missing transaction ID', req.body);
      return; // Already sent 200 OK response
    }

    // Find the payment with expanded search options
    const payment = await Payment.findOne({
      $or: [
        { transactionId },
        { transactionId: String(transactionId) },
        { externalId: transactionId }
      ]
    });

    if (!payment) {
      logger.warn('Payment not found for transaction ID', { transactionId });
      return; // Already sent 200 OK response
    }

    logger.info('Found payment for webhook:', {
      paymentId: payment._id,
      listingId: payment.listingId,
      currentStatus: payment.status
    });

    // Process asynchronously
    try {
      // Update payment status
      const oldStatus = payment.status;
      const newStatus = getPaymentStatus(status, statusCode, statusDescription);

      logger.info('Webhook status update:', {
        oldStatus,
        newStatus,
        webhookStatus: status,
        statusCode,
        statusDescription
      });

      payment.status = newStatus;
      payment.webhookData = req.body;

      // Add timestamp of when this webhook was processed
      payment.lastWebhookUpdate = new Date();

      await payment.save();
      logger.info('Payment status updated via webhook', { newStatus, paymentId: payment._id });

      // Update listing if payment successful
      if (newStatus === 'success') {
        try {
          // Find the listing regardless of oldStatus
          const listing = await Listing.findById(payment.listingId);

          if (!listing) {
            logger.error('Listing not found for successful payment', {
              listingId: payment.listingId,
              paymentId: payment._id
            });
            return;
          }

          // Only update if the listing isn't already active
          if (listing.status !== 'available' || listing.paymentStatus !== 'paid' || !listing.activeSubscription) {
            logger.info('Updating listing from webhook', {
              listingId: listing._id,
              currentStatus: listing.status,
              currentPaymentStatus: listing.paymentStatus
            });

            await updateListingAfterPayment(payment);
            logger.info('Listing activated after webhook success notification', {
              listingId: listing._id,
              newStatus: 'available',
              newPaymentStatus: 'paid'
            });
          } else {
            logger.info('Listing already active, no update needed', {
              listingId: payment.listingId,
              status: listing.status,
              paymentStatus: listing.paymentStatus
            });
          }
        } catch (updateError) {
          logger.error('Error updating listing from webhook:', {
            error: updateError.message,
            stack: updateError.stack,
            listingId: payment.listingId,
            paymentId: payment._id
          });
        }
      } else if (newStatus === 'failed' && oldStatus !== 'failed') {
        // Handle failed payment - update listing to reflect failed payment
        try {
          await Listing.findByIdAndUpdate(
            payment.listingId,
            {
              $set: {
                paymentStatus: 'failed',
                // Don't change listing status - keep as pending_payment
              }
            }
          );
          logger.info('Listing updated to reflect failed payment', {
            listingId: payment.listingId
          });
        } catch (updateError) {
          logger.error('Error updating listing for failed payment:', {
            error: updateError.message,
            listingId: payment.listingId
          });
        }
      }

      logger.info('Webhook processed successfully', {
        transactionId,
        newStatus,
        listingId: payment.listingId
      });
    } catch (err) {
      logger.error('Error processing webhook:', {
        error: err.message,
        stack: err.stack,
        transactionId,
        paymentId: payment?._id
      });
    }
  } catch (error) {
    logger.error('Webhook handler error:', {
      error: error.message,
      stack: error.stack,
      body: typeof req.body === 'object' ? JSON.stringify(req.body).substring(0, 200) : 'Invalid body'
    });
    // Already sent 200 OK response
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

    // Log before update
    logger.info('Updating listing after payment:', {
      listingId: payment.listingId,
      currentStatus: listing.status,
      currentPaymentStatus: listing.paymentStatus
    });

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
    listing.paymentId = payment.transactionId || payment._id.toString();
    listing.subscriptionPlan = payment.planId;
    listing.subscriptionStartDate = currentDate;
    listing.activeSubscription = true;

    await listing.save();

    logger.info('Listing activated after payment:', {
      listingId: listing._id,
      paymentId: payment._id,
      expiryDate,
      newStatus: listing.status,
      newPaymentStatus: listing.paymentStatus
    });

    return listing;
  } catch (error) {
    logger.error('Error updating listing:', {
      error: error.message,
      stack: error.stack,
      listingId: payment.listingId,
      paymentId: payment._id
    });
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
  try {
    const { listingId } = req.params;
    if (!listingId) {
      return res.status(400).json({ error: 'Listing ID is required' });
    }

    const listing = await Listing.findById(listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Create mock payment or use existing payment
    let payment;
    const existingPayment = await Payment.findOne({ listingId });

    if (existingPayment) {
      payment = existingPayment;
      payment.status = 'success';
      await payment.save();
      logger.info('Using existing payment for dev activation:', { paymentId: payment._id });
    } else {
      // Create new payment if none exists
      const externalId = generateExternalId();
      const transactionId = `DEV-${Date.now()}`;

      payment = new Payment({
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
      logger.info('Created new payment for dev activation:', { paymentId: payment._id });
    }

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
    logger.error('Dev activation error:', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to activate listing', details: error.message });
  }
};

/**
* Emergency fix for specific payment/listing
*/
const emergencyFixListing = async (req, res) => {
  try {
    const { paymentId, listingId } = req.params;

    let payment;
    let listing;

    // Find payment if provided
    if (paymentId) {
      payment = await Payment.findOne({
        $or: [
          { transactionId: paymentId },
          { _id: paymentId },
          { externalId: paymentId }
        ]
      });

      if (!payment) {
        return res.status(404).json({ error: 'Payment not found' });
      }

      // Use the payment's listingId if not explicitly provided
      if (!listingId) {
        listing = await Listing.findById(payment.listingId);
      }
    }

    // Find listing if provided or not found from payment
    if (listingId || !listing) {
      listing = await Listing.findById(listingId || payment.listingId);
      if (!listing) {
        return res.status(404).json({ error: 'Listing not found' });
      }
    }

    // If we have a payment, use it; otherwise create a new one
    if (payment) {
      // Force success status
      payment.status = 'success';
      await payment.save();
      logger.info('Emergency fix: Updated payment to success', { paymentId: payment._id });
    } else {
      // Create new payment
      const externalId = generateExternalId();
      const transactionId = `EMERGENCY-${Date.now()}`;

      payment = new Payment({
        userId: listing.createdBy,
        listingId: listing._id,
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
      logger.info('Emergency fix: Created new payment', { paymentId: payment._id });
    }

    // Update listing manually
    await updateListingAfterPayment(payment);
    logger.info('Emergency fix: Listing updated successfully');

    return res.json({
      success: true,
      message: 'Listing fixed successfully',
      listing: await Listing.findById(listing._id)
    });
  } catch (error) {
    logger.error('Emergency fix error:', { error: error.message, stack: error.stack });
    return res.status(500).json({ error: 'Failed to fix listing', details: error.message });
  }
};

/**
* Fix specific transaction ID
*/
const fixSpecificTransaction = async (req, res) => {
  try {
    // Hard-coded fix for transaction 78452
    const payment = await Payment.findOne({ transactionId: "78452" });
    if (!payment) {
      return res.status(404).json({ error: 'Target payment not found' });
    }

    // Force payment to success
    payment.status = 'success';
    await payment.save();

    // Update the listing
    const listing = await Listing.findById(payment.listingId);
    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    await updateListingAfterPayment(payment);

    return res.json({
      success: true,
      message: 'Fixed specific transaction',
      listing: await Listing.findById(payment.listingId)
    });
  } catch (error) {
    logger.error('Specific transaction fix error:', { error: error.message });
    return res.status(500).json({ error: 'Failed to fix specific transaction' });
  }
};

/**
* Test MaishaPay connection
*/
const testMaishapayConnection = async (req, res) => {
  try {
    const testPayload = {
      transactionReference: `TEST-${Date.now()}`,
      gatewayMode: CONFIG.GATEWAY_MODE,
      publicApiKey: CONFIG.PUBLIC_KEY,
      secretApiKey: CONFIG.SECRET_KEY,
      amount: 100,
      currency: "CDF",
      chanel: "MOBILEMONEY",
      provider: "MPESA",
      walletID: "+243810000000"
    };

    const response = await axios.post(
      CONFIG.MAISHAPAY_API_URL,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      success: true,
      maishapayStatus: 'Connected',
      response: response.data
    });
  } catch (error) {
    logger.error('MaishaPay connection test error:', {
      error: error.message,
      response: error.response?.data
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
};

/**
 * Test card payment connection
 */
const testCardPaymentConnection = async (req, res) => {
  try {
    // This payload structure must exactly match what MaishaPay expects
    const testPayload = {
      "transactionReference": `TEST-CARD-${Date.now()}`,
      "gatewayMode": CONFIG.GATEWAY_MODE,
      "publicApiKey": CONFIG.PUBLIC_KEY,
      "secretApiKey": CONFIG.SECRET_KEY,
      "order": {
        "amount": "100",
        "currency": "CDF",
        "customerFullName": "Test User",
        "customerPhoneNumber": "+243810000000",
        "customerEmailAdress": "test@example.com" // Note the typo is in their API
      },
      "paymentChannel": {
        "channel": "CARD",
        "provider": "VISA",
        "callbackUrl": CONFIG.CALLBACK_URL
      }
    };

    const response = await axios.post(
      CONFIG.MAISHAPAY_CARD_API_URL,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      success: true,
      cardPaymentStatus: 'Connected',
      response: response.data,
      redirectUrl: response.data.paymentPage || response.data.redirectUrl
    });
  } catch (error) {
    logger.error('Card payment test error:', {
      error: error.message,
      response: error.response?.data
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
};

/**
 * Test card payment v3 connection
 */
const testCardPaymentV3Connection = async (req, res) => {
  try {
    const testPayload = {
      "transactionReference": `TEST-CARD-V3-${Date.now()}`,
      "gatewayMode": CONFIG.GATEWAY_MODE,
      "publicApiKey": CONFIG.PUBLIC_KEY,
      "secretApiKey": CONFIG.SECRET_KEY,
      "order": {
        "amount": "100",
        "currency": "CDF",
        "customerFirstname": "Test",
        "customerLastname": "User",
        "customerAddress": "123 Test St",
        "customerCity": "Kinshasa",
        "customerPhoneNumber": "+243810000000",
        "customerEmailAdress": "test@example.com"
      },
      "paymentChannel": {
        "channel": "CARD",
        "provider": "VISA",
        "callbackUrl": CONFIG.CALLBACK_URL
      }
    };

    const response = await axios.post(
      CONFIG.MAISHAPAY_CARD_API_URL_V3,
      testPayload,
      {
        headers: {
          'Content-Type': 'application/json'
        }
      }
    );

    return res.json({
      success: true,
      cardPaymentV3Status: 'Connected',
      response: response.data,
      redirectUrl: response.data.paymentPage || response.data.redirectUrl
    });
  } catch (error) {
    logger.error('Card payment V3 test error:', {
      error: error.message,
      response: error.response?.data,
      stack: error.stack
    });

    return res.status(500).json({
      success: false,
      error: error.message,
      details: error.response?.data || 'No additional details'
    });
  }
};

module.exports = {
  initializePayment,
  initializeMobileMoneyPayment,
  initializeCardPayment,
  checkPaymentStatus,
  handlePaymentWebhook,
  getPaymentHistory,
  getSubscriptionPlans,
  devActivateListing,
  emergencyFixListing,
  fixSpecificTransaction,
  updateListingAfterPayment,
  testMaishapayConnection,
  testCardPaymentConnection,
  testCardPaymentV3Connection,
  initializeCardPaymentV3
};