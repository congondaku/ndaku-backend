// config/s3.js
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Force AWS SDK to load credentials from environment variables
process.env.AWS_SDK_LOAD_CONFIG = "1";

// Set AWS credentials explicitly before requiring the SDK
AWS.config.update({
  accessKeyId: process.env.AWS_ACCESS_KEY_ID,
  secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
  region: process.env.AWS_REGION || 'us-east-1'
});

// Set default region if not specified
if (!AWS.config.region) {
  AWS.config.region = 'us-east-1';
}

const bucketName = process.env.AWS_S3_BUCKET_NAME || 'congondaku';

// Log AWS config for debugging (without revealing actual credentials)
console.log('AWS SDK Configuration:', {
  accessKeyExists: !!process.env.AWS_ACCESS_KEY_ID,
  secretKeyExists: !!process.env.AWS_SECRET_ACCESS_KEY,
  region: AWS.config.region,
  bucket: bucketName,
  sdkLoadConfig: process.env.AWS_SDK_LOAD_CONFIG,
  sdkVersion: AWS.VERSION
});

// Create S3 service object with credentials directly from constructor
const s3 = new AWS.S3({
  credentials: new AWS.Credentials({
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }),
  region: AWS.config.region
});

// Add error handlers to S3 object
s3.on('error', (err) => {
  console.error('S3 Service Error:', err);
});

// Test S3 connection on startup - with a timeout
let s3ConnectionTested = false;
setTimeout(() => {
  if (!s3ConnectionTested) {
    console.warn('S3 connection test timed out. AWS credentials may be invalid.');
  }
}, 10000);

s3.listBuckets().promise()
  .then(data => {
    s3ConnectionTested = true;
    console.log('Successfully connected to AWS S3. Available buckets:',
      data.Buckets.map(b => b.Name).join(', '));
  })
  .catch(err => {
    s3ConnectionTested = true;
    console.error('Error testing S3 connection:', err);
    console.error('Error details:', {
      name: err.name, 
      code: err.code, 
      message: err.message
    });
  });

// Configure multer with error handling
const storage = multerS3({
  s3: s3,
  bucket: bucketName,
  acl: 'public-read',
  contentType: multerS3.AUTO_CONTENT_TYPE,
  metadata: (req, file, cb) => {
    cb(null, { fieldName: file.fieldname });
  },
  key: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    const filename = `real-estate-listings/${Date.now()}-${Math.floor(Math.random() * 1000000000)}${extension}`;
    cb(null, filename);
  }
});

// Fallback to disk storage if S3 fails
const diskStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, '../uploads');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const extension = path.extname(file.originalname);
    cb(null, `${Date.now()}-${Math.floor(Math.random() * 1000)}${extension}`);
  }
});

const fileFilter = (req, file, cb) => {
  if (file.mimetype.startsWith('image/')) {
    cb(null, true);
  } else {
    cb(new Error('Only image files are allowed'), false);
  }
};

// Determine if we have valid AWS credentials
const hasValidAwsCredentials = !!process.env.AWS_ACCESS_KEY_ID && 
                               !!process.env.AWS_SECRET_ACCESS_KEY;

// Create multer upload instance
let upload;
try {
  if (hasValidAwsCredentials) {
    upload = multer({
      storage: storage,
      limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB
      fileFilter: fileFilter
    });
    console.log('S3 storage configured for uploads');
  } else {
    throw new Error('AWS credentials not available');
  }
} catch (err) {
  console.error('Error configuring S3 storage:', err.message);
  console.log('Falling back to disk storage for uploads');
  upload = multer({
    storage: diskStorage,
    limits: { fileSize: 5 * 1024 * 1024 },
    fileFilter: fileFilter
  });
}

// Add middleware to handle S3 errors
const handleS3Errors = (req, res, next) => {
  if (!hasValidAwsCredentials) {
    req.awsError = 'AWS credentials not configured';
  }
  next();
};

// Function to delete a file from S3
const deleteFileFromS3 = async (fileUrl) => {
  return new Promise((resolve) => {
    try {
      // Check for valid URL and credentials
      if (!fileUrl) {
        console.warn('No file URL provided for S3 deletion');
        return resolve(false);
      }
      
      if (!hasValidAwsCredentials) {
        console.warn('Cannot delete from S3: AWS credentials not configured');
        return resolve(false);
      }
      
      // Extract key from URL using various patterns
      let key = '';
      if (fileUrl.includes(bucketName)) {
        // If URL contains bucket name directly
        const parts = fileUrl.split(`${bucketName}/`);
        if (parts.length > 1) {
          key = parts[1];
        }
      } else if (fileUrl.includes('amazonaws.com')) {
        // Standard S3 URL format
        const parts = fileUrl.split(/\.com\//);
        if (parts.length > 1) {
          key = parts[1];
        }
      }
      
      if (!key) {
        console.warn('Could not extract S3 key from URL:', fileUrl);
        return resolve(false);
      }
      
      console.log(`Deleting S3 object: Bucket=${bucketName}, Key=${key}`);
      
      // Delete the object
      s3.deleteObject({
        Bucket: bucketName, 
        Key: key
      }).promise()
        .then(() => {
          console.log('Successfully deleted file from S3:', key);
          resolve(true);
        })
        .catch(err => {
          console.error('Error deleting file from S3:', {
            error: err.message,
            code: err.code,
            fileUrl,
            key
          });
          resolve(false); // Resolve with false instead of rejecting
        });
    } catch (error) {
      console.error('Unexpected error in deleteFileFromS3:', error);
      resolve(false); // Never throw, always resolve
    }
  });
};

module.exports = {
  upload,
  deleteFileFromS3,
  s3,
  handleS3Errors
};