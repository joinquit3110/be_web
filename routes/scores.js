const router = require('express').Router();
const auth = require('../middleware/auth');
const User = require('../models/User');

// Get user scores
router.get('/', auth, async (req, res) => {
  try {
    const user = await User.findById(req.user.id);
    res.json(user.scores);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Add new score
router.post('/', auth, async (req, res) => {
  try {
    const { exerciseId, score } = req.body;
    const user = await User.findById(req.user.id);
    
    user.scores.push({
      exerciseId,
      score,
      completedAt: new Date()
    });
    
    await user.save();
    res.status(201).json(user.scores);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router;
