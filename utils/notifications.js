/**
 * Utility functions for notifications system
 */

/**
 * Create a standardized house points notification
 * @param {string} house - The house name (gryffindor, slytherin, etc.)
 * @param {number} points - Point change (positive for increase, negative for decrease)
 * @param {string} reason - The reason for the point change
 * @param {string} criteria - Assessment criteria
 * @param {string} level - Assessment level
 * @param {number} newTotal - New total points (optional)
 * @returns {Object} - Standardized notification object
 */
const createHousePointsNotification = (house, points, reason, criteria, level, newTotal = null) => {
  // Create unique ID for notification
  const notificationId = `house_points_${house}_${points}_${Date.now()}`;
  
  // Determine if positive or negative points
  const isPositive = points > 0;
  
  // Create standardized notification
  return {
    id: notificationId,
    type: "house_points", 
    subType: isPositive ? "increase" : "decrease",
    title: isPositive ? "POINTS AWARDED!" : "POINTS DEDUCTED!",
    message: formatHousePointsMessage(house, points, reason, criteria, level),
    timestamp: new Date().toISOString(),
    
    // Detailed data
    data: {
      house,
      points: Math.abs(points), // Always positive for display
      isPositive,
      reason: reason || null,
      criteria: criteria || null,
      level: level || null,
      newTotal: newTotal || null,
    },
    
    // Display data for frontend
    display: {
      color: isPositive ? "#4CAF50" : "#FF5252",
      bgColor: isPositive ? "rgba(76, 175, 80, 0.1)" : "rgba(255, 82, 82, 0.1)",
      icon: isPositive ? "increase_points" : "decrease_points",
      image: isPositive ? "IncreasePoint.png" : "DecreasePoint.png",
      animation: isPositive ? "fadeInUp" : "shakeX"
    }
  };
};

/**
 * Format a house points message in a standardized way
 * @param {string} house - The house name
 * @param {number} points - Point change
 * @param {string} reason - Reason for change
 * @param {string} criteria - Assessment criteria
 * @param {string} level - Assessment level
 * @returns {string} - Formatted message
 */
const formatHousePointsMessage = (house, points, reason, criteria, level) => {
  const isPositive = points > 0;
  const absPoints = Math.abs(points);
  
  // Capitalize house name
  const houseName = house.charAt(0).toUpperCase() + house.slice(1);
  
  // Basic message
  let message = `House ${houseName} has ${isPositive ? 'gained' : 'lost'} ${absPoints} points!`;
  
  // Add details
  const details = [];
  
  if (reason && reason !== 'Admin action' && reason.trim() !== '') {
    details.push(`Reason: ${reason}`);
  }
  
  if (criteria && criteria.trim() !== '') {
    details.push(`Criteria: ${criteria}`);
  }
  
  if (level && level.trim() !== '') {
    details.push(`Level: ${level}`);
  }
  
  // Combine message and details
  if (details.length > 0) {
    message += ` ${details.join('. ')}.`;
  }
  
  return message;
};

module.exports = {
  createHousePointsNotification,
  formatHousePointsMessage
}; 