const mongoose = require('mongoose');

const phoneVerificationSchema = new mongoose.Schema({
  phoneNumber: {
    type: String,
    required: true,
    unique: true,
    index: true
  },
  verificationCode: {
    type: String,
    required: true
  },
  attempts: {
    type: Number,
    default: 0,
    max: 5
  },
  isVerified: {
    type: Boolean,
    default: false
  },
  createdAt: {
    type: Date,
    default: Date.now,
    expires: 300 // Expires after 5 minutes
  },
  lastAttemptAt: {
    type: Date,
    default: Date.now
  },
  blockedUntil: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Index for automatic cleanup
phoneVerificationSchema.index({ createdAt: 1 }, { expireAfterSeconds: 300 });

// Methods
phoneVerificationSchema.methods.isBlocked = function() {
  return this.blockedUntil && this.blockedUntil > new Date();
};

phoneVerificationSchema.methods.incrementAttempts = function() {
  this.attempts += 1;
  this.lastAttemptAt = new Date();
  
  if (this.attempts >= 5) {
    this.blockedUntil = new Date(Date.now() + 60 * 60 * 1000); // Block for 1 hour
  }
  
  return this.save();
};

phoneVerificationSchema.methods.markAsVerified = function() {
  this.isVerified = true;
  return this.save();
};

// Static methods
phoneVerificationSchema.statics.findByPhone = function(phoneNumber) {
  return this.findOne({ phoneNumber });
};

phoneVerificationSchema.statics.createVerification = function(phoneNumber, code) {
  return this.findOneAndUpdate(
    { phoneNumber },
    {
      phoneNumber,
      verificationCode: code,
      attempts: 0,
      isVerified: false,
      createdAt: new Date(),
      lastAttemptAt: new Date(),
      blockedUntil: null
    },
    { 
      upsert: true, 
      new: true,
      setDefaultsOnInsert: true
    }
  );
};

module.exports = mongoose.model('PhoneVerification', phoneVerificationSchema);
