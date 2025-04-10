const router = require('express').Router();
const auth = require('../middleware/auth');

// Sample exercises data
const exercises = [
  {
    id: "activity1",
    title: "Linear Inequalities",
    description: "Explore the world of linear inequalities with magical challenges.",
    type: "inequality",
    difficulty: "intermediate"
  },
  {
    id: "activity2",
    title: "Systems of Equations",
    description: "Master the art of solving magical systems of equations.",
    type: "system",
    difficulty: "advanced"
  }
];

// Get all exercises
router.get('/', async (req, res) => {
  try {
    res.json(exercises);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// Get exercise by ID
router.get('/:id', async (req, res) => {
  try {
    const exercise = exercises.find(ex => ex.id === req.params.id);
    
    if (!exercise) {
      return res.status(404).json({ message: 'Exercise not found' });
    }
    
    res.json(exercise);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

module.exports = router; 