export default async function handler(req, res) {
  // Add CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { google } = require('googleapis');
    const formidable = require('formidable');
    const fs = require('fs');

    // ---- CONFIG ----
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
    const MAX_FILE_SIZE = 25 * 1024 * 1024; // 25 MB
    const BATCH_SIZE = 3;

    // ---- Parse form data ----
    const form = new formidable.IncomingForm({ multiples: true });
    const [fields, files] = await form.parse(req);

    // ---- Google Drive auth (service account) ----
    const auth = new google.auth.GoogleAuth({
      credentials: {
        type: 'service_account',
        project_id: process.env.GOOGLE_PROJECT_ID,
        private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
        private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        client_email: process.env.GOOGLE_CLIENT_EMAIL,
        client_id: process.env.GOOGLE_CLIENT_ID,
        token_uri: 'https://oauth2.googleapis.com/token',
      },
      scopes: ['https://www.googleapis.com/auth/drive'], // full drive access
    });

    const drive = google.drive({ version: 'v3', auth });

    // ---- Create folder ----
    const clientName = fields.name?.[0] || 'Unknown Client';
    const organization = fields.organization?.[0] || 'Unknown Org';
    const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const folderName = `${clientName} - ${organization} - ${date}`;

    const folderResponse = await drive.files.create({
      requestBody: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID], // base folder in Shared Drive
      },
      supportsAllDrives: true,
    });

    const folderId = folderResponse.data.id;

    // ---- Prepare files ----
    const uploadedFiles = [];
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];

    // Validate files first
    for (const file of fileArray) {
      if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
        return res.status(400).json({
          error: `File type not allowed: ${file.originalFilename}`,
        });
      }
      if (file.size > MAX_FILE_SIZE) {
        return res.status(400).json({
          error: `File too large (max 25MB): ${file.originalFilename}`,
        });
      }
    }

    // ---- Upload in batches (parallel) ----
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
              body: fs.createReadStream(file.filepath),
            },
            supportsAllDrives: true,
          })
        )
      );

      batch.forEach(file => uploadedFiles.push(file.originalFilename));
    }

    // ---- Response ----
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

// Disable default body parser
export const config = {
  api: {
    bodyParser: false,
  },
};
