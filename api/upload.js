import formidable from 'formidable';
import fs from 'fs';
import { google } from 'googleapis';

export const config = {
  api: {
    bodyParser: false, // Required for file uploads
  },
};

// ---- Config ----
const ALLOWED_MIME_TYPES = [
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'image/jpeg',
  'image/png',
  'application/zip',
  'application/x-zip-compressed',
  'text/plain',
];

const FORBIDDEN_EXTENSIONS = ['.exe', '.bat', '.cmd', '.sh'];

const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB per file
const BATCH_SIZE = 3; // Parallel uploads

export default async function handler(req, res) {
  // ---- CORS ----
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    // ---- Parse form ----
    const form = new formidable.IncomingForm({
      multiples: true,
      maxFileSize: MAX_FILE_SIZE,
    });

    const [fields, files] = await new Promise((resolve, reject) => {
      form.parse(req, (err, flds, fls) => (err ? reject(err) : resolve([flds, fls])));
    });

    // ---- Google Drive OAuth2 ----
    const oauth2Client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI
    );

    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN,
    });

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    // ---- Create folder ----
    const clientName = fields.name?.[0] || 'Unknown Client';
    const organization = fields.organization?.[0] || 'Unknown Org';
    const date = new Date().toISOString().slice(0, 10);
    const folderName = `${clientName} - ${organization} - ${date}`;

    const folderResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
      fields: 'id',
      supportsAllDrives: true,
    });

    const folderId = folderResponse.data.id;

    // ---- Normalize files ----
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];

    // ---- Validate all files and collect errors ----
    const errors: string[] = [];

    for (const file of fileArray) {
      const ext = '.' + (file.originalFilename?.toLowerCase().split('.').pop() || '');

      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        errors.push(`File type not allowed: ${file.originalFilename}`);
      }

      if (FORBIDDEN_EXTENSIONS.includes(ext)) {
        errors.push(`Forbidden file extension: ${file.originalFilename}`);
      }

      if (file.size > MAX_FILE_SIZE) {
        errors.push(`File too large (max 25MB): ${file.originalFilename}`);
      }
    }

    if (errors.length > 0) {
      return res.status(400).json({ errors });
    }

    // ---- Upload in parallel batches ----
    const uploadedFiles: string[] = [];

    for (let i = 0; i < fileArray.length; i += BATCH_SIZE) {
      const batch = fileArray.slice(i, i + BATCH_SIZE);

      await Promise.all(
        batch.map(file =>
          drive.files.create({
            requestBody: {
              name: file.originalFilename,
              parents: [folderId],
            },
            media: {
              mimeType: file.mimetype,
              body: fs.createReadStream(file.filepath),
            },
            supportsAllDrives: true,
          })
        )
      );

      batch.forEach(file => uploadedFiles.push(file.originalFilename));
    }

    // ---- Return success ----
    res.status(200).json({
      success: true,
      folderId,
      folderLink: `https://drive.google.com/drive/folders/${folderId}`,
      uploadedFiles,
    });

  } catch (error) {
    console.error('Upload error:', error);
    res.status(500).json({ error: 'Upload failed', details: error.message });
  }
}
