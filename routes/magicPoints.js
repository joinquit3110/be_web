const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get user's magic points
router.get('/', auth, async (req, res) => {
  try {
    console.log(`[BE] Fetching magic points for user: ${req.user.id}`);
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log(`[BE] User not found: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`[BE] Returning magic points for user ${req.user.id}: ${user.magicPoints || 100}`);
    res.json({ magicPoints: user.magicPoints || 100 });
  } catch (err) {
    console.error('[BE] Error fetching magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Update user's magic points
router.post('/', auth, async (req, res) => {
  try {
    const { magicPoints, timestamp } = req.body;
    console.log(`[BE] Updating magic points for user ${req.user.id} to ${magicPoints}`);
    
    if (magicPoints === undefined) {
      console.log('[BE] Magic points value is missing in the request');
      return res.status(400).json({ message: 'Magic points value is required' });
    }
    
    // Ensure points can't go below 0
    const validatedPoints = Math.max(0, parseInt(magicPoints, 10));
    
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $set: { 
          magicPoints: validatedPoints, 
          lastMagicPointsUpdate: timestamp || new Date() 
        } 
      },
      { new: true }
    );
    
    if (!updatedUser) {
      console.log(`[BE] User not found when updating points: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    console.log(`[BE] Successfully updated magic points for user ${req.user.id} to ${updatedUser.magicPoints}`);
    res.json({ 
      magicPoints: updatedUser.magicPoints,
      timestamp: updatedUser.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('[BE] Error updating magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

// Sync magic points - handles offline mode sync
router.post('/sync', auth, async (req, res) => {
  try {
    const { operations } = req.body;
    console.log(`[BE] Syncing ${operations?.length || 0} magic point operations for user ${req.user.id}`);
    
    if (!operations || !Array.isArray(operations)) {
      console.log('[BE] Invalid operations array in sync request');
      return res.status(400).json({ message: 'Valid operations array is required' });
    }
    
    const user = await User.findById(req.user.id);
    if (!user) {
      console.log(`[BE] User not found when syncing points: ${req.user.id}`);
      return res.status(404).json({ message: 'User not found' });
    }
    
    let currentPoints = user.magicPoints || 100;
    console.log(`[BE] Current points before sync: ${currentPoints}`);
    
    // Process operations in order
    for (const op of operations) {
      console.log(`[BE] Processing operation: ${op.type}, amount: ${op.amount}`);
      if (op.type === 'add') {
        currentPoints += op.amount;
      } else if (op.type === 'remove') {
        currentPoints = Math.max(0, currentPoints - op.amount);
      } else if (op.type === 'set') {
        currentPoints = Math.max(0, op.amount);
      }
    }
    
    console.log(`[BE] Points after processing operations: ${currentPoints}`);
    
    // Update user with final point value
    const updatedUser = await User.findByIdAndUpdate(
      req.user.id,
      { 
        $set: { 
          magicPoints: currentPoints, 
          lastMagicPointsUpdate: new Date() 
        } 
      },
      { new: true }
    );
    
    if (!updatedUser) {
      console.log(`[BE] Failed to update user after sync: ${req.user.id}`);
      return res.status(500).json({ message: 'Failed to update user after operations' });
    }
    
    console.log(`[BE] Successfully synced points for user ${req.user.id}, new value: ${updatedUser.magicPoints}`);
    res.json({ 
      magicPoints: updatedUser.magicPoints,
      timestamp: updatedUser.lastMagicPointsUpdate
    });
  } catch (err) {
    console.error('[BE] Error syncing magic points:', err);
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
