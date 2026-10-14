import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import lottie from 'lottie-web'
import { ChevronRight, CircleHelp, Contrast, Download, FileText, HeartHandshake, Headset, Home, Info, Keyboard, Lightbulb, MapPin, Mic, Monitor, Play, Smartphone, Type, Volume2, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
import { TouchlessCursor } from './touchless/TouchlessCursor'
import { AdaptiveVision } from './vision/AdaptiveVision'
import { CalibrationPanel } from './vision/CalibrationPanel'
import type { FaceLevel } from './vision/activeUser'
import UiPreview from './preview/UiPreview'
import './App.css'

// A relative API keeps kiosk, QR, and external tunnel traffic on one origin.
const API = import.meta.env.VITE_API_URL ?? ''

type Recommendation = { program_id: string; name: string; plain_name: string; status: '확인됨' | '일부 확인됨' | '담당자 확인 필요'; guidance: string; preparation_items: string[]; needs_confirmation: string[]; office_hint: string; source: { name: string; url: string; checked_at: string } }
type ClarificationOption = { value: string; label: string }
type Conversation = { session_id: string; masked_text: string; assistant_text: string; clarifying_question?: string; clarification_key?: string; clarification_options: ClarificationOption[]; recommendations: Recommendation[]; staff_handoff: boolean }
type NaruState = 'idle' | 'listening' | 'thinking' | 'guiding' | 'complete'
type AvatarJob = { id: string; status: 'queued' | 'processing' | 'ready' | 'fallback'; video_url?: string | null; download_url?: string | null }

const naruAnimations: Record<NaruState, string> = {
  idle: '/naru_idle.json',
  listening: '/naru_listening.json',
  thinking: '/naru_thinking.json',
  guiding: '/naru_guiding.json',
  complete: '/naru_complete.json',
}

const RECORDING_SILENCE_MS = 2_000
const RECORDING_INITIAL_SILENCE_GRACE_MS = 5_000
const SPEECH_RMS_THRESHOLD = 0.018

function recordingFileName(mimeType: string): string {
  if (/mp4|aac/i.test(mimeType)) return 'navi-recording.m4a'
  if (/ogg/i.test(mimeType)) return 'navi-recording.ogg'
  return 'navi-recording.webm'
}

function wakeSocketUrl(): string {
  const url = new URL(`${API}/api/wake-word/stream`, window.location.href)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

const quickTopics = [
  { title: '기초생활 지원', text: '생활비가 어려워서 기초생활 지원을 알아보고 싶어요.', label: '복지 지원을 찾고 싶어요', Icon: HeartHandshake },
  { title: '긴급복지', text: '갑자기 위기 상황이 생겨 긴급복지 지원을 알아보고 싶어요.', label: '신청 서류가 궁금해요', Icon: FileText },
  { title: '노인 돌봄', text: '어르신 돌봄 서비스를 신청하고 싶어요.', label: '어디에서 신청하는지 알고 싶어요', Icon: MapPin },
  { title: '장애인 활동 지원', text: '장애인 활동 지원에 필요한 준비사항을 알고 싶어요.', label: '직원 상담을 받고 싶어요', Icon: Headset },
  { title: '청년 월세', text: '청년 월세 지원이 있는지 알고 싶어요.', label: '청년 월세를 알아보고 싶어요', Icon: Home },
]

const ttsVoiceOptions = [
  { value: 'ko-KR-SunHiNeural', label: '선희 - 차분한 여성 음성' },
  { value: 'ko-KR-InJoonNeural', label: '인준 - 차분한 남성 음성' },
  { value: 'ko-KR-HyunsuMultilingualNeural', label: '현수 - 또렷한 다국어 음성' },
]

const sidoOptions = ['서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도']

function WaveMark() {
  return <svg viewBox="0 0 48 48" aria-hidden="true"><path d="M8 14c6 0 6 6 12 6s6-6 12-6 6 6 8 6" /><path d="M8 22c6 0 6 6 12 6s6-6 12-6 6 6 8 6" /><path d="M8 30c6 0 6 6 12 6s6-6 12-6 6 6 8 6" /></svg>
}

function speakInBrowser(text: string) {
  window.speechSynthesis?.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ko-KR'; utterance.rate = 0.88
  window.speechSynthesis?.speak(utterance)
}

function downsampleTo16k(samples: Float32Array, inputSampleRate: number): ArrayBuffer {
  if (inputSampleRate === 16_000) {
    return Int16Array.from(samples, (sample) => Math.max(-1, Math.min(1, sample)) * 0x7fff).buffer
  }
  const ratio = inputSampleRate / 16_000
  const output = new Int16Array(Math.round(samples.length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    const start = Math.floor(index * ratio)
    const end = Math.min(Math.floor((index + 1) * ratio), samples.length)
    let sum = 0
    for (let sampleIndex = start; sampleIndex < end; sampleIndex += 1) sum += samples[sampleIndex]
    output[index] = Math.max(-1, Math.min(1, sum / Math.max(end - start, 1))) * 0x7fff
  }
  return output.buffer
}

function NaruAnimationLayer({ state, path, visible, onLoaded }: { state: NaruState; path: string; visible: boolean; onLoaded: (state: NaruState) => void }) {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const animationRef = useRef<ReturnType<typeof lottie.loadAnimation> | null>(null)
  const onLoadedRef = useRef(onLoaded)

  useEffect(() => { onLoadedRef.current = onLoaded }, [onLoaded])

  useEffect(() => {
    if (!containerRef.current) return
    const animation = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path,
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    animationRef.current = animation
    const markLoaded = () => onLoadedRef.current(state)
    animation.addEventListener('DOMLoaded', markLoaded)
    return () => {
      animation.removeEventListener('DOMLoaded', markLoaded)
      animation.destroy()
    }
  }, [path, state])

  useEffect(() => {
    if (visible) animationRef.current?.play()
    else animationRef.current?.pause()
  }, [visible])

  return <div className={'naru-animation-layer' + (visible ? ' visible' : '')} ref={containerRef} aria-hidden="true" />
}

function NaruAnimation({ state }: { state: NaruState }) {
  const [loadedStates, setLoadedStates] = useState<Set<NaruState>>(() => new Set())
  const [lastReadyState, setLastReadyState] = useState<NaruState>('idle')
  const visibleState = loadedStates.has(state) ? state : lastReadyState

  const markLoaded = (loadedState: NaruState) => {
    setLoadedStates((current) => current.has(loadedState) ? current : new Set(current).add(loadedState))
    if (loadedState === state) setLastReadyState(loadedState)
  }

  return <div className="naru-animation" role="img" aria-label={`나루 ${state} 상태`}>
    {(Object.entries(naruAnimations) as [NaruState, string][]).map(([animationState, path]) => (
      <NaruAnimationLayer key={animationState} state={animationState} path={path} visible={visibleState === animationState} onLoaded={markLoaded} />
    ))}
  </div>
}

function Kiosk({ preview = false }: { preview?: boolean }) {
  const [message, setMessage] = useState('')
  const [inputMode, setInputMode] = useState<'voice' | 'text' | 'menu'>('voice')
  const [largeText, setLargeText] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [touchlessEnabled, setTouchlessEnabled] = useState(() => localStorage.getItem('navi-touchless-enabled') !== 'false')
  const [cameraDebugOpen, setCameraDebugOpen] = useState(false)
  const [regionSido, setRegionSido] = useState('')
  const [regionSigungu, setRegionSigungu] = useState('')
  const [ttsVoice, setTtsVoice] = useState(() => localStorage.getItem('navi-tts-voice') ?? 'ko-KR-SunHiNeural')
  const [screenLayout, setScreenLayout] = useState<'portrait' | 'landscape'>('portrait')
  const [autoLevel, setAutoLevel] = useState<FaceLevel>('MID')
  const [manualLevel, setManualLevel] = useState<FaceLevel | null>(null)
  const [handoverPending, setHandoverPending] = useState(false)
  const [ageGroup, setAgeGroup] = useState('선택 안 함')
  const [gender, setGender] = useState('선택 안 함')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [listening, setListening] = useState(false)
  const [loading, setLoading] = useState(false)
  const [inputError, setInputError] = useState(false)
  const [notice, setNotice] = useState('마이크를 눌러 말씀해 주세요.')
  const [wakeStatus, setWakeStatus] = useState<'connecting' | 'listening' | 'unavailable'>('connecting')
  const [sttDiagnostic, setSttDiagnostic] = useState('아직 음성 입력을 시도하지 않았습니다.')
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null)
  const [avatarState, setAvatarState] = useState<NaruState>('idle')
  const [avatarJob, setAvatarJob] = useState<AvatarJob | null>(null)
  const [avatarVideoOpen, setAvatarVideoOpen] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const recordingSilenceTimerRef = useRef<number | null>(null)
  const recordingAudioContextRef = useRef<AudioContext | null>(null)
  const recordingSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const recordingAnalyserRef = useRef<AnalyserNode | null>(null)
  const recordingStartedAtRef = useRef<number | null>(null)
  const recordingSilenceStartedAtRef = useRef<number | null>(null)
  const recordingHeardSpeechRef = useRef(false)
  const wakeStreamRef = useRef<MediaStream | null>(null)
  const wakeSocketRef = useRef<WebSocket | null>(null)
  const wakeContextRef = useRef<AudioContext | null>(null)
  const wakeSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const wakeProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const wakeSilenceRef = useRef<GainNode | null>(null)
  const wakeListeningRef = useRef(false)
  const wakeAutoStartedRef = useRef(false)
  const manualVoiceActionRef = useRef(false)
  const startWakeWordRef = useRef<((autoStart?: boolean) => Promise<void>) | null>(null)
  const avatarPollingRef = useRef<number | null>(null)
  const avatarRequestRef = useRef<string | null>(null)
  const requestGenerationRef = useRef(0)
  const pendingRequestsRef = useRef(new Set<AbortController>())
  const recordingCancelledRef = useRef(false)
  const wakeRestartTimeoutRef = useRef<number | null>(null)

  const trackedFetch = async (url: string, options?: RequestInit) => {
    const controller = new AbortController()
    pendingRequestsRef.current.add(controller)
    try { return await fetch(url, { ...options, signal: controller.signal }) }
    finally { pendingRequestsRef.current.delete(controller) }
  }

  const checkSttServer = async () => {
    setSttDiagnostic('음성 인식 서버 연결을 확인하고 있습니다.')
    try {
      const response = await fetch(`${API}/api/health`, { cache: 'no-store' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const health = await response.json() as { stt?: { available?: boolean; model?: string; device?: string } }
      setSttDiagnostic(health.stt?.available
        ? `서버 연결됨 · STT ${health.stt.model ?? '모델 미확인'} (${health.stt.device ?? '장치 미확인'}) · 마이크 녹음 후 실제 인식이 가능한지 확인해 주세요.`
        : '서버는 연결됐지만 STT 패키지를 사용할 수 없습니다.')
    } catch {
      setSttDiagnostic('음성 인식 서버에 연결하지 못했습니다. 데모 실행 창의 API 서버 상태를 확인해 주세요.')
    }
  }

  useEffect(() => () => {
    recorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current)
    stopRecordingSilenceDetection()
    if (avatarPollingRef.current) window.clearTimeout(avatarPollingRef.current)
    stopWakeWord()
    if (wakeRestartTimeoutRef.current) window.clearTimeout(wakeRestartTimeoutRef.current)
  }, [])

  useEffect(() => {
    localStorage.setItem('navi-tts-voice', ttsVoice)
  }, [ttsVoice])

  useEffect(() => {
    localStorage.setItem('navi-touchless-enabled', String(touchlessEnabled))
  }, [touchlessEnabled])

  useEffect(() => {
    if (!settingsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [settingsOpen])

  function stopRecordingSilenceDetection() {
    if (recordingSilenceTimerRef.current) window.clearTimeout(recordingSilenceTimerRef.current)
    recordingSilenceTimerRef.current = null
    recordingSourceRef.current?.disconnect()
    recordingSourceRef.current = null
    recordingAnalyserRef.current = null
    void recordingAudioContextRef.current?.close()
    recordingAudioContextRef.current = null
    recordingStartedAtRef.current = null
    recordingSilenceStartedAtRef.current = null
  }

  function monitorRecordingSilence(stream: MediaStream, recorder: MediaRecorder) {
    try {
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const analyser = context.createAnalyser()
      analyser.fftSize = 2_048
      source.connect(analyser)
      recordingAudioContextRef.current = context
      recordingSourceRef.current = source
      recordingAnalyserRef.current = analyser
      const samples = new Uint8Array(analyser.fftSize)
      const checkSilence = () => {
        if (recorder.state !== 'recording') return
        analyser.getByteTimeDomainData(samples)
        let sum = 0
        for (const sample of samples) {
          const amplitude = (sample - 128) / 128
          sum += amplitude * amplitude
        }
        const rms = Math.sqrt(sum / samples.length)
        const now = performance.now()
        const stillInGracePeriod = recordingStartedAtRef.current !== null && now - recordingStartedAtRef.current < RECORDING_INITIAL_SILENCE_GRACE_MS
        const hasSpeechEnergy = rms >= SPEECH_RMS_THRESHOLD
        if (hasSpeechEnergy) recordingHeardSpeechRef.current = true
        if (stillInGracePeriod) {
          recordingSilenceStartedAtRef.current = null
        } else if (hasSpeechEnergy) {
          recordingSilenceStartedAtRef.current = null
        } else if (recordingSilenceStartedAtRef.current === null) {
          recordingSilenceStartedAtRef.current = now
        } else if (now - recordingSilenceStartedAtRef.current >= RECORDING_SILENCE_MS) {
          setNotice(recordingHeardSpeechRef.current ? '말씀이 끝난 것으로 보고 녹음을 마칩니다.' : '2초 동안 말씀이 없어 녹음을 마칩니다.')
          recorder.stop()
          return
        }
        recordingSilenceTimerRef.current = window.setTimeout(checkSilence, 120)
      }
      void context.resume()
      checkSilence()
    } catch {
      // Silence detection is optional; recording continues through the manual control.
    }
  }

  const stopAvatarPolling = () => {
    avatarRequestRef.current = null
    if (avatarPollingRef.current) window.clearTimeout(avatarPollingRef.current)
    avatarPollingRef.current = null
  }

  const requestAvatarVideo = async (text: string, audioUrl: string) => {
    const generation = requestGenerationRef.current
    stopAvatarPolling()
    try {
      const response = await trackedFetch(`${API}/api/avatar-jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, audio_url: audioUrl }),
      })
      if (!response.ok) throw new Error('avatar request failed')
      const initial = await response.json() as AvatarJob
      if (generation !== requestGenerationRef.current) return
      setAvatarJob(initial)
      if (initial.status === 'fallback') return
      avatarRequestRef.current = initial.id
      const poll = async () => {
        try {
          const statusResponse = await trackedFetch(`${API}/api/avatar-jobs/${initial.id}`)
          if (!statusResponse.ok) throw new Error('avatar status failed')
          const status = await statusResponse.json() as AvatarJob
          if (generation !== requestGenerationRef.current || avatarRequestRef.current !== status.id) return
          setAvatarJob(status)
          if (status.status === 'queued' || status.status === 'processing') {
            avatarPollingRef.current = window.setTimeout(() => void poll(), 3000)
          }
        } catch {
          if (generation === requestGenerationRef.current && avatarRequestRef.current === initial.id) setAvatarJob({ id: initial.id, status: 'fallback' })
        }
      }
      void poll()
    } catch {
      if (generation === requestGenerationRef.current) setAvatarJob(null)
    }
  }

  const announce = async (text: string, afterGuidance: NaruState = 'idle', createAvatar = false) => {
    const generation = requestGenerationRef.current
    setAvatarState('guiding')
    try {
      const response = await trackedFetch(`${API}/api/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: ttsVoice }) })
      const result = await response.json() as { audio_url?: string }
      if (generation !== requestGenerationRef.current) return
      if (result.audio_url && audioRef.current) {
        if (createAvatar) void requestAvatarVideo(text, result.audio_url)
        audioRef.current.src = `${API}${result.audio_url}`
        await audioRef.current.play()
        return
      }
      speakInBrowser(text)
    } catch { if (generation === requestGenerationRef.current) speakInBrowser(text) }
    window.setTimeout(() => { if (generation === requestGenerationRef.current) setAvatarState((current) => current === 'guiding' ? afterGuidance : current) }, 1200)
  }

  const transcribeRecording = async (recording: Blob) => {
    const generation = requestGenerationRef.current
    setInputError(false)
    setAvatarState('thinking')
    setNotice('')
    try {
      if (!recording.size) throw new Error('empty-recording')
      setSttDiagnostic(`녹음 완료: ${recording.type || '형식 미확인'}, ${Math.round(recording.size / 1024)}KB. 서버에 전송 중입니다.`)
      const form = new FormData()
      form.append('audio', new File([recording], recordingFileName(recording.type), { type: recording.type || 'audio/webm' }))
      const response = await trackedFetch(API + '/api/transcriptions', { method: 'POST', body: form })
      if (!response.ok) throw new Error(`http-${response.status}`)
      const result = await response.json() as { text?: string }
      if (generation !== requestGenerationRef.current) return
      if (!result.text?.trim()) throw new Error('empty transcription')
      setSttDiagnostic(`음성 인식 성공: ${recording.type || '형식 미확인'}, ${Math.round(recording.size / 1024)}KB`)
      setMessage(result.text.trim())
      setNotice('')
      setAvatarState('idle')
      window.setTimeout(() => void startWakeWordRef.current?.(true), 350)
    } catch (error) {
      if (generation !== requestGenerationRef.current) return
      setInputError(true)
      const reason = error instanceof Error ? error.message : ''
      setSttDiagnostic(reason === 'empty-recording' ? '녹음된 데이터가 없습니다.'
        : reason === 'empty transcription' ? `서버는 응답했지만 말소리를 인식하지 못했습니다. (${recording.type || '형식 미확인'}, ${Math.round(recording.size / 1024)}KB)`
          : error instanceof TypeError ? '음성 인식 서버에 연결하지 못했습니다. API 실행 상태를 확인하세요.'
            : reason.startsWith('http-') ? `음성 인식 서버 오류: ${reason.slice(5)} (${recording.type || '형식 미확인'}, ${Math.round(recording.size / 1024)}KB)`
              : `음성 인식 처리 실패: ${reason || '원인 미확인'}`)
      setNotice(reason.startsWith('http-') || error instanceof TypeError
        ? ''
        : reason === 'empty-recording' ? '녹음된 소리가 없습니다. 마이크 권한을 확인하고 다시 말씀해 주세요.'
          : '음성을 글자로 바꾸지 못했습니다. 다시 말하거나 직접 입력해 주세요.')
      setInputMode('text')
      setAvatarState('idle')
      window.setTimeout(() => void startWakeWordRef.current?.(true), 350)
    }
  }

  function stopWakeWord() {
    wakeSocketRef.current?.close()
    wakeSocketRef.current = null
    wakeProcessorRef.current?.disconnect()
    wakeProcessorRef.current = null
    wakeSourceRef.current?.disconnect()
    wakeSourceRef.current = null
    wakeSilenceRef.current?.disconnect()
    wakeSilenceRef.current = null
    void wakeContextRef.current?.close()
    wakeContextRef.current = null
    wakeStreamRef.current?.getTracks().forEach((track) => track.stop())
    wakeStreamRef.current = null
    wakeListeningRef.current = false
    setWakeStatus('unavailable')
  }

  async function startWakeWord(autoStart = false) {
    const generation = requestGenerationRef.current
    if (wakeListeningRef.current) {
      if (!autoStart) {
        stopWakeWord()
        setNotice('나루야 감지를 멈췄습니다. 필요하면 다시 켜 주세요.')
      }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.WebSocket) {
      setWakeStatus('unavailable')
      if (!autoStart) setNotice('이 기기에서는 웨이크 워드를 사용할 수 없습니다. 말하기 버튼을 이용해 주세요.')
      return
    }
    try {
      setWakeStatus('connecting')
      const statusResponse = await fetch(`${API}/api/wake-word/status`)
      if (!statusResponse.ok) throw new Error('wake word server unavailable')
      const status = await statusResponse.json() as { ready?: boolean }
      if (generation !== requestGenerationRef.current) return
      if (!status.ready) throw new Error('wake word model unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== requestGenerationRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const silence = context.createGain()
      silence.gain.value = 0
      wakeStreamRef.current = stream
      wakeContextRef.current = context
      wakeSourceRef.current = source
      wakeProcessorRef.current = processor
      wakeSilenceRef.current = silence
      const socket = new WebSocket(wakeSocketUrl())
      wakeSocketRef.current = socket
      socket.onopen = () => {
        if (wakeSocketRef.current !== socket) return
        if (manualVoiceActionRef.current) {
          stopWakeWord()
          return
        }
        wakeListeningRef.current = true
        setWakeStatus('listening')
        source.connect(processor)
        processor.connect(silence)
        silence.connect(context.destination)
        void context.resume().catch(() => {
          if (wakeSocketRef.current === socket) stopWakeWord()
        })
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(downsampleTo16k(event.inputBuffer.getChannelData(0), context.sampleRate))
        }
        setAvatarState('idle')
        if (!autoStart) setNotice('"나루야"라고 부르면 음성 상담을 시작합니다.')
      }
      socket.onmessage = (event) => {
        if (wakeSocketRef.current !== socket) return
        const payload = JSON.parse(String(event.data)) as { type?: string }
        if (payload.type === 'activated') {
          stopWakeWord()
          setNotice('나루야를 들었어요. 필요한 도움을 말씀해 주세요.')
          window.setTimeout(() => void startListening(), 100)
        }
        if (payload.type === 'unavailable') {
          stopWakeWord()
          if (!autoStart) setNotice('나루야 모델이 아직 준비되지 않았습니다. 말하기 버튼을 이용해 주세요.')
        }
      }
      socket.onerror = () => {
        if (wakeSocketRef.current !== socket) return
        stopWakeWord()
        if (!autoStart) setNotice('나루야 감지 연결에 문제가 있습니다. 말하기 버튼을 이용해 주세요.')
      }
      socket.onclose = () => {
        if (wakeSocketRef.current === socket) stopWakeWord()
      }
    } catch {
      if (generation !== requestGenerationRef.current) return
      stopWakeWord()
      if (!autoStart && !manualVoiceActionRef.current) setNotice('나루야 모델 또는 마이크 권한이 필요합니다. 말하기 버튼을 이용해 주세요.')
    }
  }

  startWakeWordRef.current = startWakeWord

  useEffect(() => {
    if (wakeAutoStartedRef.current) return
    wakeAutoStartedRef.current = true
    void startWakeWordRef.current?.(true)
  }, [])

  const startListening = async () => {
    const generation = requestGenerationRef.current
    if (!conversation) setManualLevel(null)
    manualVoiceActionRef.current = true
    setInputError(false)
    if (wakeListeningRef.current) stopWakeWord()
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      manualVoiceActionRef.current = false
      setInputError(true)
      setSttDiagnostic('이 브라우저에서 마이크 녹음을 지원하지 않습니다.')
      setNotice('이 기기에서는 마이크 녹음을 사용할 수 없습니다. 직접 입력해 주세요.')
      setInputMode('text')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      if (generation !== requestGenerationRef.current) { stream.getTracks().forEach((track) => track.stop()); return }
      const chunks: BlobPart[] = []
      const preferredMimeType = ['audio/webm;codecs=opus', 'audio/mp4', 'audio/webm'].find((type) => MediaRecorder.isTypeSupported(type))
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined)
      setSttDiagnostic(`마이크 녹음 중: ${recorder.mimeType || '형식 자동 선택'}`)
      recordingHeardSpeechRef.current = false
      recordingCancelledRef.current = false
      recordingStartedAtRef.current = performance.now()
      recordingSilenceStartedAtRef.current = null
      recorderRef.current = recorder
      recordingStreamRef.current = stream
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        const cancelled = recordingCancelledRef.current
        if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
        stopRecordingSilenceDetection()
        recorderRef.current = null
        manualVoiceActionRef.current = false
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        setListening(false)
        if (cancelled) return
        void transcribeRecording(new Blob(chunks, { type: recorder.mimeType || (chunks[0] instanceof Blob ? chunks[0].type : '') || 'audio/webm' }))
      }
      recorder.start()
      monitorRecordingSilence(stream, recorder)
      setListening(true)
      setAvatarState('listening')
      setNotice('')
      recordingTimeoutRef.current = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), 30000)
    } catch {
      if (generation !== requestGenerationRef.current) return
      manualVoiceActionRef.current = false
      setInputError(true)
      setSttDiagnostic('마이크 권한 또는 녹음 시작에 실패했습니다.')
      setListening(false)
      setAvatarState('idle')
      setNotice('마이크 권한이 필요합니다. 브라우저에서 마이크 사용을 허용하거나 직접 입력해 주세요.')
      setInputMode('text')
    }
  }

  const sendConversation = async (text: string, sessionId?: string, answers: Record<string, string> = {}) => {
    if (!text.trim()) { setNotice('도움이 필요한 상황을 한 문장으로 말씀하거나 적어 주세요.'); return }
    const generation = requestGenerationRef.current
    setLoading(true); setSummaryUrl(null); setAvatarState('thinking')
    try {
      const response = await trackedFetch(API + '/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          session_id: sessionId,
          answers,
          region_sido: regionSido || null,
          region_sigungu: regionSido ? regionSigungu.trim() || null : null,
          demographics: { age_group: ageGroup === '선택 안 함' ? null : ageGroup, gender: gender === '선택 안 함' ? null : gender },
        }),
      })
      if (!response.ok) throw new Error('conversation failed')
      const result = await response.json() as Conversation
      if (generation !== requestGenerationRef.current) return
      setConversation(result)
      setNotice(result.assistant_text)
      void announce(
        result.assistant_text + ' ' + (result.clarifying_question ?? ''),
        result.clarifying_question ? 'idle' : result.recommendations.length ? 'complete' : 'idle',
        result.recommendations.length > 0,
      )
    } catch {
      if (generation !== requestGenerationRef.current) return
      setNotice('연결에 문제가 있습니다. 담당자에게 도움을 요청해 주세요.')
      setAvatarState('idle')
    } finally {
      if (generation === requestGenerationRef.current) setLoading(false)
    }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!conversation) setManualLevel(null)
    if (conversation?.clarification_key) {
      await sendConversation(message, conversation.session_id, { [conversation.clarification_key]: message })
      return
    }
    await sendConversation(message)
  }

  const answerClarification = async (option: ClarificationOption) => {
    if (!conversation?.clarification_key) return
    if (conversation.clarification_key === 'age_group') setAgeGroup(option.value)
    await sendConversation(option.label, conversation.session_id, { [conversation.clarification_key]: option.value })
  }

  const createSummary = async () => {
    if (!conversation?.recommendations.length) return
    const generation = requestGenerationRef.current
    try {
      const response = await trackedFetch(`${API}/api/summaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: conversation.session_id, recommendation_ids: conversation.recommendations.map((item) => item.program_id) }) })
      const result = await response.json() as { public_url: string }
      if (generation !== requestGenerationRef.current) return
      setSummaryUrl(`${window.location.origin}${result.public_url}`)
      setAvatarState('complete')
    } catch { if (generation === requestGenerationRef.current) setNotice('상담 요약을 만들지 못했어요. 다시 시도해 주세요.') }
  }
  const restart = () => {
    requestGenerationRef.current += 1
    pendingRequestsRef.current.forEach((controller) => controller.abort())
    pendingRequestsRef.current.clear()
    recordingCancelledRef.current = true
    manualVoiceActionRef.current = false
    if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
    if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current)
    stopRecordingSilenceDetection()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    stopWakeWord()
    audioRef.current?.pause()
    if (audioRef.current) audioRef.current.removeAttribute('src')
    window.speechSynthesis?.cancel()
    stopAvatarPolling()
    setListening(false); setLoading(false); setMessage(''); setInputMode('voice')
    setAgeGroup('선택 안 함'); setGender('선택 안 함'); setConversation(null)
    setRegionSido(''); setRegionSigungu('')
    setSummaryUrl(null); setAvatarJob(null); setAvatarVideoOpen(false)
    setInputError(false); setAvatarState('idle'); setHandoverPending(false)
    setManualLevel(null); setNotice('마이크를 눌러 말씀해 주세요.')
    if (wakeRestartTimeoutRef.current) window.clearTimeout(wakeRestartTimeoutRef.current)
    wakeRestartTimeoutRef.current = window.setTimeout(() => { wakeRestartTimeoutRef.current = null; void startWakeWordRef.current?.(true) }, 350)
  }
  const submitExample = (text: string) => { setManualLevel(null); setMessage(text); void sendConversation(text) }
  const hasSessionContent = Boolean(message || conversation || listening || loading)
  useEffect(() => {
    if (!handoverPending || listening || loading || avatarState === 'guiding' || avatarVideoOpen) return
    const timeout = window.setTimeout(() => restart(), 8000)
    return () => window.clearTimeout(timeout)
    // The timer is deliberately restarted only when activity resumes or the handover changes.
    // oxlint-disable-next-line react-hooks/exhaustive-deps
  }, [handoverPending, listening, loading, avatarState, avatarVideoOpen])
  const sessionStage = listening ? 'listening'
    : loading || avatarState === 'thinking' ? 'thinking'
      : conversation?.clarifying_question ? 'clarify'
        : conversation ? 'results'
          : inputError ? 'error'
            : inputMode === 'text' ? 'input'
              : message ? 'review' : 'welcome'
  const sessionHeading = {
    welcome: { title: '', detail: '무엇을 도와드릴까요?' },
    listening: { title: '나루가 듣고 있어요', detail: '편하게 말씀해 주세요.' },
    thinking: { title: '안내를 찾는 중이에요', detail: '잠시만 기다려 주세요.' },
    clarify: { title: '한 가지만 더 알려주세요', detail: '아래 질문에 답해 주세요.' },
    results: { title: '안내를 준비했어요', detail: '결과와 준비사항을 확인해 주세요.' },
    error: { title: '음성을 확인하지 못했어요', detail: '다시 말씀하거나 직접 입력해 주세요.' },
    input: { title: '궁금한 점을 적어 주세요', detail: '필요한 안내를 찾아드릴게요.' },
    review: { title: '말씀을 확인해 주세요', detail: '맞으면 아래 확인 버튼을 눌러 주세요.' },
  }[sessionStage]

  const resultsPanel = conversation && <section className="reference-results" aria-live="polite">
    <div className="reference-results-head"><div><span>안내를 준비했어요</span><h2>{conversation.clarifying_question ? '상담 내용을 확인할게요' : '상담 준비 결과'}</h2></div><button data-touchless="true" type="button" onClick={restart}>처음으로</button></div>
    <div className="reference-results-scroll">
      {conversation.clarifying_question && <section className="reference-clarification"><p>{conversation.assistant_text}</p><h3>{conversation.clarifying_question}</h3><div>{conversation.clarification_options.map((option) => <button data-touchless="true" type="button" key={option.value} disabled={loading} onClick={() => void answerClarification(option)}>{option.label}</button>)}</div><button data-touchless="true" className="reference-clarification-text" type="button" onClick={() => setInputMode('text')}>직접 답변 입력하기</button></section>}
      {conversation.recommendations.map((item) => <article key={item.program_id}><span className={'status ' + item.status.replaceAll(' ', '-')}>{item.status}</span><span className="reference-result-source">{item.source.name}</span><h3>{item.plain_name}</h3><p>{item.guidance}</p><h4>먼저 준비해 주세요</h4><ul>{item.preparation_items.map((value) => <li key={value}>{value}</li>)}</ul><p className="reference-office">상담 장소: {item.office_hint}</p></article>)}
      {conversation.recommendations.length > 0 && <><aside>실제 대상 여부와 추가 제출 서류는 담당 직원이 최종 확인합니다.</aside><div className="reference-result-actions"><button data-touchless="true" type="button" onClick={createSummary}>QR로 상담 요약 받기</button><button data-touchless="true" type="button" onClick={() => window.print()}>준비사항 인쇄하기</button>{avatarJob?.status === 'ready' && avatarJob.video_url && <button data-touchless="true" type="button" className="avatar-video-button" onClick={() => setAvatarVideoOpen(true)}><Play aria-hidden="true" /> 영상 안내 보기</button>}{avatarJob?.status === 'ready' && avatarJob.download_url && <a className="avatar-download-button" href={avatarJob.download_url} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> 영상 다운로드</a>}</div>{avatarJob && avatarJob.status !== 'ready' && avatarJob.status !== 'fallback' && <p className="avatar-job-status">나루가 안내 영상을 준비하고 있어요. 화면 안내는 계속 이용할 수 있습니다.</p>}{summaryUrl && <div className="reference-qr"><QRCodeSVG value={summaryUrl} size={132} /><p>이 QR을 담당자에게 보여 주세요.</p></div>}</>}
    </div>
  </section>

  const settingsPanel = settingsOpen && <div className="reference-settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
    <section className="reference-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>환경설정</p><h2 id="settings-title">이용 환경을 설정하세요</h2></div><button data-touchless="true" type="button" className="reference-settings-close" onClick={() => setSettingsOpen(false)} aria-label="환경설정 닫기"><X aria-hidden="true" /></button></header>
      <label htmlFor="tts-voice">TTS 안내 음성<select id="tts-voice" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>{ttsVoiceOptions.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label>
      <div className="reference-layout-settings" role="group" aria-label="화면 배치 선택"><span>화면 배치</span><button className={screenLayout === 'portrait' ? 'active' : ''} type="button" aria-pressed={screenLayout === 'portrait'} onClick={() => setScreenLayout('portrait')}><Smartphone aria-hidden="true" />세로형</button><button className={screenLayout === 'landscape' ? 'active' : ''} type="button" aria-pressed={screenLayout === 'landscape'} onClick={() => setScreenLayout('landscape')}><Monitor aria-hidden="true" />가로형</button></div>
      <label htmlFor="view-height">조작 버튼 높이<select id="view-height" value={manualLevel ?? 'AUTO'} onChange={(event) => setManualLevel(event.target.value === 'AUTO' ? null : event.target.value as FaceLevel)}><option value="AUTO">자동 조정</option><option value="LOW">낮게 보기</option><option value="MID">기본 보기</option><option value="HIGH">높게 보기</option></select></label>
      <div className="reference-settings-switch"><div><strong>비접촉 손동작</strong><small>카메라로 손을 인식해 커서를 조작합니다. 기본으로 켜져 있습니다.</small></div><button data-touchless="true" type="button" role="switch" aria-label="비접촉 손동작" aria-checked={touchlessEnabled} onClick={() => setTouchlessEnabled((value) => !value)}>{touchlessEnabled ? '켜짐' : '꺼짐'}</button></div>
      <div className="reference-settings-switch"><div><strong>나루야 음성 호출</strong><small>{wakeStatus === 'listening' ? '호출어를 듣고 있습니다.' : wakeStatus === 'connecting' ? '연결 중입니다.' : '연결되지 않았습니다. 음성 인식 서버와 마이크 권한을 확인해 주세요.'}</small></div><button data-touchless="true" type="button" onClick={() => void startWakeWord()}>{wakeStatus === 'listening' ? '중지' : '다시 시도'}</button></div>
      <div className="reference-settings-switch"><div><strong>음성 입력 점검</strong><small role="status">{sttDiagnostic}</small></div><button data-touchless="true" type="button" onClick={() => void checkSttServer()}>서버 확인</button></div>
      <div className="reference-settings-region"><strong>상담 지역</strong><p>공공데이터 API 연결 시 정부 부처 정보와 선택 지역의 지자체 정보를 함께 찾습니다. 새 상담을 시작하면 초기화됩니다.</p><label htmlFor="region-sido">시·도<select id="region-sido" value={regionSido} onChange={(event) => { setRegionSido(event.target.value); setRegionSigungu('') }}><option value="">전국 정보만 보기</option>{sidoOptions.map((sido) => <option key={sido} value={sido}>{sido}</option>)}</select></label><label htmlFor="region-sigungu">시·군·구<input id="region-sigungu" value={regionSigungu} onChange={(event) => setRegionSigungu(event.target.value)} disabled={!regionSido} maxLength={30} placeholder="예: 부평구 (선택 사항)" /></label></div>
      <button data-touchless="true" type="button" className="reference-settings-debug" onClick={() => { setSettingsOpen(false); setCameraDebugOpen(true) }}>카메라 디버그 보기</button>
      <div className="reference-settings-actions"><button data-touchless="true" type="button" className="reference-settings-preview" onClick={() => void announce('안녕하세요. 복지나루 AI 안내 도우미 나루입니다. 필요한 도움을 편하게 말씀해 주세요.') }><Volume2 aria-hidden="true" /> 미리 듣기</button><button data-touchless="true" type="button" className="reference-settings-confirm" onClick={() => setSettingsOpen(false)}>확인</button></div>
    </section>
  </div>

  const videoPanel = avatarVideoOpen && avatarJob?.video_url && <div className="avatar-video-backdrop" role="presentation" onMouseDown={() => setAvatarVideoOpen(false)}>
    <section className="avatar-video-modal" role="dialog" aria-modal="true" aria-label="나루 영상 안내" onMouseDown={(event) => event.stopPropagation()}>
      <header><div><p>나루 영상 안내</p><h2>안내 내용을 영상으로 들으세요</h2></div><button data-touchless="true" type="button" onClick={() => setAvatarVideoOpen(false)} aria-label="영상 닫기"><X aria-hidden="true" /></button></header>
      <video src={avatarJob.video_url} controls autoPlay playsInline onPlay={() => audioRef.current?.pause()} />
      {avatarJob.download_url && <a href={avatarJob.download_url} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> 영상 다운로드</a>}
    </section>
  </div>

  if (preview) return <main className={'ui-preview preview-functional layout-' + screenLayout + ' view-' + (manualLevel ?? autoLevel).toLowerCase() + (largeText ? ' is-large' : '') + (highContrast ? ' is-contrast' : '')}>
    <audio ref={audioRef} onEnded={() => setAvatarState(conversation?.recommendations.length ? 'complete' : 'idle')} />
    <UiPreview
      largeText={largeText} highContrast={highContrast} level={manualLevel ?? autoLevel}
      listening={listening} loading={loading} inputMode={inputMode}
      message={message} notice={notice} sessionHeading={sessionHeading} hasConversation={Boolean(conversation)}
      avatar={<NaruAnimation state={avatarState} />}
      vision={<AdaptiveVision debugOpen={cameraDebugOpen} onDebugClose={() => setCameraDebugOpen(false)} detectedLevel={autoLevel} appliedLevel={manualLevel ?? autoLevel} manualOverride={manualLevel !== null} onLevel={setAutoLevel} onHandover={() => { if (hasSessionContent) setHandoverPending(true) }} onReturn={() => setHandoverPending(false)} onAbsence={() => setHandoverPending(false)} />}
      touchless={<TouchlessCursor enabled={touchlessEnabled} />}
      handover={handoverPending && <div className="handover-prompt" role="alertdialog" aria-label="새 사용자 확인"><strong>새로운 분이 이용 중인가요?</strong><span>계속 이용하시려면 눌러 주세요. 응답이 없으면 8초 뒤 새 상담을 시작합니다.</span><div><button data-touchless="true" type="button" onClick={() => setHandoverPending(false)}>계속 사용</button><button data-touchless="true" type="button" onClick={restart}>새로 시작</button></div></div>}
      results={resultsPanel}
      onToggleLargeText={() => setLargeText((value) => !value)} onToggleHighContrast={() => setHighContrast((value) => !value)}
      onOpenSettings={() => setSettingsOpen(true)} onHelp={() => setNotice('마이크를 누르고 필요한 도움을 말씀해 주세요. 말하기가 어려우면 직접 입력하기를 눌러 주세요.')} onMic={() => void startListening()}
      onToggleText={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}
      onMessageChange={(value) => { setMessage(value); setInputError(false) }} onTextSubmit={(event) => void submit(event)} onConfirmMessage={() => void submit()} onEditMessage={() => setInputMode('text')}
      onExample={submitExample} onRestart={restart}
    />
    {settingsPanel}
    {videoPanel}
  </main>

  return <main className={'kiosk-shell reference-kiosk kiosk-home layout-' + screenLayout + ' view-' + (manualLevel ?? autoLevel).toLowerCase() + (largeText ? ' large-text' : '') + (highContrast ? ' high-contrast' : '')}>
    <audio ref={audioRef} onEnded={() => setAvatarState(conversation?.recommendations.length ? 'complete' : 'idle')} />
    <header className="reference-header">
      <a className="reference-brand" href="/"><span className="reference-logo"><WaveMark /></span><span><strong>복지나루</strong><small>말로 물어보는 복지·민원 안내</small></span></a>
      <div className="reference-header-actions">
        <div className="reference-tools">
          <button data-touchless="true" className={largeText ? 'active' : ''} type="button" aria-pressed={largeText} onClick={() => setLargeText((value) => !value)}><Type aria-hidden="true" /><span>글자 크게</span></button>
          <button data-touchless="true" className={highContrast ? 'active' : ''} type="button" aria-pressed={highContrast} onClick={() => setHighContrast((value) => !value)}><Contrast aria-hidden="true" /><span>고대비</span></button>
          <button data-touchless="true" type="button" onClick={() => setSettingsOpen(true)} aria-label="환경설정"><Volume2 aria-hidden="true" /><span>환경설정</span></button>
          <button data-touchless="true" type="button" onClick={() => setNotice('마이크를 누르고 필요한 도움을 말씀해 주세요. 말하기가 어려우면 직접 입력하기를 눌러 주세요.')}><CircleHelp aria-hidden="true" /><span>도움말</span></button>
        </div>
      </div>
    </header>
    <section className={'kiosk-hero' + (sessionStage !== 'welcome' ? ' is-session' : '')}>
      <div className="kiosk-hero-copy"><h1 aria-live="polite">{sessionStage === 'welcome' ? <>안녕하세요,<br /><span>나루예요!</span></> : sessionHeading.title}</h1>{sessionStage === 'welcome' && <small>복지·민원 준비를 도와드릴게요.</small>}<strong className="kiosk-question-bubble">{sessionHeading.detail}</strong></div>
      <div className="kiosk-character"><div className="kiosk-character-halo" /><div className={'kiosk-character-animation ' + avatarState}><NaruAnimation state={avatarState} /></div><span>언제든지 말씀해 주세요!</span></div>
    </section>
    <section className="kiosk-action-area">
      <AdaptiveVision debugOpen={cameraDebugOpen} onDebugClose={() => setCameraDebugOpen(false)} detectedLevel={autoLevel} appliedLevel={manualLevel ?? autoLevel} manualOverride={manualLevel !== null} onLevel={setAutoLevel} onHandover={() => { if (hasSessionContent) setHandoverPending(true) }} onReturn={() => setHandoverPending(false)} onAbsence={() => setHandoverPending(false)} />
      {handoverPending && <div className="handover-prompt" role="alertdialog" aria-label="새 사용자 확인">
        <strong>새로운 분이 이용 중인가요?</strong><span>계속 이용하시려면 눌러 주세요. 응답이 없으면 8초 뒤 새 상담을 시작합니다.</span>
        <div><button type="button" onClick={() => setHandoverPending(false)}>계속 사용</button><button type="button" onClick={restart}>새로 시작</button></div>
      </div>}
      <TouchlessCursor enabled={touchlessEnabled} />
      <div className="kiosk-input-actions">
        <button data-touchless="true" className={'kiosk-mic-action ' + (listening ? 'listening' : '')} type="button" onClick={startListening}><span className="kiosk-action-icon"><Mic aria-hidden="true" /></span><span><strong>{listening ? '말씀 듣는 중' : <>마이크를 눌러<br />말씀해 주세요</>}</strong><small>{listening ? '다시 누르면 녹음이 끝나요' : '누른 뒤 천천히 말씀해 주세요'}</small></span><ChevronRight aria-hidden="true" /></button>
        <button data-touchless="true" className="kiosk-text-action" type="button" onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}><span className="kiosk-action-icon"><Keyboard aria-hidden="true" /></span><span><strong>직접 입력하기</strong><small>말하기가 어려우시면<br />글로 입력해 주세요</small></span><ChevronRight aria-hidden="true" /></button>
      </div>
      {notice && notice !== '마이크를 눌러 말씀해 주세요.' && <section className="kiosk-notice" aria-live="polite"><p>{notice}</p></section>}
      {message && <div className="reference-transcript"><strong>말씀하신 내용</strong><p>{message}</p><button data-touchless="true" type="button" onClick={() => setInputMode('text')}>수정하기</button><button data-touchless="true" type="button" onClick={() => void submit()}>이 내용으로 확인</button></div>}
      {inputMode === 'text' && <form className="reference-input kiosk-text-form" onSubmit={submit}><textarea value={message} onChange={(event) => { setMessage(event.target.value); setInputError(false) }} placeholder="도움이 필요한 상황을 적어 주세요." rows={3} /><button data-touchless="true" type="submit" disabled={loading}>{loading ? '확인 중' : '이 내용으로 확인'}</button></form>}
      <section className="kiosk-examples"><h2><Lightbulb aria-hidden="true" /> 이렇게 말씀해 보세요</h2><div>{[
        '기초생활수급 신청하려고 왔어요', '전세나 임대주택 지원이 궁금해요', '일자리와 직업훈련을 알아보고 싶어요', '아이 돌봄 지원이 필요해요', '병원비 지원을 받을 수 있나요?', '한부모 가족 지원을 알고 싶어요',
      ].map((example) => <button data-touchless="true" type="button" key={example} onClick={() => submitExample(example)}>“{example}”</button>)}</div></section>
      {resultsPanel}
    </section>
    <section className="reference-quick-grid">
      <h2>자주 찾는 도움</h2>
      <div className="kiosk-quick-cards">{quickTopics.slice(0, 4).map(({ title, text, label, Icon }, index) => <button data-touchless="true" type="button" className={'reference-quick quick-' + index} key={title} onClick={() => submitExample(text)}><Icon className={'reference-quick-icon icon-' + index} aria-hidden="true" /><span><strong>{label}</strong><small>{['나에게 맞는 복지 제도를 찾아드려요.', '필요한 준비사항을 안내해 드려요.', '어디서 신청하는지 알려드려요.', '담당자 상담을 연결해 드려요.'][index]}</small></span><ChevronRight aria-hidden="true" /></button>)}</div>
    </section>
    <footer className="reference-footer"><Info className="reference-footer-icon" aria-hidden="true" /> 본 안내는 공식 정보를 기반으로 제공되며, 최종 판단은 담당 직원의 확인이 필요합니다.</footer>
    {settingsPanel}
    {videoPanel}
  </main>
}

function Admin() {
  type AdminProgram = { program_id: string; plain_name: string; category: string; review_status: 'approved' | 'needs_review'; reviewed_at?: string | null; reviewed_by?: string | null; note?: string | null; origin: 'seed' | 'public-data'; source: { name: string; url: string; checked_at: string } }
  type PilotArea = { sido: string | null; sigungu: string | null; updated_at?: string | null; updated_by?: string | null }
  type ReviewHistory = { changed_at: string; changed_by: string; review_status: 'approved' | 'needs_review'; note: string }
  const sidoOptions = ['', '서울특별시', '부산광역시', '대구광역시', '인천광역시', '광주광역시', '대전광역시', '울산광역시', '세종특별자치시', '경기도', '강원특별자치도', '충청북도', '충청남도', '전북특별자치도', '전라남도', '경상북도', '경상남도', '제주특별자치도']
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(sessionStorage.getItem('navi-admin-token') ?? '')
  const [overview, setOverview] = useState<{ total_sessions: number; handoff_count: number; approved_programs: number; needs_review_programs: number; summaries: Array<{ token: string; created_at: string; masked_text: string; recommendation_names: string[] }> } | null>(null)
  const [programs, setPrograms] = useState<AdminProgram[]>([])
  const [pilotArea, setPilotArea] = useState<PilotArea>({ sido: null, sigungu: null })
  const [reviewFilter, setReviewFilter] = useState<'all' | 'approved' | 'needs_review'>('needs_review')
  const [history, setHistory] = useState<Record<string, ReviewHistory[]>>({})
  const [savingArea, setSavingArea] = useState(false)
  const [error, setError] = useState('')

  const loadOverview = async (currentToken: string) => {
    const headers = { Authorization: 'Bearer ' + currentToken }
    const [overviewResponse, programsResponse, areaResponse] = await Promise.all([
      fetch(API + '/api/admin/overview', { headers }),
      fetch(API + '/api/admin/programs', { headers }),
      fetch(API + '/api/admin/pilot-area', { headers }),
    ])
    if (!overviewResponse.ok || !programsResponse.ok || !areaResponse.ok) {
      setToken('')
      sessionStorage.removeItem('navi-admin-token')
      return
    }
    setOverview(await overviewResponse.json())
    setPrograms(await programsResponse.json())
    setPilotArea(await areaResponse.json())
  }

  // The authenticated token is the sole trigger for refreshing admin data.
  // oxlint-disable-next-line react/set-state-in-effect
  useEffect(() => { if (token) void loadOverview(token) }, [token])

  const login = async (event: FormEvent) => {
    event.preventDefault()
    setError('')
    const response = await fetch(API + '/api/admin/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) })
    if (!response.ok) { setError('비밀번호가 맞지 않습니다.'); return }
    const result = await response.json() as { token: string }
    sessionStorage.setItem('navi-admin-token', result.token)
    setToken(result.token)
  }

  const updateReview = async (programId: string, reviewStatus: 'approved' | 'needs_review') => {
    const note = window.prompt('검토 메모를 입력하세요. 비워 둘 수 있습니다.', '') ?? ''
    const response = await fetch(API + '/api/admin/programs/' + programId, {
      method: 'PUT',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ review_status: reviewStatus, note }),
    })
    if (response.ok) void loadOverview(token)
  }

  const savePilotArea = async () => {
    setSavingArea(true)
    setError('')
    const response = await fetch(API + '/api/admin/pilot-area', {
      method: 'PUT', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ sido: pilotArea.sido || null, sigungu: pilotArea.sigungu || null }),
    })
    setSavingArea(false)
    if (!response.ok) { setError('지역 설정을 저장하지 못했습니다.'); return }
    setPilotArea(await response.json())
  }

  const toggleHistory = async (programId: string) => {
    if (history[programId]) { setHistory((current) => { const next = { ...current }; delete next[programId]; return next }); return }
    const response = await fetch(API + '/api/admin/programs/' + programId + '/history', { headers: { Authorization: 'Bearer ' + token } })
    if (response.ok) {
      const records = await response.json() as ReviewHistory[]
      setHistory((current) => ({ ...current, [programId]: records }))
    }
  }

  if (!token) return <main className="admin-shell"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><form className="login-card" onSubmit={login}><p className="eyebrow">담당자 전용</p><h1>관리자 로그인</h1><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>{error && <p className="error">{error}</p>}<button className="primary-button">로그인</button></form></main>

  const visiblePrograms = programs.filter((program) => reviewFilter === 'all' || program.review_status === reviewFilter)
  return <main className="admin-shell"><header className="topbar"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><button className="text-button" onClick={() => { sessionStorage.removeItem('navi-admin-token'); setToken('') }}>로그아웃</button></header><section className="admin-content"><p className="eyebrow">담당자 관리자 화면</p><h1>상담·공식 정보 운영</h1>{error && <p className="error">{error}</p>}<CalibrationPanel />{overview && <><div className="metric-row"><div><strong>{overview.total_sessions}</strong><span>상담 세션</span></div><div><strong>{overview.handoff_count}</strong><span>담당자 확인 요청</span></div><div><strong>{overview.approved_programs}</strong><span>검토 완료 항목</span></div><div><strong>{overview.needs_review_programs}</strong><span>검토 대기 항목</span></div></div><section className="summary-list admin-area"><div><p className="eyebrow">지역 복지서비스</p><h2>파일럿 지역 설정</h2><p>이 설정은 지자체 복지서비스 API 조회에만 사용됩니다. 키오스크 이용자는 지역을 선택할 수 없습니다.</p></div><div className="area-fields"><label>시·도<select value={pilotArea.sido ?? ''} onChange={(event) => setPilotArea((area) => ({ ...area, sido: event.target.value || null, sigungu: event.target.value ? area.sigungu : null }))}>{sidoOptions.map((item) => <option key={item} value={item}>{item || '선택 안 함'}</option>)}</select></label><label>시·군·구<input value={pilotArea.sigungu ?? ''} placeholder="예: 성동구" disabled={!pilotArea.sido} onChange={(event) => setPilotArea((area) => ({ ...area, sigungu: event.target.value }))} /></label><button type="button" className="primary-button" disabled={savingArea} onClick={() => void savePilotArea()}>{savingArea ? '저장 중' : '지역 적용'}</button></div>{pilotArea.updated_at && <small>마지막 변경: {new Date(pilotArea.updated_at).toLocaleString('ko-KR')} · {pilotArea.updated_by}</small>}</section><section className="summary-list"><div className="review-heading"><div><h2>공식 정보 검토 대기열</h2><p>공공데이터 API에서 새로 발견한 항목은 검토 전까지 키오스크에 담당자 확인 필요로 표시됩니다.</p></div><label>표시<select value={reviewFilter} onChange={(event) => setReviewFilter(event.target.value as typeof reviewFilter)}><option value="needs_review">검토 필요</option><option value="approved">검토 완료</option><option value="all">전체</option></select></label></div>{visiblePrograms.length === 0 ? <p>이 상태의 안내 항목이 없습니다.</p> : visiblePrograms.map((program) => <article className="program-review" key={program.program_id}><div><strong>{program.plain_name}</strong><p>{program.source.name} · 확인일 {program.source.checked_at} · {program.origin === 'public-data' ? 'API 항목' : '시드 항목'}</p><small>{program.note || '검토 메모 없음'}</small></div><div><span className={program.review_status === 'approved' ? 'review-approved' : 'review-pending'}>{program.review_status === 'approved' ? '검토 완료' : '검토 필요'}</span><button type="button" onClick={() => void toggleHistory(program.program_id)}>{history[program.program_id] ? '이력 닫기' : '검토 이력'}</button><button type="button" onClick={() => void updateReview(program.program_id, program.review_status === 'approved' ? 'needs_review' : 'approved')}>{program.review_status === 'approved' ? '재검토 표시' : '검토 완료 처리'}</button></div>{history[program.program_id] && <ol className="review-history">{history[program.program_id].length === 0 ? <li>변경 이력이 없습니다.</li> : history[program.program_id].map((item, index) => <li key={item.changed_at + index}><strong>{item.review_status === 'approved' ? '검토 완료' : '검토 필요'}</strong> · {new Date(item.changed_at).toLocaleString('ko-KR')} · {item.note || '메모 없음'}</li>)}</ol>}</article>)}</section><section className="summary-list"><h2>전달된 상담 요약</h2>{overview.summaries.length === 0 ? <p>아직 전달된 상담 요약이 없습니다.</p> : overview.summaries.map((item) => <article key={item.token}><p>{item.masked_text}</p><strong>{item.recommendation_names.join(', ')}</strong><span>{new Date(item.created_at).toLocaleString('ko-KR')} 생성</span></article>)}</section></>}</section></main>
}

function Summary() {
  const [result, setResult] = useState<{ masked_text: string; created_at: string; recommendation_names: string[]; recommendations: Recommendation[] } | null>(null)
  const [error, setError] = useState('상담 요약을 불러오고 있습니다.')
  useEffect(() => {
    const token = window.location.pathname.split('/').pop()
    if (!token) return
    void fetch(`${API}/api/summaries/${token}`).then(async (response) => {
      if (!response.ok) throw new Error()
      setResult(await response.json())
    }).catch(() => setError('이 상담 요약은 없거나 만료되었습니다. 키오스크에서 다시 발급해 주세요.'))
  }, [])
  return <main className="summary-shell"><a className="brand" href="/">NAVI <span>상담 준비 요약</span></a>{result ? <section className="summary-card"><p className="eyebrow">담당자에게 보여 주세요</p><h1>상담 준비 요약</h1><p className="summary-question">{result.masked_text}</p><h2>확인한 상담 분야</h2><ul>{result.recommendation_names.map((item) => <li key={item}>{item}</li>)}</ul>{result.recommendations.map((item) => <section className="summary-guide" key={item.program_id}><h2>{item.plain_name}</h2><h3>준비해 주세요</h3><ul>{item.preparation_items.map((value) => <li key={value}>{value}</li>)}</ul><h3>상담 장소</h3><p>{item.office_hint}</p><h3>추가 확인 필요</h3><ul>{item.needs_confirmation.map((value) => <li key={value}>{value}</li>)}</ul><a href={item.source.url} target="_blank" rel="noreferrer">출처: {item.source.name} · {item.source.checked_at}</a></section>)}<p className="summary-meta">{new Date(result.created_at).toLocaleString('ko-KR')}에 생성됨</p><p className="summary-warning">개별 자격과 최종 서류는 담당자가 확인합니다.</p></section> : <section className="summary-card"><h1>{error}</h1></section>}</main>
}

export default function App() { if (window.location.pathname.startsWith('/admin')) return <Admin />; if (window.location.pathname.startsWith('/summary/')) return <Summary />; return <Kiosk preview={window.location.pathname.replace(/\/$/, '') === '/ui-preview'} /> }
