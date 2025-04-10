const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get user's magic points
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ magicPoints: user.magicPoints || 100 });
  } catch (err) {
    console.error('Error fetching magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Update user's magic points
router.post('/', auth, async (req, res) => {
  try {
    const { magicPoints, timestamp } = req.body;
    console.log(`Updating magic points for user ${req.user.id} to ${magicPoints}`);
    
    if (magicPoints === undefined) {
      return res.status(400).json({ message: 'Magic points value is required' });
    }
    
    // Ensure points can't go below 0
    const validatedPoints = Math.max(0, magicPoints);
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { magicPoints: validatedPoints, lastMagicPointsUpdate: timestamp || new Date() } },
      { new: true }
    );
    
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    res.json({ 
      magicPoints: user.magicPoints,
      timestamp: user.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('Error updating magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Sync magic points - handles offline mode sync
router.post('/sync', auth, async (req, res) => {
  try {
    const { operations } = req.body;
    
    if (!operations || !Array.isArray(operations)) {
      return res.status(400).json({ message: 'Valid operations array is required' });
    }
    
    const user = await User.findById(req.user.id);
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }
    
    let currentPoints = user.magicPoints || 100;
    
    // Process operations in order
    for (const op of operations) {
      if (op.type === 'add') {
        currentPoints += op.amount;
      } else if (op.type === 'remove') {
        currentPoints = Math.max(0, currentPoints - op.amount);
      } else if (op.type === 'set') {
        currentPoints = Math.max(0, op.amount);
      }
    }
    
    // Update user with final point value
    user.magicPoints = currentPoints;
    user.lastMagicPointsUpdate = new Date();
    await user.save();
    
    res.json({ 
      magicPoints: user.magicPoints,
      timestamp: user.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('Error syncing magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
