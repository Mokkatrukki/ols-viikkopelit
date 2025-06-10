import express, { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { exec } from 'child_process';
import { fileURLToPath } from 'url';

// --- Define __dirname for ES module scope ---
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router: Router = express.Router();

// --- Configuration ---
const UPLOAD_PASSWORD_ENV = process.env.UPLOAD_PASSWORD;
// Fly.io volume mount point is /data. For local dev, use a path relative to the app.
const UPLOAD_DIR_BASE = process.env.FLY_APP_NAME ? '/data' : path.join(__dirname, '../../persistent_app_files');
const UPLOAD_DIR = path.join(UPLOAD_DIR_BASE, 'uploaded_pdfs');

// Ensure upload directory exists
if (!fs.existsSync(UPLOAD_DIR)) {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    console.log(`Created PDF upload directory: ${UPLOAD_DIR}`);
}

// --- Multer Setup ---
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        // Sanitize filename: replace spaces with underscores, remove non-alphanumeric (except ., _, -)
        const sanitizedOriginalName = file.originalname
            .replace(/\s+/g, '_')
            .replace(/[^a-zA-Z0-9._-]/g, '');
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        cb(null, uniqueSuffix + '-' + sanitizedOriginalName);
    }
});

const upload = multer({
    storage: storage,
    fileFilter: (req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Invalid file type: Only PDF files are allowed.'));
        }
    },
    limits: {
        fileSize: 10 * 1024 * 1024 // 10 MB limit
    }
});

// --- Routes ---
// POST /admin/upload-pdf
router.post('/upload-pdf', upload.single('pdfFile'), (req: Request, res: Response) => {
    const { password } = req.body;

    if (!UPLOAD_PASSWORD_ENV) {
        console.error('UPLOAD_PASSWORD environment variable is not set.');
        const serverConfigError = encodeURIComponent('Error: Server configuration error (upload password not set).');
        return res.status(500).redirect(`/?message=${serverConfigError}&type=error`);
    }

    if (password !== UPLOAD_PASSWORD_ENV) {
        console.warn('Failed PDF upload attempt: Incorrect password.');
        const noFileMessage = encodeURIComponent('No file uploaded or password incorrect.');
        return res.redirect(`/?message=${noFileMessage}&type=error`);
    }

    if (!req.file) {
        console.warn('Failed PDF upload attempt: No file uploaded.');
        const noFileMessage = encodeURIComponent('No file uploaded or password incorrect.');
        return res.redirect(`/?message=${noFileMessage}&type=error`);
    }

    // Log successful upload
    const clientIp = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const originalFileName = req.file.originalname;
    const storedFileName = req.file.filename;
    const storedFilePath = req.file.path; // Full path to the uploaded file

    console.log(`PDF Uploaded:
        Timestamp: ${new Date().toISOString()}
        Original Name: ${originalFileName}
        Stored Name: ${storedFileName}
        Stored Path: ${storedFilePath}
        Size: ${req.file.size} bytes
        Uploaded by IP: ${clientIp}
    `);

    // Now, process the uploaded PDF
    console.log(`Processing ${storedFilePath} with 'npm run parse-pdf'...`);
    const projectRoot = path.join(__dirname, '../../'); // Navigate from admin_app/src/routes to admin_app/
    const processCommand = `npm run parse-pdf -- "${storedFilePath}"`;

    exec(processCommand, { cwd: projectRoot }, (error, stdout, stderr) => {
        if (error) {
            console.error(`Error processing manually uploaded PDF: ${error.message}`);
            console.error(`Stdout: ${stdout}`);
            console.error(`Stderr: ${stderr}`);
            const errorMessage = encodeURIComponent(`Error processing PDF '${originalFileName}': ${error.message}. Check server logs.`);
            return res.redirect(`/?message=${errorMessage}&type=error`);
        }
        if (stderr) {
            // pdf2json often outputs to stderr even on success
            console.warn(`Stderr while processing manually uploaded PDF: ${stderr}`);
        }
        console.log(`Manually uploaded PDF processing script stdout: ${stdout}`);
        console.log(`PDF '${originalFileName}' processed successfully after manual upload.`);

        const successMessage = encodeURIComponent(`Success: File '${originalFileName}' uploaded and processed.`);
        return res.redirect(`/?message=${successMessage}&type=success`);
    });

}, (error: Error, req: Request, res: Response, next: express.NextFunction) => {
    // Multer error handling (e.g., file type, size limit)
    console.error('Multer error during PDF upload:', error.message);
    const uploadErrorMessage = encodeURIComponent(`Upload Error: ${error.message}`);
    return res.redirect(`/?message=${uploadErrorMessage}&type=error`);
});

export default router;
