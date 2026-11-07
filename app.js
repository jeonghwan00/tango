'use strict';
// 単語 — 개인용 오프라인 일본어 단어장. 데이터는 전부 이 기기의 localStorage 에만 있다.

const { fsrs, generatorParameters, createEmptyCard, Rating, State } = window.FSRS;
const F = fsrs(generatorParameters({ enable_fuzz: true }));

const KEY = 'tango.v1';
const MIN = 6e4, DAY = 864e5, ROLL = 4 * 3600e3; // 하루는 새벽 4시에 바뀐다
const LONG = 21, STABLE = 7;                      // 장기기억 / 안정 기준 (안정도, 일)
const DIRS = { hk: 'かな→한', jk: '漢字→한', kj: '한→일', sj: '문장' };
const GRADES = [
  { g: Rating.Again, label: '몰랐음', cls: 'again' },
  { g: Rating.Hard, label: '애매함', cls: 'hard' },
  { g: Rating.Good, label: '알았음', cls: 'good' },
];

const $ = (s, r = document) => r.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const KANJI = /[㐀-鿿豈-﫿々〆ヶ]/;

function dayStart(t = Date.now()) { const d = new Date(t - ROLL); d.setHours(0, 0, 0, 0); return d.getTime() + ROLL; }
function dayKey(t = Date.now()) {
  const d = new Date(t - ROLL);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// ---------- 저장 ----------
let S;
function defaults() {
  return {
    v: 1, seq: 0, decks: {}, notes: {}, cards: {},
    settings: { newPerDay: 20, dirs: { hk: true, jk: true, kj: true, sj: false }, furigana: true, pron: true, deck: 'all' },
    daily: { date: '', newDone: 0, extra: 0, wrong: [] },
    history: {},
  };
}
function reviveCard(c) {
  const f = c.f;
  f.due = new Date(f.due);
  if (f.last_review) f.last_review = new Date(f.last_review);
  return c;
}
function hydrate(obj) {
  const d = defaults();
  const s = Object.assign(d, obj);
  s.settings = Object.assign(defaults().settings, obj.settings || {});
  s.settings.dirs = Object.assign(defaults().settings.dirs, (obj.settings || {}).dirs || {});
  s.daily = Object.assign(defaults().daily, obj.daily || {});
  for (const c of Object.values(s.cards)) reviveCard(c);
  // 나중에 생긴 방향(かな→한 등)의 카드를 기존 단어에도 만들어 준다
  for (const n of Object.values(s.notes)) for (const dir of Object.keys(DIRS)) {
    if (n.cards[dir] && s.cards[n.cards[dir]]) continue;
    const c = { id: uid(), noteId: n.id, dir, f: createEmptyCard(new Date()), introAt: 0 };
    s.cards[c.id] = c; n.cards[dir] = c.id;
  }
  return s;
}
function load() {
  try { const raw = localStorage.getItem(KEY); S = raw ? hydrate(JSON.parse(raw)) : defaults(); }
  catch (e) { S = defaults(); }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('저장하지 못했어요. 저장 공간을 확인해 주세요.'); }
}
function ensureDay() {
  const k = dayKey();
  if (S.daily.date !== k) { S.daily = { date: k, newDone: 0, extra: 0, wrong: [] }; save(); }
}
function hist() { const k = dayKey(); return (S.history[k] ||= { reviews: 0, newWords: 0 }); }

// ---------- 덱 / 노트 ----------
const NOTE_FIELDS = ['word', 'reading', 'pron', 'meaning', 'pos', 'sentence', 'sentence_ko', 'time'];

function findDeckByName(name) { return Object.values(S.decks).find((d) => d.name === name); }
function ensureDeck(name) {
  name = (name || '').trim() || '내 단어장';
  let d = findDeckByName(name);
  if (!d) { d = { id: uid(), name, created: Date.now() }; S.decks[d.id] = d; }
  return d;
}
function cleanNote(raw) {
  const n = {};
  for (const k of NOTE_FIELDS) n[k] = String(raw[k] ?? '').trim();
  if (!n.reading && !KANJI.test(n.word)) n.reading = n.word;
  return n;
}
function addNote(deckId, raw) {
  const n = { id: uid(), deckId, order: ++S.seq, intro: '', ...cleanNote(raw), cards: {} };
  for (const dir of Object.keys(DIRS)) {
    const c = { id: uid(), noteId: n.id, dir, f: createEmptyCard(new Date()), introAt: 0 };
    S.cards[c.id] = c; n.cards[dir] = c.id;
  }
  S.notes[n.id] = n;
  return n;
}
function deleteNote(id) {
  const n = S.notes[id]; if (!n) return;
  for (const cid of Object.values(n.cards)) delete S.cards[cid];
  delete S.notes[id];
}
function resetNote(n) {
  n.intro = '';
  for (const cid of Object.values(n.cards)) { const c = S.cards[cid]; c.f = createEmptyCard(new Date()); c.introAt = 0; }
}
function notesOf(deckId) { return Object.values(S.notes).filter((n) => n.deckId === deckId).sort((a, b) => a.order - b.order); }

// ---------- 스케줄 ----------
function inDeck(n) { const d = S.settings.deck; return d === 'all' || !S.decks[d] || n.deckId === d; }
function modeDirs(mode) {
  if (mode === 'type') return ['kj'];
  const on = Object.keys(DIRS).filter((d) => S.settings.dirs[d]);
  return on.length ? on : ['jk'];
}
function usable(c, n) {
  if (c.dir === 'sj') return !!n.sentence;
  if (c.dir === 'hk') return !!n.reading && KANJI.test(n.word); // 한자 없는 단어는 漢字→한 과 같아서 뺀다
  return true;
}
function pool(mode) {
  const dirs = modeDirs(mode), out = [];
  for (const n of Object.values(S.notes)) {
    if (!inDeck(n)) continue;
    for (const d of dirs) { const c = S.cards[n.cards[d]]; if (c && usable(c, n)) out.push(c); }
  }
  return out;
}
// 오늘 소개된 새 카드는 학습 카드처럼 취급한다
const isLearning = (c) => c.f.state === State.Learning || c.f.state === State.Relearning || (c.f.state === State.New && c.introAt > 0);
const learnDue = (c) => (c.f.state === State.New ? c.introAt : c.f.due.getTime());
const isReviewToday = (c, end) => c.f.state === State.Review && c.f.due.getTime() < end;

