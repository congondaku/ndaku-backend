// fix-listing-direct.js
const mongoose = require('mongoose');
const dotenv = require('dotenv');
const path = require('path');

// Use explicit path to ensure .env is found
dotenv.config({ path: path.resolve(__dirname, "./.env") });

const MONGO_URI = process.env.MONGODB_URI;
console.log('Connecting to MongoDB...');

mongoose.connect(MONGO_URI)
  .then(() => console.log('Connected to MongoDB'))
  .catch(err => {
    console.error('MongoDB connection error:', err);
    process.exit(1);
  });

// Define simplified schema for updating
const listingSchema = new mongoose.Schema({}, { strict: false });
const Listing = mongoose.model('Listing', listingSchema, 'listings');

async function fixListing() {
  try {
    const listingId = "68214f3df634c9d72b3e9891";
    
    console.log(`Looking for listing ${listingId}...`);
    
    // First, let's check if the listing exists
    const existingListing = await Listing.findById(listingId);
    if (!existingListing) {
      console.error('❌ Listing not found! Check the ID and try again.');
      return;
    }
    
    console.log('Found listing:', existingListing.title || 'No title');
    console.log('Current status:', existingListing.status);
    console.log('Current payment status:', existingListing.paymentStatus);
    
    // Calculate new expiry date - 3 months from now
    const expiryDate = new Date();
    expiryDate.setMonth(expiryDate.getMonth() + 3);
    
    console.log(`Updating listing ${listingId}...`);
    console.log('New expiry date will be:', expiryDate);
    
    // Update the listing using updateOne
    const result = await Listing.updateOne(
      { _id: listingId },
      { 
        $set: { 
          status: "available", 
          paymentStatus: "paid",
          paymentId: "78452",
          activeSubscription: true,
          subscriptionPlan: "3_months",
          subscriptionStartDate: new Date(),
          expiryDate: expiryDate
        } 
      }
    );
    
    console.log('Update result:', result);
    
    if (result.matchedCount === 1 && result.modifiedCount === 1) {
      console.log('✅ Listing updated successfully!');
      
      // Verify the update by fetching the updated listing
      const updatedListing = await Listing.findById(listingId);
      console.log('---------- UPDATED LISTING ----------');
      console.log('Title:', updatedListing.title || 'No title');
      console.log('Status:', updatedListing.status);
      console.log('Payment status:', updatedListing.paymentStatus);
      console.log('Subscription active:', updatedListing.activeSubscription);
      console.log('Expiry date:', updatedListing.expiryDate);
      console.log('--------------------------------------');
    } else if (result.matchedCount === 1 && result.modifiedCount === 0) {
      console.log('⚠️ Listing found but not modified. It might already have these values.');
    } else {
      console.log('❌ Listing not updated. Check the ID and try again.');
    }
  } catch (error) {
    console.error('Error fixing listing:', error);
  } finally {
    // Close MongoDB connection when done
    console.log('Disconnecting from MongoDB...');
    await mongoose.disconnect();
    console.log('Disconnected from MongoDB');
  }
}

// Run the fix
console.log('Starting listing fix script...');
fixListing();