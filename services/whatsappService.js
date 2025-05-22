const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const path = require('path');

class WhatsAppService {
  constructor() {
    this.client = null;
    this.isReady = false;
    this.isInitializing = false;
    this.retryCount = 0;
    this.maxRetries = 3;
  }

  async initialize() {
    if (this.isInitializing || this.isReady) {
      return;
    }

    this.isInitializing = true;

    try {
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: path.join(__dirname, '../whatsapp_auth')
        }),
        puppeteer: {
          headless: true,
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--single-process',
            '--disable-gpu'
          ]
        }
      });

      this.setupEventHandlers();
      await this.client.initialize();

    } catch (error) {
      console.error('WhatsApp initialization error:', error);
      this.isInitializing = false;
      
      if (this.retryCount < this.maxRetries) {
        this.retryCount++;
        console.log(`Retrying WhatsApp initialization (${this.retryCount}/${this.maxRetries})...`);
        setTimeout(() => this.initialize(), 5000);
      }
    }
  }

  setupEventHandlers() {
    this.client.on('qr', (qr) => {
      console.log('\n=== WhatsApp QR Code ===');
      console.log('Scan this QR code with your WhatsApp:');
      qrcode.generate(qr, { small: true });
      console.log('========================\n');
    });

    this.client.on('ready', () => {
      console.log('✅ WhatsApp client is ready!');
      this.isReady = true;
      this.isInitializing = false;
      this.retryCount = 0;
    });

    this.client.on('authenticated', () => {
      console.log('✅ WhatsApp authenticated successfully');
    });

    this.client.on('auth_failure', (msg) => {
      console.error('❌ WhatsApp authentication failed:', msg);
      this.isReady = false;
      this.isInitializing = false;
    });

    this.client.on('disconnected', (reason) => {
      console.log('❌ WhatsApp client disconnected:', reason);
      this.isReady = false;
      this.isInitializing = false;
      
      // Auto-reconnect after 10 seconds
      setTimeout(() => {
        if (!this.isReady && !this.isInitializing) {
          console.log('🔄 Attempting to reconnect WhatsApp...');
          this.initialize();
        }
      }, 10000);
    });

    this.client.on('message', async (message) => {
      // You can handle incoming messages here if needed
      // For example, auto-reply to verification confirmations
    });
  }

  formatPhoneNumber(phoneNumber) {
    // Remove + and add @c.us for WhatsApp format
    const cleanNumber = phoneNumber.replace(/\D/g, '');
    return cleanNumber + '@c.us';
  }

  async sendMessage(phoneNumber, message) {
    if (!this.isReady) {
      throw new Error('WhatsApp client is not ready');
    }

    try {
      const formattedNumber = this.formatPhoneNumber(phoneNumber);
      
      // Check if number is registered on WhatsApp
      const isRegistered = await this.client.isRegisteredUser(formattedNumber);
      if (!isRegistered) {
        throw new Error('Phone number is not registered on WhatsApp');
      }

      await this.client.sendMessage(formattedNumber, message);
      console.log(`✅ WhatsApp message sent to ${phoneNumber}`);
      
      return { success: true };
    } catch (error) {
      console.error(`❌ Error sending WhatsApp message to ${phoneNumber}:`, error);
      throw error;
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

  getStatus() {
    return {
      isReady: this.isReady,
      isInitializing: this.isInitializing,
      retryCount: this.retryCount
    };
  }

  async destroy() {
    if (this.client) {
      await this.client.destroy();
      this.isReady = false;
      this.isInitializing = false;
    }
  }
}

// Create singleton instance
const whatsappService = new WhatsAppService();

module.exports = whatsappService;