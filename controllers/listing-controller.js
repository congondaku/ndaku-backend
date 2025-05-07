const Listing = require('../models/Listing');
const fs = require('fs');
const logger = require('../config/logger');
const cloudinary = require('cloudinary').v2;

// Helper function to validate listing data
const validateListingData = (body) => {
  const requiredFields = [
    'listerFirstName', 'listerLastName', 'listerEmailAddress',
    'listerPhoneNumber', 'typeOfListing', 'listingType',
    'address', 'quartier', 'commune', 'district', 'ville'
  ];

  const missingFields = requiredFields.filter(field => !body[field]);

  if (missingFields.length > 0) {
    return { isValid: false, missingFields };
  }

  return { isValid: true };
};

// Create a new listing
const addListing = async (req, res) => {
  try {
    const validation = validateListingData(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        message: 'Missing required fields',
        missingFields: validation.missingFields
      });
    }

    // Parse details if provided as string
    let details = {};
    if (req.body.details) {
      try {
        details = typeof req.body.details === 'string'
          ? JSON.parse(req.body.details)
          : req.body.details;
      } catch (err) {
        logger.error('Failed to parse details:', err);
        return res.status(400).json({
          message: 'Invalid details format',
          error: err.message
        });
      }
    }

    // Prepare listing data
    const listingData = {
      ...req.body,
      details,
      createdBy: req.user._id,
      isDeleted: false
    };

    // Set appropriate price field
    const priceField =
      req.body.listingType === 'sale' ? 'priceSale' :
        req.body.listingType === 'rent' ? 'priceMonthly' : 'priceDaily';

    listingData[priceField] = parseFloat(req.body.price || 0);

    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        message: 'At least one image is required'
      });
    }

    // Upload images to Cloudinary
    const uploadResults = await Promise.all(
      req.files.map(file =>
        cloudinary.uploader.upload(file.path, {
          folder: 'real-estate-listings',
          transformation: [{ width: 1000, height: 750, crop: 'limit' }]
        })
      )
    );

    // Clean up uploaded files
    req.files.forEach(file => {
      if (fs.existsSync(file.path)) {
        fs.unlinkSync(file.path);
      }
    });

    listingData.images = uploadResults.map(img => img.secure_url);

    // Save to database
    const newListing = new Listing(listingData);
    const savedListing = await newListing.save();

    return res.status(201).json({
      message: 'Listing created successfully',
      listing: savedListing
    });

  } catch (error) {
    logger.error('Add listing error:', {
      error: error.message,
      stack: error.stack,
      body: req.body,
      files: req.files ? req.files.map(f => f.originalname) : null
    });

    if (error.name === 'ValidationError') {
      const errors = {};
      for (const field in error.errors) {
        errors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        message: 'Validation failed',
        errors
      });
    }

    return res.status(500).json({
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all published listings with filters
const getAllListings = async (req, res) => {
  try {
    const { commune, typeOfListing, priceMin, priceMax, bedrooms, bathrooms } = req.query;
    const filter = { isDeleted: false };

    // Apply filters
    if (commune) filter.commune = commune;
    if (typeOfListing) filter.typeOfListing = typeOfListing;
    if (bedrooms) filter['details.bedroom'] = parseInt(bedrooms);
    if (bathrooms) filter['details.bathroom'] = parseInt(bathrooms);

    // Price range filter
    if (priceMin && priceMax) {
      filter.$or = [
        { priceMonthly: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } },
        { priceSale: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } },
        { priceDaily: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } }
      ];
    }

    const listings = await Listing.find(filter)
      .sort({ createdAt: -1 })
      .populate('createdBy', 'firstName lastName email');

    res.status(200).json({ listings });
  } catch (error) {
    logger.error('Error fetching listings:', error);
    res.status(500).json({
      message: 'Error fetching listings',
      error: error.message
    });
  }
};

// Get a single listing by ID
const getListing = async (req, res) => {
  try {
    const listing = await Listing.findById(req.params.id)
      .populate('createdBy', 'firstName lastName email');

    if (!listing) {
      return res.status(404).json({ message: 'Listing not found' });
    }

    res.status(200).json(listing);
  } catch (error) {
    logger.error('Error fetching listing:', error);
    res.status(500).json({
      message: 'Error fetching listing',
      error: error.message
    });
  }
};

// Get listings for current user
const getMyListings = async (req, res) => {
  try {
    const listings = await Listing.find({
      createdBy: req.user._id
    }).sort({ createdAt: -1 });

    res.status(200).json(listings);
  } catch (error) {
    logger.error('Error getting user listings:', error);
    res.status(500).json({
      message: 'Failed to fetch your listings',
      error: error.message
    });
  }
};

