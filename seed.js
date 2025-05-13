require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs'); // ← add this
const Admin = require('./models/Admin');

const start = async () => {
  await mongoose.connect(process.env.MONGODB_URI);

  const existing = await Admin.findOne({ email: 'yousyogue@gmail.com' });
  if (existing) {
    console.log('Superadmin already exists.');
    return process.exit();
  }


  const superadmin = new Admin({
    firstName: 'Youssouf',
    lastName: 'Yogue',
    email: 'yousyogue@gmail.com',
    password: 'Kin00243!',  // plain text password, schema will hash it
    role: 'superadmin',
  });
  

  await superadmin.save();
  console.log('Superadmin created');
  process.exit();
};

start();
