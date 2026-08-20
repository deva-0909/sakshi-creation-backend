const multer = require('multer');
const fs = require('fs');
const path = require('path');

// Reusable function to return multer upload middleware
function FileUploader(subfolder = '') {
    // Set the default upload path to 'public/' + optional subfolder
    const uploadPath = path.join(__dirname, '..', 'public', subfolder);

    // Create the folder if it doesn't exist
    if (!fs.existsSync(uploadPath)) {
        fs.mkdirSync(uploadPath, { recursive: true });
    }

    const storage = multer.diskStorage({
        destination: function (req, file, cb) {
            cb(null, uploadPath); // Save to dynamic path under /public
        },
        filename: function (req, file, cb) {
            const ext = path.extname(file.originalname);
            const name = path.basename(file.originalname, ext);
            const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
            cb(null, `${name}-${uniqueSuffix}${ext}`);
        }
    });

    return multer({ storage });
}

module.exports = {
    FileUploader
};
