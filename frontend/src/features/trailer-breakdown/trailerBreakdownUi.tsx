import {
  friendlyStageLabel as sharedFriendlyStageLabel,
  TRAILER_STAGE_LABELS,
} from '../../shared/jobs/friendlyLabels';

export function friendlyStageLabel(stage: string): string {
  return sharedFriendlyStageLabel(stage, TRAILER_STAGE_LABELS);
}
