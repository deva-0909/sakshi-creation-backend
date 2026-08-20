const express = require('express');
const InventoryController = require('../controllers/inventory.controller');

const router = express.Router();

router.get('/bycategory/:category', InventoryController.getInventoryByCategory);
router.get('/summary/:category', InventoryController.getInventorySummary);

module.exports = router;