const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const listingController = require('../controllers/listing-controller');
const locationData = require('../utils/locationData');
const villesData = require('../utils/villesData');
const multer = require('multer');
const { storage } = require('../config/cloudinary');
const Listing = require('../models/Listing');

/**
 * Configure multer for file uploads
 */
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) {
      cb(null, true);
    } else {
      cb(new Error('Only image files are allowed!'), false);
    }
  }
});

/**
 * Middleware to handle multer errors
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE' 
        ? 'File too large (max 10MB)' 
        : `Upload error: ${err.message}`
    });
  } else if (err) {
    return res.status(400).json({
      success: false,
      message: err.message || 'Invalid file type'
    });
  }
  next();
};

/**
 * Middleware for request logging
 */
const logRequest = (req, res, next) => {
  console.log('Listing API Request:', {
    method: req.method,
    path: req.path,
    user: req.user?._id,
    filesCount: req.files?.length,
    params: req.params,
    body: {
      ...req.body,
      images: req.files ? `(${req.files.length} files)` : undefined
    }
  });
  next();
};

/**
 * Middleware to process listing form data
 */
const processListingData = (req, res, next) => {
  try {
    req.body.createdBy = req.user._id;

    if (typeof req.body.details === 'string') {
      req.body.details = JSON.parse(req.body.details);
    }

    const { listingType, price } = req.body;
    if (listingType === 'rent') req.body.priceMonthly = parseFloat(price) || 0;
    else if (listingType === 'daily') req.body.priceDaily = parseFloat(price) || 0;
    else if (listingType === 'sale') req.body.priceSale = parseFloat(price) || 0;

    next();
  } catch (err) {
    return res.status(400).json({ 
      success: false,
      message: 'Error processing form data: ' + err.message 
    });
  }
};

// =================== PUBLIC ROUTES ===================

// Get all published listings with filters
router.get('/', listingController.getAllListings);

// Get location data
router.get('/locations/villes', (req, res) => {
  try {
    return res.status(200).json(villesData);
  } catch (err) {
    console.error('Error retrieving cities data:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while retrieving cities data'
    });
  }
});

// Get city-specific location data
router.get('/locations/:cityName', (req, res) => {
  try {
    const { cityName } = req.params;
    const cityData = locationData[cityName];
    
    if (!cityData) {
      return res.status(404).json({
        success: false,
        message: `No data found for city: ${cityName}`
      });
    }
    
    return res.status(200).json(cityData);
  } catch (err) {
    console.error('Error retrieving location data:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while retrieving location data'
    });
  }
});

// Get single listing
router.get('/:id', listingController.getListing);

// =================== AUTHENTICATED ROUTES ===================
router.use(authenticate); // All routes after this require authentication

// Get current user's listings
router.get('/user/current', listingController.getMyListings);

// Create new listing
router.post(
  '/add',
  logRequest,
  upload.array('images', 10),
  handleMulterError,
  processListingData,
  listingController.addListing
);

// Update existing listing
router.put(
  '/update/:id',
  logRequest,
  upload.array('images', 10),
  handleMulterError,
  listingController.updateListing
);

// Update listing status (published/unpublished)
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { isDeleted } = req.body;
    
    if (typeof isDeleted !== 'boolean') {
      return res.status(400).json({
        success: false,
        message: 'isDeleted must be a boolean value'
      });
    }
    
    const listing = await Listing.findById(id);
    
    if (!listing) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }
    
    if (listing.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        message: 'Unauthorized: You can only update your own listings'
      });
    }
    
    listing.isDeleted = isDeleted;
    await listing.save();
    
    return res.status(200).json({
      success: true,
      message: isDeleted ? 'Listing unpublished successfully' : 'Listing published successfully',
      listing
    });
  } catch (err) {
    console.error('Error updating listing status:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating listing status'
    });
  }
});

// Alternative status toggle endpoint
router.patch('/:id/toggle-status', listingController.togglePublishStatus);

// Delete listing permanently
router.delete('/:id', listingController.deleteListing);

module.exports = router;

