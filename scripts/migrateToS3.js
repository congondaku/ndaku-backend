/**
 * Migration script to move images from Cloudinary to AWS S3
 * 
 * Usage:
 * - Run: node scripts/migrateToS3.js
 * - With limit: node scripts/migrateToS3.js --limit=50
 * - For specific listing: node scripts/migrateToS3.js --id=listing_id
 * - Dry run (no actual changes): node scripts/migrateToS3.js --dry-run
 */

require('dotenv').config();
const mongoose = require('mongoose');
const axios = require('axios');
const AWS = require('aws-sdk');
const Listing = require('../models/Listing');
const cloudinary = require('cloudinary').v2;
const fs = require('fs');
const path = require('path');
const { promisify } = require('util');
const writeFileAsync = promisify(fs.writeFile);
const mkdirAsync = promisify(fs.mkdir);
const unlinkAsync = promisify(fs.unlink);

// Parse command-line arguments
const args = process.argv.slice(2).reduce((result, arg) => {
  if (arg.startsWith('--')) {
    const [key, value] = arg.substring(2).split('=');
    result[key] = value === undefined ? true : value;
  }
  return result;
}, {});

// Configure Cloudinary
cloudinary.config({
  cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
  api_key: process.env.CLOUDINARY_API_KEY,
  api_secret: process.env.CLOUDINARY_API_SECRET
});

// Configure AWS S3
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID_I,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION
});

const s3 = new AWS.S3();
const BUCKET_NAME = process.env.AWS_S3_BUCKET_NAME;
const TEMP_DIR = path.join(__dirname, '../temp_migration');

// Helper function to download an image from URL to temp folder
async function downloadImage(imageUrl, filename) {
  try {
    // Ensure temp directory exists
    await mkdirAsync(TEMP_DIR, { recursive: true });
    
    const filepath = path.join(TEMP_DIR, filename);
    const response = await axios({
      method: 'GET',
      url: imageUrl,
      responseType: 'arraybuffer'
    });
    
    await writeFileAsync(filepath, response.data);
    return filepath;
  } catch (error) {
    console.error(`Error downloading image ${imageUrl}:`, error.message);
    return null;
  }
}

// Helper function to upload a file to S3
async function uploadToS3(filepath, filename) {
  try {
    const fileContent = fs.readFileSync(filepath);
    const fileExtension = path.extname(filename);
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    
    const params = {
      Bucket: BUCKET_NAME,
      Key: `real-estate-listings/${uniqueSuffix}${fileExtension}`,
      Body: fileContent,
      ContentType: `image/${fileExtension.substring(1)}`, // Remove the dot
      ACL: 'public-read'
    };
    
    const data = await s3.upload(params).promise();
    return data.Location;
  } catch (error) {
    console.error(`Error uploading to S3:`, error);
    return null;
  }
}

// Main migration function
async function migrateImages() {
  try {
    // Connect to MongoDB
    await mongoose.connect(process.env.MONGODB_URI, {
      useNewUrlParser: true,
      useUnifiedTopology: true
    });
    console.log('Connected to MongoDB');
    
    // Prepare query
    let query = { images: { $exists: true, $ne: [] } };
    
    // Handle specific listing ID if provided
    if (args.id) {
      query = { _id: args.id };
    }
    
    // Query options
    const options = {};
    if (args.limit) {
      options.limit = parseInt(args.limit);
    }
    
    // Find listings with images
    const listings = await Listing.find(query, null, options);
    console.log(`Found ${listings.length} listings with images to migrate`);
    
    // Process each listing
    for (const [index, listing] of listings.entries()) {
      console.log(`\nProcessing listing ${index + 1}/${listings.length} (ID: ${listing._id})`);
      
      const oldImages = [...listing.images];
      const newImages = [];
      
      // Process each image
      for (const [imgIndex, imageUrl] of oldImages.entries()) {
        if (!imageUrl.includes('cloudinary.com')) {
          console.log(`  Image ${imgIndex + 1}/${oldImages.length} is not on Cloudinary, skipping`);
          newImages.push(imageUrl);
          continue;
        }
        
        console.log(`  Migrating image ${imgIndex + 1}/${oldImages.length}: ${imageUrl}`);
        
        // Extract filename from Cloudinary URL
        const urlParts = imageUrl.split('/');
        const filenameWithExtension = urlParts[urlParts.length - 1];
        
        // Skip if not a dry run
        if (!args['dry-run']) {
          // Download image to temp directory
          const tempFilePath = await downloadImage(imageUrl, filenameWithExtension);
          if (!tempFilePath) {
            console.error(`  Failed to download image ${imageUrl}`);
            newImages.push(imageUrl); // Keep old URL on failure
            continue;
          }
          
          // Upload to S3
          const s3Url = await uploadToS3(tempFilePath, filenameWithExtension);
          if (!s3Url) {
            console.error(`  Failed to upload image to S3`);
            newImages.push(imageUrl); // Keep old URL on failure
          } else {
            console.log(`  Successfully migrated to S3: ${s3Url}`);
            newImages.push(s3Url);
          }
          
          // Clean up temp file
          await unlinkAsync(tempFilePath).catch(err => console.error(`  Error removing temp file:`, err));
        } else {
          console.log(`  [DRY RUN] Would migrate: ${imageUrl}`);
          newImages.push(imageUrl);
        }
      }
      
      // Update the listing with new image URLs if not a dry run
      if (!args['dry-run'] && JSON.stringify(oldImages) !== JSON.stringify(newImages)) {
        listing.images = newImages;
        await listing.save();
        console.log(`  Updated listing with new S3 URLs`);
        
        // Optionally delete from Cloudinary
        if (process.env.DELETE_FROM_CLOUDINARY === 'true') {
          for (const imageUrl of oldImages) {
            if (imageUrl.includes('cloudinary.com')) {
              // Extract public_id from Cloudinary URL
              const urlParts = imageUrl.split('/');
              const fileWithExt = urlParts[urlParts.length - 1];
              const folder = urlParts[urlParts.length - 2];
              const publicId = `${folder}/${fileWithExt.split('.')[0]}`;
              
              try {
                await cloudinary.uploader.destroy(publicId);
                console.log(`  Deleted image from Cloudinary: ${publicId}`);
              } catch (error) {
                console.error(`  Error deleting image from Cloudinary:`, error.message);
              }
            }
          }
        }
      } else if (args['dry-run']) {
        console.log(`  [DRY RUN] Would update listing with new S3 URLs`);
      }
    }
    
    console.log('\nMigration completed!');
    
  } catch (error) {
    console.error('Migration error:', error);
  } finally {
    // Clean up temp directory
    try {
      fs.rmdirSync(TEMP_DIR, { recursive: true });
    } catch (error) {
      console.error('Error cleaning up temp directory:', error);
    }
    
    // Disconnect from MongoDB
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Start migration
migrateImages();
