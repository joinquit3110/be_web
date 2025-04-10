const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');
const mongoose = require('mongoose');

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
    
    // Ensure points can't go below 0 or above 1000
    const validatedPoints = Math.max(0, Math.min(1000, parseInt(magicPoints, 10)));
    
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
    
    // Also update the user's scores array with this activity
    const activityScore = {
      activityType: 'magic_points_update',
      score: validatedPoints,
      timestamp: new Date()
    };
    
    await User.findByIdAndUpdate(
      req.user.id,
      { $push: { scores: activityScore } },
      { new: false } // Don't return the updated document
    );
    
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
    
    // More robust validation of the operations array
    if (!operations || !Array.isArray(operations) || operations.length === 0) {
      console.log('[BE] Invalid or empty operations array in sync request');
      return res.status(400).json({ message: 'Valid non-empty operations array is required' });
    }
    
    // Use a transaction or session to prevent race conditions
    const session = await mongoose.startSession();
    session.startTransaction();
    
    try {
      // Process operations in order with server-side consistency
      const user = await User.findById(req.user.id).session(session);
      if (!user) {
        await session.abortTransaction();
        session.endSession();
        return res.status(404).json({ message: 'User not found' });
      }
      
      let currentPoints = user.magicPoints || 100;
      console.log(`[BE] Current points before sync: ${currentPoints}`);
      
      // Apply all operations in order within the transaction
      for (const op of operations) {
        const amount = typeof op.amount === 'string' ? parseFloat(op.amount) : op.amount;
        
        if (op.type === 'add') {
          currentPoints += amount;
        } else if (op.type === 'remove') {
          currentPoints = Math.max(0, currentPoints - amount);
        } else if (op.type === 'set') {
          currentPoints = Math.max(0, amount);
        }
      }
      
      // Ensure points is valid and within reasonable bounds
      currentPoints = Math.max(0, Math.min(1000, isNaN(currentPoints) ? 100 : currentPoints));
      
      // Update user with final value
      await User.findByIdAndUpdate(
        req.user.id,
        { 
          $set: { 
            magicPoints: currentPoints, 
            lastMagicPointsUpdate: new Date() 
          } 
        },
        { session }
      );
      
      // Also add to user's scores array for tracking
      const scoreEntry = {
        activityType: 'magic_points_sync',
        score: currentPoints,
        details: `Synced ${operations.length} operations`,
        timestamp: new Date()
      };
      
      await User.findByIdAndUpdate(
        req.user.id,
        { $push: { scores: scoreEntry } },
        { session }
      );
      
      // Commit the transaction
      await session.commitTransaction();
      session.endSession();
      
      console.log(`[BE] Successfully synced points for user ${req.user.id}, new value: ${currentPoints}`);
      res.json({ 
        magicPoints: currentPoints,
        timestamp: new Date().toISOString()
      });
    } catch (innerError) {
      // Abort transaction on error
      await session.abortTransaction();
      session.endSession();
      throw innerError;
    }
  } catch (err) {
    console.error('[BE] Error syncing magic points:', err);
    res.status(500).json({ 
      message: err.message || 'Internal server error during point sync'
    });
  }
});

module.exports = router;
