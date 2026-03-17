#!/usr/bin/env node

// Review pending orders against new city-specific thresholds
// Run with: node review-pending-orders.js

import { getCityThresholds } from "./city-specific-thresholds.js";

// Sample data from API (truncated for testing)
const pendingOrders = [
  // TIER 1 (good) - should mostly pass
  { id: 561, city: "Miami", side: "NO", entry_price: 0.66, edge: 0.258, orderStillActive: true },
  { id: 531, city: "Miami", side: "NO", entry_price: 0.52, edge: 0.43, orderStillActive: true },
  { id: 530, city: "Miami", side: "NO", entry_price: 0.6, edge: 0.35, orderStillActive: false },
  { id: 438, city: "Miami", side: "NO", entry_price: 0.66, edge: 0.284, orderStillActive: false },
  
  // TIER 2 (marginal) 
  { id: 558, city: "Atlanta", side: "NO", entry_price: 0.64, edge: 0.31, orderStillActive: true },
  { id: 528, city: "Atlanta", side: "NO", entry_price: 0.67, edge: 0.28, orderStillActive: false },
  { id: 474, city: "Atlanta", side: "NO", entry_price: 0.62, edge: 0.277, orderStillActive: true },
  { id: 428, city: "Atlanta", side: "NO", entry_price: 0.7, edge: 0.25, orderStillActive: false },
  { id: 395, city: "Atlanta", side: "NO", entry_price: 0.66, edge: 0.29, orderStillActive: false },

  // TIER 4 (terrible) - should mostly fail
  { id: 543, city: "Toronto", side: "NO", entry_price: 0.66, edge: 0.29, orderStillActive: true }, // CANCEL
  { id: 539, city: "Toronto", side: "NO", entry_price: 0.7, edge: 0.25, orderStillActive: false }, // Already filled
  { id: 424, city: "Toronto", side: "NO", entry_price: 0.66, edge: 0.29, orderStillActive: false }, // Already filled
  
  { id: 534, city: "Tokyo", side: "NO", entry_price: 0.51, edge: 0.402, orderStillActive: true }, // CANCEL (price too high)
  { id: 457, city: "Tokyo", side: "NO", entry_price: 0.59, edge: 0.36, orderStillActive: true }, // CANCEL 
  { id: 456, city: "Tokyo", side: "NO", entry_price: 0.65, edge: 0.258, orderStillActive: false }, // Already filled
  
  { id: 541, city: "Singapore", side: "NO", entry_price: 0.61, edge: 0.298, orderStillActive: true }, // CANCEL (edge < 0.30)
  { id: 537, city: "Singapore", side: "NO", entry_price: 0.59, edge: 0.293, orderStillActive: false }, // Already filled

  // TIER 3 (poor)
  { id: 437, city: "Seattle", side: "NO", entry_price: 0.65, edge: 0.3, orderStillActive: false }, // Already filled
  { id: 407, city: "Seattle", side: "NO", entry_price: 0.68, edge: 0.27, orderStillActive: false }, // Already filled

  // TIER 1 (good)
  { id: 540, city: "Chicago", side: "YES", entry_price: 0.52, edge: 0.48, orderStillActive: false },
  { id: 529, city: "Chicago", side: "NO", entry_price: 0.67, edge: 0.28, orderStillActive: false },
  { id: 460, city: "Chicago", side: "NO", entry_price: 0.68, edge: 0.27, orderStillActive: false },

  { id: 542, city: "Dallas", side: "NO", entry_price: 0.69, edge: 0.26, orderStillActive: true },
  { id: 475, city: "Dallas", side: "NO", entry_price: 0.7, edge: 0.25, orderStillActive: false },
  { id: 465, city: "Dallas", side: "NO", entry_price: 0.7, edge: 0.25, orderStillActive: true },

  { id: 472, city: "London", side: "NO", entry_price: 0.66, edge: 0.265, orderStillActive: true },
  { id: 467, city: "London", side: "NO", entry_price: 0.7, edge: 0.25, orderStillActive: false },
  { id: 453, city: "London", side: "NO", entry_price: 0.66, edge: 0.25, orderStillActive: false },

  { id: 471, city: "Paris", side: "NO", entry_price: 0.66, edge: 0.29, orderStillActive: false },
];

function shouldCancelOrder(order) {
  if (!order.orderStillActive) return false; // Already filled/expired
  
  const thresholds = getCityThresholds(order.city);
  const reasons = [];
  
  // Check edge requirement
  if (order.edge < thresholds.minEdge) {
    reasons.push(`edge ${order.edge.toFixed(3)} < required ${thresholds.minEdge}`);
  }
  
  // Check price requirement  
  if (order.entry_price > thresholds.maxPrice) {
    reasons.push(`price ${order.entry_price} > max ${thresholds.maxPrice}`);
  }
  
  return reasons.length > 0 ? reasons : null;
}

console.log("=== PENDING ORDER REVIEW AGAINST NEW THRESHOLDS ===\\n");

const toCancel = [];
const toKeep = [];

for (const order of pendingOrders) {
  const reasons = shouldCancelOrder(order);
  const thresholds = getCityThresholds(order.city);
  
  if (reasons) {
    toCancel.push({ ...order, reasons });
    console.log(`❌ CANCEL ${order.id}: ${order.city} ${order.side} @ ${order.entry_price} (edge: ${order.edge.toFixed(3)})`);
    console.log(`   Reasons: ${reasons.join(", ")}`);
    console.log(`   Required: edge ≥${thresholds.minEdge}, price ≤${thresholds.maxPrice}\\n`);
  } else if (order.orderStillActive) {
    toKeep.push(order);
    console.log(`✅ KEEP ${order.id}: ${order.city} ${order.side} @ ${order.entry_price} (edge: ${order.edge.toFixed(3)})`);
    console.log(`   Meets: edge ≥${thresholds.minEdge}, price ≤${thresholds.maxPrice}\\n`);
  }
}

console.log("=== SUMMARY ===");
console.log(`Orders to cancel: ${toCancel.length}`);
console.log(`Active orders to keep: ${toKeep.length}`);
console.log(`Total orders reviewed: ${pendingOrders.length}`);

if (toCancel.length > 0) {
  console.log("\\n=== ORDERS TO CANCEL ===");
  toCancel.forEach(order => {
    console.log(`${order.id}: ${order.city} @ ${order.entry_price} - ${order.reasons.join(", ")}`);
  });
  
  console.log("\\n=== CANCEL COMMANDS ===");
  console.log("You can cancel these orders via the weather dashboard /kill endpoint or manually:");
  toCancel.forEach(order => {
    console.log(`curl -X POST "https://polymarket-dashboard-ip4ea.ondigitalocean.app/api/weather/cancel/${order.id}"`);
  });
}