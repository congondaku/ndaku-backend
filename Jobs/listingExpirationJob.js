const cron = require('node-cron');
const Listing = require('../models/Listing');

// Delete Listings Older Than 1 Month
const deleteExpiredListings = async () => {
  const expirationDate = new Date();
  expirationDate.setMonth(expirationDate.getMonth() - 1);

  try {
    const expiredListings = await Listing.find({
      isDeleted: false,
      createdAt: { $lte: expirationDate }
    });

    for (const listing of expiredListings) {
      listing.isDeleted = true;
      await listing.save();
      console.log(`Expired listing ${listing._id} marked as deleted.`);
    }
  } catch (error) {
    console.error('Error deleting expired listings:', error);
  }
};

cron.schedule('0 0 * * *', deleteExpiredListings); // Midnight everyday
