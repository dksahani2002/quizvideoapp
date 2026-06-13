import fetch from 'node-fetch';

export interface InstagramConnectResult {
  accessToken: string;
  tokenExpiresAt: string;
  pageId: string;
  igUserId: string;
}

function assertOk(r: any, body: any) {
  if (r.ok) return;
  const msg = body?.error?.message || body?.error?.error_user_msg || body?.error?.type || r.statusText;
  throw new Error(`Meta Graph API error (${r.status}): ${msg}`);
}

export async function exchangeInstagramOAuthCode(params: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
}): Promise<{ shortLivedToken: string }> {
  const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  u.searchParams.set('client_id', params.appId);
  u.searchParams.set('client_secret', params.appSecret);
  u.searchParams.set('redirect_uri', params.redirectUri);
  u.searchParams.set('code', params.code);

  const r = await fetch(u.toString());
  const body: any = await r.json().catch(() => ({}));
  assertOk(r, body);
  const token = body?.access_token;
  if (!token) throw new Error('Missing access_token from Meta OAuth exchange.');
  return { shortLivedToken: token };
}

export async function exchangeLongLivedToken(params: {
  appSecret: string;
  shortLivedToken: string;
}): Promise<{ accessToken: string; expiresIn: number }> {
  const u = new URL('https://graph.facebook.com/v21.0/oauth/access_token');
  u.searchParams.set('grant_type', 'fb_exchange_token');
  u.searchParams.set('client_secret', params.appSecret);
  u.searchParams.set('fb_exchange_token', params.shortLivedToken);
  const r = await fetch(u.toString());
  const body: any = await r.json().catch(() => ({}));
  assertOk(r, body);
  const token = body?.access_token;
  const expiresIn = Number(body?.expires_in || 0);
  if (!token) throw new Error('Missing access_token from long-lived exchange.');
  return { accessToken: token, expiresIn: expiresIn > 0 ? expiresIn : 60 * 60 * 24 * 60 };
}

export async function resolveInstagramBusinessAccount(params: {
  accessToken: string;
  preferredPageId?: string;
}): Promise<{ pageId: string; igUserId: string }> {
  const meAccounts = new URL('https://graph.facebook.com/v21.0/me/accounts');
  meAccounts.searchParams.set('fields', 'id,name,instagram_business_account');
  meAccounts.searchParams.set('access_token', params.accessToken);
  const r = await fetch(meAccounts.toString());
  const body: any = await r.json().catch(() => ({}));
  assertOk(r, body);
  const pages: any[] = body?.data || [];
  if (!pages.length) throw new Error('No Facebook Pages found. You must connect a Page to use Instagram Graph API.');

  const page =
    (params.preferredPageId ? pages.find((p) => p.id === params.preferredPageId) : null) ||
    pages.find((p) => p.instagram_business_account?.id) ||
    pages[0];

  const pageId = String(page?.id || '');
  const igUserId = String(page?.instagram_business_account?.id || '');
  if (!pageId) throw new Error('Could not resolve pageId.');
  if (!igUserId) {
    throw new Error('Selected Page has no connected Instagram Business Account. Connect an IG Business account to the Page.');
  }
  return { pageId, igUserId };
}

export async function connectInstagramGraph(params: {
  appId: string;
  appSecret: string;
  redirectUri: string;
  code: string;
  preferredPageId?: string;
}): Promise<InstagramConnectResult> {
  const { shortLivedToken } = await exchangeInstagramOAuthCode({
    appId: params.appId,
    appSecret: params.appSecret,
    redirectUri: params.redirectUri,
    code: params.code,
  });
  const long = await exchangeLongLivedToken({ appSecret: params.appSecret, shortLivedToken });
  const tokenExpiresAt = new Date(Date.now() + long.expiresIn * 1000).toISOString();
  const acct = await resolveInstagramBusinessAccount({ accessToken: long.accessToken, preferredPageId: params.preferredPageId });
  return { accessToken: long.accessToken, tokenExpiresAt, pageId: acct.pageId, igUserId: acct.igUserId };
}

export async function publishReel(params: {
  igUserId: string;
  accessToken: string;
  videoUrl: string;
  caption: string;
}): Promise<{ creationId: string; mediaId: string }> {
  const createUrl = new URL(`https://graph.facebook.com/v21.0/${params.igUserId}/media`);
  createUrl.searchParams.set('media_type', 'REELS');
  createUrl.searchParams.set('video_url', params.videoUrl);
  createUrl.searchParams.set('caption', params.caption);
  createUrl.searchParams.set('access_token', params.accessToken);

  const r1 = await fetch(createUrl.toString(), { method: 'POST' });
  const b1: any = await r1.json().catch(() => ({}));
  assertOk(r1, b1);
  const creationId = String(b1?.id || '');
  if (!creationId) throw new Error('Missing creation id from /media.');

  // Poll container status
  const statusUrl = new URL(`https://graph.facebook.com/v21.0/${creationId}`);
  statusUrl.searchParams.set('fields', 'status_code');
  statusUrl.searchParams.set('access_token', params.accessToken);
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const rs = await fetch(statusUrl.toString());
    const bs: any = await rs.json().catch(() => ({}));
    assertOk(rs, bs);
    const sc = String(bs?.status_code || '');
    if (sc === 'FINISHED') break;
    if (sc === 'ERROR') throw new Error('Instagram container processing failed.');
  }

  const pubUrl = new URL(`https://graph.facebook.com/v21.0/${params.igUserId}/media_publish`);
  pubUrl.searchParams.set('creation_id', creationId);
  pubUrl.searchParams.set('access_token', params.accessToken);
  const r2 = await fetch(pubUrl.toString(), { method: 'POST' });
  const b2: any = await r2.json().catch(() => ({}));
  assertOk(r2, b2);
  const mediaId = String(b2?.id || '');
  if (!mediaId) throw new Error('Missing media id from /media_publish.');
  return { creationId, mediaId };
}

