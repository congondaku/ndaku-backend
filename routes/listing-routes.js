const express = require('express');
const router = express.Router();
const { authenticate } = require('../middleware/auth');
const listingController = require('../controllers/listing-controller');
const locationData = require('../utils/locationData');
const villesData = require('../utils/villesData');
const multer = require('multer');
const { upload, s3 } = require('../config/s3'); // Updated to use s3 config
const Listing = require('../models/Listing');

/**
 * Middleware to handle multer errors
 */
const handleMulterError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    return res.status(400).json({
      success: false,
      message: err.code === 'LIMIT_FILE_SIZE' 
        ? 'File too large (max 5MB)' 
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

const handleS3Error = (req, res, next) => {
  if (req.awsError) {
    return res.status(400).json({
      success: false,
      message: req.awsError
    });
  }
  next();
};

// Get single listing
router.get('/:id', listingController.getListing);

// =================== AUTHENTICATED ROUTES ===================
router.use(authenticate); // All routes after this require authentication

// Get current user's listings
router.get('/user/current', listingController.getMyListings);

// Create new listing - using AWS S3 upload
router.post(
  '/add',
  logRequest,
  (req, res, next) => {
    try {
      upload.array('images', 10)(req, res, (err) => {
        if (err) {
          if (err.message === 'The AWS Access Key Id you provided does not exist in our records.') {
            req.awsError = 'AWS S3 connection error: ' + err.message;
            return next();
          }
          return handleMulterError(err, req, res, next);
        }
        next();
      });
    } catch (err) {
      req.awsError = 'Upload error: ' + err.message;
      next();
    }
  },
  handleS3Error,
  processListingData,
  listingController.addListing
);

router.get('/test-aws', async (req, res) => {
  try {
    const { s3 } = require('../config/s3');
    const result = await s3.listBuckets().promise();
    return res.json({ success: true, buckets: result.Buckets.map(b => b.Name) });
  } catch (error) {
    console.error('AWS Error:', error);
    return res.status(500).json({ 
      success: false, 
      error: error.message,
      stack: error.stack
    });
  }
});
// Update existing listing - using AWS S3 upload
router.put(
  '/update/:id',
  logRequest,
  upload.array('images', 10), // This now uses the S3 upload middleware
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