function remainingNew() { return Math.max(0, S.settings.newPerDay + S.daily.extra - S.daily.newDone); }
function newCandidates(mode) {
  const dirs = modeDirs(mode), out = [];
  for (const n of Object.values(S.notes)) {
    if (!inDeck(n)) continue;
    const cs = dirs.map((d) => S.cards[n.cards[d]]).filter((c) => c && usable(c, n) && c.f.state === State.New && !c.introAt);
    if (cs.length) out.push({ n, cs });
  }
  return out.sort((a, b) => a.n.order - b.n.order);
}
function introduce(mode) {
  const cand = newCandidates(mode)[0];
  if (!cand) return null;
  const now = Date.now(), ord = { hk: 0, jk: 1, kj: 2, sj: 3 };
  cand.cs.sort((a, b) => ord[a.dir] - ord[b.dir]).forEach((c, i) => { c.introAt = now + i * 3 * MIN; });
  if (!cand.n.intro) { cand.n.intro = dayKey(); hist().newWords++; }
  S.daily.newDone++;
  return cand.cs[0];
}
function counts(mode) {
  const now = Date.now(), end = dayStart(now) + DAY, P = pool(mode);
  return {
    learn: P.filter(isLearning).length,
    review: P.filter((c) => isReviewToday(c, end)).length,
    fresh: Math.min(remainingNew(), newCandidates(mode).length),
  };
}
function nextCard(mode, skipId) {
  const now = Date.now(), end = dayStart(now) + DAY, P = pool(mode);
  const learn = P.filter(isLearning).sort((a, b) => learnDue(a) - learnDue(b));
  const ready = learn.find((c) => learnDue(c) <= now && c.id !== skipId);
  if (ready) return ready;
  const rev = P.filter((c) => isReviewToday(c, end)).sort((a, b) => a.f.due - b.f.due);
  const canNew = remainingNew() > 0;
  session.n++;
  // 복습 사이사이에 새 단어를 섞는다 (복습 3장 : 새 단어 1장)
  if (rev.length && !(canNew && session.n % 4 === 0)) return rev[0];
  if (canNew) { const c = introduce(mode); if (c) { save(); return c; } }
  if (rev.length) return rev[0];
  // 남은 게 아직 시간이 안 된 학습 카드뿐이면 미리 보여준다
  return learn.find((c) => c.id !== skipId) || learn[0] || null;
}
function preview(c) {
  const rec = F.repeat(c.f, new Date());
  const out = {};
  for (const { g } of GRADES) out[g] = rec[g].card;
  return out;
}
function fmtNext(f) {
  const ms = f.due.getTime() - Date.now();
  if (f.state !== State.Review || ms < DAY / 2) { const m = Math.max(1, Math.round(ms / MIN)); return m < 60 ? `${m}분` : `${Math.round(m / 60)}시간`; }
  const d = f.scheduled_days || Math.round(ms / DAY);
  if (d < 30) return `${d}일`;
  if (d < 365) return `${(d / 30).toFixed(1).replace('.0', '')}개월`;
  return `${(d / 365).toFixed(1).replace('.0', '')}년`;
}
function grade(c, g) {
  const now = new Date();
  session.undo = { id: c.id, f: JSON.stringify(c.f), introAt: c.introAt, daily: JSON.stringify(S.daily), hist: JSON.stringify(hist()) };
  c.f = F.next(c.f, now, g).card;
  c.introAt = 0;
  hist().reviews++;
  if (g === Rating.Again && !S.daily.wrong.includes(c.id)) S.daily.wrong.push(c.id);
  save();
}
function undo() {
  const u = session.undo; if (!u) return;
  const c = S.cards[u.id]; if (!c) return;
  c.f = JSON.parse(u.f); reviveCard(c); c.introAt = u.introAt;
  S.daily = JSON.parse(u.daily); S.history[dayKey()] = JSON.parse(u.hist);
  session.undo = null; save();
  session.card = c; session.flipped = false; session.typed = null;
  renderStudy();
}

// 단어 상태: 켜진 방향 카드 중 가장 약한 것 기준
function noteStrength(n) {
  let min = Infinity, any = false;
  for (const d of modeDirs('flip')) {
    const c = S.cards[n.cards[d]]; if (!c || !usable(c, n)) continue;
    any = true;
    if (c.f.state === State.New && !n.intro) return { tag: 'new', s: 0 };
    min = Math.min(min, c.f.state === State.Review ? c.f.stability : 0);
  }
  if (!any) return { tag: 'new', s: 0 };
  return { tag: min >= LONG ? 'long' : min >= STABLE ? 'stable' : 'learn', s: min };
}
function streak() {
  let n = 0, t = Date.now();
  if (!(S.history[dayKey(t)]?.reviews)) t -= DAY;
  while (S.history[dayKey(t)]?.reviews) { n++; t -= DAY; }
  return n;
}

// ---------- 한글 발음 ----------
// 히라가나 읽기에서 만든다. 장음은 대시: せんしゅう → 센슈-, きょう → 쿄-, カーディガン → 카-디간
const KROWS = [['あいうえお', '아이우에오'], ['かきくけこ', '카키쿠케코'], ['がぎぐげご', '가기구게고'], ['さしすせそ', '사시스세소'],
  ['ざじずぜぞ', '자지즈제조'], ['たちつてと', '타치츠테토'], ['だぢづでど', '다지즈데도'], ['なにぬねの', '나니누네노'],
  ['はひふへほ', '하히후헤호'], ['ばびぶべぼ', '바비부베보'], ['ぱぴぷぺぽ', '파피푸페포'], ['まみむめも', '마미무메모'],
  ['らりるれろ', '라리루레로'], ['ぁぃぅぇぉ', '아이우에오']];
const KTAB = {};
for (const [k, h] of KROWS) [...k].forEach((ch, i) => { KTAB[ch] = [h[i], 'aiueo'[i]]; });
Object.assign(KTAB, { や: ['야', 'a'], ゆ: ['유', 'u'], よ: ['요', 'o'], ゃ: ['야', 'a'], ゅ: ['유', 'u'], ょ: ['요', 'o'], わ: ['와', 'a'], を: ['오', 'o'], ゐ: ['이', 'i'], ゑ: ['에', 'e'], ゔ: ['부', 'u'] });
const YOON = { き: '캬큐쿄', ぎ: '갸규교', し: '샤슈쇼', じ: '자주조', ち: '차추초', ぢ: '자주조', に: '냐뉴뇨', ひ: '햐휴효', び: '뱌뷰뵤', ぴ: '퍄퓨표', み: '먀뮤묘', り: '랴류료' };
const SMALLV = { ふぁ: ['화', 'a'], ふぃ: ['휘', 'i'], ふぇ: ['페', 'e'], ふぉ: ['포', 'o'], てぃ: ['티', 'i'], でぃ: ['디', 'i'], とぅ: ['투', 'u'], どぅ: ['두', 'u'],
  うぃ: ['위', 'i'], うぇ: ['웨', 'e'], うぉ: ['워', 'o'], ちぇ: ['체', 'e'], しぇ: ['셰', 'e'], じぇ: ['제', 'e'], いぇ: ['예', 'e'], ゔぁ: ['바', 'a'], ゔぃ: ['비', 'i'], ゔぇ: ['베', 'e'], ゔぉ: ['보', 'o'] };
