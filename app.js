const express = require("express");
const path = require("path");
const cors = require("cors");
const logger = require("morgan");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const createError = require("http-errors");

if (!process.env.JWT_SECRET) {
  throw new Error(
    "JWT_SECRET environment variable is required and must not be empty. " +
    "Set it in your deployment environment (see .env.example)."
  );
}

const app = express();


// View engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "ejs");

app.use(logger("dev"));

// Define allowed origins
const allowedOrigins = process.env.CORS_ORIGIN
  ? process.env.CORS_ORIGIN.split(",")
  : ["http://localhost:3000"];

// Apply CORS middleware globally
app.use(
  cors({
    origin: function (origin, callback) {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) === -1) {
        const msg =
          "The CORS policy for this site does not allow access from the specified Origin.";
        const corsError = new Error(msg);
        corsError.status = 403;
        return callback(corsError, false);
      }
      return callback(null, true);
    },
    credentials: true,
    allowedHeaders: ["Content-Type", "Authorization", "X-Requested-With"],
    methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
    exposedHeaders: ["Content-Range", "X-Content-Range"],
    preflightContinue: false,
    optionsSuccessStatus: 204,
  })
);

// // Middleware to add CORS headers for static files
// app.use("/uploads", (req, res, next) => {
//   res.setHeader("Access-Control-Allow-Origin", "http://localhost:3000"); // Explicitly allow the frontend origin
//   res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
//   res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With");
//   next();
// });

app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

const AllRoutes = require("./routes/index");
app.use("/api", AllRoutes);

app.get("/", (request, response) => {
  response.send("sakshi creation api is working .....111!");
});

// catch 404 and forward to error handler
app.use(function(req, res, next) {
  next(createError(404));
});

// Global error handler. This is an API-only app (every route returns
// JSON), but the previous handler called res.render("error") — an HTML
// EJS view — for every unhandled error and every 404, which broke
// frontend error parsing (axios/fetch expecting `{ success, message }`
// got an HTML page instead). This returns a consistent JSON envelope
// instead, matching the shape controllers already use elsewhere.
// eslint-disable-next-line no-unused-vars
app.use(function (err, req, res, next) {
  const status = err.status || err.statusCode || 500;
  const isDev = req.app.get("env") === "development";

  if (status >= 500) {
    console.error(err);
  }

  res.status(status).json({
    success: false,
    message: err.message || "Internal server error",
    ...(isDev && err.stack ? { stack: err.stack } : {}),
  });
});

module.exports = app;