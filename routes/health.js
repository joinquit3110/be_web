const router = require('express').Router();

router.get('/', (req, res) => {
  res.json({ status: 'healthy' });
});

module.exports = router;
