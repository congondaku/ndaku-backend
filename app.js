const express = require('express');
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const cors = require('cors');
const path = require('path'); // Add this import at the top
const userRoutes = require('./routes/user-routes');
const listingRoutes = require('./routes/listing-routes');
const adminRoutes = require('./routes/adminRoutes');

// Config
dotenv.config();

// App setup
const app = express();

// Middleware
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static('uploads'));

// API routes
app.use('/api/users', userRoutes);
app.use('/api/listings', listingRoutes);
app.use('/api/admin', adminRoutes);

// Serve React in production
if (process.env.NODE_ENV === 'production') {
  // Adjust this path to where your React build is located
  const reactBuildPath = path.join(__dirname, '../frontend/dist');
  
  // Serve static files
  app.use(express.static(reactBuildPath));
  
  // Handle React routing
  app.get('*', (req, res) => {
    res.sendFile(path.join(reactBuildPath, 'index.html'));
  });
}

// Database & Server connection
const PORT = process.env.PORT || 5001;
const MONGO_URI = process.env.MONGODB_URI;

mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => {
    console.log('✅ Connected to MongoDB');
    app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
  })
  .catch((err) => {
    console.error('❌ MongoDB connection error:', err.message);
    process.exit(1);
  });
  