import type { ExportPlan, PublisherAdapter, PublishRequest, PublisherPlatform } from './publisherAdapter.js';

function basePlan(platform: PublisherPlatform): ExportPlan {
  const common = [
    'Download the MP4 from Video Library',
    'Upload from the platform’s official app or creator studio',
    'Paste the caption and hashtags',
    'Choose cover frame / thumbnail',
    'Post or schedule (if available in-app)',
  ];
  if (platform === 'tiktok') {
    return {
      platform,
      checklist: [...common, 'Enable “Allow Stitch/Duet” if desired', 'Select category & audience'],
      suggestedCaption: 'Quick quiz challenge. How many did you get right?',
      constraints: { maxDurationSec: 60, aspect: '9:16' },
    };
  }
  if (platform === 'x') {
    return {
      platform,
      checklist: [...common, 'Keep caption concise (best performance under ~200 chars)'],
      suggestedCaption: 'Quick quiz challenge. Reply with your score.',
      constraints: { aspect: '9:16' },
    };
  }
  return {
    platform,
    checklist: [...common, 'Verify audio loudness & captions rendering'],
    suggestedCaption: 'Quick quiz challenge. Follow for more.',
    constraints: { maxDurationSec: 60, aspect: '9:16' },
  };
}

export class ExportOnlyAdapter implements PublisherAdapter {
  platform: PublisherPlatform;
  constructor(platform: PublisherPlatform) {
    this.platform = platform;
  }
  async buildExportPlan(_req: PublishRequest): Promise<ExportPlan> {
    return basePlan(this.platform);
  }
}

