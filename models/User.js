const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
  username: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    minlength: 3
  },
  email: {
    type: String,
    required: true,
    unique: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  fullName: {
    type: String,
    trim: true
  },
  school: {
    type: String,
    trim: true
  },
  grade: {
    type: String,
    trim: true
  },
  house: {
    type: String,
    enum: ['gryffindor', 'slytherin', 'ravenclaw', 'hufflepuff', 'muggle', 'admin', ''],
    default: 'muggle'
  },
  scores: [{
    exerciseId: String,
    score: Number,
    completedAt: Date
  }],
  magicPoints: {
    type: Number,
    default: 100,
    min: 0
  },
  lastMagicPointsUpdate: {
    type: Date,
    default: Date.now
  },
  avatar: {
    type: String,
    default: null
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  // New fields for optimized sync
  needsSync: {
    type: Boolean,
    default: false
  },
  syncRequestedAt: {
    type: Date
  },
  lastSyncedAt: {
    type: Date
  }
});

module.exports = mongoose.model('User', userSchema);
