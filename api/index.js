// Vercel serverless entrypoint. Vercel treats any exported request handler
// under /api as its own function; wrapping the whole Express app here means
// every /api/* route (defined in app.js -> routes/index.js) is served by
// this single function, without having to split each route into its own file.
const app = require("../app");

module.exports = app;
