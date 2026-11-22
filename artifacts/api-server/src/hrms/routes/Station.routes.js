const express = require('express');
const router  = express.Router();
const { protect, adminOnly } = require('../middleware/auth.middleware');
const Station = require('../models/Station.model');

// GET /api/v1/stations — list all stations (incl. auto-registered, unassigned ones)
router.get('/', protect, adminOnly, async (req, res) => {
  const stations = await Station.find().populate({
    path: 'assignedEmployees',
    populate: {
      path: 'user',
      select: 'firstName lastName avatar employeeId department',
      populate: { path: 'department', select: 'name' },
    },
  });
  res.json({ success: true, data: stations });
});

// POST /api/v1/stations
// Body: { stationId, label?, assignedEmployees?: [employeeId, ...], isActive? }
router.post('/', protect, adminOnly, async (req, res) => {
  const { stationId, label, assignedEmployees, isActive } = req.body;
  if (!stationId) {
    return res.status(400).json({ success: false, message: 'stationId is required' });
  }

  try {
    const station = await Station.create({
      stationId,
      label: label || stationId,
      assignedEmployees: assignedEmployees || [],
      isActive: isActive !== undefined ? isActive : true,
    });
    return res.status(201).json({ success: true, data: station });
  } catch (err) {
    if (err.code === 11000) {
      return res.status(409).json({ success: false, message: 'Station ID already exists' });
    }
    return res.status(500).json({ success: false, message: err.message });
  }
});

// PATCH /api/v1/stations/:stationId
// Body: { label?, assignedEmployees?: [employeeId, ...], isActive? }
router.patch('/:stationId', protect, adminOnly, async (req, res) => {
  const { label, assignedEmployees, isActive } = req.body;
  const update = {};
  if (label !== undefined) update.label = label;
  if (assignedEmployees !== undefined) update.assignedEmployees = assignedEmployees;
  if (isActive !== undefined) update.isActive = isActive;

  const station = await Station.findOneAndUpdate(
    { stationId: req.params.stationId },
    { $set: update },
    { new: true, upsert: true }
  );
  res.json({ success: true, data: station });
});

module.exports = router;