// Update a listing
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Authorization check
    if (req.user.role !== 'admin' && listing.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden: You can only update your own listings' });
    }

    // Parse details if provided as string
    if (req.body.details && typeof req.body.details === 'string') {
      try {
        req.body.details = JSON.parse(req.body.details);
      } catch (err) {
        return res.status(400).json({ message: 'Invalid details format' });
      }
    }

    // Handle publish/unpublish toggle
    if (req.body.isDeleted !== undefined) {
      listing.isDeleted = req.body.isDeleted;
    }

    // Update other fields
    Object.keys(req.body).forEach(key => {
      if (key !== 'images' && key !== 'createdBy' && key !== 'isDeleted' && key !== 'removedImages') {
        listing[key] = req.body[key];
      }
    });

    // Handle removal of existing images
    if (req.body.removedImages && req.body.removedImages.length > 0) {
      // Handle case where removedImages might be a single string or an array
      const removedImages = Array.isArray(req.body.removedImages)
        ? req.body.removedImages
        : [req.body.removedImages];

      // Delete images from Cloudinary
      await Promise.all(
        removedImages.map(imageUrl => {
          // Extract public_id from the Cloudinary URL
          // Format is typically: https://res.cloudinary.com/cloud-name/image/upload/v1234567890/folder/public_id.jpg
          const urlParts = imageUrl.split('/');
          const publicIdWithExtension = urlParts[urlParts.length - 1];
          const publicId = `real-estate-listings/${publicIdWithExtension.split('.')[0]}`;

          logger.info(`Deleting image from Cloudinary: ${publicId}`);
          return cloudinary.uploader.destroy(publicId);
        })
      );

      // Filter out removed images from the listing's images array
      listing.images = listing.images.filter(img => !removedImages.includes(img));
    }

    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      const uploadedImages = await Promise.all(
        req.files.map(file =>
          cloudinary.uploader.upload(file.path, {
            folder: 'real-estate-listings',
            transformation: [{ width: 1000, height: 750, crop: 'limit' }]
          })
        )
      );

      // Clean up uploaded files
      req.files.forEach(file => {
        if (fs.existsSync(file.path)) {
          fs.unlinkSync(file.path);
        }
      });

      listing.images = [...listing.images, ...uploadedImages.map(img => img.secure_url)];
    }

    const updatedListing = await listing.save();

    res.json({
      message: 'Listing updated successfully',
      listing: updatedListing
    });

  } catch (error) {
    logger.error('Error updating listing:', error);

    if (error.name === 'ValidationError') {
      const validationErrors = {};
      for (const field in error.errors) {
        validationErrors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        message: 'Validation error',
        errors: validationErrors
      });
    }

    res.status(500).json({
      error: 'Failed to update listing',
      details: error.message
    });
  }
};

// Toggle publish status
const togglePublishStatus = async (req, res) => {
  try {
    const { id } = req.params;

    const result = await Listing.updateOne(
      { _id: id, createdBy: req.user._id },
      { $set: { isDeleted: req.body.isDeleted } }
    );

    if (result.matchedCount === 0) {
      return res.status(404).json({
        success: false,
        message: 'Listing not found or not owned by user'
      });
    }

    const updatedListing = await Listing.findById(id);

    return res.status(200).json({
      success: true,
      message: req.body.isDeleted
        ? 'Listing unpublished successfully'
        : 'Listing published successfully',
      listing: updatedListing
    });
  } catch (err) {
    logger.error('Error in togglePublishStatus:', err);
    return res.status(500).json({
      success: false,
      message: 'Server error while updating listing status'
    });
  }
};

// Delete a listing permanently
const deleteListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({ error: 'Listing not found' });
    }

    // Authorization check
    if (req.user.role !== 'admin' && listing.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({ error: 'Forbidden: You can only delete your own listings' });
    }

    // Delete images from Cloudinary
    await Promise.all(
      listing.images.map(imageUrl =>
        cloudinary.uploader.destroy(imageUrl.split('/').pop().split('.')[0])
      )
    );

    await listing.deleteOne();

    res.json({ message: 'Listing permanently deleted successfully' });

  } catch (error) {
    logger.error('Error deleting listing:', error);
    res.status(500).json({
      error: 'Failed to delete listing',
      details: error.message
    });
  }
};

module.exports = {
  addListing,
  getAllListings,
  updateListing,
  deleteListing,
  getMyListings,
  getListing,
  togglePublishStatus
};
