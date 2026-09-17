import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import lottie from 'lottie-web'
import { ChevronRight, CircleHelp, Contrast, Download, FileText, HeartHandshake, Headset, Home, Info, Keyboard, Lightbulb, MapPin, Mic, Monitor, Play, ShieldCheck, Smartphone, Type, Volume2, X } from 'lucide-react'
import { QRCodeSVG } from 'qrcode.react'
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

function NaruAnimation({ state }: { state: NaruState }) {
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const animation = lottie.loadAnimation({
      container: containerRef.current,
      renderer: 'svg',
      loop: true,
      autoplay: true,
      path: naruAnimations[state],
      rendererSettings: { preserveAspectRatio: 'xMidYMid meet' },
    })
    return () => animation.destroy()
  }, [state])

  return <div className="naru-animation" ref={containerRef} role="img" aria-label={`나루 ${state} 상태`} />
}

function Kiosk() {
  const [message, setMessage] = useState('')
  const [inputMode, setInputMode] = useState<'voice' | 'text' | 'menu'>('voice')
  const [largeText, setLargeText] = useState(false)
  const [highContrast, setHighContrast] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [ttsVoice, setTtsVoice] = useState(() => localStorage.getItem('navi-tts-voice') ?? 'ko-KR-SunHiNeural')
  const [screenLayout, setScreenLayout] = useState<'portrait' | 'landscape'>('portrait')
  const [ageGroup, setAgeGroup] = useState('선택 안 함')
  const [gender, setGender] = useState('선택 안 함')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [listening, setListening] = useState(false)
  const [wakeListening, setWakeListening] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('마이크를 눌러 말씀해 주세요.')
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null)
  const [avatarState, setAvatarState] = useState<NaruState>('idle')
  const [avatarJob, setAvatarJob] = useState<AvatarJob | null>(null)
  const [avatarVideoOpen, setAvatarVideoOpen] = useState(false)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const recordingStreamRef = useRef<MediaStream | null>(null)
  const recordingTimeoutRef = useRef<number | null>(null)
  const wakeStreamRef = useRef<MediaStream | null>(null)
  const wakeSocketRef = useRef<WebSocket | null>(null)
  const wakeContextRef = useRef<AudioContext | null>(null)
  const wakeSourceRef = useRef<MediaStreamAudioSourceNode | null>(null)
  const wakeProcessorRef = useRef<ScriptProcessorNode | null>(null)
  const wakeSilenceRef = useRef<GainNode | null>(null)
  const wakeAutoStartedRef = useRef(false)
  const avatarPollingRef = useRef<number | null>(null)
  const avatarRequestRef = useRef<string | null>(null)

  useEffect(() => () => {
    recorderRef.current?.stop()
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
    if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current)
    if (avatarPollingRef.current) window.clearTimeout(avatarPollingRef.current)
    stopWakeWord()
  }, [])

  useEffect(() => {
    localStorage.setItem('navi-tts-voice', ttsVoice)
  }, [ttsVoice])

  useEffect(() => {
    if (!settingsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setSettingsOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [settingsOpen])

  const stopAvatarPolling = () => {
    avatarRequestRef.current = null
    if (avatarPollingRef.current) window.clearTimeout(avatarPollingRef.current)
    avatarPollingRef.current = null
  }

  const requestAvatarVideo = async (text: string, audioUrl: string) => {
    stopAvatarPolling()
    try {
      const response = await fetch(`${API}/api/avatar-jobs`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, audio_url: audioUrl }),
      })
      if (!response.ok) throw new Error('avatar request failed')
      const initial = await response.json() as AvatarJob
      setAvatarJob(initial)
      if (initial.status === 'fallback') return
      avatarRequestRef.current = initial.id
      const poll = async () => {
        try {
          const statusResponse = await fetch(`${API}/api/avatar-jobs/${initial.id}`)
          if (!statusResponse.ok) throw new Error('avatar status failed')
          const status = await statusResponse.json() as AvatarJob
          if (avatarRequestRef.current !== status.id) return
          setAvatarJob(status)
          if (status.status === 'queued' || status.status === 'processing') {
            avatarPollingRef.current = window.setTimeout(() => void poll(), 3000)
          }
        } catch {
          if (avatarRequestRef.current === initial.id) setAvatarJob({ id: initial.id, status: 'fallback' })
        }
      }
      void poll()
    } catch {
      setAvatarJob(null)
    }
  }

  const announce = async (text: string, afterGuidance: NaruState = 'idle', createAvatar = false) => {
    setAvatarState('guiding')
    try {
      const response = await fetch(`${API}/api/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice: ttsVoice }) })
      const result = await response.json() as { audio_url?: string }
      if (result.audio_url && audioRef.current) {
        if (createAvatar) void requestAvatarVideo(text, result.audio_url)
        audioRef.current.src = `${API}${result.audio_url}`
        await audioRef.current.play()
        return
      }
      speakInBrowser(text)
    } catch { speakInBrowser(text) }
    window.setTimeout(() => setAvatarState((current) => current === 'guiding' ? afterGuidance : current), 1200)
  }

  const transcribeRecording = async (recording: Blob) => {
    setAvatarState('thinking')
    setNotice('말씀하신 내용을 확인하고 있어요.')
    try {
      const form = new FormData()
      form.append('audio', new File([recording], 'navi-recording.webm', { type: recording.type || 'audio/webm' }))
      const response = await fetch(API + '/api/transcriptions', { method: 'POST', body: form })
      if (!response.ok) throw new Error('transcription failed')
      const result = await response.json() as { text?: string }
      if (!result.text?.trim()) throw new Error('empty transcription')
      setMessage(result.text.trim())
      setNotice('말씀하신 내용을 확인해 주세요. 맞으면 이 내용으로 확인을 눌러 주세요.')
      setAvatarState('idle')
    } catch {
      setNotice('음성을 글자로 바꾸지 못했습니다. 다시 말하거나 직접 입력해 주세요.')
      setInputMode('text')
      setAvatarState('idle')
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
    setWakeListening(false)
  }

  async function startWakeWord(autoStart = false) {
    if (wakeListening) {
      if (!autoStart) {
        stopWakeWord()
        setNotice('나루야 감지를 멈췄습니다. 필요하면 다시 켜 주세요.')
      }
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.AudioContext || !window.WebSocket) {
      setNotice('이 기기에서는 웨이크 워드를 사용할 수 없습니다. 말하기 버튼을 이용해 주세요.')
      return
    }
    try {
      const statusResponse = await fetch(`${API}/api/wake-word/status`)
      const status = await statusResponse.json() as { ready?: boolean }
      if (!status.ready) throw new Error('wake word model unavailable')
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const context = new AudioContext()
      const source = context.createMediaStreamSource(stream)
      const processor = context.createScriptProcessor(4096, 1, 1)
      const silence = context.createGain()
      silence.gain.value = 0
      const socket = new WebSocket(`${API.replace(/^http/, 'ws')}/api/wake-word/stream`)
      wakeStreamRef.current = stream
      wakeContextRef.current = context
      wakeSourceRef.current = source
      wakeProcessorRef.current = processor
      wakeSilenceRef.current = silence
      wakeSocketRef.current = socket
      socket.onopen = () => {
        source.connect(processor)
        processor.connect(silence)
        silence.connect(context.destination)
        processor.onaudioprocess = (event) => {
          if (socket.readyState !== WebSocket.OPEN) return
          socket.send(downsampleTo16k(event.inputBuffer.getChannelData(0), context.sampleRate))
        }
        setWakeListening(true)
        setAvatarState('idle')
        setNotice('"나루야"라고 부르면 음성 상담을 시작합니다.')
      }
      socket.onmessage = (event) => {
        const payload = JSON.parse(String(event.data)) as { type?: string }
        if (payload.type === 'activated') {
          stopWakeWord()
          setNotice('나루야를 들었어요. 필요한 도움을 말씀해 주세요.')
          window.setTimeout(() => void startListening(), 100)
        }
        if (payload.type === 'unavailable') {
          stopWakeWord()
          setNotice('나루야 모델이 아직 준비되지 않았습니다. 말하기 버튼을 이용해 주세요.')
        }
      }
      socket.onerror = () => {
        stopWakeWord()
        setNotice('나루야 감지 연결에 문제가 있습니다. 말하기 버튼을 이용해 주세요.')
      }
    } catch {
      stopWakeWord()
      setNotice(autoStart ? '나루야 자동 감지를 시작하려면 마이크 권한을 허용해 주세요. 말하기 버튼도 사용할 수 있습니다.' : '나루야 모델 또는 마이크 권한이 필요합니다. 말하기 버튼을 이용해 주세요.')
    }
  }

  useEffect(() => {
    if (wakeAutoStartedRef.current) return
    wakeAutoStartedRef.current = true
    void startWakeWord(true)
  }, [])

  const startListening = async () => {
    if (wakeListening) stopWakeWord()
    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
      return
    }
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setNotice('이 기기에서는 마이크 녹음을 사용할 수 없습니다. 직접 입력해 주세요.')
      setInputMode('text')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const chunks: BlobPart[] = []
      const recorder = new MediaRecorder(stream, { mimeType: MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : undefined })
      recorderRef.current = recorder
      recordingStreamRef.current = stream
      recorder.ondataavailable = (event) => { if (event.data.size) chunks.push(event.data) }
      recorder.onstop = () => {
        if (recordingTimeoutRef.current) window.clearTimeout(recordingTimeoutRef.current)
        recordingTimeoutRef.current = null
        recorderRef.current = null
        recordingStreamRef.current?.getTracks().forEach((track) => track.stop())
        recordingStreamRef.current = null
        setListening(false)
        void transcribeRecording(new Blob(chunks, { type: recorder.mimeType || 'audio/webm' }))
      }
      recorder.start()
      setListening(true)
      setAvatarState('listening')
      setNotice('말씀을 듣고 있어요. 말씀을 마치면 마이크를 다시 눌러 주세요.')
      recordingTimeoutRef.current = window.setTimeout(() => recorder.state === 'recording' && recorder.stop(), 30000)
    } catch {
      setListening(false)
      setAvatarState('idle')
      setNotice('마이크 권한이 필요합니다. 브라우저에서 마이크 사용을 허용하거나 직접 입력해 주세요.')
      setInputMode('text')
    }
  }

  const sendConversation = async (text: string, sessionId?: string, answers: Record<string, string> = {}) => {
    if (!text.trim()) { setNotice('도움이 필요한 상황을 한 문장으로 말씀하거나 적어 주세요.'); return }
    setLoading(true); setSummaryUrl(null); setAvatarState('thinking')
    try {
      const response = await fetch(API + '/api/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text,
          session_id: sessionId,
          answers,
          demographics: { age_group: ageGroup === '선택 안 함' ? null : ageGroup, gender: gender === '선택 안 함' ? null : gender },
        }),
      })
      if (!response.ok) throw new Error('conversation failed')
      const result = await response.json() as Conversation
      setConversation(result)
      setNotice(result.assistant_text)
      void announce(
        result.assistant_text + ' ' + (result.clarifying_question ?? ''),
        result.clarifying_question ? 'idle' : result.recommendations.length ? 'complete' : 'idle',
        result.recommendations.length > 0,
      )
    } catch {
      setNotice('연결에 문제가 있습니다. 담당자에게 도움을 요청해 주세요.')
      setAvatarState('idle')
    } finally {
      setLoading(false)
    }
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
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
    const response = await fetch(`${API}/api/summaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: conversation.session_id, recommendation_ids: conversation.recommendations.map((item) => item.program_id) }) })
    const result = await response.json() as { public_url: string }
    setSummaryUrl(`${window.location.origin}${result.public_url}`)
    setAvatarState('complete')
  }
  const restart = () => { stopAvatarPolling(); setMessage(''); setInputMode('voice'); setAgeGroup('선택 안 함'); setGender('선택 안 함'); setConversation(null); setSummaryUrl(null); setAvatarJob(null); setAvatarVideoOpen(false); setAvatarState('idle'); setNotice('마이크를 눌러 말씀해 주세요.') }
  const submitExample = (text: string) => { setMessage(text); void sendConversation(text) }
  const voiceState = listening
    ? { label: '말씀을 듣고 있어요', detail: '말씀을 마치면 마이크를 다시 눌러 주세요.', kind: 'listening' }
    : loading || avatarState === 'thinking'
      ? { label: '관련 정보를 확인하고 있어요', detail: '잠시만 기다려 주세요.', kind: 'thinking' }
      : avatarState === 'guiding'
        ? { label: '확인한 내용을 안내해 드릴게요', detail: '화면에서도 내용을 확인할 수 있어요.', kind: 'guiding' }
        : avatarState === 'complete'
          ? { label: '안내가 준비되었어요', detail: '화면의 준비사항을 확인해 주세요.', kind: 'complete' }
          : { label: '마이크를 눌러 말씀해 주세요', detail: '버튼을 누르기 전에는 녹음되지 않습니다.', kind: 'idle' }

  return <main className={'kiosk-shell reference-kiosk kiosk-home layout-' + screenLayout + (largeText ? ' large-text' : '') + (highContrast ? ' high-contrast' : '')}>
    <audio ref={audioRef} onEnded={() => setAvatarState(conversation?.recommendations.length ? 'complete' : 'idle')} />
    <header className="reference-header">
      <a className="reference-brand" href="/"><span className="reference-logo"><WaveMark /></span><span><strong>복지나루</strong><small>말로 물어보는 복지·민원 안내</small></span></a>
      <div className="reference-header-actions">
        <div className="reference-tools">
          <button className={largeText ? 'active' : ''} type="button" aria-pressed={largeText} onClick={() => setLargeText((value) => !value)}><Type aria-hidden="true" /><span>글자 크게</span></button>
          <button className={highContrast ? 'active' : ''} type="button" aria-pressed={highContrast} onClick={() => setHighContrast((value) => !value)}><Contrast aria-hidden="true" /><span>고대비</span></button>
          <button type="button" onClick={() => setSettingsOpen(true)}><Volume2 aria-hidden="true" /><span>음성 설정</span></button>
          <button type="button" onClick={() => setNotice('마이크를 누르고 필요한 도움을 말씀해 주세요. 말하기가 어려우면 직접 입력하기를 눌러 주세요.')}><CircleHelp aria-hidden="true" /><span>도움말</span></button>
        </div>
      </div>
    </header>
    <section className="kiosk-hero">
      <div className="kiosk-hero-copy"><p>복지·민원 안내 도우미</p><h1>안녕하세요,<br /><span>나루예요!</span></h1><small>복지·민원 준비를 도와드릴게요.</small><strong className="kiosk-question-bubble">무엇을 도와드릴까요?</strong></div>
      <div className="kiosk-character"><div className="kiosk-character-halo" /><div className={'kiosk-character-animation ' + avatarState}><NaruAnimation state={avatarState} /></div><span>언제든지 말씀해 주세요!</span></div>
    </section>
    <section className="kiosk-action-area">
      <div className={'kiosk-voice-state ' + voiceState.kind} aria-live="polite"><span>{voiceState.label}</span><small>{voiceState.detail}</small></div>
      <div className="kiosk-input-actions">
        <button className={'kiosk-mic-action ' + (listening ? 'listening' : '')} type="button" onClick={startListening}><span className="kiosk-action-icon"><Mic aria-hidden="true" /></span><span><strong>{listening ? '말씀 듣는 중' : <>마이크를 눌러<br />말씀해 주세요</>}</strong><small>{listening ? '다시 누르면 녹음이 끝나요' : '누른 뒤 천천히 말씀해 주세요'}</small></span><ChevronRight aria-hidden="true" /></button>
        <button className="kiosk-text-action" type="button" onClick={() => setInputMode(inputMode === 'text' ? 'voice' : 'text')}><span className="kiosk-action-icon"><Keyboard aria-hidden="true" /></span><span><strong>직접 입력하기</strong><small>말하기가 어려우시면<br />글로 입력해 주세요</small></span><ChevronRight aria-hidden="true" /></button>
      </div>
      <p className={'kiosk-wake-status ' + (wakeListening ? 'active' : '')}><ShieldCheck aria-hidden="true" /> {wakeListening ? '“나루야”라고 부르면 음성 상담을 시작할 수 있어요.' : '마이크 버튼을 누르기 전에는 음성을 녹음하지 않습니다.'}</p>
      {(message || conversation || voiceState.kind !== 'idle') && <section className="kiosk-notice" aria-live="polite"><p>{notice}</p></section>}
      {message && <div className="reference-transcript"><strong>말씀하신 내용</strong><p>{message}</p><button type="button" onClick={() => setInputMode('text')}>수정하기</button><button type="button" onClick={() => void submit()}>이 내용으로 확인</button></div>}
      {inputMode === 'text' && <form className="reference-input kiosk-text-form" onSubmit={submit}><textarea value={message} onChange={(event) => setMessage(event.target.value)} placeholder="도움이 필요한 상황을 적어 주세요." rows={3} /><button type="submit" disabled={loading}>{loading ? '확인 중' : '이 내용으로 확인'}</button></form>}
      <section className="kiosk-examples"><h2><Lightbulb aria-hidden="true" /> 이렇게 말씀해 보세요</h2><div>{[
        '기초생활수급 신청하려고 왔어요', '여권 만들려면 무엇이 필요한가요?', '장애인 혜택을 알고 싶어요', '주민등록등본은 어디서 발급하나요?',
      ].map((example) => <button type="button" key={example} onClick={() => submitExample(example)}>“{example}”</button>)}</div></section>
      {conversation && <section className="reference-results" aria-live="polite">
          <div className="reference-results-head"><div><span>안내를 준비했어요</span><h2>{conversation.clarifying_question ?? '상담 준비 결과'}</h2></div><button type="button" onClick={restart}>처음으로</button></div>
          <div className="reference-results-scroll">
            {conversation.clarifying_question && <section className="reference-clarification"><p>{conversation.assistant_text}</p><h3>{conversation.clarifying_question}</h3><div>{conversation.clarification_options.map((option) => <button type="button" key={option.value} disabled={loading} onClick={() => void answerClarification(option)}>{option.label}</button>)}</div><button className="reference-clarification-text" type="button" onClick={() => setInputMode('text')}>직접 답변 입력하기</button></section>}
            {conversation.recommendations.map((item) => <article key={item.program_id}><span className={'status ' + item.status.replaceAll(' ', '-')}>{item.status}</span><h3>{item.plain_name}</h3><p>{item.guidance}</p><h4>먼저 준비해 주세요</h4><ul>{item.preparation_items.map((value) => <li key={value}>{value}</li>)}</ul><p className="reference-office">상담 장소: {item.office_hint}</p></article>)}
            {conversation.recommendations.length > 0 && <><aside>실제 대상 여부와 추가 제출 서류는 담당 직원이 최종 확인합니다.</aside><div className="reference-result-actions"><button type="button" onClick={createSummary}>QR로 상담 요약 받기</button><button type="button" onClick={() => window.print()}>준비사항 인쇄하기</button>{avatarJob?.status === 'ready' && avatarJob.video_url && <button type="button" className="avatar-video-button" onClick={() => setAvatarVideoOpen(true)}><Play aria-hidden="true" /> 영상 안내 보기</button>}{avatarJob?.status === 'ready' && avatarJob.download_url && <a className="avatar-download-button" href={avatarJob.download_url} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> 영상 다운로드</a>}</div>{avatarJob && avatarJob.status !== 'ready' && avatarJob.status !== 'fallback' && <p className="avatar-job-status">나루가 안내 영상을 준비하고 있어요. 화면 안내는 계속 이용할 수 있습니다.</p>}{summaryUrl && <div className="reference-qr"><QRCodeSVG value={summaryUrl} size={132} /><p>이 QR을 담당자에게 보여 주세요.</p></div>}</>}
          </div>
        </section>}
    </section>
    <section className="reference-quick-grid">
      <h2>자주 찾는 도움</h2>
      <div className="kiosk-quick-cards">{quickTopics.slice(0, 4).map(({ title, text, label, Icon }, index) => <button type="button" className={'reference-quick quick-' + index} key={title} onClick={() => submitExample(text)}><Icon className={'reference-quick-icon icon-' + index} aria-hidden="true" /><span><strong>{label}</strong><small>{['나에게 맞는 복지 제도를 찾아드려요.', '필요한 준비사항을 안내해 드려요.', '어디서 신청하는지 알려드려요.', '담당자 상담을 연결해 드려요.'][index]}</small></span><ChevronRight aria-hidden="true" /></button>)}</div>
    </section>
    <footer className="reference-footer"><Info className="reference-footer-icon" aria-hidden="true" /> 본 안내는 공식 정보를 기반으로 제공되며, 최종 판단은 담당 직원의 확인이 필요합니다.</footer>
    {settingsOpen && <div className="reference-settings-backdrop" role="presentation" onMouseDown={() => setSettingsOpen(false)}>
      <section className="reference-settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p>환경설정</p><h2 id="settings-title">음성과 화면을 설정하세요</h2></div><button type="button" className="reference-settings-close" onClick={() => setSettingsOpen(false)} aria-label="환경설정 닫기"><X aria-hidden="true" /></button></header>
        <label htmlFor="tts-voice">TTS 안내 음성<select id="tts-voice" value={ttsVoice} onChange={(event) => setTtsVoice(event.target.value)}>{ttsVoiceOptions.map((voice) => <option key={voice.value} value={voice.value}>{voice.label}</option>)}</select></label>
        <div className="reference-layout-settings" role="group" aria-label="화면 배치 선택"><span>화면 배치</span><button className={screenLayout === 'portrait' ? 'active' : ''} type="button" aria-pressed={screenLayout === 'portrait'} onClick={() => setScreenLayout('portrait')}><Smartphone aria-hidden="true" />세로형</button><button className={screenLayout === 'landscape' ? 'active' : ''} type="button" aria-pressed={screenLayout === 'landscape'} onClick={() => setScreenLayout('landscape')}><Monitor aria-hidden="true" />가로형</button></div>
        <p>선택한 음성은 이 기기의 다음 안내부터 적용됩니다.</p>
        <div className="reference-settings-actions"><button type="button" className="reference-settings-preview" onClick={() => void announce('안녕하세요. 복지나루 AI 안내 도우미 나루입니다. 필요한 도움을 편하게 말씀해 주세요.') }><Volume2 aria-hidden="true" /> 미리 듣기</button><button type="button" className="reference-settings-confirm" onClick={() => setSettingsOpen(false)}>확인</button></div>
      </section>
    </div>}
    {avatarVideoOpen && avatarJob?.video_url && <div className="avatar-video-backdrop" role="presentation" onMouseDown={() => setAvatarVideoOpen(false)}>
      <section className="avatar-video-modal" role="dialog" aria-modal="true" aria-label="나루 영상 안내" onMouseDown={(event) => event.stopPropagation()}>
        <header><div><p>나루 영상 안내</p><h2>안내 내용을 영상으로 들으세요</h2></div><button type="button" onClick={() => setAvatarVideoOpen(false)} aria-label="영상 닫기"><X aria-hidden="true" /></button></header>
        <video src={avatarJob.video_url} controls autoPlay playsInline onPlay={() => audioRef.current?.pause()} />
        {avatarJob.download_url && <a href={avatarJob.download_url} target="_blank" rel="noreferrer"><Download aria-hidden="true" /> 영상 다운로드</a>}
      </section>
    </div>}
  </main>
}

