export const VOICE_MAX_SECONDS = 60;
export const VOICE_MAX_BYTES = 5 * 1024 * 1024;
export const VOICE_MAX_TEXT = 4000;

export interface SpeechResult {
  isFinal: boolean;
  [index: number]: { transcript: string };
}
export interface SpeechEvent {
  resultIndex: number;
  results: ArrayLike<SpeechResult>;
}
export interface VoiceSpeechRecognizer {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechEvent) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
export type TranscriptParts = Map<number, { text: string; final: boolean }>;

/** Speech result indices are cumulative; replacing an index avoids duplicates. */
export function updateVoiceTranscript(
  parts: TranscriptParts,
  event: SpeechEvent,
) {
  for (const [index, part] of parts)
    if (!part.final && index >= event.results.length) parts.delete(index);
  for (let index = event.resultIndex; index < event.results.length; index++) {
    const result = event.results[index];
    if (result)
      parts.set(index, {
        text: result[0]?.transcript ?? '',
        final: result.isFinal,
      });
  }
  return [...parts]
    .sort(([a], [b]) => a - b)
    .map(([, p]) => p.text.trim())
    .filter(Boolean)
    .join(' ')
    .slice(0, VOICE_MAX_TEXT);
}

export interface VoiceSnapshot {
  phase: 'idle' | 'requesting' | 'recording' | 'stopping' | 'review';
  transcript: string;
  audioUrl: string | null;
  seconds: number;
  notice: string;
  error: string;
}
export const EMPTY_VOICE_SNAPSHOT: VoiceSnapshot = {
  phase: 'idle',
  transcript: '',
  audioUrl: null,
  seconds: 0,
  notice: '',
  error: '',
};
type Recorder = Pick<
  MediaRecorder,
  | 'start'
  | 'stop'
  | 'state'
  | 'mimeType'
  | 'ondataavailable'
  | 'onstop'
  | 'onerror'
>;
export interface VoiceDependencies {
  getStream?: () => Promise<MediaStream>;
  createRecorder?: (stream: MediaStream) => Recorder;
  createRecognition?: () => VoiceSpeechRecognizer;
  createUrl: (blob: Blob) => string;
  revokeUrl: (url: string) => void;
}

export function browserVoiceDependencies(): VoiceDependencies {
  const speechWindow = window as unknown as {
    SpeechRecognition?: new () => VoiceSpeechRecognizer;
    webkitSpeechRecognition?: new () => VoiceSpeechRecognizer;
  };
  const Recognition =
    speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition;
  return {
    getStream: navigator.mediaDevices?.getUserMedia
      ? () => navigator.mediaDevices.getUserMedia({ audio: true })
      : undefined,
    createRecorder:
      typeof MediaRecorder !== 'undefined'
        ? (stream) => {
            const mimeType = [
              'audio/webm;codecs=opus',
              'audio/mp4',
              'audio/webm',
            ].find((mime) => MediaRecorder.isTypeSupported(mime));
            return mimeType
              ? new MediaRecorder(stream, { mimeType })
              : new MediaRecorder(stream);
          }
        : undefined,
    createRecognition: Recognition ? () => new Recognition() : undefined,
    createUrl: (blob) => URL.createObjectURL(blob),
    revokeUrl: (url) => URL.revokeObjectURL(url),
  };
}

/** Local capture only. No request, upload, chat send, or durable storage. */
export class VoiceInputSession {
  private state: VoiceSnapshot = { ...EMPTY_VOICE_SNAPSHOT };
  private generation = 0;
  private stream: MediaStream | null = null;
  private recorder: Recorder | null = null;
  private recognition: VoiceSpeechRecognizer | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private permissionTimer: ReturnType<typeof setTimeout> | null = null;
  private finalizeTimer: ReturnType<typeof setTimeout> | null = null;
  private chunks: Blob[] = [];
  private bytes = 0;
  private overLimit = false;
  private edited = false;
  private parts: TranscriptParts = new Map();
  private endedMime: string | null = null;
  private disposed = false;
  private deps: VoiceDependencies;
  private changed: (state: VoiceSnapshot) => void;

  constructor(
    deps: VoiceDependencies,
    changed: (state: VoiceSnapshot) => void,
  ) {
    this.deps = deps;
    this.changed = changed;
  }

