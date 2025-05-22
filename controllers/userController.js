const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const WhatsAppVerification = require('../models/WhatsAppVerification');
const whatsappService = require('../services/whatsappService');

// Phone number normalization
const normalizePhoneNumber = (phoneNumber) => {
  if (!phoneNumber) return '';
  let normalized = phoneNumber.replace(/[^\d+]/g, '');
  if (!normalized.startsWith('+')) {
    normalized = '+' + normalized;
  }
  return normalized;
};

// Generate 6-digit verification code
const generateVerificationCode = () => {
  return Math.floor(100000 + Math.random() * 900000).toString();
};

// Register User
const registerUser = async (req, res) => {
  const { firstName, lastName, phoneNumber, email, password } = req.body;

  try {
    // Check if user already exists
    const existingUser = await User.findOne({ $or: [{ email }, { phoneNumber }] });

    if (existingUser) {
      return res.status(400).json({ message: 'Email or phone number already exists' });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Create user
    const user = new User({
      firstName,
      lastName,
      phoneNumber,
      email,
      password: hashedPassword,
    });

    await user.save();

    res.status(201).json({ message: 'User registered successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while registering user' });
  }
};

// Login User
const loginUser = async (req, res) => {
  const { email, password } = req.body;

  try {
    const user = await User.findOne({ email });

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(400).json({ message: 'Invalid credentials' });
    }

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: '1h',
    });

    res.status(200).json({
      message: "Login successful",
      token,
      user: {
        _id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
        phoneNumber: user.phoneNumber, // Make sure this is included
        username: user.username,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      },
    })
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while logging in' });
  }
};

// Get Current User
const getCurrentUser = async (req, res) => {
  try {
    const user = req.user;
    const { password, ...userWithoutPassword } = user.toObject();

    res.status(200).json({ user: userWithoutPassword });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while fetching user' });
  }
};

// Get User Profile (detailed view)
const getUserProfile = async (req, res) => {
  try {
    const user = req.user;
    const { password, ...userProfile } = user.toObject();

    // Add additional profile information
    const profileData = {
      ...userProfile,
      memberSince: user.createdAt,
      profileCompleted: !!(user.firstName && user.lastName && user.phoneNumber && user.email),
      lastLogin: user.lastLogin || user.updatedAt
    };

    res.status(200).json({
      success: true,
      profile: profileData
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({
      success: false,
      message: 'Server error while fetching profile'
    });
  }
};

// Request Phone Number Change Verification
const requestPhoneVerification = async (req, res) => {
  try {
    let { newPhoneNumber } = req.body;
    const user = req.user;

    if (!newPhoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'New phone number is required'
      });
    }

    // Normalize phone number
    newPhoneNumber = normalizePhoneNumber(newPhoneNumber);

    // Check if phone number is already in use by another user
    const existingUser = await User.findOne({
      phoneNumber: newPhoneNumber,
      _id: { $ne: user._id }
    });

    if (existingUser) {
      return res.status(409).json({
        success: false,
        message: 'This phone number is already registered to another account'
      });
    }

    // Check if it's the same as current phone number
    if (newPhoneNumber === user.phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'This is your current phone number'
      });
    }

    // Check if WhatsApp service is ready
    const serviceStatus = whatsappService.getStatus();
    if (!serviceStatus.isReady) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp service temporarily unavailable'
      });
    }

    // Check for existing verification request
    const existingVerification = await WhatsAppVerification.findByPhone(newPhoneNumber);
    if (existingVerification) {
      if (existingVerification.isBlocked()) {
        return res.status(429).json({
          success: false,
          message: 'Too many attempts. Please try again later.',
          blockedUntil: existingVerification.blockedUntil
        });
      }

      // Rate limit: 1 request per minute
      const timeSinceLastAttempt = Date.now() - existingVerification.lastAttemptAt;
      if (timeSinceLastAttempt < 60000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait before requesting another code',
          retryAfter: Math.ceil((60000 - timeSinceLastAttempt) / 1000)
        });
      }
    }

    // Generate verification code
    const verificationCode = generateVerificationCode();

    // Save verification request
    await WhatsAppVerification.createVerification(newPhoneNumber, verificationCode);

    // Send verification code via WhatsApp
    const verificationMessage = `📱 *Changement de numéro - Ndaku*

Bonjour ${user.firstName},

Votre code de vérification pour changer votre numéro est: *${verificationCode}*

Ce code expire dans 5 minutes.
⚠️ Ne partagez ce code avec personne.

Si vous n'avez pas demandé ce changement, ignorez ce message.

---
Ndaku - Plateforme de location sécurisée`;

    await whatsappService.sendMessage(newPhoneNumber, verificationMessage);

    console.log(`📱 Phone verification code sent to ${newPhoneNumber.substring(0, 7)}*** for user ${user._id}`);

    res.json({
      success: true,
      message: 'Verification code sent to new phone number',
      phoneNumber: newPhoneNumber.substring(0, 7) + '***'
    });

  } catch (error) {
    console.error('Error sending phone verification code:', error);

    let errorMessage = 'Failed to send verification code';
    let statusCode = 500;

    if (error.message.includes('not registered')) {
      errorMessage = 'Phone number not registered on WhatsApp';
      statusCode = 400;
    } else if (error.message.includes('not ready')) {
      errorMessage = 'WhatsApp service temporarily unavailable';
      statusCode = 503;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage
    });
  }
};

