import fetch from 'node-fetch';

export default async function handler(req, res) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', process.env.NODE_ENV === 'development' ? 'http://localhost:5173' : '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  try {
    const { type, recipientEmail, recipientName, message, projectTitle } = req.body;

    // You'll need to create a new EmailJS template for notifications
    const templateParams = {
      to_email: recipientEmail,
      to_name: recipientName,
      message: message,
      project_title: projectTitle || 'N/A',
      notification_type: type,
    };

    await fetch('https://api.emailjs.com/api/v1.0/email/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        service_id: process.env.EMAILJS_SERVICE_ID,
        template_id: process.env.EMAILJS_NOTIFICATION_TEMPLATE_ID,
        user_id: process.env.EMAILJS_PUBLIC_KEY,
        template_params: templateParams,
      }),
    });

    res.status(200).json({ success: true });
  } catch (error) {
    console.error('Notification error:', error);
    res.status(500).json({ error: 'Failed to send notification', details: error.message });
  }
}
