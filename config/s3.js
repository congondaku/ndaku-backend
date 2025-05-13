// config/s3.js
const AWS = require('aws-sdk');
const multerS3 = require('multer-s3');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Make sure dotenv is loaded
const dotenv = require('dotenv');
dotenv.config({ path: path.resolve(__dirname, '../.env') });

// Force reload AWS credentials from .env file directly
let awsAccessKeyId, awsSecretAccessKey, awsRegion, bucketName;

try {
  // Try to read directly from .env file
  const envPath = path.resolve(__dirname, '../.env');
  if (fs.existsSync(envPath)) {
    const envContent = fs.readFileSync(envPath, 'utf8');
    const lines = envContent.split('\n');
    
    lines.forEach(line => {
      if (line.startsWith('AWS_ACCESS_KEY_ID=')) {
        awsAccessKeyId = line.split('=')[1].trim();
      } else if (line.startsWith('AWS_SECRET_ACCESS_KEY=')) {
        awsSecretAccessKey = line.split('=')[1].trim();
      } else if (line.startsWith('AWS_REGION=')) {
        awsRegion = line.split('=')[1].trim();
      } else if (line.startsWith('AWS_S3_BUCKET_NAME=')) {
        bucketName = line.split('=')[1].trim();
      }
    });
    
    console.log('AWS credentials loaded directly from .env file');
  }
} catch (err) {
  console.error('Error reading .env file directly:', err.message);
}

// Fallback to process.env if direct reading failed
awsAccessKeyId = awsAccessKeyId || process.env.AWS_ACCESS_KEY_ID;
awsSecretAccessKey = awsSecretAccessKey || process.env.AWS_SECRET_ACCESS_KEY;
awsRegion = awsRegion || process.env.AWS_REGION || 'us-east-1';
bucketName = bucketName || process.env.AWS_S3_BUCKET_NAME || 'congondaku';

// Check for missing credentials - REMOVED hardcoded values
if (!awsAccessKeyId || !awsSecretAccessKey) {
  console.error('⚠️ WARNING: AWS credentials not found in environment variables!');
  console.error('Please ensure AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY are set in your .env file');
  console.error('Uploads may fail or fall back to local storage');
}

// Log AWS config for debugging (without revealing actual credentials)
console.log('AWS Config:', {
  accessKeyExists: !!awsAccessKeyId,
  secretKeyExists: !!awsSecretAccessKey,
  region: awsRegion,
  bucket: bucketName
});

// Create S3 service object with explicit credentials
const s3 = new AWS.S3({
  accessKeyId: awsAccessKeyId,
  secretAccessKey: awsSecretAccessKey,
  region: awsRegion
});

// Test S3 connection
s3.listBuckets((err, data) => {
  if (err) {
    console.error('Error testing S3 connection:', err);
  } else {
    console.log('Successfully connected to AWS S3. Available buckets:',
      data.Buckets.map(b => b.Name).join(', '));
  }
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

// Create multer upload with primary and fallback storage
let upload;
try {
  upload = multer({
    storage: storage,
    limits: {
      fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: fileFilter
  });
  console.log('S3 storage configured for uploads');
} catch (err) {
  console.error('Error configuring S3 storage, falling back to disk storage:', err);
  upload = multer({
    storage: diskStorage,
    limits: {
      fileSize: 5 * 1024 * 1024 // 5 MB
    },
    fileFilter: fileFilter
  });
}

// Function to delete a file from S3
const deleteFileFromS3 = async (fileUrl) => {
  try {
    if (!fileUrl) return false;
    
    // Extract key from S3 URL
    let key = '';
    if (fileUrl.includes(bucketName)) {
      const urlParts = fileUrl.split('/');
      const bucketIndex = urlParts.findIndex(part => part === bucketName || part.includes(bucketName));
      if (bucketIndex >= 0) {
        key = urlParts.slice(bucketIndex + 1).join('/');
      }
    }
    
    if (!key) {
      console.warn('Could not parse S3 URL:', fileUrl);
      return false;
    }
    
    console.log(`Attempting to delete S3 file: ${key} from bucket ${bucketName}`);
    
    await s3.deleteObject({
      Bucket: bucketName,
      Key: key
    }).promise();
    
    console.log(`Successfully deleted file from S3: ${key}`);
    return true;
  } catch (error) {
    console.error('Error deleting file from S3:', error);
    return false;
  }
};

module.exports = {
  upload,
  deleteFileFromS3,
  s3 // Export s3 client for potential direct usage
};