// Update Profile (with phone verification if needed)
const updateProfile = async (req, res) => {
  try {
    let { firstName, lastName, email, newPhoneNumber, verificationCode } = req.body;
    const user = req.user;

    // Update basic information
    if (firstName) user.firstName = firstName;
    if (lastName) user.lastName = lastName;
    if (email && email !== user.email) {
      // Check if email is already in use
      const existingUser = await User.findOne({
        email: email,
        _id: { $ne: user._id }
      });

      if (existingUser) {
        return res.status(409).json({
          success: false,
          message: 'This email is already registered to another account'
        });
      }
      user.email = email;
    }

    // Handle phone number change if requested
    if (newPhoneNumber) {
      newPhoneNumber = normalizePhoneNumber(newPhoneNumber);

      if (!verificationCode) {
        return res.status(400).json({
          success: false,
          message: 'Verification code is required to change phone number'
        });
      }

      // Find and verify the phone verification
      const verification = await WhatsAppVerification.findByPhone(newPhoneNumber);
      if (!verification) {
        return res.status(400).json({
          success: false,
          message: 'Verification code expired or not found'
        });
      }

      if (verification.isBlocked()) {
        return res.status(429).json({
          success: false,
          message: 'Too many failed attempts. Please request a new code.'
        });
      }

      if (verification.verificationCode !== verificationCode) {
        await verification.incrementAttempts();

        return res.status(400).json({
          success: false,
          message: 'Invalid verification code',
          attemptsLeft: Math.max(0, 5 - verification.attempts)
        });
      }

      // Verification successful - update phone number
      user.phoneNumber = newPhoneNumber;

      // Clean up verification record
      await WhatsAppVerification.deleteOne({ _id: verification._id });

      console.log(`📱 Phone number updated successfully for user ${user._id}`);
    }

    user.profileUpdated = true;
    user.updatedAt = new Date();
    await user.save();

    // Return updated user data (without password)
    const { password, ...updatedUser } = user.toObject();

    res.status(200).json({
      success: true,
      message: 'Profile updated successfully',
      user: updatedUser
    });

  } catch (error) {
    console.error('Error updating profile:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while updating profile'
    });
  }
};

// Change Password
const changePassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    const userId = req.user._id;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Current password and new password are required'
      });
    }

    // Fetch user with password field
    const user = await User.findById(userId).select('+password');

    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    // Use the model's comparePassword method if available
    let isCurrentPasswordValid;
    if (user.comparePassword) {
      isCurrentPasswordValid = await user.comparePassword(currentPassword);
    } else {
      // Fallback to direct bcrypt comparison
      isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password);
    }

    if (!isCurrentPasswordValid) {
      return res.status(400).json({
        success: false,
        message: 'Current password is incorrect'
      });
    }

    // Validate new password strength
    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'New password must be at least 6 characters long'
      });
    }

    // Hash and update password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    user.updatedAt = new Date();
    await user.save();

    console.log(`🔐 Password changed successfully for user ${user._id}`);

    res.json({
      success: true,
      message: 'Password changed successfully'
    });

  } catch (error) {
    console.error('Error changing password:', error);
    res.status(500).json({
      success: false,
      message: 'Server error while changing password'
    });
  }
};

