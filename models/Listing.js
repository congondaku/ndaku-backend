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
    enum: {
      values: ['apartment', 'house', 'condo'],
      message: '{VALUE} is not a valid listing type'
    },
    required: [true, 'Listing type is required']
  },
  listingType: { 
    type: String,
    enum: {
      values: ['sale', 'rent', 'daily'],
      message: '{VALUE} is not a valid listing type'
    },
    required: [true, 'Listing duration type is required']
  },
  priceMonthly: { 
    type: Number, 
    min: [0, 'Price cannot be negative'],
    required: function() {
      return this.listingType === 'rent';
    }
  },
  priceDaily: { 
    type: Number, 
    min: [0, 'Price cannot be negative'],
    required: function() {
      return this.listingType === 'daily';
    }
  },
  priceSale: { 
    type: Number, 
    min: [0, 'Price cannot be negative'],
    required: function() {
      return this.listingType === 'sale';
    }
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
    trim: true,
    unique: true
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
    validate: {
      validator: function(images) {
        return images.length > 0;
      },
      message: 'At least one image is required'
    }
  },
  expiryDate: {
    type: Date,
    default: () => {
      const now = new Date();
      now.setMonth(now.getMonth() + 3);
      return now;
    }
  },
  isDeleted: { 
    type: Boolean, 
    default: false 
  },
  createdBy: { 
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: [true, 'Creator ID is required']
  }
}, { 
  timestamps: true,
  toJSON: { virtuals: true },
  toObject: { virtuals: true }
});

listingSchema.pre('validate', function(next) {
  if (this.listingType === 'rent' && (this.priceDaily || this.priceSale)) {
    this.invalidate('priceDaily', 'Only priceMonthly should be set for rent listings');
    this.invalidate('priceSale', 'Only priceMonthly should be set for rent listings');
  } else if (this.listingType === 'daily' && (this.priceMonthly || this.priceSale)) {
    this.invalidate('priceMonthly', 'Only priceDaily should be set for daily listings');
    this.invalidate('priceSale', 'Only priceDaily should be set for daily listings');
  } else if (this.listingType === 'sale' && (this.priceMonthly || this.priceDaily)) {
    this.invalidate('priceMonthly', 'Only priceSale should be set for sale listings');
    this.invalidate('priceDaily', 'Only priceSale should be set for sale listings');
  }
  next();
});

listingSchema.index({ commune: 1 });
listingSchema.index({ typeOfListing: 1 });
listingSchema.index({ priceMonthly: 1 });
listingSchema.index({ priceSale: 1 });
listingSchema.index({ createdBy: 1 });
listingSchema.index({ isDeleted: 1 });

module.exports = mongoose.model('Listing', listingSchema);