  private emit(patch: Partial<VoiceSnapshot>) {
    this.state = { ...this.state, ...patch };
    if (!this.disposed) this.changed({ ...this.state });
  }
  private clearTimers() {
    if (this.timer) clearInterval(this.timer);
    if (this.permissionTimer) clearTimeout(this.permissionTimer);
    if (this.finalizeTimer) clearTimeout(this.finalizeTimer);
    this.timer = null;
    this.permissionTimer = null;
    this.finalizeTimer = null;
  }
  private releaseStream() {
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
  }
  private releaseRecognition() {
    const recognition = this.recognition;
    this.recognition = null;
    if (!recognition) return;
    recognition.onresult = null;
    recognition.onerror = null;
    recognition.onend = null;
    try {
      recognition.abort();
    } catch {
      /* Already ended. */
    }
  }
  private releaseRecorder() {
    const recorder = this.recorder;
    this.recorder = null;
    if (!recorder) return;
    recorder.ondataavailable = null;
    recorder.onstop = null;
    recorder.onerror = null;
    try {
      if (recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* Already ended. */
    }
  }

  setTranscript(text: string) {
    this.edited = true;
    this.emit({ transcript: text.slice(0, VOICE_MAX_TEXT) });
  }
  reset() {
    this.generation++;
    this.clearTimers();
    this.releaseRecognition();
    this.releaseRecorder();
    this.releaseStream();
    if (this.state.audioUrl) this.deps.revokeUrl(this.state.audioUrl);
    this.chunks = [];
    this.bytes = 0;
    this.parts.clear();
    this.edited = false;
    this.overLimit = false;
    this.endedMime = null;
    this.emit({ ...EMPTY_VOICE_SNAPSHOT });
  }
  dispose() {
    this.disposed = true;
    this.reset();
  }

  async start() {
    if (
      this.disposed ||
      ['requesting', 'recording', 'stopping'].includes(this.state.phase)
    )
      return;
    this.reset();
    if (!this.deps.getStream || !this.deps.createRecorder) {
      this.emit({
        phase: 'review',
        error:
          'متصفحك لا يدعم تسجيل الصوت هنا. اكتب نص التسجيل يدوياً للمراجعة.',
      });
      return;
    }
    const generation = this.generation;
    this.emit({
      phase: 'requesting',
      notice: 'اسمح باستخدام الميكروفون لبدء التسجيل.',
    });
    this.permissionTimer = setTimeout(() => {
      if (generation !== this.generation) return;
      this.generation++;
      this.permissionTimer = null;
      this.emit({
        phase: 'review',
        notice: '',
        error: 'انتهت مهلة إذن الميكروفون. حاول مجدداً أو اكتب النص يدوياً.',
      });
    }, 15_000);
    try {
      const stream = await this.deps.getStream();
      if (generation !== this.generation || this.disposed) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      if (this.permissionTimer) clearTimeout(this.permissionTimer);
      this.permissionTimer = null;
      this.stream = stream;
      const recorder = this.deps.createRecorder(stream);
      this.recorder = recorder;
      recorder.ondataavailable = (event) => {
        if (
          generation !== this.generation ||
          !event.data.size ||
          this.overLimit
        )
          return;
        this.bytes += event.data.size;
        if (this.bytes > VOICE_MAX_BYTES) {
          this.overLimit = true;
          this.chunks = [];
          this.emit({
            error:
              'تجاوز التسجيل 5MB؛ أوقفناه وحذفنا الصوت. راجع النص أو حاول بتسجيل أقصر.',
          });
          this.stop();
        } else this.chunks.push(event.data);
      };
      recorder.onstop = () => this.finish(generation, recorder.mimeType);
      recorder.onerror = () => {
        if (generation !== this.generation) return;
        this.overLimit = true;
        this.chunks = [];
        this.emit({
          error: 'تعذّر حفظ التسجيل الصوتي. يمكنك مراجعة النص وكتابته يدوياً.',
        });
        this.stop();
      };
      recorder.start(250);
      this.emit({ phase: 'recording', notice: '' });
      if (this.deps.createRecognition) {
        try {
          const recognition = this.deps.createRecognition();
          this.recognition = recognition;
          recognition.lang = 'ar-SA';
          recognition.continuous = true;
          recognition.interimResults = true;
          recognition.onresult = (event) => {
            if (generation !== this.generation || this.edited) return;
            this.emit({ transcript: updateVoiceTranscript(this.parts, event) });
          };
          recognition.onerror = () => {
            if (generation !== this.generation) return;
            this.emit({
              notice:
                'تعذّر تحويل الصوت إلى نص. استمع للتسجيل واكتب نصه يدوياً.',
            });
          };
          recognition.onend = () => {
            if (generation !== this.generation) return;
            this.releaseRecognition();
            if (this.state.phase === 'recording') {
              this.emit({
                notice:
                  'انتهى التقاط النص؛ أوقفنا التسجيل. راجع النص وأكمل ما ينقصه.',
              });
              this.stop();
            } else if (
              this.state.phase === 'stopping' &&
              this.endedMime !== null
            ) {
              this.finish(generation, this.endedMime);
            }
          };
          recognition.start();
        } catch {
          this.releaseRecognition();
          this.emit({
            notice:
              'تحويل الصوت إلى نص غير متاح الآن. استمع للتسجيل واكتب النص يدوياً.',
          });
        }
      } else
        this.emit({
          notice:
            'متصفحك لا يدعم تحويل الصوت إلى نص. يمكنك التسجيل والاستماع ثم كتابة النص يدوياً.',
        });
      if (this.state.phase !== 'recording') return;
      const began = Date.now();
      this.timer = setInterval(() => {
        if (generation !== this.generation) return;
        const seconds = Math.min(
          VOICE_MAX_SECONDS,
          Math.floor((Date.now() - began) / 1000),
        );
        this.emit({ seconds });
        if (seconds >= VOICE_MAX_SECONDS) {
          this.emit({ notice: 'بلغ التسجيل دقيقة؛ أوقفناه للمراجعة.' });
          this.stop();
        }
      }, 250);
    } catch (error) {
      if (generation !== this.generation || this.disposed) return;
      this.clearTimers();
      this.releaseRecognition();
      this.releaseRecorder();
      this.releaseStream();
      const denied =
        error instanceof Error &&
        ['NotAllowedError', 'PermissionDeniedError'].includes(error.name);
      this.emit({
        phase: 'review',
        notice: '',
        error: denied
          ? 'لم يُسمح بالميكروفون. غيّر إذن المتصفح أو اكتب النص يدوياً.'
          : 'تعذّر بدء التسجيل. تحقق من الميكروفون أو اكتب النص يدوياً.',
      });
    }
  }

  stop() {
    if (this.state.phase !== 'recording') return;
    this.emit({ phase: 'stopping' });
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    try {
      this.recognition?.stop();
    } catch {
      this.releaseRecognition();
    }
    const generation = this.generation;
    this.finalizeTimer = setTimeout(() => {
      if (generation !== this.generation || this.state.phase !== 'stopping')
        return;
      if (this.endedMime === null) {
        this.overLimit = true;
        this.chunks = [];
        this.emit({
          error: 'تعذّر إنهاء الصوت في الوقت المحدد. راجع النص يدوياً.',
        });
      }
      this.finish(generation, this.endedMime ?? '', true);
    }, 3000);
    try {
      if (this.recorder && this.recorder.state !== 'inactive')
        this.recorder.stop();
      else this.finish(generation, this.recorder?.mimeType ?? '');
    } catch {
      this.finish(generation, '');
    }
    this.releaseStream();
  }

  private finish(generation: number, mimeType: string, force = false) {
    if (generation !== this.generation || this.disposed) return;
    if (this.state.phase === 'recording') {
      this.stop();
      return;
    }
    this.endedMime = mimeType;
    // Drain the browser's final recognition event before allowing text edits.
    if (this.recognition && !force) {
      this.releaseStream();
      this.releaseRecorder();
      return;
    }
    this.clearTimers();
    this.releaseStream();
    this.releaseRecorder();
    this.releaseRecognition();
    let audioUrl: string | null = null;
    if (!this.overLimit && this.chunks.length) {
      try {
        audioUrl = this.deps.createUrl(
          new Blob(this.chunks, { type: mimeType || 'audio/webm' }),
        );
      } catch {
        this.emit({ error: 'تعذّرت معاينة الصوت. راجع النص يدوياً.' });
      }
    }
    this.chunks = [];
    this.emit({ phase: 'review', audioUrl });
  }
}
