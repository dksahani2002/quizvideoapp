export type PublisherPlatform = 'youtube' | 'instagram' | 'tiktok' | 'x' | 'snapchat';

export interface PublishRequest {
  userId: string;
  videoId: string;
  title?: string;
  description?: string;
  caption?: string;
  scheduledAt?: string;
}

export interface PublishResult {
  success: boolean;
  platform: PublisherPlatform;
  externalId?: string;
  url?: string;
  error?: string;
  raw?: any;
}

export interface ExportPlan {
  platform: PublisherPlatform;
  checklist: string[];
  suggestedCaption: string;
  constraints: { maxDurationSec?: number; aspect?: string };
}

export interface PublisherAdapter {
  platform: PublisherPlatform;
  /**
   * For platforms without an official/approved automation path, return an export plan
   * that the UI can present (download + checklist).
   */
  buildExportPlan(req: PublishRequest): Promise<ExportPlan>;
}

