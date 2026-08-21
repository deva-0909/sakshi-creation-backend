// Thin request-validation middleware built on zod.
//
// Usage: router.post("/create", validate(createOrderSchema), createOrder)
//
// On failure, responds with the standard error envelope and a
// VALIDATION_ERROR code instead of letting a malformed request reach the
// controller (where it previously either crashed into a generic 500 or
// silently produced bad data).
function validate(schema) {
  return (req, res, next) => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        code: "VALIDATION_ERROR",
        errors: result.error.issues.map((issue) => ({
          field: issue.path.join("."),
          message: issue.message,
        })),
      });
    }
    // Replace req.body with the parsed/coerced data so controllers get
    // clean, typed values.
    req.body = result.data;
    next();
  };
}

module.exports = { validate };