const PURE = 'あいうえお';
const toHira = (s) => String(s || '').replace(/[\u30A1-\u30F6]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60));
function addFinal(out, fin) { // fin: 4=ㄴ, 16=ㅁ, 19=ㅅ, 21=ㅇ
  const last = out[out.length - 1], code = last ? last.charCodeAt(0) - 0xAC00 : -1;
  if (code >= 0 && code < 11172 && code % 28 === 0) out[out.length - 1] = String.fromCharCode(last.charCodeAt(0) + fin);
  else out.push(fin === 19 ? '' : '응');
}
function hangulPron(reading, pos = '') {
  const raw = String(reading || ''), s = toHira(raw);
  if (!s || /[\u3400-\u9FFFa-zA-Z가-힣]/.test(s)) return '';
  const verb = /동사/.test(pos);
  const out = []; let prev = null; // prev: 바로 앞 음절의 모음 (ん/っ 이 끼면 null)
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], two = s.slice(i, i + 2);
    if (ch === 'ー') { if (prev) out.push('-'); continue; }
    if (ch === 'ん') { // 뒤 소리에 따라 ㄴ/ㅇ/ㅁ: 산포 → 삼포, 쇼핀구 → 쇼핑구
      const nx = s[i + 1] || ' ';
      addFinal(out, 'かきくけこがぎぐげご'.includes(nx) ? 21 : 'ばびぶべぼぱぴぷぺぽまみむめも'.includes(nx) ? 16 : 4);
      prev = null; continue;
    }
    if (ch === 'っ') { if (i < s.length - 1) addFinal(out, 19); prev = null; continue; }
    let unit = null;
    if (SMALLV[two]) { unit = SMALLV[two]; i++; }
    else if (YOON[ch] && 'ゃゅょ'.includes(s[i + 1])) { const k = 'ゃゅょ'.indexOf(s[i + 1]); unit = [YOON[ch][k], 'auo'[k]]; i++; }
    else if (KTAB[ch]) unit = KTAB[ch];
    if (!unit) { out.push(ch); prev = null; continue; }
    const [h, v] = unit;
    // 가타카나(외래어)는 ー 만 장음: ネイビー → 네이비-
    if (prev && PURE.includes(ch) && !/[\u30A1-\u30F6]/.test(raw[i])) {
      const isLong = v === prev || (v === 'u' && prev === 'o') || (v === 'i' && prev === 'e');
      const verbEnd = verb && ch === 'う' && i === s.length - 1; // 思う, 会う 의 끝 う 는 장음이 아니다
      if (isLong && !verbEnd) { out.push('-'); continue; }
    }
    out.push(h); prev = v;
  }
  return out.join('');
}
const pronOf = (n) => hangulPron(n.reading || (!KANJI.test(n.word) ? n.word : ''), n.pos) || n.pron || '';

// ---------- 후리가나 ----------
// "今日[きょう]は" 형식. 한자 덩어리 바로 뒤의 [읽기] 가 루비가 된다.
function segments(s) {
  const out = [], re = /([㐀-鿿豈-﫿々〆ヶ]+)\[([^\]]+)\]/g;
  let last = 0, m;
  while ((m = re.exec(s))) {
    if (m.index > last) out.push({ t: s.slice(last, m.index) });
    out.push({ t: m[1], r: m[2] });
    last = re.lastIndex;
  }
  if (last < s.length) out.push({ t: s.slice(last) });
  return out;
}
const plainOf = (s) => segments(s).map((x) => x.t).join('');
function furi(s, hl) {
  const segs = segments(s), plain = segs.map((x) => x.t).join('');
  let range = null;
  if (hl) {
    const h = plainOf(hl).replace(/^[〜~]+|[〜~]+$/g, '');
    for (const c of [h, h.length >= 2 && h.slice(0, -1), h.length >= 3 && h.slice(0, -2)]) {
      if (!c) continue;
      const i = plain.indexOf(c);
      if (i >= 0) { range = [i, i + c.length]; break; }
    }
  }
  let pos = 0, out = '';
  for (const x of segs) {
    const a = pos, b = pos + x.t.length; pos = b;
    const hit = range && a < range[1] && b > range[0];
    if (x.r !== undefined) {
      const ru = `<ruby>${esc(x.t)}<rt>${esc(x.r)}</rt></ruby>`;
      out += hit ? `<mark>${ru}</mark>` : ru;
    } else if (hit) {
      const s1 = Math.max(range[0], a) - a, e1 = Math.min(range[1], b) - a;
      out += esc(x.t.slice(0, s1)) + '<mark>' + esc(x.t.slice(s1, e1)) + '</mark>' + esc(x.t.slice(e1));
    } else out += esc(x.t);
  }
  return out;
}
function wordHTML(n) {
  if (n.word.includes('[')) return furi(n.word);
  if (n.reading && n.reading !== n.word && KANJI.test(n.word)) return `<ruby>${esc(n.word)}<rt>${esc(n.reading)}</rt></ruby>`;
  return esc(n.word);
}

