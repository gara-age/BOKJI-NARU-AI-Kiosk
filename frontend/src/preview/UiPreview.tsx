import type { FormEvent, ReactNode } from 'react'
import { ArrowRight, CircleHelp, Contrast, FileText, Headset, House, Keyboard, MapPin, Mic, Search, Settings2, Type } from 'lucide-react'
import './UiPreview.css'

const examples = [
  { label: '기초생활수급 신청', query: '기초생활수급을 신청하고 싶어요', icon: FileText },
  { label: '임대주택 지원', query: '전세나 임대주택 지원이 궁금해요', icon: House },
  { label: '신청 서류 안내', query: '복지서비스 신청에 필요한 서류를 알려 주세요', icon: FileText },
  { label: '어르신 돌봄', query: '어르신 돌봄 서비스를 신청하고 싶어요', icon: Headset },
  { label: '병원비 지원', query: '병원비 지원을 받을 수 있나요?', icon: Search },
  { label: '한부모 가족 지원', query: '한부모 가족 지원을 알고 싶어요', icon: House },
]

type Props = {
  largeText: boolean
  highContrast: boolean
  level: 'LOW' | 'MID' | 'HIGH'
  listening: boolean
  loading: boolean
  inputMode: 'voice' | 'text' | 'menu'
  message: string
  notice: string
  sessionHeading: { title: string; detail: string }
  hasConversation: boolean
  avatar: ReactNode
  vision: ReactNode
  touchless: ReactNode
  handover: ReactNode
  results: ReactNode
  onToggleLargeText: () => void
  onToggleHighContrast: () => void
  onOpenSettings: () => void
  onHelp: () => void
  onMic: () => void
  onToggleText: () => void
  onMessageChange: (value: string) => void
  onTextSubmit: (event: FormEvent) => void
  onConfirmMessage: () => void
  onEditMessage: () => void
  onExample: (query: string) => void
  onRestart: () => void
}

function WaveLogo() {
  return <span className="preview-mark" aria-hidden="true">
    <svg viewBox="0 0 48 48" fill="none"><path d="M9 19c5-5 9-5 14 0s9 5 16-1M9 26c5-5 9-5 14 0s9 5 16-1M9 33c5-5 9-5 14 0s9 5 16-1" stroke="currentColor" strokeWidth="3.2" strokeLinecap="round" /></svg>
  </span>
}

