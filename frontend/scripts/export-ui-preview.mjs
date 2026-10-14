import { readFile, mkdir, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { transpileModule, JsxEmit, ModuleKind } from 'typescript'

const root = resolve(import.meta.dirname, '..')
const destination = resolve(root, '..', 'output', 'ui-concepts', 'bokjinaru-ui-preview-standalone.html')
const previewSource = resolve(root, 'src', 'preview', 'UiPreview.tsx')
const temporaryModule = resolve(root, 'src', 'preview', '.UiPreview.ssr.mjs')

try {
  const [source, css, image, font] = await Promise.all([
    readFile(previewSource, 'utf8'),
    readFile(resolve(root, 'src', 'preview', 'UiPreview.css'), 'utf8'),
    readFile(resolve(root, 'public', 'naru-guide.png')),
    readFile(resolve(root, 'node_modules', 'pretendard', 'dist', 'web', 'variable', 'woff2', 'PretendardVariable.woff2')),
  ])
  const compiled = transpileModule(source.replace("import './UiPreview.css'", ''), {
    compilerOptions: { jsx: JsxEmit.ReactJSX, module: ModuleKind.ESNext },
  }).outputText
  await writeFile(temporaryModule, compiled, 'utf8')
  const { default: UiPreview } = await import(pathToFileURL(temporaryModule).href)
  const body = renderToStaticMarkup(createElement(UiPreview)).replace(
    'src="/naru-guide.png"',
    `src="data:image/png;base64,${image.toString('base64')}"`,
  )
  const html = `<!doctype html>
<html lang="ko">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>복지나루 UI 시안</title>
  <style>
    @font-face { font-family: Pretendard; src: url(data:font/woff2;base64,${font.toString('base64')}) format('woff2'); font-style: normal; font-weight: 100 900; font-display: swap; }
    :root { font-family: Pretendard, sans-serif; color: #0b2455; font-synthesis: none; text-rendering: optimizeLegibility; }
    * { box-sizing: border-box; } body { min-width: 320px; margin: 0; } button, textarea { font: inherit; cursor: pointer; }
    button:focus-visible, a:focus-visible, textarea:focus-visible { outline: 4px solid #f4a940; outline-offset: 3px; }
    ${css}
  </style>
</head>
<body>
  <main class="ui-preview">${body}</main>
  <script>
    const root = document.querySelector('.ui-preview');
    const actions = document.querySelector('.preview-actions');
    const notice = (message) => {
      let box = document.querySelector('.preview-notice');
      if (!box) {
        box = document.createElement('div');
        box.className = 'preview-notice';
        box.setAttribute('role', 'status');
        actions.after(box);
      }
      box.textContent = message;
    };
    document.querySelector('.preview-tools button:first-child').addEventListener('click', (event) => {
      const active = root.classList.toggle('is-large');
      event.currentTarget.classList.toggle('is-active', active);
      event.currentTarget.setAttribute('aria-pressed', String(active));
    });
    document.querySelector('.preview-tools button:nth-child(2)').addEventListener('click', (event) => {
      const active = root.classList.toggle('is-contrast');
      event.currentTarget.classList.toggle('is-active', active);
      event.currentTarget.setAttribute('aria-pressed', String(active));
    });
    document.querySelector('.preview-settings-trigger').addEventListener('click', () => notice('디자인 테스트용 HTML입니다. 음성 녹음과 상담 API는 연결되어 있지 않습니다.'));
    document.querySelector('.preview-mic').addEventListener('click', () => notice('디자인 테스트용 HTML입니다. 실제 음성 상담은 기존 키오스크 화면에서 이용해 주세요.'));
    document.querySelector('.preview-text-toggle').addEventListener('click', (event) => {
      const current = document.querySelector('#preview-text-form');
      if (current) { current.remove(); event.currentTarget.setAttribute('aria-expanded', 'false'); return; }
      const form = document.createElement('form');
      form.id = 'preview-text-form';
      form.className = 'preview-text-form';
      form.innerHTML = '<label for="preview-draft">궁금한 점을 입력해 보세요</label><textarea id="preview-draft" placeholder="예: 기초생활수급을 신청하고 싶어요" rows="2"></textarea><button type="submit">시안에서 확인하기</button>';
      form.addEventListener('submit', (submitEvent) => {
        submitEvent.preventDefault();
        const value = form.querySelector('textarea').value.trim();
        if (value) notice('“' + value + '”을 입력했어요. 이 HTML은 디자인 시안으로 상담 API는 연결되어 있지 않습니다.');
      });
      actions.append(form);
      event.currentTarget.setAttribute('aria-expanded', 'true');
      form.querySelector('textarea').focus();
    });
    document.querySelectorAll('.preview-example-list button, .preview-shortcuts button').forEach((button) => {
      button.addEventListener('click', () => notice('“' + button.querySelector('strong').textContent + '”을 선택했어요. 이 HTML은 디자인 시안입니다.'));
    });
    document.querySelectorAll('a[href="/"], a[href="/ui-preview"]').forEach((link) => link.addEventListener('click', (event) => {
      event.preventDefault();
      notice('단독 HTML에서는 기존 키오스크 화면으로 이동할 수 없습니다. 실행 중인 복지나루 웹사이트를 이용해 주세요.');
    }));
  </script>
</body>
</html>
`
  await mkdir(resolve(destination, '..'), { recursive: true })
  await writeFile(destination, html, 'utf8')
  console.log(destination)
} finally {
  await rm(temporaryModule, { force: true })
}
