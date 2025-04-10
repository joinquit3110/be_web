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
    
    const user = await User.findByIdAndUpdate(
      req.user.id,
      { $set: { magicPoints, lastMagicPointsUpdate: timestamp || new Date() } },
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

module.exports = router;
