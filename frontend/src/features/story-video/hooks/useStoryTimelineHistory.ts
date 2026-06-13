import { useReducer, useCallback } from 'react';
import type { StoryTimeline } from '../api';

const MAX_UNDO = 50;

export function cloneStoryTimeline(t: StoryTimeline): StoryTimeline {
  return JSON.parse(JSON.stringify(t)) as StoryTimeline;
}

type State = { timeline: StoryTimeline; undo: StoryTimeline[]; redo: StoryTimeline[] };

type Action =
  | { type: 'apply'; next: StoryTimeline; record?: boolean }
  | { type: 'applyFn'; fn: (t: StoryTimeline) => StoryTimeline; record?: boolean }
  | { type: 'replace'; next: StoryTimeline }
  | { type: 'undo' }
  | { type: 'redo' };

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'replace':
      return { timeline: cloneStoryTimeline(action.next), undo: [], redo: [] };
    case 'apply': {
      const next = action.next;
      if (JSON.stringify(state.timeline) === JSON.stringify(next)) return state;
      if (action.record === false) {
        return { ...state, timeline: cloneStoryTimeline(next) };
      }
      const u = [...state.undo, cloneStoryTimeline(state.timeline)];
      return {
        timeline: cloneStoryTimeline(next),
        undo: u.length > MAX_UNDO ? u.slice(-MAX_UNDO) : u,
        redo: [],
      };
    }
    case 'applyFn': {
      const next = action.fn(state.timeline);
      if (JSON.stringify(state.timeline) === JSON.stringify(next)) return state;
      if (action.record === false) {
        return { ...state, timeline: cloneStoryTimeline(next) };
      }
      const u = [...state.undo, cloneStoryTimeline(state.timeline)];
      return {
        timeline: cloneStoryTimeline(next),
        undo: u.length > MAX_UNDO ? u.slice(-MAX_UNDO) : u,
        redo: [],
      };
    }
    case 'undo': {
      if (state.undo.length === 0) return state;
      const snap = state.undo[state.undo.length - 1]!;
      return {
        timeline: cloneStoryTimeline(snap),
        undo: state.undo.slice(0, -1),
        redo: [...state.redo, cloneStoryTimeline(state.timeline)],
      };
    }
    case 'redo': {
      if (state.redo.length === 0) return state;
      const snap = state.redo[state.redo.length - 1]!;
      const u = [...state.undo, cloneStoryTimeline(state.timeline)];
      return {
        timeline: cloneStoryTimeline(snap),
        undo: u.length > MAX_UNDO ? u.slice(-MAX_UNDO) : u,
        redo: state.redo.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

const initialState: State = { timeline: { clips: [] }, undo: [], redo: [] };

export function useStoryTimelineHistory() {
  const [s, dispatch] = useReducer(reducer, initialState);

  const applyTimeline = useCallback((next: StoryTimeline, opts?: { record?: boolean }) => {
    dispatch({ type: 'apply', next, record: opts?.record });
  }, []);

  const applyTimelineFn = useCallback((fn: (t: StoryTimeline) => StoryTimeline, opts?: { record?: boolean }) => {
    dispatch({ type: 'applyFn', fn, record: opts?.record });
  }, []);

  const replaceTimeline = useCallback((next: StoryTimeline) => {
    dispatch({ type: 'replace', next });
  }, []);

  const undo = useCallback(() => dispatch({ type: 'undo' }), []);
  const redo = useCallback(() => dispatch({ type: 'redo' }), []);

  return {
    timeline: s.timeline,
    canUndo: s.undo.length > 0,
    canRedo: s.redo.length > 0,
    applyTimeline,
    applyTimelineFn,
    replaceTimeline,
    undo,
    redo,
  };
}