// Request Password Reset via WhatsApp
const requestPasswordReset = async (req, res) => {
  try {
    let { phoneNumber } = req.body;

    if (!phoneNumber) {
      return res.status(400).json({
        success: false,
        message: 'Phone number is required'
      });
    }

    phoneNumber = normalizePhoneNumber(phoneNumber);

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'No account found with this phone number'
      });
    }

    const serviceStatus = whatsappService.getStatus();
    if (!serviceStatus.isReady) {
      return res.status(503).json({
        success: false,
        message: 'WhatsApp service temporarily unavailable'
      });
    }

    const existingReset = await WhatsAppVerification.findByPhone(phoneNumber);
    if (existingReset) {
      if (existingReset.isBlocked()) {
        return res.status(429).json({
          success: false,
          message: 'Too many attempts. Please try again later.',
          blockedUntil: existingReset.blockedUntil
        });
      }

      const timeSinceLastAttempt = Date.now() - existingReset.lastAttemptAt;
      if (timeSinceLastAttempt < 60000) {
        return res.status(429).json({
          success: false,
          message: 'Please wait before requesting another code',
          retryAfter: Math.ceil((60000 - timeSinceLastAttempt) / 1000)
        });
      }
    }

    const resetCode = generateVerificationCode();
    await WhatsAppVerification.createVerification(phoneNumber, resetCode);

    const resetMessage = `🔐 *Réinitialisation de mot de passe Ndaku*

Bonjour ${user.firstName},

Votre code de réinitialisation est: *${resetCode}*

Ce code expire dans 5 minutes.
⚠️ Ne partagez ce code avec personne.

Si vous n'avez pas demandé cette réinitialisation, ignorez ce message.

---
Ndaku - Plateforme de location sécurisée`;

    await whatsappService.sendMessage(phoneNumber, resetMessage);

    res.json({
      success: true,
      message: 'Password reset code sent via WhatsApp',
      phoneNumber: phoneNumber.substring(0, 7) + '***'
    });

  } catch (error) {
    console.error('Error sending password reset code:', error);

    let errorMessage = 'Failed to send reset code';
    let statusCode = 500;

    if (error.message.includes('not registered')) {
      errorMessage = 'Phone number not registered on WhatsApp';
      statusCode = 400;
    } else if (error.message.includes('not ready')) {
      errorMessage = 'WhatsApp service temporarily unavailable';
      statusCode = 503;
    }

    res.status(statusCode).json({
      success: false,
      message: errorMessage
    });
  }
};

// Reset Password
const resetPassword = async (req, res) => {
  try {
    let { phoneNumber, code, newPassword } = req.body;

    if (!phoneNumber || !code || !newPassword) {
      return res.status(400).json({
        success: false,
        message: 'Phone number, code, and new password are required'
      });
    }

    if (newPassword.length < 6) {
      return res.status(400).json({
        success: false,
        message: 'Password must be at least 6 characters long'
      });
    }

    phoneNumber = normalizePhoneNumber(phoneNumber);

    const verification = await WhatsAppVerification.findByPhone(phoneNumber);
    if (!verification) {
      return res.status(400).json({
        success: false,
        message: 'Reset code expired or not found'
      });
    }

    if (verification.isBlocked()) {
      return res.status(429).json({
        success: false,
        message: 'Too many failed attempts. Please request a new code.',
        blockedUntil: verification.blockedUntil
      });
    }

    if (verification.verificationCode !== code) {
      await verification.incrementAttempts();

      return res.status(400).json({
        success: false,
        message: 'Invalid reset code',
        attemptsLeft: Math.max(0, 5 - verification.attempts)
      });
    }

    const user = await User.findOne({ phoneNumber });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: 'User not found'
      });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 10);
    user.password = hashedPassword;
    await user.save();

    await WhatsAppVerification.deleteOne({ _id: verification._id });

    const confirmationMessage = `✅ *Mot de passe mis à jour - Ndaku*

Bonjour ${user.firstName},

Votre mot de passe a été mis à jour avec succès.

Si ce n'était pas vous, contactez-nous immédiatement.

---
Ndaku - Plateforme de location sécurisée`;

    try {
      await whatsappService.sendMessage(phoneNumber, confirmationMessage);
    } catch (error) {
      console.error('Failed to send confirmation message:', error);
    }

    res.json({
      success: true,
      message: 'Password reset successfully'
    });

  } catch (error) {
    console.error('Error resetting password:', error);
    res.status(500).json({
      success: false,
      message: 'Failed to reset password'
    });
  }
};

// Delete User (admin only)
const deleteUser = async (req, res) => {
  const { id } = req.params;

  try {
    const user = await User.findByIdAndDelete(id);

    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    res.status(200).json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error(error);
    res.status(500).json({ message: 'Server error while deleting user' });
  }
};

module.exports = {
  registerUser,
  loginUser,
  getCurrentUser,
  getUserProfile,
  updateProfile,
  changePassword,
  requestPhoneVerification,
  requestPasswordReset,
  resetPassword,
  deleteUser,
  updateUserProfile: updateProfile
};
