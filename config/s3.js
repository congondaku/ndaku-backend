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
      if (!fileUrl) {
        console.log('No file URL provided for deletion');
        return resolve(false);
      }

      console.log(`Attempting to delete file: ${fileUrl}`);

      // Create a new S3 instance with explicit credentials for this operation
      const s3Op = new AWS.S3({
        credentials: new AWS.Credentials({
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
        }),
        region: process.env.AWS_REGION || 'us-east-1'
      });

      // Extract the key using URL parsing
      let key;
      try {
        // Create a URL object
        const url = new URL(fileUrl);
        
        // Get the pathname (e.g., "/bucket-name/path/to/file.jpg")
        const pathname = url.pathname;
        
        // Split by '/' and remove empty elements
        const parts = pathname.split('/').filter(part => part.length > 0);
        
        // If the first part is the bucket name, remove it
        if (parts[0] === bucketName) {
          key = parts.slice(1).join('/');
        } else {
          key = parts.join('/');
        }
      } catch (parseError) {
        // Fallback to simple splitting if URL parsing fails
        console.log('URL parsing failed, using fallback method');
        const simpleParts = fileUrl.split('/');
        key = simpleParts.slice(3).join('/'); // Skip protocol, domain, and bucket
      }

      if (!key) {
        console.log(`Could not extract key from URL: ${fileUrl}`);
        return resolve(false);
      }

      console.log(`Deleting with bucket=${bucketName}, key=${key}`);

      // Use explicit credentials for this operation
      s3Op.deleteObject({
        Bucket: bucketName,
        Key: key
      }, (err, data) => {
        if (err) {
          console.error('S3 delete error:', err);
          return resolve(false);
        }
        
        console.log('S3 delete success:', data);
        return resolve(true);
      });
    } catch (error) {
      console.error('Unexpected error in deleteFileFromS3:', error);
      resolve(false);
    }
  });
};

module.exports = {
  upload,
  deleteFileFromS3,
  s3,
  handleS3Errors
};