const twilio = require('twilio');
const winston = require('winston');

class SMSService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.phoneNumber = process.env.TWILIO_PHONE_NUMBER || '+14144049642'; // Your Twilio number
    
    this.isReady = false;
    this.isInitializing = false;
    this.retryCount = 0;
    this.lastError = null;
    
    if (this.accountSid && this.authToken) {
      this.initialize();
    } else {
      console.log('❌ SMS service not configured - missing credentials');
      console.log('Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN');
    }
  }

  async initialize() {
    this.isInitializing = true;
    console.log('🔄 Initializing SMS service...');
    
    try {
      this.client = twilio(this.accountSid, this.authToken);
      
      // Test credentials by fetching account info
      const account = await this.client.api.accounts(this.accountSid).fetch();
      
      if (account.status !== 'active') {
        throw new Error(`Twilio account status is '${account.status}', expected 'active'`);
      }
      
      this.isReady = true;
      this.isInitializing = false;
      this.lastError = null;
      
      console.log('✅ SMS service initialized successfully');
      console.log(`📱 Using phone number: ${this.phoneNumber}`);
      
    } catch (error) {
      this.isReady = false;
      this.isInitializing = false;
      this.lastError = error;
      this.retryCount++;
      
      console.error('❌ Failed to initialize SMS service:', error.message);
      throw error;
    }
  }

  getStatus() {
    return {
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      retryCount: this.retryCount,
      lastError: this.lastError ? {
        code: this.lastError.code,
        message: this.lastError.message
      } : null,
      phoneNumber: this.phoneNumber
    };
  }

  formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters except +
    let cleaned = phoneNumber.replace(/[^\d+]/g, '');
    
    // Ensure it starts with +
    if (!cleaned.startsWith('+')) {
      cleaned = '+' + cleaned;
    }
    
    return cleaned;
  }

  async sendSMS(phoneNumber, message) {
    if (!this.isReady) {
      const statusMessage = this.lastError 
        ? `SMS service error: ${this.lastError.message}`
        : 'SMS service not ready';
      throw new Error(statusMessage);
    }

    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Validate phone number format
      if (!/^\+[1-9]\d{1,14}$/.test(formattedNumber)) {
        throw new Error('Invalid phone number format');
      }
      
      winston.info('Sending SMS', {
        to: formattedNumber.substring(0, 7) + '***',
        from: this.phoneNumber
      });
      
      const result = await this.client.messages.create({
        body: message,
        from: this.phoneNumber,
        to: formattedNumber
      });

      winston.info('SMS sent successfully', {
        sid: result.sid,
        status: result.status,
        to: formattedNumber.substring(0, 7) + '***'
      });
      
      return { 
        success: true, 
        sid: result.sid,
        status: result.status
      };
      
    } catch (error) {
      winston.error('Error sending SMS', {
        error: error.message,
        code: error.code,
        to: phoneNumber.substring(0, 7) + '***'
      });
      
      // Map Twilio errors to user-friendly messages
      const errorMap = {
        20003: 'SMS authentication failed - check credentials',
        21211: 'Invalid phone number format',
        21614: 'Phone number is not a valid mobile number',
        21408: 'Permission to send an SMS has not been enabled',
        30008: 'Unknown error occurred',
        20429: 'Too many requests - rate limited',
        21610: 'The message cannot be sent to this number'
      };
      
      const userMessage = errorMap[error.code] || `SMS service error: ${error.message}`;
      
      // For authentication errors, mark service as not ready
      if (error.code === 20003) {
        this.isReady = false;
        this.lastError = error;
      }
      
      throw new Error(userMessage);
    }
  }

  async sendVerificationCode(phoneNumber, code) {
    const message = `🔐 Code de vérification Ndaku

Votre code de vérification est: ${code}

Ce code expire dans 5 minutes.
Ne partagez ce code avec personne.

Ndaku - Plateforme de location sécurisée`;

    return await this.sendSMS(phoneNumber, message);
  }

  // Test method to check if service is working
  async testConnection() {
    if (!this.client) {
      throw new Error('SMS client not initialized');
    }
    
    try {
      const account = await this.client.api.accounts(this.accountSid).fetch();
      return {
        success: true,
        accountStatus: account.status,
        accountSid: account.sid
      };
    } catch (error) {
      throw new Error(`Connection test failed: ${error.message}`);
    }
  }

  async destroy() {
    this.isReady = false;
    this.client = null;
    console.log('✅ SMS service destroyed');
  }
}

// Create singleton instance
const smsService = new SMSService();

module.exports = smsService;