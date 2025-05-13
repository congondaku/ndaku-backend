const Listing = require('../models/Listing');
const fs = require('fs');
const logger = require('../config/logger');
const { deleteFileFromS3 } = require('../config/s3');

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
    // Log the complete request body and files for debugging
    console.log("Request body:", req.body);
    console.log("Request files:", req.files ? req.files.length : "none");

    // Check for AWS S3 connection error
    if (req.fileValidationError) {
      return res.status(400).json({
        success: false,
        message: req.fileValidationError
      });
    }

    // Check if the request was aborted due to S3 error
    if (req.awsError) {
      return res.status(400).json({
        success: false,
        message: "Error connecting to AWS S3: " + req.awsError
      });
    }

    // Validate required fields
    const validation = validateListingData(req.body);
    if (!validation.isValid) {
      return res.status(400).json({
        success: false,
        message: 'Missing required fields',
        missingFields: validation.missingFields
      });
    }

    // Validate images
    if (!req.files || req.files.length === 0) {
      return res.status(400).json({
        success: false,
        message: 'At least one image is required'
      });
    }

    // Get image URLs based on upload method (S3 or Cloudinary)
    let imageUrls = [];
    if (req.files[0].location) {
      // S3 upload - files already have location property
      imageUrls = req.files.map(file => file.location);
    } else {
      // Cloudinary upload
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

      imageUrls = uploadResults.map(img => img.secure_url);
    }

    // Create a processed data object for the listing
    const processedData = { ...req.body };

    // Parse details if provided as string
    if (req.body.details) {
      try {
        processedData.details = typeof req.body.details === 'string'
          ? JSON.parse(req.body.details)
          : req.body.details;
      } catch (err) {
        logger.error('Failed to parse details:', err);
        return res.status(400).json({
          success: false,
          message: 'Invalid details format',
          error: err.message
        });
      }
    }

    // Process features array - handle array notation from form data
    const features = [];
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('features[')) {
        const match = key.match(/features\[(\d+)\]/);
        if (match) {
          const index = parseInt(match[1]);
          features[index] = req.body[key];
        }
      }
    });

    if (features.length > 0) {
      processedData.features = features;
    } else if (req.body.features) {
      try {
        if (typeof req.body.features === 'string') {
          processedData.features = JSON.parse(req.body.features);
        } else {
          processedData.features = req.body.features;
        }
      } catch (err) {
        console.error('Error parsing features:', err);
        processedData.features = [];
      }
    }

    // Process amenities array - handle array notation from form data
    const amenities = [];
    Object.keys(req.body).forEach(key => {
      if (key.startsWith('nearbyAmenities[')) {
        const match = key.match(/nearbyAmenities\[(\d+)\]/);
        if (match) {
          const index = parseInt(match[1]);
          amenities[index] = req.body[key];
        }
      }
    });

    if (amenities.length > 0) {
      processedData.nearbyAmenities = amenities;
    } else if (req.body.nearbyAmenities) {
      try {
        if (typeof req.body.nearbyAmenities === 'string') {
          processedData.nearbyAmenities = JSON.parse(req.body.nearbyAmenities);
        } else {
          processedData.nearbyAmenities = req.body.nearbyAmenities;
        }
      } catch (err) {
        console.error('Error parsing amenities:', err);
        processedData.nearbyAmenities = [];
      }
    }

    // Handle boolean conversion for negotiable
    if (req.body.negotiable) {
      processedData.negotiable = req.body.negotiable === 'true';
    }

    // IMPROVED PRICE HANDLING
    // Helper function to convert price fields to numbers
    const getNumericPrice = (value) => {
      if (!value) return undefined;

      // If it's already a number, return it
      if (typeof value === 'number') return value;

      // Try to convert string to number
      const numValue = parseFloat(value);
      return isNaN(numValue) ? 0 : numValue;
    };

    // Set the appropriate price field based on listing type and clear the others
    if (req.body.listingType === 'sale') {
      // For sale listings
      if (req.body.priceSale) {
        processedData.priceSale = getNumericPrice(req.body.priceSale);
      } else if (req.body.debugPriceSale) {
        processedData.priceSale = getNumericPrice(req.body.debugPriceSale);
      } else if (req.body.price) {
        processedData.priceSale = getNumericPrice(req.body.price);
      }

      // Ensure other price fields are undefined (not just 0)
      processedData.priceMonthly = undefined;
      processedData.priceDaily = undefined;

      console.log(`Setting priceSale to: ${processedData.priceSale}`);

    } else if (req.body.listingType === 'rent') {
      // For rent listings
      if (req.body.priceMonthly) {
        processedData.priceMonthly = getNumericPrice(req.body.priceMonthly);
      } else if (req.body.debugPriceMonthly) {
        processedData.priceMonthly = getNumericPrice(req.body.debugPriceMonthly);
      } else if (req.body.price) {
        processedData.priceMonthly = getNumericPrice(req.body.price);
      }

      // Ensure other price fields are undefined (not just 0)
      processedData.priceSale = undefined;
      processedData.priceDaily = undefined;

      console.log(`Setting priceMonthly to: ${processedData.priceMonthly}`);

    } else if (req.body.listingType === 'daily') {
      // For daily listings
      if (req.body.priceDaily) {
        processedData.priceDaily = getNumericPrice(req.body.priceDaily);
      } else if (req.body.debugPriceDaily) {
        processedData.priceDaily = getNumericPrice(req.body.debugPriceDaily);
      } else if (req.body.price) {
        processedData.priceDaily = getNumericPrice(req.body.price);
      }

      // Ensure other price fields are undefined (not just 0)
      processedData.priceSale = undefined;
      processedData.priceMonthly = undefined;

      console.log(`Setting priceDaily to: ${processedData.priceDaily}`);
    }

    // Clean up debug fields to avoid saving them to the database
    delete processedData.debugPriceSale;
    delete processedData.debugPriceMonthly;
    delete processedData.debugPriceDaily;
    delete processedData.price; // Remove generic price field

    // Add images to the processed data
    processedData.images = imageUrls;

    // Add user info and ensure listing is not deleted by default
    processedData.createdBy = req.user._id;
    processedData.isDeleted = false;

    // Log the processed data right before saving
    console.log("Processed data before saving:", JSON.stringify(processedData, null, 2));

    // Create and save the listing
    const newListing = new Listing(processedData);
    const savedListing = await newListing.save();

    console.log("Saved listing:", JSON.stringify(savedListing, null, 2));

    return res.status(201).json({
      success: true,
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
        success: false,
        message: 'Validation failed',
        errors
      });
    }

    return res.status(500).json({
      success: false,
      message: 'Internal server error',
      error: error.message
    });
  }
};

