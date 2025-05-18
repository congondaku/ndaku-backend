const updateSubscriptionStatus = async () => {
  try {
    const currentDate = new Date();
    
    // Find listings with an expiry date in the past but active subscription still set to true
    const expiredListings = await Listing.find({
      expiryDate: { $lt: currentDate },
      activeSubscription: true
    });
    
    // Update them all to set activeSubscription to false
    if (expiredListings.length > 0) {
      const updatePromises = expiredListings.map(listing => {
        listing.activeSubscription = false;
        return listing.save();
      });
      
      await Promise.all(updatePromises);
      
      logger.info(`Updated subscription status for ${expiredListings.length} expired listings`);
    }
  } catch (error) {
    logger.error('Error updating subscription status:', error);
  }
};
