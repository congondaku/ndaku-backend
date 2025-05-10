const mongoose = require('mongoose');

const listingSchema = new mongoose.Schema({
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
  typeOfListing: { 
    type: String,
    enum: ['apartment', 'house', 'condo'],
    required: [true, 'Listing type is required']
  },
  listingType: { 
    type: String,
    enum: ['sale', 'rent', 'daily'],
    required: [true, 'Listing duration type is required']
  },
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
  details: {
    floor: { type: Number, default: 0, min: 0 },
    bedroom: { type: Number, default: 0, min: 0 },
    bathroom: { type: Number, default: 0, min: 0 },
    kitchen: { type: Number, default: 0, min: 0 },
    dinningRoom: { type: Number, default: 0, min: 0 }
  },
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
  images: { 
    type: [String], 
    required: [true, 'At least one image is required'],
    validate: [array => array.length > 0, 'At least one image is required']
  },
  expiryDate: {
    type: Date,
    default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000) // 3 months
  },
  isDeleted: { 
    type: Boolean, 
    default: false 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

// Modified pre-save hook to clean up price fields
listingSchema.pre('save', function(next) {
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
  next();
});

// Indexes
listingSchema.index({ commune: 1 });
listingSchema.index({ typeOfListing: 1 });
listingSchema.index({ priceMonthly: 1 });
listingSchema.index({ priceSale: 1 });
listingSchema.index({ createdBy: 1 });
listingSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('Listing', listingSchema);