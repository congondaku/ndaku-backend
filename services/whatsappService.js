// services/whatsappService.js - Improved version with better error handling
const twilio = require('twilio');
const winston = require('winston');

class WhatsAppService {
  constructor() {
    this.accountSid = process.env.TWILIO_ACCOUNT_SID;
    this.authToken = process.env.TWILIO_AUTH_TOKEN;
    this.whatsappNumber = process.env.TWILIO_WHATSAPP_NUMBER || '+14144049642';
    
    this.isReady = false;
    this.isInitializing = false;
    this.retryCount = 0;
    this.lastError = null;
    
    if (this.accountSid && this.authToken) {
      this.initialize();
    } else {
      console.log('❌ Twilio WhatsApp service not configured - missing credentials');
      console.log('Required: TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN');
    }
  }

  async initialize() {
    this.isInitializing = true;
    console.log('🔄 Initializing Twilio WhatsApp service...');
    
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
      
      console.log('✅ Twilio WhatsApp service initialized successfully');
      console.log(`📱 Using WhatsApp number: ${this.whatsappNumber}`);
      
    } catch (error) {
      this.isReady = false;
      this.isInitializing = false;
      this.lastError = error;
      this.retryCount++;
      
      console.error('❌ Failed to initialize Twilio WhatsApp service:', error.message);
      
      // Provide specific troubleshooting based on error
      if (error.code === 20003) {
        console.log('🔧 Troubleshooting: Invalid Twilio credentials');
        console.log('1. Verify TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in your .env file');
        console.log('2. Check if your Twilio account is active');
        console.log('3. Regenerate Auth Token if necessary');
      }
      
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
      whatsappNumber: this.whatsappNumber
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

  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      const statusMessage = this.lastError 
        ? `Twilio service error: ${this.lastError.message}`
        : 'Twilio WhatsApp service not ready';
      throw new Error(statusMessage);
    }

    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Validate phone number format
      if (!/^\+[1-9]\d{1,14}$/.test(formattedNumber)) {
        throw new Error('Invalid phone number format');
      }
      
      winston.info('Sending WhatsApp message', {
        to: formattedNumber.substring(0, 7) + '***',
        from: this.whatsappNumber
      });
      
      const result = await this.client.messages.create({
        body: message,
        from: this.whatsappNumber,
        to: `whatsapp:${formattedNumber}`
      });

      winston.info('WhatsApp message sent successfully', {
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
      winston.error('Error sending WhatsApp message', {
        error: error.message,
        code: error.code,
        to: phoneNumber.substring(0, 7) + '***'
      });
      
      // Map Twilio errors to user-friendly messages
      const errorMap = {
        20003: 'Twilio authentication failed - check credentials',
        21211: 'Invalid phone number format',
        21608: 'Phone number not verified in WhatsApp sandbox. Please join sandbox first.',
        63016: 'Phone number is not registered on WhatsApp',
        21606: 'WhatsApp message template not approved',
        21610: 'Message cannot be sent to this number',
        30008: 'Unknown error occurred',
        // Rate limiting
        20429: 'Too many requests - rate limited'
      };
      
      const userMessage = errorMap[error.code] || `WhatsApp service error: ${error.message}`;
      
      // For authentication errors, mark service as not ready
      if (error.code === 20003) {
        this.isReady = false;
        this.lastError = error;
      }
      
      throw new Error(userMessage);
    }
  }

  async sendVerificationCode(phoneNumber, code) {
    const message = `🔐 *Code de vérification Ndaku*

Votre code de vérification est: *${code}*

Ce code expire dans 5 minutes.
⚠️ Ne partagez ce code avec personne.

---
Ndaku - Plateforme de location sécurisée`;

    return await this.sendMessage(phoneNumber, message);
  }

  // Test method to check if service is working
  async testConnection() {
    if (!this.client) {
      throw new Error('Twilio client not initialized');
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
    console.log('✅ Twilio WhatsApp service destroyed');
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;
