const express = require("express");
const DebitNoteController = require("../controllers/debitNote.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createDebitNoteSchema } = require("../validators/debitNote.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("debitnote", "create"), validate(createDebitNoteSchema), DebitNoteController.createDebitNote);
router.get("/", DebitNoteController.getAllDebitNotes);
router.get("/:id", DebitNoteController.getDebitNoteById);
router.patch("/:id/issue", authorizePermission("debitnote", "approve"), DebitNoteController.issueDebitNote);
router.patch("/:id/cancel", authorizePermission("debitnote", "edit"), DebitNoteController.cancelDebitNote);

module.exports = router;
