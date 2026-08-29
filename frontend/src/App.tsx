import { useEffect, useRef, useState } from 'react'
import type { FormEvent } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import './App.css'

const API = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:8000'

type Recommendation = { program_id: string; name: string; plain_name: string; status: '확인됨' | '일부 확인됨' | '담당자 확인 필요'; guidance: string; preparation_items: string[]; needs_confirmation: string[]; office_hint: string; source: { name: string; url: string; checked_at: string } }
type Conversation = { session_id: string; masked_text: string; assistant_text: string; clarifying_question?: string; clarification_key?: string; recommendations: Recommendation[]; staff_handoff: boolean }
type SpeechRecognitionLike = { lang: string; interimResults: boolean; onresult: (event: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void; onerror: () => void; start: () => void }

declare global { interface Window { webkitSpeechRecognition?: new () => SpeechRecognitionLike } }

const ageOptions = ['선택 안 함', '19세 이하', '20~34세', '35~64세', '65세 이상']

function speakInBrowser(text: string) {
  window.speechSynthesis?.cancel()
  const utterance = new SpeechSynthesisUtterance(text)
  utterance.lang = 'ko-KR'; utterance.rate = 0.88
  window.speechSynthesis?.speak(utterance)
}

function Kiosk() {
  const [message, setMessage] = useState('')
  const [ageGroup, setAgeGroup] = useState('선택 안 함')
  const [gender, setGender] = useState('선택 안 함')
  const [conversation, setConversation] = useState<Conversation | null>(null)
  const [listening, setListening] = useState(false)
  const [loading, setLoading] = useState(false)
  const [notice, setNotice] = useState('말씀하시거나 아래에 적어 주세요.')
  const [summaryUrl, setSummaryUrl] = useState<string | null>(null)
  const [avatarState, setAvatarState] = useState('idle')
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const announce = async (text: string) => {
    setAvatarState('speaking')
    try {
      const response = await fetch(`${API}/api/speech`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) })
      const result = await response.json() as { audio_url?: string }
      if (result.audio_url && audioRef.current) { audioRef.current.src = `${API}${result.audio_url}`; await audioRef.current.play() } else speakInBrowser(text)
      await fetch(`${API}/api/avatar-jobs`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, audio_url: result.audio_url ?? null }) })
    } catch { speakInBrowser(text) }
    window.setTimeout(() => setAvatarState('idle'), 1200)
  }

  const startListening = () => {
    const Recognition = window.webkitSpeechRecognition
    if (!Recognition) { setNotice('이 브라우저는 음성 인식을 지원하지 않습니다. 아래 입력창에 적어 주세요.'); return }
    const recognition = new Recognition(); recognition.lang = 'ko-KR'; recognition.interimResults = false
    recognition.onresult = (event) => { setMessage(event.results[0][0].transcript); setNotice('말씀하신 내용을 확인해 주세요.'); setListening(false) }
    recognition.onerror = () => { setNotice('음성을 잘 듣지 못했습니다. 다시 말하거나 직접 적어 주세요.'); setListening(false) }
    setListening(true); setNotice('듣고 있습니다. 천천히 말씀해 주세요.'); recognition.start()
  }

  const submit = async (event?: FormEvent) => {
    event?.preventDefault()
    if (!message.trim()) { setNotice('도움이 필요한 상황을 한 문장으로 말씀하거나 적어 주세요.'); return }
    setLoading(true); setSummaryUrl(null)
    try {
      const response = await fetch(`${API}/api/conversations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: message, demographics: { age_group: ageGroup === '선택 안 함' ? null : ageGroup, gender: gender === '선택 안 함' ? null : gender } }) })
      if (!response.ok) throw new Error('상담을 시작하지 못했습니다.')
      const result = await response.json() as Conversation
      setConversation(result); setNotice(result.assistant_text); void announce(`${result.assistant_text} ${result.clarifying_question ?? ''}`)
    } catch { setNotice('연결에 문제가 있습니다. 담당자에게 도움을 요청해 주세요.') } finally { setLoading(false) }
  }

  const createSummary = async () => {
    if (!conversation?.recommendations.length) return
    const response = await fetch(`${API}/api/summaries`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ session_id: conversation.session_id, recommendation_ids: conversation.recommendations.map((item) => item.program_id) }) })
    const result = await response.json() as { public_url: string }
    setSummaryUrl(`${window.location.origin}${result.public_url}`)
  }
  const restart = () => { setMessage(''); setAgeGroup('선택 안 함'); setGender('선택 안 함'); setConversation(null); setSummaryUrl(null); setNotice('말씀하시거나 아래에 적어 주세요.') }

  return <main className="kiosk-shell">
    <audio ref={audioRef} onEnded={() => setAvatarState('idle')} />
    <header className="topbar"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><a className="staff-link" href="/admin">담당자 화면</a></header>
    <section className="hero-panel"><div className={`avatar-frame ${avatarState}`}><div className="avatar-halo" /><img src="/navi-guide-avatar.png" alt="Navi 디지털 안내원" /><span className="avatar-status">{avatarState === 'speaking' ? '안내 중' : 'Navi 안내원'}</span></div><div className="welcome-copy"><p className="eyebrow">주민센터 방문 전, 함께 준비해요</p><h1>무엇이 필요하신가요?</h1><p className="guide-copy">정확한 제도 이름을 몰라도 괜찮아요. 상황을 말씀하시면 필요한 상담과 준비사항을 찾아드릴게요.</p><div className="spoken-notice" aria-live="polite">{notice}</div></div></section>
    <section className="conversation-panel"><form onSubmit={submit}><label htmlFor="message">도움이 필요한 상황</label><div className="input-row"><textarea id="message" value={message} onChange={(event) => setMessage(event.target.value)} placeholder="예: 생활비가 어려워서 지원받고 싶어요" rows={3} /><button className={`voice-button ${listening ? 'recording' : ''}`} type="button" onClick={startListening}>{listening ? '듣는 중' : '말하기'}</button></div><div className="optional-info"><fieldset><legend>연령대 <span>선택</span></legend><div className="choice-row">{ageOptions.map((item) => <button key={item} type="button" className={ageGroup === item ? 'selected' : ''} onClick={() => setAgeGroup(item)}>{item}</button>)}</div></fieldset><fieldset><legend>성별 <span>선택</span></legend><div className="choice-row">{['선택 안 함', '여성', '남성', '직접 입력 안 함'].map((item) => <button key={item} type="button" className={gender === item ? 'selected' : ''} onClick={() => setGender(item)}>{item}</button>)}</div></fieldset></div><button className="primary-button" type="submit" disabled={loading}>{loading ? '정보를 확인하고 있어요' : '상담 준비 시작하기'}</button></form></section>
    {conversation && <section className="result-panel" aria-live="polite"><div className="result-head"><div><p className="eyebrow">상담 준비 결과</p><h2>{conversation.clarifying_question ?? '이 내용을 준비해 주세요'}</h2></div><button className="text-button" onClick={restart}>처음으로</button></div>{conversation.recommendations.map((item) => <article className="recommendation" key={item.program_id}><div className="recommendation-title"><div><span className={`status ${item.status.replaceAll(' ', '-')}`}>{item.status}</span><h3>{item.plain_name}</h3></div><a href={item.source.url} target="_blank" rel="noreferrer">{item.source.name} 공식 정보 보기</a></div><p>{item.guidance}</p><div className="detail-grid"><div><h4>미리 준비하면 좋은 것</h4><ul>{item.preparation_items.map((value) => <li key={value}>{value}</li>)}</ul></div><div><h4>담당자와 확인할 것</h4><ul>{item.needs_confirmation.map((value) => <li key={value}>{value}</li>)}</ul></div></div><footer><span>상담 장소: {item.office_hint}</span><span>정보 확인일: {item.source.checked_at}</span></footer></article>)}<aside className="handoff-card"><strong>중요해요</strong><p>실제 대상 여부와 필요한 서류는 담당자가 최종 확인합니다. 주민등록번호나 계좌번호는 말씀하지 마세요.</p></aside><div className="result-actions"><button className="primary-button" onClick={createSummary}>QR로 상담 요약 받기</button><button className="secondary-button" onClick={() => window.print()}>준비사항 인쇄하기</button></div>{summaryUrl && <div className="qr-card"><QRCodeSVG value={summaryUrl} size={172} /><div><h3>상담 요약 QR</h3><p>이 QR은 잠시 후 만료됩니다. 주민센터 담당자에게 보여 주세요.</p></div></div>}</section>}
  </main>
}

function Admin() {
  const [password, setPassword] = useState(''); const [token, setToken] = useState(sessionStorage.getItem('navi-admin-token') ?? ''); const [overview, setOverview] = useState<{ total_sessions: number; handoff_count: number; approved_programs: number; summaries: Array<{ token: string; created_at: string; masked_text: string; recommendation_names: string[] }> } | null>(null); const [error, setError] = useState('')
  useEffect(() => { if (token) void loadOverview(token) }, [token])
  const loadOverview = async (currentToken: string) => { const response = await fetch(`${API}/api/admin/overview`, { headers: { Authorization: `Bearer ${currentToken}` } }); if (!response.ok) { setToken(''); sessionStorage.removeItem('navi-admin-token'); return }; setOverview(await response.json()) }
  const login = async (event: FormEvent) => { event.preventDefault(); setError(''); const response = await fetch(`${API}/api/admin/login`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password }) }); if (!response.ok) { setError('비밀번호가 맞지 않습니다.'); return }; const result = await response.json() as { token: string }; sessionStorage.setItem('navi-admin-token', result.token); setToken(result.token) }
  if (!token) return <main className="admin-shell"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><form className="login-card" onSubmit={login}><p className="eyebrow">담당자 전용</p><h1>관리자 로그인</h1><label>비밀번호<input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoFocus /></label>{error && <p className="error">{error}</p>}<button className="primary-button">로그인</button></form></main>
  return <main className="admin-shell"><header className="topbar"><a className="brand" href="/">NAVI <span>민원 준비 도우미</span></a><button className="text-button" onClick={() => { sessionStorage.removeItem('navi-admin-token'); setToken('') }}>로그아웃</button></header><section className="admin-content"><p className="eyebrow">담당자 관리자 화면</p><h1>오늘의 상담 준비 현황</h1>{overview && <><div className="metric-row"><div><strong>{overview.total_sessions}</strong><span>상담 세션</span></div><div><strong>{overview.handoff_count}</strong><span>담당자 확인 요청</span></div><div><strong>{overview.approved_programs}</strong><span>승인된 안내 항목</span></div></div><section className="summary-list"><h2>전달된 상담 요약</h2>{overview.summaries.length === 0 ? <p>아직 전달된 상담 요약이 없습니다.</p> : overview.summaries.map((item) => <article key={item.token}><p>{item.masked_text}</p><strong>{item.recommendation_names.join(', ')}</strong><span>{new Date(item.created_at).toLocaleString('ko-KR')} 생성</span></article>)}</section></>}</section></main>
}

function Summary() {
  const [result, setResult] = useState<{ masked_text: string; created_at: string; recommendation_names: string[] } | null>(null)
  const [error, setError] = useState('상담 요약을 불러오고 있습니다.')
  useEffect(() => {
    const token = window.location.pathname.split('/').pop()
    if (!token) return
    void fetch(`${API}/api/summaries/${token}`).then(async (response) => {
      if (!response.ok) throw new Error()
      setResult(await response.json())
    }).catch(() => setError('이 상담 요약은 없거나 만료되었습니다. 키오스크에서 다시 발급해 주세요.'))
  }, [])
  return <main className="summary-shell"><a className="brand" href="/">NAVI <span>상담 준비 요약</span></a>{result ? <section className="summary-card"><p className="eyebrow">담당자에게 보여 주세요</p><h1>상담 준비 요약</h1><p className="summary-question">{result.masked_text}</p><h2>확인한 상담 분야</h2><ul>{result.recommendation_names.map((item) => <li key={item}>{item}</li>)}</ul><p className="summary-meta">{new Date(result.created_at).toLocaleString('ko-KR')}에 생성됨</p><p className="summary-warning">개별 자격과 최종 서류는 담당자가 확인합니다.</p></section> : <section className="summary-card"><h1>{error}</h1></section>}</main>
}

export default function App() { if (window.location.pathname.startsWith('/admin')) return <Admin />; if (window.location.pathname.startsWith('/summary/')) return <Summary />; return <Kiosk /> }
