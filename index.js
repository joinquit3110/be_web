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
const notificationsRoutes = require('./routes/notifications');
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
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  credentials: true, // Allow cookies
  preflightContinue: false,
  optionsSuccessStatus: 204
}));

// Set additional headers for better CORS handling
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Credentials', 'true');
  res.header('Access-Control-Allow-Origin', req.headers.origin);
  res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,PATCH,OPTIONS');
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

// Socket.IO setup with improved connection tracking
const socketIO = require('socket.io');
const server = require('http').createServer(app);
const io = socketIO(server, {
  cors: {
    origin: '*', // Allow all origins in development
    methods: ['GET', 'POST'],
    credentials: true
  },
  pingTimeout: 30000, // How long to wait before considering a client disconnected
  pingInterval: 10000, // How often to ping clients to check connection
});

// Store active connections with improved handling
const activeConnections = new Map();
// Track user online status with timestamps
const userStatus = new Map(); // userId -> { online: boolean, lastSeen: Date }

// Socket.IO connection handling
io.on('connection', (socket) => {
  console.log('New client connected', socket.id);
  let authenticatedUserId = null;
  
  // Handle user authentication
  socket.on('authenticate', (userData) => {
    if (userData && userData.userId) {
      authenticatedUserId = userData.userId.toString();
      // Store user connection for targeted updates
      activeConnections.set(authenticatedUserId, socket.id);
      
      // Update online status
      userStatus.set(authenticatedUserId, { 
        online: true, 
        lastSeen: new Date(),
        house: userData.house || null,
        username: userData.username || null
      });
      
      // Join user to their house room if available
      if (userData.house) {
        socket.join(userData.house);
        console.log(`User ${userData.userId} joined house ${userData.house}`);
        
        // Also join a role-based room
        const role = userData.isAdmin ? 'admin' : 'student';
        socket.join(role);
      }
      
      // Join admin broadcast channel for system-wide announcements
      socket.join('system-updates');
      
      console.log(`User ${userData.userId} authenticated, socket ID: ${socket.id}`);
      console.log(`Active connections: ${activeConnections.size}`);
      
      // Notify user they are connected
      socket.emit('connection_status', { 
        connected: true, 
        timestamp: new Date().toISOString(),
        message: 'Successfully connected to real-time updates'
      });
    }
  });
  
  // Handle heartbeat to keep track of active users
  socket.on('heartbeat', () => {
    if (authenticatedUserId) {
      const status = userStatus.get(authenticatedUserId);
      if (status) {
        status.lastSeen = new Date();
        userStatus.set(authenticatedUserId, status);
      }
    }
  });
  
  // Handle house change
  socket.on('change_house', async ({ userId, oldHouse, newHouse }) => {
    if (oldHouse) {
      socket.leave(oldHouse);
      console.log(`User ${userId} left house ${oldHouse}`);
    }
    
    if (newHouse) {
      socket.join(newHouse);
      console.log(`User ${userId} joined house ${newHouse}`);
      
      // Update user status with new house
      if (userId && userStatus.has(userId.toString())) {
        const status = userStatus.get(userId.toString());
        status.house = newHouse;
        userStatus.set(userId.toString(), status);
        
        // Send notification to the user about house change
        socket.emit('sync_update', {
          type: 'user_update',
          timestamp: new Date().toISOString(),
          data: {
            updatedFields: {
              house: newHouse
            }
          }
        });
      }
    }
  });
  
  // NEW: Handle admin house points update
  socket.on('admin_house_points', ({ house, points, reason }) => {
    // Verify that this is coming from an admin (should also be validated server-side)
    // This is a simplified example - in production, use proper authentication
    if (house && points) {
      console.log(`Admin updating ${house} points by ${points}. Reason: ${reason}`);
      
      // Broadcast to all users in that house
      io.to(house).emit('house_points_update', {
        house,
        points,
        newTotal: 0, // This would be calculated from the database
        reason,
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // NEW: Handle admin targeted notification
  socket.on('admin_notification', ({ targetUser, targetHouse, message, notificationType }) => {
    console.log(`Admin sending notification - Target user: ${targetUser}, Target house: ${targetHouse}`);
    
    // Send to specific user if provided
    if (targetUser && activeConnections.has(targetUser)) {
      const targetSocketId = activeConnections.get(targetUser);
      io.to(targetSocketId).emit('admin_notification', {
        message,
        notificationType: notificationType || 'info',
        timestamp: new Date().toISOString()
      });
    }
    
    // Send to entire house if provided
    if (targetHouse) {
      io.to(targetHouse).emit('admin_notification', {
        message,
        notificationType: notificationType || 'info',
        timestamp: new Date().toISOString()
      });
    }
  });
  
  // NEW: Handle global announcement from admin
  socket.on('global_announcement', ({ message }) => {
    console.log(`Admin sending global announcement: ${message}`);
    
    // Broadcast to all connected clients
    io.emit('global_announcement', {
      message,
      timestamp: new Date().toISOString()
    });
  });
  
  // Handle force sync request from client
  socket.on('request_sync', () => {
    if (authenticatedUserId) {
      console.log(`User ${authenticatedUserId} requested data sync`);
      socket.emit('sync_update', {
        type: 'force_sync',
        timestamp: new Date().toISOString(),
        message: 'Sync requested by client'
      });
    }
  });
  
  // NEW: Handle user real-time status request
  socket.on('get_online_users', ({ house }, callback) => {
    // Get all online users, optionally filtering by house
    const onlineUsers = [];
    
    for (const [userId, status] of userStatus.entries()) {
      if (status.online && (!house || status.house === house)) {
        onlineUsers.push({
          userId,
          username: status.username,
          house: status.house,
          lastSeen: status.lastSeen
        });
      }
    }
    
    // If this has a callback, call it with the results
    if (typeof callback === 'function') {
      callback(onlineUsers);
    } else {
      // Otherwise, emit an event back
      socket.emit('online_users', { users: onlineUsers });
    }
  });
  
  // Handle disconnect
  socket.on('disconnect', () => {
    // Remove user from activeConnections
    if (authenticatedUserId) {
      activeConnections.delete(authenticatedUserId);
      
      // Update online status
      if (userStatus.has(authenticatedUserId)) {
        const status = userStatus.get(authenticatedUserId);
        status.online = false;
        status.lastSeen = new Date();
        userStatus.set(authenticatedUserId, status);
      }
      
      console.log(`User ${authenticatedUserId} disconnected`);
    }
    
    console.log(`Client disconnected ${socket.id}, remaining connections: ${activeConnections.size}`);
  });
});

// Add periodic cleanup of stale connections
setInterval(() => {
  const now = new Date();
  let cleanedCount = 0;
  
  // Check for stale entries in userStatus
  for (const [userId, status] of userStatus.entries()) {
    // If marked as online but hasn't been seen in 2 minutes
    if (status.online && (now - status.lastSeen > 2 * 60 * 1000)) {
      status.online = false;
      userStatus.set(userId, status);
      
      // Also remove from activeConnections if present
      if (activeConnections.has(userId)) {
        activeConnections.delete(userId);
        cleanedCount++;
      }
    }
    
    // Remove very old offline entries (more than 24 hours)
    if (!status.online && (now - status.lastSeen > 24 * 60 * 60 * 1000)) {
      userStatus.delete(userId);
    }
  }
  
  if (cleanedCount > 0) {
    console.log(`Cleaned up ${cleanedCount} stale connections`);
  }
}, 60000); // Run every minute

// Make io accessible in routes
app.set('io', io);
app.set('activeConnections', activeConnections);
app.set('userStatus', userStatus); // Add userStatus to app for route usage

// NEW: Helper function to send real-time notifications to users
app.locals.sendRealTimeNotification = (options) => {
  const { userId, house, message, type, title } = options;
  
  try {
    // Option 1: Send to specific user
    if (userId && activeConnections.has(userId)) {
      const socketId = activeConnections.get(userId);
      io.to(socketId).emit('admin_notification', {
        message,
        notificationType: type || 'info',
        title,
        timestamp: new Date().toISOString()
      });
      return true;
    }
    
    // Option 2: Send to an entire house
    if (house) {
      io.to(house).emit('admin_notification', {
        message,
        notificationType: type || 'info',
        title,
        timestamp: new Date().toISOString()
      });
      return true;
    }
    
    return false;
  } catch (error) {
    console.error('Error sending real-time notification:', error);
    return false;
  }
};

// NEW: Helper function to broadcast house point changes
app.locals.broadcastHousePointsUpdate = (house, pointChange, newTotal, reason) => {
  try {
    if (!house) return false;
    
    io.to(house).emit('house_points_update', {
      house,
      points: pointChange,
      newTotal,
      reason: reason || 'Admin action',
      timestamp: new Date().toISOString()
    });
    
    return true;
  } catch (error) {
    console.error('Error broadcasting house points update:', error);
    return false;
  }
};

// NEW: Helper function to update user fields in real-time
app.locals.updateUserInRealTime = (userId, updatedFields) => {
  try {
    if (!userId || !activeConnections.has(userId)) return false;
    
    const socketId = activeConnections.get(userId);
    io.to(socketId).emit('sync_update', {
      type: 'user_update',
      timestamp: new Date().toISOString(),
      data: {
        updatedFields
      }
    });
    
    return true;
  } catch (error) {
    console.error('Error updating user in real-time:', error);
    return false;
  }
};

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
app.use(`${API_PREFIX}/notifications`, notificationsRoutes);

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
server.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT}`);
  console.log('Access URLs:');
  console.log(`- Local: http://localhost:${PORT}`);
  console.log(`- Network: http://192.168.1.53:${PORT}`);
  console.log(`- API: http://192.168.1.53:${PORT}/api`);
});
