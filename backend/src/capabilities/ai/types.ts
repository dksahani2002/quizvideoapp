export type WhisperSegment = {
  start: number;
  end: number;
  text: string;
};

export type TranscribeVerboseResult = {
  segments: WhisperSegment[];
  language?: string;
};
