const mongoose = require('mongoose');

const paymentSchema = new mongoose.Schema({
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  listingId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'Listing',
    required: true
  },
  planId: {
    type: String,
    required: true,
    enum: ['1_month', '2_months', '3_months', '6_months', '12_months']
  },
  duration: {
    type: Number,
    required: true
  },
  amountUSD: {
    type: Number,
    required: true
  },
  amountCDF: {
    type: Number,
    required: true
  },
  amount: {
    type: Number,
    required: true
  },
  currency: {
    type: String,
    required: true,
    enum: ['USD', 'CDF']
  },
  paymentMethod: {
    type: String,
    required: true,
    enum: ['orange', 'airtel', 'mpesa', 'card']
  },
  phoneNumber: {
    type: String,
    required: true
  },
  transactionId: {
    type: String
  },
  externalId: {
    type: String,
    required: true,
    unique: true
  },
  status: {
    type: String,
    required: true,
    enum: ['pending', 'success', 'failed', 'canceled'],
    default: 'pending'
  },
  responseData: {
    type: Object
  },
  webhookData: {
    type: Object
  }
}, { 
  timestamps: true 
});

// Index for faster queries
paymentSchema.index({ userId: 1, createdAt: -1 });
paymentSchema.index({ listingId: 1 });
paymentSchema.index({ transactionId: 1 });
paymentSchema.index({ externalId: 1 });
paymentSchema.index({ status: 1 });

// Add a virtual property to check if payment is successful
paymentSchema.virtual('isSuccessful').get(function() {
  return this.status === 'success';
});

// Add a method to update the payment status
paymentSchema.methods.updateStatus = async function(status, webhookData = null) {
  this.status = status;
  
  if (webhookData) {
    this.webhookData = webhookData;
  }
  
  return this.save();
};

module.exports = mongoose.model('Payment', paymentSchema);
