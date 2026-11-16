// Pure timeline maths for smart clip edits: which parts of the source play,
// and where a source time lands in the edited output. Shared by the Remotion
// composition, the editor UI and the worker.

export interface Segment {
  s: number; // source start (seconds)
  e: number; // source end
  out: number; // output time at which this segment starts
}

export interface Timeline {
  segments: Segment[];
  duration: number; // output seconds
}

const MIN_SEGMENT = 0.08; // drop slivers shorter than ~2 frames

export function buildTimeline(start: number, end: number, removals: { s: number; e: number }[]): Timeline {
  const cuts = removals
    .map((r) => ({ s: Math.max(start, r.s), e: Math.min(end, r.e) }))
    .filter((r) => r.e > r.s)
    .sort((a, b) => a.s - b.s);

  // Merge overlapping cuts.
  const merged: { s: number; e: number }[] = [];
  for (const c of cuts) {
    const last = merged[merged.length - 1];
    if (last && c.s <= last.e) last.e = Math.max(last.e, c.e);
    else merged.push({ ...c });
  }

  const segments: Segment[] = [];
  let cursor = start;
  let out = 0;
  const push = (s: number, e: number) => {
    if (e - s < MIN_SEGMENT) return;
    segments.push({ s, e, out });
    out += e - s;
  };
  for (const c of merged) {
    push(cursor, c.s);
    cursor = Math.max(cursor, c.e);
  }
  push(cursor, end);

  if (segments.length === 0) {
    // Everything was cut: keep a 1 s sliver so the clip is never empty.
    const e = Math.min(end, start + 1);
    segments.push({ s: start, e, out: 0 });
    out = e - start;
  }
  return { segments, duration: out };
}

// Output time for a source time; null when that moment was cut.
export function sourceToOutput(tl: Timeline, t: number): number | null {
  for (const seg of tl.segments) {
    if (t >= seg.s && t <= seg.e) return seg.out + (t - seg.s);
  }
  return null;
}

// Like sourceToOutput, but a cut moment snaps to the next kept moment.
export function sourceToOutputSnap(tl: Timeline, t: number): number {
  for (const seg of tl.segments) {
    if (t <= seg.e) return seg.out + Math.max(0, t - seg.s);
  }
  return tl.duration;
}

// Source time playing at an output time.
export function outputToSource(tl: Timeline, o: number): number {
  for (const seg of tl.segments) {
    if (o < seg.out + (seg.e - seg.s)) return seg.s + Math.max(0, o - seg.out);
  }
  const last = tl.segments[tl.segments.length - 1];
  return last.e;
}

// Index of the segment playing at an output time (for jump-cut effects).
export function segmentIndexAt(tl: Timeline, o: number): number {
  for (let i = 0; i < tl.segments.length; i++) {
    const seg = tl.segments[i];
    if (o < seg.out + (seg.e - seg.s)) return i;
  }
  return tl.segments.length - 1;
}

// Linear interpolation over sorted {t, x} keyframes.
export function interpTrack(track: { t: number; x: number }[], t: number, fallback: number): number {
  if (track.length === 0) return fallback;
  if (t <= track[0].t) return track[0].x;
  for (let i = 1; i < track.length; i++) {
    const a = track[i - 1];
    const b = track[i];
    if (t <= b.t) {
      const k = (t - a.t) / Math.max(1e-6, b.t - a.t);
      return a.x + (b.x - a.x) * k;
    }
  }
  return track[track.length - 1].x;
}
