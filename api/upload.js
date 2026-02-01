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
    
    // Parse the form data
    const form = formidable({ multiples: true });
    const [fields, files] = await form.parse(req);
    
    // Google Drive credentials from environment variables
    const credentials = {
      type: "service_account",
      project_id: process.env.GOOGLE_PROJECT_ID,
      private_key_id: process.env.GOOGLE_PRIVATE_KEY_ID,
      private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      client_email: process.env.GOOGLE_CLIENT_EMAIL,
      client_id: process.env.GOOGLE_CLIENT_ID,
      auth_uri: "https://accounts.google.com/o/oauth2/auth",
      token_uri: "https://oauth2.googleapis.com/token",
    };

    // Initialize Google Drive
    const auth = new google.auth.GoogleAuth({
      credentials,
      scopes: ['https://www.googleapis.com/auth/drive.file'],
    });
    
    const drive = google.drive({ version: 'v3', auth });

    // Create folder name
    const clientName = fields.name[0];
    const organization = fields.organization[0];
    const date = new Date().toLocaleDateString().replace(/\//g, '-');
    const folderName = `${clientName} - ${organization} - ${date}`;

    // Create folder
    const folderResponse = await drive.files.create({
      resource: {
        name: folderName,
        mimeType: 'application/vnd.google-apps.folder',
        parents: [process.env.GOOGLE_DRIVE_FOLDER_ID],
      },
    });

    const folderId = folderResponse.data.id;

    // Upload files
    const uploadedFiles = [];
    const fileArray = Array.isArray(files.file) ? files.file : [files.file];
    
    for (const file of fileArray) {
      if (file) {
        const fileResponse = await drive.files.create({
          resource: {
            name: file.originalFilename,
            parents: [folderId],
          },
          media: {
            body: require('fs').createReadStream(file.filepath),
          },
        });
        uploadedFiles.push(file.originalFilename);
      }
    }

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

export const config = {
  api: {
    bodyParser: false,
  },
};
