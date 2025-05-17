const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
  // Basic listing information
  listerFirstName: { 
    type: String, 
    required: [true, 'First name is required'],
    trim: true
  },
  listerLastName: { 
    type: String, 
    required: [true, 'Last name is required'],
    trim: true
  },
  listerEmailAddress: { 
    type: String, 
    required: [true, 'Email is required'],
    match: [/^\S+@\S+\.\S+$/, 'Please use a valid email address'],
    trim: true,
    lowercase: true
  },
  listerPhoneNumber: { 
    type: String, 
    required: [true, 'Phone number is required'],
    trim: true
  },
  listerProfileImage: {
    type: String,
    default: null
  },
  
  // Property type and listing type
  typeOfListing: { 
    type: String,
    enum: ['apartment', 'house', 'condo', 'office', 'land', 'studio', 'other'],
    required: [true, 'Property type is required']
  },
  listingType: { 
    type: String,
    enum: ['sale', 'rent', 'daily'],
    required: [true, 'Listing duration type is required']
  },
  
  // Pricing
  priceMonthly: { 
    type: Number, 
    min: 0,
    required: function() { return this.listingType === 'rent'; }
  },
  priceDaily: { 
    type: Number, 
    min: 0,
    required: function() { return this.listingType === 'daily'; }
  },
  priceSale: { 
    type: Number, 
    min: 0,
    required: function() { return this.listingType === 'sale'; }
  },
  currency: {
    type: String,
    enum: ['USD', 'CDF'],
    default: 'USD'
  },
  negotiable: {
    type: Boolean,
    default: false
  },
  
  details: {
    floor: { type: Number, default: 0, min: 0 },
    bedroom: { type: Number, default: 0, min: 0 },
    bathroom: { type: Number, default: 0, min: 0 },
    kitchen: { type: Number, default: 0, min: 0 },
    dinningRoom: { type: Number, default: 0, min: 0 },
    livingRoom: { type: Number, default: 1, min: 0 },
    parking: { type: Number, default: 0, min: 0 },
    area: { type: Number, min: 0 },
    garden: { type: Boolean, default: false },
    furnished: { type: Boolean, default: false },
    yearBuilt: { type: Number },
    wifi: { type: Boolean, default: false },
    airConditioner: { type: Boolean, default: false },
    security: { type: Boolean, default: false },
    solarPower: { type: Boolean, default: false },
    waterTank: { type: Boolean, default: false },
    generator: { type: Boolean, default: false },
    swimming: { type: Boolean, default: false },
    accessForDisabled: { type: Boolean, default: false }
  },
  
  // Enhanced location information
  address: { 
    type: String, 
    required: [true, 'Address is required'],
    trim: true
  },
  quartier: { 
    type: String, 
    required: [true, 'Quartier is required'],
    trim: true
  },
  commune: { 
    type: String, 
    required: [true, 'Commune is required'],
    trim: true
  },
  district: { 
    type: String, 
    required: [true, 'District is required'],
    trim: true
  },
  ville: { 
    type: String, 
    required: [true, 'City is required'],
    trim: true
  },

  // Media content
  images: { 
    type: [String], 
    required: [true, 'At least one image is required'],
    validate: [array => array.length > 0, 'At least one image is required']
  },
  
  // Additional listing content
  title: {
    type: String,
    trim: true,
    maxlength: [100, 'Title cannot be more than 100 characters']
  },
  description: {
    type: String,
    trim: true
  },
  features: {
    type: [String],
    default: []
  },
  nearbyAmenities: {
    type: [String],
    default: []
  },
  
  // Listing status and visibility
  isDeleted: { 
    type: Boolean, 
    default: false 
  },
  isFeatured: {
    type: Boolean,
    default: false
  },
  status: {
    type: String,
    enum: ['available', 'pending', 'pending_payment', 'sold', 'rented'],
    default: 'pending_payment'
  },
  visibility: {
    type: String,
    enum: ['public', 'private', 'unlisted'],
    default: 'public'
  },
  
  // Payment and subscription info
  paymentId: {
    type: String,
    default: null
  },
  paymentStatus: {
    type: String,
    enum: ['unpaid', 'pending', 'paid', 'failed', 'expired'],
    default: 'unpaid'
  },
  subscriptionPlan: {
    type: String,
    enum: ['1_month', '2_months', '3_months', '6_months', '12_months'],
    default: null
  },
  subscriptionStartDate: {
    type: Date,
    default: null
  },
  
  // Time-based fields
  expiryDate: {
    type: Date,
    default: null
  },
  availableFrom: {
    type: Date,
    default: Date.now
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  },
  tags: {
    type: [String],
    default: []
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Improved pre-save hook to clean up price fields
listingSchema.pre('save', function(next) {
  // Handle pricing fields based on listing type
  if (this.listingType === 'rent') {
    this.priceDaily = undefined;
    this.priceSale = undefined;
  } else if (this.listingType === 'daily') {
    this.priceMonthly = undefined;
    this.priceSale = undefined;
  } else if (this.listingType === 'sale') {
    this.priceMonthly = undefined;
    this.priceDaily = undefined;
  }
  
  // Auto-generate tags if none provided
  if (!this.tags || this.tags.length === 0) {
    const tags = [
      this.typeOfListing,
      this.listingType,
      this.commune,
      this.ville,
      `${this.details?.bedroom || 0}-bedroom`
    ];
    
    // Add feature-based tags
    if (this.details?.garden) tags.push('garden');
    if (this.details?.furnished) tags.push('furnished');
    if (this.details?.swimming) tags.push('swimming-pool');
    if (this.details?.wifi) tags.push('wifi');
    if (this.details?.airConditioner) tags.push('air-conditioning');
    if (this.details?.security) tags.push('security-system');
    
    this.tags = tags.filter(tag => tag); // Filter out any undefined or empty values
  }
  
  // Auto-generate title if not provided
  if (!this.title) {
    const propertyType = this.typeOfListing.charAt(0).toUpperCase() + this.typeOfListing.slice(1);
    const bedrooms = this.details?.bedroom || 0;
    const location = this.commune;
    
    if (this.listingType === 'rent') {
      this.title = `${bedrooms}-Bedroom ${propertyType} for Rent in ${location}`;
    } else if (this.listingType === 'sale') {
      this.title = `${bedrooms}-Bedroom ${propertyType} for Sale in ${location}`;
    } else if (this.listingType === 'daily') {
      this.title = `${bedrooms}-Bedroom ${propertyType} for Daily Rental in ${location}`;
    }
  }
  
  next();
});

// Virtual for calculating days until expiry
listingSchema.virtual('daysUntilExpiry').get(function() {
  if (!this.expiryDate) return 0;
  
  const now = new Date();
  const expiryDate = new Date(this.expiryDate);
  const diffTime = expiryDate - now;
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
  
  return diffDays > 0 ? diffDays : 0;
});

// Virtual for full name
listingSchema.virtual('listerFullName').get(function() {
  return `${this.listerFirstName} ${this.listerLastName}`;
});

// Method to renew listing expiry date
listingSchema.methods.renewListing = function(daysToAdd = 90) {
  const currentExpiry = this.expiryDate ? new Date(this.expiryDate) : new Date();
  this.expiryDate = new Date(currentExpiry.getTime() + daysToAdd * 24 * 60 * 60 * 1000);
  return this.save();
};

// Method to mark listing as sold/rented
listingSchema.methods.markAsSold = function() {
  this.status = this.listingType === 'sale' ? 'sold' : 'rented';
  return this.save();
};

// Static method to update listing after payment
listingSchema.statics.updateAfterPayment = async function(listingId, planId, durationMonths) {
  const listing = await this.findById(listingId);
  if (!listing) throw new Error('Listing not found');
  
  // Calculate expiry date based on subscription plan
  const currentDate = new Date();
  const expiryDate = new Date(currentDate);
  expiryDate.setMonth(currentDate.getMonth() + durationMonths);
  
  // Update listing fields
  listing.status = 'available';
  listing.isDeleted = false;
  listing.expiryDate = expiryDate;
  listing.paymentStatus = 'paid';
  listing.subscriptionPlan = planId;
  listing.subscriptionStartDate = currentDate;
  
  return listing.save();
};

// Indexes for better query performance
listingSchema.index({ commune: 1, typeOfListing: 1 });
listingSchema.index({ ville: 1 });
listingSchema.index({ priceMonthly: 1 });
listingSchema.index({ priceSale: 1 });
listingSchema.index({ priceDaily: 1 });
listingSchema.index({ createdBy: 1 });
listingSchema.index({ isDeleted: 1, status: 1 });
listingSchema.index({ 'details.bedroom': 1 });
listingSchema.index({ isFeatured: 1 });
listingSchema.index({ expiryDate: 1 });
listingSchema.index({ paymentStatus: 1 });
listingSchema.index({ subscriptionPlan: 1 });
listingSchema.index({ createdAt: -1 });
listingSchema.index({ updatedAt: -1 });

// Text index for search functionality
listingSchema.index({
  title: 'text',
  description: 'text',
  address: 'text',
  commune: 'text',
  quartier: 'text',
  ville: 'text'
});

module.exports = mongoose.model('Listing', listingSchema);