// ---------- 카드 면 ----------
function wordBlock(n, always) {
  return `<div class="word ${always ? 'always' : ''}">${wordHTML(n)}</div>` +
    (pronOf(n) ? `<div class="pron">${esc(pronOf(n))}</div>` : '');
}
function sentBlock(n, withKo = true) {
  if (!n.sentence) return '';
  return `<div class="sent"><div class="jp">${furi(n.sentence, n.word)}</div>` +
    (withKo && n.sentence_ko ? `<div class="ko">${esc(n.sentence_ko)}</div>` : '') +
    (n.time ? `<div class="time">▶ ${esc(n.time)}</div>` : '') + '</div>';
}
const posTag = (n) => (n.pos ? `<div class="pos">${esc(n.pos)}</div>` : '');
function face(c, n, back) {
  if (c.dir === 'hk') {
    return posTag(n) + `<div class="word kana" lang="ja">${esc(n.reading)}</div>` +
      (pronOf(n) ? `<div class="pron">${esc(pronOf(n))}</div>` : '') +
      (back ? `<hr><div class="word always">${wordHTML(n)}</div><div class="meaning">${esc(n.meaning)}</div>${sentBlock(n)}` : '');
  }
  if (c.dir === 'jk') {
    return posTag(n) + wordBlock(n, back) + (back ? `<hr><div class="meaning">${esc(n.meaning)}</div>${sentBlock(n)}` : '');
  }
  if (c.dir === 'kj') {
    return posTag(n) + `<div class="meaning big">${esc(n.meaning)}</div>` + (back ? `<hr>${wordBlock(n, true)}${sentBlock(n)}` : '');
  }
  // 문장 카드
  const front = `<div class="pos">문장</div><div class="sent front"><div class="jp">${furi(n.sentence, n.word)}</div></div>`;
  return front + (back ? `<hr><div class="ko solo">${esc(n.sentence_ko)}</div>${wordBlock(n, true)}<div class="meaning">${esc(n.meaning)}</div>` : '');
}

// ---------- 타이핑 채점 ----------
function normJa(s) {
  return String(s || '').normalize('NFKC').replace(/[\s・。、.,!?！？「」『』()（）〜~]/g, '')
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60)).toLowerCase();
}
function checkTyped(n, input) {
  const v = normJa(input);
  if (!v) return false;
  const answers = [n.word, plainOf(n.word), n.reading, ...String(n.reading).split(/[\/／,、]/)].filter(Boolean).map(normJa);
  return answers.includes(v);
}

// ---------- 화면 ----------
let view = 'home';
let session = { mode: 'flip', card: null, flipped: false, n: 0, undo: null, typed: null };
let cram = null;
let wordsDeck = null, wordsQuery = '';

