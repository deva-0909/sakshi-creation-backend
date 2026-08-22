const express = require("express");
const CreditNoteController = require("../controllers/creditNote.controller");

const { authenticateToken } = require("../middleware/auth");
const { authorizePermission } = require("../middleware/authorize");
const { validate } = require("../middleware/validate");
const { createCreditNoteSchema } = require("../validators/creditNote.validator");
const router = express.Router();

router.use(authenticateToken);

router.post("/", authorizePermission("creditnote", "create"), validate(createCreditNoteSchema), CreditNoteController.createCreditNote);
router.get("/", CreditNoteController.getAllCreditNotes);
router.get("/:id", CreditNoteController.getCreditNoteById);
router.patch("/:id/issue", authorizePermission("creditnote", "approve"), CreditNoteController.issueCreditNote);
router.patch("/:id/cancel", authorizePermission("creditnote", "edit"), CreditNoteController.cancelCreditNote);

module.exports = router;
