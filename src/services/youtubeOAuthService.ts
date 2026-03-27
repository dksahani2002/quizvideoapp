import { google } from 'googleapis';

export function getYouTubeAuthUrl(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  state: string;
}): string {
  const oauth2Client = new google.auth.OAuth2(params.clientId, params.clientSecret, params.redirectUri);
  return oauth2Client.generateAuthUrl({
    access_type: 'offline',
    prompt: 'consent',
    scope: ['https://www.googleapis.com/auth/youtube.upload'],
    state: params.state,
  });
}

export async function exchangeYouTubeCode(params: {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ refreshToken: string }> {
  const oauth2Client = new google.auth.OAuth2(params.clientId, params.clientSecret, params.redirectUri);
  const { tokens } = await oauth2Client.getToken(params.code);
  const refreshToken = tokens.refresh_token;
  if (!refreshToken) {
    throw new Error('YouTube OAuth did not return a refresh_token. Try reconnecting with prompt=consent.');
  }
  return { refreshToken };
}