function setFuriClass() {
  document.body.classList.toggle('nofuri', !S.settings.furigana);
  document.body.classList.toggle('nopron', !S.settings.pron);
}
function showTabs(on, tab) {
  $('#tabs').hidden = !on;
  document.querySelectorAll('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
}
function render() {
  ensureDay(); setFuriClass();
  if (view === 'study') return renderStudy();
  if (view === 'cram') return renderCram();
  if (view === 'decks') return renderDecks();
  if (view === 'words') return renderWords();
  if (view === 'import') return renderImport();
  if (view === 'settings') return renderSettings();
  return renderHome();
}
function deckSelect() {
  const decks = Object.values(S.decks).sort((a, b) => a.created - b.created);
  if (decks.length < 2) return '';
  return `<select data-change="deck" class="deck-select"><option value="all">전체 단어장</option>${decks.map((d) =>
    `<option value="${d.id}" ${S.settings.deck === d.id ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}</select>`;
}
function isStandalone() { return window.navigator.standalone || matchMedia('(display-mode: standalone)').matches; }

function renderHome() {
  showTabs(true, 'home');
  const notes = Object.values(S.notes).filter(inDeck);
  if (!Object.keys(S.notes).length) {
    $('#app').innerHTML = `<header class="top"><h1>単語</h1></header>
      <section class="empty"><p>아직 단어가 없어요.</p>
      <button class="primary" data-act="go" data-view="import">단어 가져오기</button>
      <button data-act="add-word">하나씩 추가</button></section>${installHint()}`;
    return;
  }
  const c = counts('flip'), t = counts('type');
  const tiers = { new: 0, learn: 0, stable: 0, long: 0 };
  for (const n of notes) tiers[noteStrength(n).tag]++;
  const wrong = S.daily.wrong.filter((id) => S.cards[id]).length;
  const h = S.history[dayKey()] || { reviews: 0, newWords: 0 };
  const todo = c.learn + c.review + c.fresh;
  $('#app').innerHTML = `
    <header class="top"><h1>単語</h1>${deckSelect()}</header>
    <section class="hero">
      <div class="big-num">${tiers.long}</div>
      <div class="big-label">장기기억 단어 <span class="muted">/ ${notes.length}</span></div>
      <div class="bar">${['long', 'stable', 'learn', 'new'].map((k) => `<i class="${k}" style="flex:${tiers[k]}"></i>`).join('')}</div>
      <div class="legend"><span class="long">장기 ${tiers.long}</span><span class="stable">안정 ${tiers.stable}</span><span class="learn">익히는 중 ${tiers.learn}</span><span class="new">새 단어 ${tiers.new}</span></div>
    </section>
    <section class="today">
      <div class="counts"><div><b>${c.review}</b><span>복습</span></div><div><b>${c.learn}</b><span>학습 중</span></div><div><b>${c.fresh}</b><span>새 단어</span></div></div>
      <button class="primary big" data-act="study" data-mode="flip">${todo ? '카드 공부' : '오늘 할 것 끝 ✓'}</button>
      <div class="row">
        <button data-act="study" data-mode="type">⌨︎ 타이핑 (한→일)<small>${t.review + t.learn + t.fresh}장</small></button>
        <button data-act="cram" ${wrong ? '' : 'disabled'}>오늘 틀린 것<small>${wrong}장</small></button>
      </div>
      <div class="row extra"><span class="muted">새 단어 오늘 ${S.daily.newDone}/${S.settings.newPerDay + S.daily.extra}</span>
        <button class="chip" data-act="more" data-n="10">+10</button><button class="chip" data-act="more" data-n="20">+20</button><button class="chip" data-act="more" data-n="50">+50</button></div>
    </section>
    <p class="foot muted">오늘 ${h.reviews}번 복습 · 새 단어 ${h.newWords}개 · 연속 ${streak()}일</p>
    ${installHint()}`;
}
function installHint() {
  if (isStandalone() || !/iPhone|iPad/.test(navigator.userAgent)) return '';
  return `<p class="hint">Safari 아래 공유 버튼 → <b>홈 화면에 추가</b>를 누르면 앱처럼 쓰고, 인터넷 없이도 열려요.</p>`;
}

function startStudy(mode) {
  session = { mode, card: null, flipped: false, n: 0, undo: null, typed: null };
  session.card = nextCard(mode);
  view = 'study'; render();
}
function renderStudy() {
  showTabs(false);
  const { mode, card } = session;
  const c = counts(mode);
  const head = `<header class="study-top">
      <button class="icon" data-act="home" aria-label="닫기">✕</button>
      <div class="q"><span class="rv">${c.review}</span><span class="ln">${c.learn}</span><span class="nw">${c.fresh}</span></div>
      <button class="icon" data-act="undo" ${session.undo ? '' : 'disabled'} aria-label="되돌리기">↶</button>
      <button class="icon furi-btn ${S.settings.furigana ? 'on' : ''}" data-act="furi" aria-label="후리가나">あ</button>
      <button class="icon pron-btn ${S.settings.pron ? 'on' : ''}" data-act="pron" aria-label="한글 발음">가</button>
    </header>`;
  if (!card) {
    const wrong = S.daily.wrong.filter((id) => S.cards[id]).length;
    $('#app').innerHTML = head + `<section class="done"><div class="done-mark">✓</div><h2>오늘 할 것 끝</h2>
      <p class="muted">더 하고 싶으면 새 단어를 더 열어요.</p>
      <div class="row"><button data-act="more" data-n="10" data-cont="1">새 단어 +10</button><button data-act="more" data-n="20" data-cont="1">+20</button></div>
      <button data-act="cram" ${wrong ? '' : 'disabled'}>오늘 틀린 것 다시보기 (${wrong})</button>
      <button class="primary" data-act="home">홈으로</button></section>`;
    return;
  }
  const n = S.notes[card.noteId];
  const typing = mode === 'type';
  const back = session.flipped;
  let body = `<article class="card dir-${card.dir} ${back ? 'back' : ''}" ${!typing && !back ? 'data-act="flip"' : ''}>
      <div class="dir">${DIRS[card.dir]}${card.f.state === State.New ? ' · 새 단어' : ''}</div>
      <div class="face">${face(card, n, back)}</div>
      ${!typing && !back ? '<div class="tap muted">탭해서 뒤집기</div>' : ''}
    </article>`;
  let bottom;
  if (typing && !back) {
    bottom = `<form class="type-form" data-submit="check"><input id="answer" lang="ja" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" placeholder="히라가나 또는 한자로 입력">
      <button class="primary" type="submit">확인</button></form><button class="link" data-act="giveup">모르겠어요</button>`;
  } else if (!back) {
    bottom = `<button class="primary big" data-act="flip">정답 보기</button>`;
  } else {
    const p = preview(card);
    const suggest = typing ? (session.typed?.ok ? Rating.Good : Rating.Again) : null;
    const res = typing ? `<div class="typed ${session.typed.ok ? 'ok' : 'ng'}">${session.typed.ok ? '정답' : '오답'} · <span lang="ja">${esc(session.typed.input || '—')}</span></div>` : '';
    bottom = res + `<div class="grades">${GRADES.map(({ g, label, cls }) =>
      `<button class="${cls} ${suggest === g ? 'suggest' : ''}" data-act="grade" data-g="${g}"><b>${label}</b><small>${fmtNext(p[g])}</small></button>`).join('')}</div>`;
  }
  $('#app').innerHTML = head + `<section class="study">${body}</section><footer class="study-bottom">${bottom}</footer>`;
  if (typing && !back) setTimeout(() => $('#answer')?.focus(), 30);
}

function startCram() {
  const ids = S.daily.wrong.filter((id) => S.cards[id]);
  if (!ids.length) return;
  cram = { queue: ids.sort(() => Math.random() - 0.5), flipped: false, total: ids.length, from: view };
  view = 'cram'; render();
}
function renderCram() {
  showTabs(false);
  const id = cram.queue[0];
  const head = `<header class="study-top"><button class="icon" data-act="home">✕</button>
    <div class="q"><span>다시보기 ${cram.total - cram.queue.length}/${cram.total}</span></div>
    <button class="icon furi-btn ${S.settings.furigana ? 'on' : ''}" data-act="furi">あ</button>
    <button class="icon pron-btn ${S.settings.pron ? 'on' : ''}" data-act="pron">가</button></header>`;
  if (!id) {
    $('#app').innerHTML = head + `<section class="done"><div class="done-mark">✓</div><h2>다시보기 끝</h2><p class="muted">다시보기는 복습 일정에 영향을 주지 않아요.</p><button class="primary" data-act="home">홈으로</button></section>`;
    return;
  }
  const c = S.cards[id], n = S.notes[c.noteId];
  const back = cram.flipped;
  $('#app').innerHTML = head + `<section class="study"><article class="card ${back ? 'back' : ''}" ${back ? '' : 'data-act="cram-flip"'}>
      <div class="dir">${DIRS[c.dir]}</div><div class="face">${face(c, n, back)}</div>${back ? '' : '<div class="tap muted">탭해서 뒤집기</div>'}</article></section>
    <footer class="study-bottom">${back ? `<div class="grades two"><button class="again" data-act="cram-grade" data-ok="0"><b>또 볼래요</b></button><button class="good" data-act="cram-grade" data-ok="1"><b>알았음</b></button></div>` : '<button class="primary big" data-act="cram-flip">정답 보기</button>'}</footer>`;
}

// ---------- 단어장 ----------
function renderDecks() {
  showTabs(true, 'decks');
  const decks = Object.values(S.decks).sort((a, b) => a.created - b.created);
  $('#app').innerHTML = `<header class="top"><h1>단어장</h1></header>
    <div class="row"><button class="primary" data-act="go" data-view="import">＋ 가져오기</button><button data-act="add-word">하나씩 추가</button></div>
    <ul class="decks">${decks.map((d) => {
      const ns = notesOf(d.id);
      const long = ns.filter((n) => noteStrength(n).tag === 'long').length;
      return `<li><button class="deck" data-act="words" data-id="${d.id}"><b>${esc(d.name)}</b><span class="muted">${ns.length}단어 · 장기 ${long}</span></button>
        <div class="deck-acts"><button class="chip" data-act="share-deck" data-id="${d.id}">내보내기</button><button class="chip" data-act="rename-deck" data-id="${d.id}">이름</button><button class="chip danger" data-act="del-deck" data-id="${d.id}">삭제</button></div></li>`;
    }).join('') || '<li class="muted">단어장이 없어요.</li>'}</ul>`;
}
function statusLabel(n) {
  const st = noteStrength(n);
  if (st.tag === 'new') return '<span class="st new">새</span>';
  if (st.tag === 'learn' && st.s === 0) return '<span class="st learn">학습</span>';
  return `<span class="st ${st.tag}">${Math.round(st.s)}일</span>`;
}
function renderWords() {
  showTabs(true, 'decks');
  const d = S.decks[wordsDeck]; if (!d) { view = 'decks'; return render(); }
  $('#app').innerHTML = `<header class="top"><button class="icon" data-act="go" data-view="decks">‹</button><h1 class="sm">${esc(d.name)}</h1></header>
    <input class="search" data-input="q" placeholder="검색" value="${esc(wordsQuery)}"><div id="wordlist">${wordsListHTML()}</div>`;
}
function wordsListHTML() {
  const q = wordsQuery.trim().toLowerCase();
  const ns = notesOf(wordsDeck).filter((n) => !q || [n.word, n.reading, n.meaning, pronOf(n)].some((x) => String(x).toLowerCase().includes(q)));
  return `<ul class="words">${ns.map((n) => `<li><button data-act="edit-word" data-id="${n.id}"><span class="w" lang="ja">${esc(plainOf(n.word))}</span><span class="r" lang="ja">${esc(n.reading !== n.word ? n.reading : '')}</span><span class="m">${esc(n.meaning)}</span>${statusLabel(n)}</button></li>`).join('')}</ul>
    <p class="muted center">${ns.length}단어</p>`;
}

// ---------- 가져오기 ----------
const GPT_PROMPT = `아래는 일본어 유튜브 영상의 자동 자막 스크립트야. 한국어 화자가 외우면 좋을 일본어 단어와 표현을 빠짐없이 뽑아서, 아래 JSON 형식으로만 답해줘. 설명 없이 JSON 코드 블록 하나만.

{
  "format": "tango-deck-v1",
  "deck": "덱 이름 (예: 일본어 회화 2회차)",
  "cards": [
    {
      "word": "先週",
      "reading": "せんしゅう",
      "meaning": "지난주",
      "pos": "명사",
      "sentence": "今日[きょう]は先週[せんしゅう]友達[ともだち]と買[か]い物[もの]に行[い]った時[とき]の話[はなし]をしようと思[おも]います。",
      "sentence_ko": "오늘은 지난주 친구와 쇼핑하러 갔을 때의 이야기를 하려고 해요.",
      "time": "00:00"
    }
  ]
}

규칙:
- word: 사전형. 한자가 있으면 한자로. 영상 속 문형(예: 〜てみたいんだけど)도 word 로 넣어.
- reading: 히라가나 읽기 하나 (가타카나 단어는 가타카나 그대로).
- meaning: 짧은 한국어 뜻. pos: 품사(명사/동사/형용사/부사/표현/문형 등).
- sentence: 스크립트에서 그 단어가 실제로 나온 문장. 자동 자막의 오인식·띄어쓰기·구두점은 바로잡아. 한자 덩어리마다 바로 뒤에 [읽기]를 붙이고, 가나에는 붙이지 마.
- sentence_ko: 문장 번역. time: 그 문장의 타임스탬프(mm:ss).
- 같은 단어는 한 번만. 스크립트가 반복되면 처음 한 번만 써.
- 카드가 60개를 넘으면 60개씩 나눠서 주고, 내가 "계속"이라고 하면 같은 deck 이름으로 이어서 줘.

스크립트:
`;

function renderImport() {
  showTabs(true, 'decks');
  $('#app').innerHTML = `<header class="top"><button class="icon" data-act="go" data-view="decks">‹</button><h1 class="sm">가져오기</h1></header>
    <section class="panel"><h3>1. GPT로 단어장 만들기</h3>
      <p class="muted">프롬프트를 복사해서 ChatGPT에 붙이고, 그 아래에 유튜브 스크립트를 붙여넣으세요.</p>
      <button data-act="copy-prompt">프롬프트 복사</button>
      <details><summary>프롬프트 보기</summary><pre>${esc(GPT_PROMPT)}</pre></details></section>
    <section class="panel"><h3>2. 결과 붙여넣기</h3>
      <textarea id="paste" rows="8" placeholder="GPT 답변을 그대로 붙여넣기 (JSON)"></textarea>
      <input id="deckname" placeholder="덱 이름 (비우면 JSON 안의 이름)">
      <button class="primary" data-act="do-import">가져오기</button></section>
    <section class="panel"><h3>파일에서</h3>
      <p class="muted">내보낸 덱 파일(.json)이나 백업 파일을 고르세요.</p>
      <button data-act="pick-file" data-kind="deck">파일 고르기</button></section>`;
}
function parseLoose(text) {
  let t = String(text || '').trim().replace(/^```(?:json)?/gim, '').replace(/```$/gm, '').trim();
  // GPT 가 이어서 준 여러 덩어리를 붙여넣어도 각각 읽는다
  const objs = [];
  let depth = 0, start = -1, inStr = false, escp = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (inStr) { if (escp) escp = false; else if (ch === '\\') escp = true; else if (ch === '"') inStr = false; continue; }
    if (ch === '"') inStr = true;
    else if (ch === '{' || ch === '[') { if (depth === 0) start = i; depth++; }
    else if (ch === '}' || ch === ']') { depth--; if (depth === 0 && start >= 0) { objs.push(JSON.parse(t.slice(start, i + 1))); start = -1; } }
  }
  if (!objs.length) {
    // 탭 구분 텍스트: 단어 \t 읽기 \t 뜻 \t 예문 \t 예문뜻
    const rows = t.split('\n').map((l) => l.split('\t')).filter((r) => r.length >= 2);
    if (rows.length) return [{ cards: rows.map(([word, reading, meaning, sentence, sentence_ko]) => meaning === undefined ? { word, meaning: reading } : { word, reading, meaning, sentence, sentence_ko }) }];
    throw new Error('형식을 읽지 못했어요');
  }
  return objs;
}
function importDeckObjects(objs, nameOverride) {
  let added = 0, skipped = 0; const names = new Set();
  for (const o of objs) {
    if (o && o.notes && o.cards && o.settings) throw new Error('backup');
    const cards = Array.isArray(o) ? o : o.cards || [];
    const deck = ensureDeck(nameOverride || o.deck || o.name);
    names.add(deck.name);
    const seen = new Set(notesOf(deck.id).map((n) => plainOf(n.word) + '|' + n.reading));
    for (const raw of cards) {
      const n = cleanNote(raw || {});
      if (!n.word || !n.meaning) { skipped++; continue; }
      const k = plainOf(n.word) + '|' + n.reading;
      if (seen.has(k)) { skipped++; continue; }
      seen.add(k); addNote(deck.id, n); added++;
    }
  }
  save();
  return { added, skipped, names: [...names] };
}
function importText(text, nameOverride) {
  try {
    const objs = parseLoose(text);
    if (objs.length === 1 && objs[0].notes && objs[0].settings) return restoreBackup(objs[0]);
    const r = importDeckObjects(objs, nameOverride);
    toast(`${r.names.join(', ')}에 ${r.added}개 추가${r.skipped ? ` (중복·빈 항목 ${r.skipped}개 건너뜀)` : ''}`);
    view = 'decks'; render();
  } catch (e) {
    toast(e.message === 'backup' ? '백업 파일은 설정 → 백업 불러오기에서 열어주세요.' : '읽지 못했어요: ' + e.message);
  }
}
function restoreBackup(obj) {
  if (!confirm('백업으로 지금 데이터를 모두 바꿀까요? 현재 학습 기록은 사라져요.')) return;
  S = hydrate(obj); save(); toast('백업을 불러왔어요'); view = 'home'; render();
}

// ---------- 내보내기 ----------
async function shareFile(name, text, fallbackMsg) {
  const file = new File([text], name, { type: 'application/json' });
  try {
    if (navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: name }); return; }
  } catch (e) { if (e.name === 'AbortError') return; }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file); a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
  if (fallbackMsg) toast(fallbackMsg);
}
function exportDeck(id) {
  const d = S.decks[id];
  const cards = notesOf(id).map((n) => { const o = {}; for (const k of NOTE_FIELDS) if (n[k]) o[k] = n[k]; return o; });
  const json = JSON.stringify({ format: 'tango-deck-v1', deck: d.name, cards }, null, 2);
  shareFile(`${d.name.replace(/[\\/:*?"<>|]/g, '_')}.json`, json, '덱 파일을 저장했어요');
}
function exportBackup() {
  shareFile(`tango-backup-${dayKey()}.json`, JSON.stringify(S), '백업 파일을 저장했어요');
  S.settings.lastBackup = Date.now(); save();
}

// ---------- 설정 ----------
function renderSettings() {
  showTabs(true, 'settings');
  const st = S.settings;
  const lb = st.lastBackup ? new Date(st.lastBackup).toLocaleDateString('ko-KR') : '없음';
  $('#app').innerHTML = `<header class="top"><h1>설정</h1></header>
    <section class="panel"><h3>하루 새 단어</h3>
      <div class="stepper"><button data-act="npd" data-d="-5">−</button><b>${st.newPerDay}</b><button data-act="npd" data-d="5">＋</button></div>
      <p class="muted">더 하고 싶은 날은 홈에서 +10 / +20 / +50 으로 그날만 늘릴 수 있어요.</p></section>
    <section class="panel"><h3>카드 공부 방향</h3>
      ${Object.entries(DIRS).map(([k, v]) => `<label class="check"><input type="checkbox" data-change="dir" data-dir="${k}" ${st.dirs[k] ? 'checked' : ''}> ${v}<span class="muted">${{ hk: '히라가나 보고 뜻', jk: '한자 보고 뜻', kj: '뜻 보고 단어', sj: '예문 속 단어 뜻' }[k]}</span></label>`).join('')}
      <p class="muted">방향마다 기억 기록이 따로 쌓여요. 타이핑은 항상 한→일이에요.</p></section>
    <section class="panel"><h3>후리가나 · 한글 발음</h3>
      <label class="check"><input type="checkbox" data-change="furi" ${st.furigana ? 'checked' : ''}> 앞면에 후리가나 보이기</label>
      <label class="check"><input type="checkbox" data-change="pron" ${st.pron ? 'checked' : ''}> 한글 발음 보이기 <span class="muted">센슈-</span></label>
      <p class="muted">공부 중에도 오른쪽 위 あ / 가 버튼으로 따로 켜고 끌 수 있어요.</p></section>
    <section class="panel"><h3>백업</h3>
      <p class="muted">학습 기록은 이 폰에만 있어요. 가끔 백업해서 파일 앱이나 iCloud에 보관하세요. 마지막 백업: ${lb}</p>
      <div class="row"><button data-act="backup">백업 내보내기</button><button data-act="pick-file" data-kind="backup">백업 불러오기</button></div></section>
    <section class="panel"><h3>초기화</h3><button class="danger" data-act="wipe">모든 데이터 지우기</button></section>
    <p class="muted center">単語 · 오프라인 개인 단어장 · 복습 알고리즘 FSRS</p>`;
}

// ---------- 단어 편집 ----------
function openModal(html) { const m = $('#modal'); m.innerHTML = `<div class="sheet">${html}</div>`; m.hidden = false; }
function closeModal() { $('#modal').hidden = true; $('#modal').innerHTML = ''; }
function wordForm(n, deckId) {
  const f = (k, label, ph = '', ja = false, area = false) => `<label><span>${label}</span>${area
    ? `<textarea name="${k}" rows="2" ${ja ? 'lang="ja"' : ''} placeholder="${esc(ph)}">${esc(n?.[k])}</textarea>`
    : `<input name="${k}" ${ja ? 'lang="ja"' : ''} placeholder="${esc(ph)}" value="${esc(n?.[k])}">`}</label>`;
  const decks = Object.values(S.decks);
  const deckField = n ? '' : `<label><span>단어장</span><select name="deck">${decks.map((d) => `<option value="${d.id}" ${d.id === deckId ? 'selected' : ''}>${esc(d.name)}</option>`).join('')}<option value="__new">＋ 새 단어장…</option></select></label>`;
  return `<form data-submit="save-word" data-id="${n?.id || ''}"><h3>${n ? '단어 수정' : '단어 추가'}</h3>${deckField}
    ${f('word', '단어 *', '先週', true)}${f('reading', '읽기', 'せんしゅう', true)}${f('meaning', '뜻 *', '지난주')}${f('pos', '품사', '명사')}
    ${f('sentence', '예문', '今日[きょう]は… (한자[읽기])', true, true)}${f('sentence_ko', '예문 뜻', '', false, true)}
    <div class="row"><button type="button" data-act="close">취소</button><button class="primary" type="submit">저장</button></div>
    ${n ? `<div class="row"><button type="button" class="chip" data-act="reset-word" data-id="${n.id}">진도 초기화</button><button type="button" class="chip danger" data-act="del-word" data-id="${n.id}">삭제</button></div>` : ''}</form>`;
}

// ---------- 이벤트 ----------
const actions = {
  tab: (el) => { view = el.dataset.tab; render(); },
  go: (el) => { view = el.dataset.view; render(); },
  home: () => { view = 'home'; render(); },
  study: (el) => startStudy(el.dataset.mode),
  flip: () => { session.flipped = true; renderStudy(); },
  giveup: () => { session.typed = { ok: false, input: '' }; session.flipped = true; renderStudy(); },
  grade: (el) => {
    const c = session.card; if (!c) return;
    grade(c, Number(el.dataset.g));
    session.card = nextCard(session.mode, c.id); session.flipped = false; session.typed = null;
    renderStudy();
  },
  undo: () => undo(),
  furi: () => { S.settings.furigana = !S.settings.furigana; save(); setFuriClass(); $('.furi-btn')?.classList.toggle('on', S.settings.furigana); },
  pron: () => { S.settings.pron = !S.settings.pron; save(); setFuriClass(); $('.pron-btn')?.classList.toggle('on', S.settings.pron); },
  more: (el) => {
    S.daily.extra += Number(el.dataset.n); save();
    if (el.dataset.cont) { session.card = nextCard(session.mode); session.flipped = false; renderStudy(); } else render();
    toast(`오늘 새 단어 +${el.dataset.n}`);
  },
  cram: () => startCram(),
  'cram-flip': () => { cram.flipped = true; renderCram(); },
  'cram-grade': (el) => {
    const id = cram.queue.shift();
    if (el.dataset.ok !== '1') cram.queue.splice(Math.min(cram.queue.length, 3), 0, id);
    cram.flipped = false; renderCram();
  },
  words: (el) => { wordsDeck = el.dataset.id; wordsQuery = ''; view = 'words'; render(); },
  'share-deck': (el) => exportDeck(el.dataset.id),
  'rename-deck': (el) => {
    const d = S.decks[el.dataset.id]; const name = prompt('단어장 이름', d.name);
    if (name && name.trim()) { d.name = name.trim(); save(); render(); }
  },
  'del-deck': (el) => {
    const d = S.decks[el.dataset.id];
    if (!confirm(`「${d.name}」 단어장과 학습 기록을 지울까요?`)) return;
    for (const n of notesOf(d.id)) deleteNote(n.id);
    delete S.decks[d.id]; if (S.settings.deck === d.id) S.settings.deck = 'all';
    save(); render();
  },
  'add-word': () => openModal(wordForm(null, S.settings.deck !== 'all' ? S.settings.deck : Object.keys(S.decks)[0])),
  'edit-word': (el) => openModal(wordForm(S.notes[el.dataset.id])),
  'del-word': (el) => { if (confirm('이 단어를 지울까요?')) { deleteNote(el.dataset.id); save(); closeModal(); render(); } },
  'reset-word': (el) => { resetNote(S.notes[el.dataset.id]); save(); closeModal(); render(); toast('새 단어로 되돌렸어요'); },
  close: () => closeModal(),
  'copy-prompt': async () => {
    try { await navigator.clipboard.writeText(GPT_PROMPT); toast('프롬프트를 복사했어요'); }
    catch (e) { toast('복사하지 못했어요. 프롬프트 보기에서 직접 복사해 주세요.'); }
  },
  'do-import': () => importText($('#paste').value, $('#deckname').value.trim()),
  'pick-file': (el) => { const f = $('#file'); f.dataset.kind = el.dataset.kind; f.value = ''; f.click(); },
  backup: () => exportBackup(),
  npd: (el) => { S.settings.newPerDay = Math.max(0, Math.min(500, S.settings.newPerDay + Number(el.dataset.d))); save(); render(); },
  wipe: () => { if (confirm('정말 모든 단어와 기록을 지울까요?') && confirm('되돌릴 수 없어요. 지울까요?')) { S = defaults(); save(); view = 'home'; render(); } },
};

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (el && !el.disabled) { e.preventDefault(); actions[el.dataset.act]?.(el, e); return; }
  if (e.target.id === 'modal') closeModal();
});
document.addEventListener('change', (e) => {
  const el = e.target, k = el.dataset.change;
  if (k === 'deck') { S.settings.deck = el.value; save(); render(); }
  if (k === 'dir') { S.settings.dirs[el.dataset.dir] = el.checked; save(); }
  if (k === 'furi') { S.settings.furigana = el.checked; save(); setFuriClass(); }
  if (k === 'pron') { S.settings.pron = el.checked; save(); setFuriClass(); }
});
document.addEventListener('input', (e) => {
  if (e.target.dataset.input === 'q') {
    wordsQuery = e.target.value; $('#wordlist').innerHTML = wordsListHTML();
  }
});
document.addEventListener('submit', (e) => {
  e.preventDefault();
  const form = e.target, k = form.dataset.submit;
  if (k === 'check') {
    const n = S.notes[session.card.noteId], input = $('#answer').value;
    session.typed = { ok: checkTyped(n, input), input }; session.flipped = true; renderStudy();
  }
  if (k === 'save-word') {
    const data = Object.fromEntries(new FormData(form));
    if (!data.word?.trim() || !data.meaning?.trim()) { toast('단어와 뜻은 꼭 넣어주세요'); return; }
    if (form.dataset.id) {
      Object.assign(S.notes[form.dataset.id], cleanNote(data));
    } else {
      let deckId = data.deck;
      if (!deckId || deckId === '__new') { const name = prompt('새 단어장 이름', '내 단어장'); if (!name) return; deckId = ensureDeck(name).id; }
      addNote(deckId, data); toast('추가했어요');
      save(); form.reset(); form.querySelector('select[name=deck]').value = deckId; form.querySelector('[name=word]').focus();
      return;
    }
    save(); closeModal(); render();
  }
});
$('#file').addEventListener('change', async (e) => {
  const f = e.target.files[0]; if (!f) return;
  const text = await f.text();
  if (e.target.dataset.kind === 'backup') {
    try { const o = JSON.parse(text); if (!o.notes || !o.settings) throw 0; restoreBackup(o); }
    catch (err) { toast('백업 파일이 아니에요'); }
  } else importText(text, '');
});
document.addEventListener('keydown', (e) => {
  if (view !== 'study' && view !== 'cram') return;
  if (e.target.matches('input, textarea')) return;
  if (view === 'cram') {
    if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); cram.flipped ? actions['cram-grade']({ dataset: { ok: '1' } }) : actions['cram-flip'](); }
    return;
  }
  if (!session.card) return;
  if (!session.flipped && (e.key === ' ' || e.key === 'Enter')) { e.preventDefault(); actions.flip(); return; }
  if (session.flipped) {
    const map = { 1: Rating.Again, 2: Rating.Hard, 3: Rating.Good };
    let g = map[e.key];
    if (e.key === 'Enter' || e.key === ' ') g = session.mode === 'type' && !session.typed?.ok ? Rating.Again : Rating.Good;
    if (g) { e.preventDefault(); actions.grade({ dataset: { g } }); }
  }
  if (e.key === 'z' && (e.metaKey || e.ctrlKey)) undo();
});

let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { t.hidden = true; }, 2600);
}

// ---------- 시작 ----------
load();
render();
document.addEventListener('visibilitychange', () => { if (!document.hidden && view === 'home') render(); });
if (navigator.storage?.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
