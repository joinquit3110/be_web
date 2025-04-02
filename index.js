require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const scoreRoutes = require('./routes/scores');
const path = require('path');

const app = express();

// Đơn giản hóa CORS
app.use(cors({
  origin: ['https://fe-web-lilac.vercel.app'], // Chỉ cho phép frontend của bạn truy cập
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', '*'],
}));
app.use(express.json());

// Connect to MongoDB with updated configuration
mongoose.connect(process.env.MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  useNewUrlParser: true,
  useUnifiedTopology: true,
})
.then(() => console.log("Successfully connected to MongoDB Atlas!"))
.catch(err => {
  console.error("MongoDB connection error:", err);
  process.exit(1);
});

// Add version prefix to all routes
const API_PREFIX = '/api';

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve the React frontend in production
if (process.env.NODE_ENV === 'production') {
  app.use(express.static(path.join(__dirname, 'public')));
  
  // Handle React routing, return all requests to React app
  app.get('*', (req, res, next) => {
    if (req.url.startsWith('/api')) {
      return next();
    }
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
}

// Routes with prefix
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/scores`, scoreRoutes);

// Add health check route
app.get('/api/health', (req, res) => {
  res.json({ status: 'healthy' });
});

// Update error handling
app.use((err, req, res, next) => {
  console.error('Server error:', err);
  res.status(500).json({ 
    message: err.message || 'Internal server error',
    stack: process.env.NODE_ENV === 'development' ? err.stack : undefined
  });
});

// Add catch-all route for frontend
app.get('*', (req, res) => {
  res.status(404).json({ message: 'Not Found' });
});

// Update server listening
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Access URLs:');
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.53:${PORT}`);
  console.log(`- API: http://192.168.1.53:${PORT}/api`);
});
