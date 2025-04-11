require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const { MongoClient, ServerApiVersion } = require('mongodb');
const cors = require('cors');
const authRoutes = require('./routes/auth');
const exerciseRoutes = require('./routes/exercises');
const scoreRoutes = require('./routes/scores');
const magicPointsRoutes = require('./routes/magicPoints');
const userRoutes = require('./routes/users');
const path = require('path');

const app = express();

// Enhanced CORS configuration for better offline/online synchronization
app.use(cors({
  origin: [
    'https://fe-web-lilac.vercel.app',  // Vercel frontend
    'http://localhost:3000',            // Local development
    'https://inequality-web.vercel.app', // Alternative frontend URL
    'https://mw15w-5173.csb.app',       // CodeSandbox URL
    'capacitor://localhost',            // Mobile app via Capacitor
    'http://localhost',                 // Alternative local development
    'http://localhost:8080',            // Another common local port
    'http://localhost:8100',            // Ionic default port
    '*'                                 // Allow all origins in development (remove in production)
  ],
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true, // Allow cookies
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Set additional headers for better CORS handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin,X-Requested-With,Content-Type,Accept,Authorization');
  next();
});

// Increase payload size limit for sync operations with many items
app.use(express.json({ limit: '5mb' }));

// Connect to MongoDB with updated configuration
console.log('Attempting to connect to MongoDB...');
const MONGODB_URI = process.env.MONGODB_URI;

if (!MONGODB_URI) {
  console.error('MongoDB URI is missing. Make sure MONGODB_URI is set in .env file');
  process.exit(1);
}

// Log a masked version of the connection string for debugging (hide password)
const maskedURI = MONGODB_URI.replace(/:([^:@]+)@/, ':******@');
console.log(`Connecting to MongoDB: ${maskedURI}`);

mongoose.connect(MONGODB_URI, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
  useNewUrlParser: true,
  useUnifiedTopology: true,
  serverSelectionTimeoutMS: 30000, // Thời gian chờ server selection là 30 giây
  socketTimeoutMS: 45000, // Thời gian chờ socket là 45 giây
})
.then(() => console.log("Successfully connected to MongoDB Atlas!"))
.catch(err => {
  console.error('MongoDB connection error:', err);
  
  // More detailed error logging
  if (err.name === 'MongoParseError') {
    console.error('Invalid MongoDB connection string. Please check your MONGODB_URI in .env');
  } else if (err.name === 'MongoServerSelectionError') {
    console.error('Cannot connect to MongoDB server. Please check your network or MongoDB Atlas status');
  } else if (err.message && err.message.includes('Authentication failed')) {
    console.error('MongoDB authentication failed. Please check your username and password');
  }
  
  process.exit(1); // Stop the program if connection fails
});

// Add version prefix to all routes
const API_PREFIX = '/api';

// Serve static files from uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Serve static files from public directory
app.use(express.static(path.join(__dirname, 'public')));

// Routes with prefix
app.use(`${API_PREFIX}/auth`, authRoutes);
app.use(`${API_PREFIX}/exercises`, exerciseRoutes);
app.use(`${API_PREFIX}/user/scores`, scoreRoutes);
app.use(`${API_PREFIX}/user/magic-points`, magicPointsRoutes);
app.use(`${API_PREFIX}/users`, userRoutes);

// Catch-all route for SPA - send index.html for any unknown routes
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

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

// Update server listening
const PORT = process.env.PORT || 5000;
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Access URLs:');
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.53:${PORT}`);
  console.log(`- API: http://192.168.1.53:${PORT}/api`);
});