// Get all published listings with filters and pagination
const getAllListings = async (req, res) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const maxLimit = 50;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;

    // Extract filtering parameters
    const {
      commune,
      ville,
      quartier,
      typeOfListing,
      listingType,
      priceMin,
      priceMax,
      bedrooms,
      bathrooms,
      furnished,
      sortBy,
      sortOrder,
      search
    } = req.query;

    const filter = { isDeleted: false };

    // Apply location filters
    if (commune) filter.commune = commune;
    if (ville) filter.ville = ville;
    if (quartier) filter.quartier = quartier;

    // Apply property type filters
    if (typeOfListing) filter.typeOfListing = typeOfListing;
    if (listingType) filter.listingType = listingType;

    // Apply feature filters
    if (bedrooms) filter['details.bedroom'] = parseInt(bedrooms);
    if (bathrooms) filter['details.bathroom'] = parseInt(bathrooms);
    if (furnished === 'true') filter['details.furnished'] = true;

    // Add text search if provided
    if (search) {
      filter.$text = { $search: search };
    }

    // Price range filter based on listing type
    if (priceMin || priceMax) {
      const priceFilter = {};

      if (listingType === 'rent') {
        if (priceMin) priceFilter.$gte = parseFloat(priceMin);
        if (priceMax) priceFilter.$lte = parseFloat(priceMax);
        filter.priceMonthly = priceFilter;
      }
      else if (listingType === 'daily') {
        if (priceMin) priceFilter.$gte = parseFloat(priceMin);
        if (priceMax) priceFilter.$lte = parseFloat(priceMax);
        filter.priceDaily = priceFilter;
      }
      else if (listingType === 'sale') {
        if (priceMin) priceFilter.$gte = parseFloat(priceMin);
        if (priceMax) priceFilter.$lte = parseFloat(priceMax);
        filter.priceSale = priceFilter;
      }
      else if (priceMin || priceMax) {
        // If no listing type specified but price filter is used
        const ranges = [];

        if (priceMin && priceMax) {
          ranges.push({ priceMonthly: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } });
          ranges.push({ priceDaily: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } });
          ranges.push({ priceSale: { $gte: parseFloat(priceMin), $lte: parseFloat(priceMax) } });
        }
        else if (priceMin) {
          ranges.push({ priceMonthly: { $gte: parseFloat(priceMin) } });
          ranges.push({ priceDaily: { $gte: parseFloat(priceMin) } });
          ranges.push({ priceSale: { $gte: parseFloat(priceMin) } });
        }
        else if (priceMax) {
          ranges.push({ priceMonthly: { $lte: parseFloat(priceMax) } });
          ranges.push({ priceDaily: { $lte: parseFloat(priceMax) } });
          ranges.push({ priceSale: { $lte: parseFloat(priceMax) } });
        }

        filter.$or = ranges;
      }
    }

    // Determine sorting options
    const sortOptions = {};
    if (sortBy) {
      // Valid sort fields
      const validSortFields = ['createdAt', 'priceMonthly', 'priceSale', 'priceDaily'];
      const field = validSortFields.includes(sortBy) ? sortBy : 'createdAt';
      sortOptions[field] = sortOrder === 'asc' ? 1 : -1;
    } else {
      // Default sorting by creation date, newest first
      sortOptions.createdAt = -1;
    }

    // If using text search, add score to sort criteria
    if (search) {
      sortOptions.score = { $meta: "textScore" };
    }

    // Get total count for pagination metadata
    const total = await Listing.countDocuments(filter);

    // Execute the paginated query
    let listingsQuery = Listing.find(filter);

    // Add text score projection if searching
    if (search) {
      listingsQuery = listingsQuery.select({ score: { $meta: "textScore" } });
    }

    const listings = await listingsQuery
      .sort(sortOptions)
      .skip(skip)
      .limit(actualLimit)
      .populate('createdBy', 'firstName lastName email');

    // Format listings to handle image format consistency
    const formattedListings = listings.map(listing => {
      const plainListing = listing.toObject();

      // If images are stored as objects with url and public_id, extract just the URLs
      if (plainListing.images.length > 0 && typeof plainListing.images[0] === 'object') {
        plainListing.images = plainListing.images.map(img => img.url);
      }

      return plainListing;
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / actualLimit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    res.status(200).json({
      success: true,
      listings: formattedListings,
      pagination: {
        total,
        count: formattedListings.length,
        page,
        limit: actualLimit,
        totalPages,
        hasNext,
        hasPrev,
        nextPage: hasNext ? page + 1 : null,
        prevPage: hasPrev ? page - 1 : null
      }
    });
  } catch (error) {
    logger.error('Error fetching listings:', error);
    res.status(500).json({
      success: false,
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
      return res.status(404).json({
        success: false,
        message: 'Listing not found'
      });
    }

    res.status(200).json({
      success: true,
      listing
    });
  } catch (error) {
    logger.error('Error fetching listing:', error);
    res.status(500).json({
      success: false,
      message: 'Error fetching listing',
      error: error.message
    });
  }
};

// Get listings for current user with pagination
const getMyListings = async (req, res) => {
  try {
    // Extract pagination parameters
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 10;
    const maxLimit = 50;
    const actualLimit = Math.min(limit, maxLimit);
    const skip = (page - 1) * actualLimit;

    // Get total count
    const total = await Listing.countDocuments({
      createdBy: req.user._id
    });

    // Execute paginated query
    const listings = await Listing.find({
      createdBy: req.user._id
    })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(actualLimit);

    // Format listings to show only URLs for frontend display
    const formattedListings = listings.map(listing => {
      const plainListing = listing.toObject();

      // If images are stored as objects with url and public_id, extract just the URLs
      if (plainListing.images.length > 0 && typeof plainListing.images[0] === 'object') {
        plainListing.images = plainListing.images.map(img => img.url);
      }

      return plainListing;
    });

    // Calculate pagination metadata
    const totalPages = Math.ceil(total / actualLimit);
    const hasNext = page < totalPages;
    const hasPrev = page > 1;

    res.status(200).json({
      success: true,
      listings: formattedListings,
      pagination: {
        total,
        count: formattedListings.length,
        page,
        limit: actualLimit,
        totalPages,
        hasNext,
        hasPrev,
        nextPage: hasNext ? page + 1 : null,
        prevPage: hasPrev ? page - 1 : null
      }
    });
  } catch (error) {
    // Log extensive details about the error
    console.error('CRITICAL UPDATE ERROR:', {
      error: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code || 'no_code',
      listingId: id,
      userId: req.user ? req.user._id : 'unknown',
      bodyKeys: Object.keys(req.body),
      removedImagesPresent: !!req.body.removedImages,
      filesPresent: !!(req.files && req.files.length)
    });

    // Return a more detailed error response
    return res.status(500).json({
      success: false,
      error: 'Failed to update listing',
      errorType: error.name,
      errorCode: error.code,
      details: error.message
    });
  }
};

// Update a listing
const updateListing = async (req, res) => {
  try {
    const { id } = req.params;
    const listing = await Listing.findById(id);

    if (!listing) {
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Authorization check
    if (req.user.role !== 'admin' && listing.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only update your own listings'
      });
    }

    // Parse details if provided as string
    if (req.body.details && typeof req.body.details === 'string') {
      try {
        req.body.details = JSON.parse(req.body.details);
      } catch (err) {
        return res.status(400).json({
          success: false,
          message: 'Invalid details format'
        });
      }
    }

    // Handle publish/unpublish toggle
    if (req.body.isDeleted !== undefined) {
      listing.isDeleted = req.body.isDeleted;
    }

    console.log(`Update request for listing ${id} by user ${req.user._id}`);
    console.log('Request body:', JSON.stringify(req.body, null, 2));

    // Handle removal of existing images
    if (req.body.removedImages) {
      // Handle case where removedImages might be a JSON string or an array
      let removedImages;

      if (typeof req.body.removedImages === 'string') {
        try {
          removedImages = JSON.parse(req.body.removedImages);
        } catch (e) {
          // If not valid JSON, treat as a single URL
          removedImages = [req.body.removedImages];
        }
      } else {
        removedImages = Array.isArray(req.body.removedImages)
          ? req.body.removedImages
          : [req.body.removedImages];
      }

      console.log('AWS Environment Check:', {
        AWS_ACCESS_KEY_ID_exists: !!process.env.MY_AWS_ACCESS_KEY_ID,
        AWS_SECRET_ACCESS_KEY_exists: !!process.env.MY_AWS_ACCESS_KEY_ID,
        MY_AWS_REGION: process.env.MY_AWS_REGION,
        MY_S3_BUCKET_NAME: process.env.MY_S3_BUCKET_NAME,
        MY_SDK_LOAD_CONFIG: process.env.MY_SDK_LOAD_CONFIG,
        removedImagesCount: removedImages.length
      });

      // Delete images from storage (S3 or Cloudinary)
      if (req.files && req.files[0] && req.files[0].location) {
        // Using S3
        await Promise.all(
          removedImages.map(imageUrl => {
            logger.info(`Deleting image from S3: ${imageUrl}`);
            return deleteFileFromS3(imageUrl);
          })
        );
      } else {
        // Using Cloudinary
        await Promise.all(
          removedImages.map(imageUrl => {
            // Extract public_id from the Cloudinary URL
            const urlParts = imageUrl.split('/');
            const publicIdWithExtension = urlParts[urlParts.length - 1];
            const publicId = `real-estate-listings/${publicIdWithExtension.split('.')[0]}`;

            logger.info(`Deleting image from Cloudinary: ${publicId}`);
            return cloudinary.uploader.destroy(publicId);
          })
        );
      }

      // Filter out removed images from the listing's images array
      listing.images = listing.images.filter(img => !removedImages.includes(img));
    }

    // Update other fields
    Object.keys(req.body).forEach(key => {
      if (key !== 'images' && key !== 'createdBy' && key !== 'removedImages') {
        if (key === 'details' && req.body.details) {
          listing.details = req.body.details;
        } else {
          listing[key] = req.body[key];
        }
      }
    });

    // Handle price fields based on listing type
    if (req.body.listingType === 'sale') {
      if (req.body.priceSale) {
        listing.priceSale = parseFloat(req.body.priceSale);
      }
      listing.priceMonthly = undefined;
      listing.priceDaily = undefined;
    } else if (req.body.listingType === 'rent') {
      if (req.body.priceMonthly) {
        listing.priceMonthly = parseFloat(req.body.priceMonthly);
      }
      listing.priceSale = undefined;
      listing.priceDaily = undefined;
    } else if (req.body.listingType === 'daily') {
      if (req.body.priceDaily) {
        listing.priceDaily = parseFloat(req.body.priceDaily);
      }
      listing.priceSale = undefined;
      listing.priceMonthly = undefined;
    }

    // Handle new image uploads
    if (req.files && req.files.length > 0) {
      let newImageUrls = [];

      if (req.files[0].location) {
        // Using S3
        newImageUrls = req.files.map(file => file.location);
      } else {
        // Using Cloudinary
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

        newImageUrls = uploadedImages.map(img => img.secure_url);
      }

      listing.images = [...listing.images, ...newImageUrls];
    }

    console.log('About to save updated listing');

    const updatedListing = await listing.save();

    res.json({
      success: true,
      message: 'Listing updated successfully',
      listing: updatedListing
    });

  } catch (error) {
    console.error('Detailed update error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      listingId: id
    });

    if (error.name === 'ValidationError') {
      let removedImages;
      const validationErrors = {};
      for (const field in error.errors) {
        validationErrors[field] = error.errors[field].message;
      }
      return res.status(400).json({
        success: false,
        message: 'Validation error',
        errors: validationErrors
      });
    }

    res.status(500).json({
      success: false,
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
      return res.status(404).json({
        success: false,
        error: 'Listing not found'
      });
    }

    // Authorization check
    if (req.user.role !== 'admin' && listing.createdBy.toString() !== req.user._id.toString()) {
      return res.status(403).json({
        success: false,
        error: 'Forbidden: You can only delete your own listings'
      });
    }

    // Determine if using S3 or Cloudinary based on image URL format
    const isS3 = listing.images[0] && listing.images[0].includes('amazonaws.com');

    // Delete images from storage
    if (isS3) {
      // Delete from S3
      await Promise.all(
        listing.images.map(imageUrl => {
          logger.info(`Deleting image from S3: ${imageUrl}`);
          return deleteFileFromS3(imageUrl);
        })
      );
    } else {
      // Delete from Cloudinary
      await Promise.all(
        listing.images.map(imageUrl => {
          const urlParts = imageUrl.split('/');
          const publicIdWithExtension = urlParts[urlParts.length - 1];
          const publicId = `real-estate-listings/${publicIdWithExtension.split('.')[0]}`;
          return cloudinary.uploader.destroy(publicId);
        })
      );
    }

    // Delete the listing from the database
    await listing.deleteOne();

    res.json({
      success: true,
      message: 'Listing permanently deleted successfully'
    });

  } catch (error) {
    logger.error('Error deleting listing:', error);
    res.status(500).json({
      success: false,
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
