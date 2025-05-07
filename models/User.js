const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    firstName: { type: String, required: true },
    lastName: { type: String, required: true },
    phoneNumber: { type: String, required: true, unique: true },
    email: { type: String, required: true, unique: true },
    password: { type: String, required: true },
    username: { type: String, unique: true },
    profileUpdated: { type: Boolean, default: false },
    refreshToken: { type: String },  // Store refresh token here
  },
  { timestamps: true }
);

// Auto-generate username before saving
userSchema.pre('save', async function (next) {
  if (this.isNew || this.isModified('firstName') || this.isModified('lastName')) {
    const baseUsername = `${this.firstName.toLowerCase()}.${this.lastName.toLowerCase()}`;

    let username = baseUsername;
    let count = 0;

    while (await mongoose.models.User.findOne({ username })) {
      count++;
      username = `${baseUsername}${count}`;
    }

    this.username = username;
  }
  next();
});

// Cascade delete Listings created by the user
userSchema.pre('remove', async function (next) {
  try {
    await mongoose.model('Listing').deleteMany({ createdBy: this._id });
    next();
  } catch (error) {
    next(error);
  }
});

const User = mongoose.model('User', userSchema);

module.exports = User;