function Admin() {
  type AdminProgram = { program_id: string; plain_name: string; category: string; review_status: 'approved' | 'needs_review'; reviewed_at?: string | null; note?: string | null; source: { name: string; checked_at: string } }
  const [password, setPassword] = useState('')
  const [token, setToken] = useState(sessionStorage.getItem('navi-admin-token') ?? '')
  const [overview, setOverview] = useState<{ total_sessions: number; handoff_count: number; approved_programs: number; summaries: Array<{ token: string; created_at: string; masked_text: string; recommendation_names: string[] }> } | null>(null)
  const [programs, setPrograms] = useState<AdminProgram[]>([])
  const [error, setError] = useState('')

  const loadOverview = async (currentToken: string) => {
    const headers = { Authorization: 'Bearer ' + currentToken }
    const [overviewResponse, programsResponse] = await Promise.all([
      fetch(API + '/api/admin/overview', { headers }),
      fetch(API + '/api/admin/programs', { headers }),
    ])
    if (!overviewResponse.ok || !programsResponse.ok) {
      setToken('')
      sessionStorage.removeItem('navi-admin-token')
      return
    }
    setOverview(await overviewResponse.json())
    setPrograms(await programsResponse.json())
  }

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

  if (!token) return <main className="admin-shell"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><form className="login-card" onSubmit={login}><p className="eyebrow">담당자 전용</p><h1>관리자 로그인</h1><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>{error && <p className="error">{error}</p>}<button className="primary-button">로그인</button></form></main>

  return <main className="admin-shell"><header className="topbar"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><button className="text-button" onClick={() => { sessionStorage.removeItem('navi-admin-token'); setToken('') }}>로그아웃</button></header><section className="admin-content"><p className="eyebrow">담당자 관리자 화면</p><h1>오늘의 상담 준비 현황</h1>{overview && <><div className="metric-row"><div><strong>{overview.total_sessions}</strong><span>상담 세션</span></div><div><strong>{overview.handoff_count}</strong><span>담당자 확인 요청</span></div><div><strong>{overview.approved_programs}</strong><span>승인된 안내 항목</span></div></div><section className="summary-list"><h2>공식 정보 검토</h2>{programs.map((program) => <article className="program-review" key={program.program_id}><div><strong>{program.plain_name}</strong><p>{program.source.name} · 확인일 {program.source.checked_at}</p><small>{program.note || '검토 메모 없음'}</small></div><div><span className={program.review_status === 'approved' ? 'review-approved' : 'review-pending'}>{program.review_status === 'approved' ? '검토 완료' : '검토 필요'}</span><button type="button" onClick={() => void updateReview(program.program_id, program.review_status === 'approved' ? 'needs_review' : 'approved')}>{program.review_status === 'approved' ? '재검토 표시' : '검토 완료 처리'}</button></div></article>)}</section><section className="summary-list"><h2>전달된 상담 요약</h2>{overview.summaries.length === 0 ? <p>아직 전달된 상담 요약이 없습니다.</p> : overview.summaries.map((item) => <article key={item.token}><p>{item.masked_text}</p><strong>{item.recommendation_names.join(', ')}</strong><span>{new Date(item.created_at).toLocaleString('ko-KR')} 생성</span></article>)}</section></>}</section></main>
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

export default function App() { if (window.location.pathname.startsWith('/admin')) return <Admin />; if (window.location.pathname.startsWith('/summary/')) return <Summary />; return <Kiosk /> }
