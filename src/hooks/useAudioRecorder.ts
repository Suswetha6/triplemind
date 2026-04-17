import { useRef, useCallback } from 'react';

interface UseAudioRecorderOptions {
  onChunk: (blob: Blob) => void;
  chunkIntervalMs?: number;
}

export function useAudioRecorder({ onChunk, chunkIntervalMs = 30000 }: UseAudioRecorderOptions) {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const streamRef = useRef<MediaStream | null>(null);

  const flushChunks = useCallback(() => {
    if (chunksRef.current.length === 0) return;
    const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
    chunksRef.current = [];
    onChunk(blob);
  }, [onChunk]);

  const start = useCallback(async () => {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    streamRef.current = stream;

    const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
      ? 'audio/webm;codecs=opus'
      : 'audio/webm';

    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;

    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.start(1000); // collect data every 1s

    intervalRef.current = setInterval(flushChunks, chunkIntervalMs);
  }, [flushChunks, chunkIntervalMs]);

  const stop = useCallback(() => {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
    flushChunks(); // flush remaining audio

    mediaRecorderRef.current?.stop();
    mediaRecorderRef.current = null;

    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, [flushChunks]);

  return { start, stop };
}
