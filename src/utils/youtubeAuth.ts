import { google } from 'googleapis';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load environment variables
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const envPath = path.resolve(__dirname, '../../.env');

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token: string;
  scope: string;
  token_type: string;
}

export async function getYouTubeRefreshToken(): Promise<void> {
  // Load environment variables
  if (!process.env.YT_CLIENT_ID || !process.env.YT_CLIENT_SECRET || !process.env.YT_REDIRECT_URI) {
    console.error(
      '❌ Missing required environment variables: YT_CLIENT_ID, YT_CLIENT_SECRET, YT_REDIRECT_URI'
    );
    console.error('\nAdd these to your .env file:');
    console.error('YT_CLIENT_ID=your_client_id');
    console.error('YT_CLIENT_SECRET=your_client_secret');
    console.error('YT_REDIRECT_URI=http://localhost:3000/oauth2callback');
    process.exit(1);
  }

  const oauth2Client = new google.auth.OAuth2(
    process.env.YT_CLIENT_ID,
    process.env.YT_CLIENT_SECRET,
    'http://localhost:3001/oauth2callback'
  );

  // Generate the auth URL
  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
  });

  console.log('\n📺 YouTube OAuth Token Generator');
  console.log('═'.repeat(50));
  console.log('\n1️⃣  Opening browser to authorize access...\n');
  console.log('Click the link below or it will open automatically:');
  console.log(`\n${authUrl}\n`);

  // Create a simple HTTP server to catch the redirect
  const server = http.createServer(async (req, res) => {
    if (!req.url) {
      res.writeHead(400);
      res.end('No URL provided');
      return;
    }

    const url = new URL(req.url, `http://localhost:3000`);
    const authCode = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error) {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>Authorization Error</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h1>❌ Authorization Failed</h1>
            <p><strong>Error:</strong> ${error}</p>
            <p>Please try again.</p>
          </body>
        </html>
      `);
      server.close();
      return;
    }

    if (!authCode) {
      res.writeHead(400);
      res.end('No authorization code provided');
      server.close();
      return;
    }

    try {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(`
        <html>
          <head><title>Authorization Successful</title></head>
          <body style="font-family: Arial, sans-serif; padding: 20px;">
            <h1>✅ Authorization Successful!</h1>
            <p>Your refresh token has been saved to <code>.env</code></p>
            <p>You can close this window.</p>
          </body>
        </html>
      `);

      // Exchange auth code for tokens
      console.log('2️⃣  Exchanging authorization code for tokens...\n');
      const { tokens } = await oauth2Client.getToken(authCode);
      const tokenResponse = tokens as TokenResponse;

      if (!tokenResponse.refresh_token) {
        throw new Error('No refresh token received from Google');
      }

      // Update .env file
      updateEnvFile(tokenResponse.refresh_token);
      
      console.log('✅ Refresh token obtained successfully!\n');
      console.log('📋 Token Details:');
      console.log(`  - Access Token: ${tokenResponse.access_token.substring(0, 20)}...`);
      console.log(`  - Refresh Token: ${tokenResponse.refresh_token.substring(0, 20)}...`);
      console.log(`  - Token Type: ${tokenResponse.token_type}`);
      console.log(`  - Expires In: ${tokenResponse.expires_in} seconds\n`);
      console.log('✨ You can now upload videos to YouTube with:');
      console.log('   npm run upload:youtube\n');

      // Close server after a short delay
      setTimeout(() => server.close(), 1000);
    } catch (error) {
      console.error('❌ Error exchanging authorization code:', error);
      res.writeHead(500);
      res.end('Internal server error');
      server.close();
    }
  });

  server.listen(3001, async () => {
    console.log('3️⃣  Waiting for authorization...\n');
    console.log('Listening on http://localhost:3001/oauth2callback\n');

    // Try to open browser if on desktop
    if (process.platform === 'darwin') {
      // macOS
      const { exec } = await import('child_process');
      exec(`open "${authUrl}"`);
    } else if (process.platform === 'win32') {
      // Windows
      const { exec } = await import('child_process');
      exec(`start "${authUrl}"`);
    } else if (process.platform === 'linux') {
      // Linux
      const { exec } = await import('child_process');
      exec(`xdg-open "${authUrl}"`);
    }
  });

  // Timeout after 5 minutes
  setTimeout(() => {
    if (server.listening) {
      console.error('\n⏱️  Authorization timeout. Please try again.');
      server.close();
      process.exit(1);
    }
  }, 5 * 60 * 1000);
}

function updateEnvFile(refreshToken: string): void {
  let envContent = '';

  if (fs.existsSync(envPath)) {
    envContent = fs.readFileSync(envPath, 'utf8');
  }

  // Check if YT_REFRESH_TOKEN already exists
  if (envContent.includes('YT_REFRESH_TOKEN=')) {
    // Replace existing token
    envContent = envContent.replace(
      /YT_REFRESH_TOKEN=.*/,
      `YT_REFRESH_TOKEN=${refreshToken}`
    );
  } else {
    // Add new token
    if (envContent && !envContent.endsWith('\n')) {
      envContent += '\n';
    }
    envContent += `YT_REFRESH_TOKEN=${refreshToken}\n`;
  }

  fs.writeFileSync(envPath, envContent, 'utf8');
  console.log(`📝 Token saved to: ${envPath}`);
}

// Run the function
getYouTubeRefreshToken().catch(error => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});