export default function UiPreview({
  largeText = false, highContrast = false, level = 'MID', listening = false, loading = false,
  inputMode = 'voice', message = '', notice = '', sessionHeading = { title: '', detail: '무엇을 도와드릴까요?' }, hasConversation = false,
  avatar = <img src="/naru-guide.png" alt="복지나루 캐릭터 나루" />,
  vision = null, touchless = null, handover = null, results = null,
  onToggleLargeText = () => {}, onToggleHighContrast = () => {}, onOpenSettings = () => {}, onHelp = () => {},
  onMic = () => {}, onToggleText = () => {}, onMessageChange = () => {},
  onTextSubmit = (event: FormEvent) => event.preventDefault(), onConfirmMessage = () => {}, onEditMessage = () => {},
  onExample = () => {}, onRestart = () => {},
}: Partial<Props> = {}) {
  const exampleCards = <section className="preview-examples" aria-labelledby="preview-examples-title"><h2 id="preview-examples-title">이렇게 물어보세요</h2><div className="preview-example-list">{examples.map(({ label, query, icon: Icon }) => <button data-touchless="true" type="button" key={label} onClick={() => onExample(query)}><span><Icon aria-hidden="true" /></span><strong>{label}</strong><ArrowRight aria-hidden="true" /></button>)}</div></section>
  const shortcuts = <section className="preview-shortcuts" aria-label="자주 찾는 도움"><button data-touchless="true" type="button" onClick={() => onExample('나에게 맞는 복지 지원을 찾고 싶어요')}><span className="preview-shortcut-icon"><Search aria-hidden="true" /></span><span><strong>복지 지원 찾기</strong><small>나에게 맞는 복지 혜택을 찾아보세요</small></span><ArrowRight aria-hidden="true" /></button><button data-touchless="true" type="button" onClick={() => onExample('복지서비스 신청에 필요한 서류를 알려 주세요')}><span className="preview-shortcut-icon mint"><FileText aria-hidden="true" /></span><span><strong>신청 서류 안내</strong><small>필요한 준비사항을 확인하세요</small></span><ArrowRight aria-hidden="true" /></button><button data-touchless="true" type="button" onClick={() => onExample('복지서비스를 어디에서 신청하는지 알고 싶어요')}><span className="preview-shortcut-icon"><MapPin aria-hidden="true" /></span><span><strong>신청 방법·장소</strong><small>신청 창구를 알아보세요</small></span><ArrowRight aria-hidden="true" /></button><button data-touchless="true" type="button" onClick={() => onExample('담당 직원과 상담하고 싶어요')}><span className="preview-shortcut-icon mint"><Headset aria-hidden="true" /></span><span><strong>직원 상담 요청</strong><small>더 자세한 상담을 받아보세요</small></span><ArrowRight aria-hidden="true" /></button></section>

  return <div className="preview-page" data-testid="functional-ui-preview" data-view-level={level.toLowerCase()}>
    <header className="preview-header">
      <a className="preview-brand" href="/ui-preview" aria-label="복지나루 테스트 화면 처음으로"><WaveLogo /><span>복지<span>나루</span></span></a>
      <div className="preview-tools">
        <button data-touchless="true" type="button" className={largeText ? 'is-active' : ''} aria-pressed={largeText} onClick={onToggleLargeText}><Type aria-hidden="true" /><span>글자 크게</span></button>
        <button data-touchless="true" type="button" className={highContrast ? 'is-active' : ''} aria-pressed={highContrast} onClick={onToggleHighContrast}><Contrast aria-hidden="true" /><span>고대비</span></button>
        <button data-touchless="true" type="button" className="preview-settings-trigger" aria-label="환경설정" onClick={onOpenSettings}><Settings2 aria-hidden="true" /></button>
        <button data-touchless="true" type="button" className="preview-help-trigger" aria-label="도움말" onClick={onHelp}><CircleHelp aria-hidden="true" /><span>도움말</span></button>
      </div>
    </header>

    <section className={'preview-hero' + (sessionHeading.title ? ' is-session' : '')} aria-labelledby="preview-title">
      <div className="preview-hero-copy"><h1 id="preview-title" aria-live="polite">{sessionHeading.title || <>안녕하세요,<br /><span>나루</span>예요!</>}</h1><p className="preview-prompt">{sessionHeading.detail}</p></div>
      <div className="preview-mascot"><div className="preview-mascot-glow" /><div className="preview-mascot-animation">{avatar}</div></div>
    </section>

    {handover}
    <section className="preview-actions" aria-label="상담 시작 방법">
      <button data-touchless="true" type="button" className={'preview-mic' + (listening ? ' is-listening' : '')} onClick={onMic}><span className="preview-mic-icon"><Mic aria-hidden="true" /></span><strong>{listening ? '말씀 듣는 중 · 다시 누르면 종료' : loading ? '안내를 준비하고 있어요' : '마이크를 눌러 말씀해 주세요'}</strong><ArrowRight aria-hidden="true" /></button>
      <button data-touchless="true" type="button" className="preview-text-toggle" aria-expanded={inputMode === 'text'} aria-controls="preview-text-form" onClick={onToggleText}><Keyboard aria-hidden="true" /><strong>직접 입력하기</strong><ArrowRight aria-hidden="true" /></button>
      {inputMode === 'text' && <form id="preview-text-form" className="preview-text-form" onSubmit={onTextSubmit}><label htmlFor="preview-draft">궁금한 점을 입력해 보세요</label><textarea id="preview-draft" value={message} onChange={(event) => onMessageChange(event.target.value)} placeholder="예: 기초생활수급을 신청하고 싶어요" rows={2} /><button data-touchless="true" type="submit" disabled={loading || !message.trim()}>{loading ? '확인 중' : '이 내용으로 확인'}</button></form>}
    </section>
    <div className="preview-runtime">{vision}{touchless}</div>

    {notice && notice !== '마이크를 눌러 말씀해 주세요.' && <div className="preview-notice" role="status"><p>{notice}</p></div>}
    {message && (inputMode !== 'text' || hasConversation) && <div className="preview-transcript"><div><strong>말씀하신 내용</strong><p>{message}</p></div><div><button data-touchless="true" type="button" onClick={onEditMessage}>수정하기</button><button data-touchless="true" type="button" onClick={onConfirmMessage}>이 내용으로 확인</button></div></div>}
    {results}
    {level === 'LOW' ? <>{shortcuts}{exampleCards}</> : <>{exampleCards}{shortcuts}</>}
    {hasConversation && <button data-touchless="true" type="button" className="preview-restart" onClick={onRestart}>새 상담 시작</button>}
    <footer className="preview-footer"><span>복지나루 | 함께 만드는 더 나은 일상</span><a href="/">기존 화면 보기 <ArrowRight aria-hidden="true" /></a></footer>
  </div>
}
