// Responsibility: host game orchestration — peer networking, player management,
// game flow (questions → reveal → top5 → gameover), and DOM wiring.

import { PEER_OPTIONS }                              from './peer-config.js';
import { ALL_QUESTIONS, YES_NO_QUESTIONS,
         IMAGE_QUESTIONS, ESTIMATION_QUESTIONS,
         shuffle }                                   from './questions.js';
import { startTimer }                                from './timer.js';
import { SHAPES, showScreen, buildLeaderboard }      from './ui.js';

const MAX_PTS = 1000;
const MIN_PTS = 100;

const state = {
  peer:         null,
  players:      new Map(),   // peerId → { conn, name, score, correct, answered, lastAnswer, lastTimeLeft, lastDelta, lastEstimate }
  questions:    [],
  qIndex:       0,
  timer:        null,        // { stop }
  revealed:     false,
  savedScores:  new Map(),   // name → { score, correct }
};

// ── Leaderboard ───────────────────────────────────────────────────────────────
function getLeaderboard() {
  return [...state.players.values()]
    .sort((a, b) => b.score - a.score)
    .map((p, i) => ({ rank: i + 1, name: p.name, score: p.score, correct: p.correct, delta: p.lastDelta }));
}

// ── Player list UI ────────────────────────────────────────────────────────────
function updatePlayerList() {
  const list = document.getElementById('player-list');
  list.innerHTML = '';
  if (state.players.size === 0) {
    list.innerHTML = '<span style="opacity:.5">Waiting for players…</span>';
  } else {
    state.players.forEach(p => {
      const chip = document.createElement('span');
      chip.className = 'player-chip';
      chip.textContent = p.name;
      list.appendChild(chip);
    });
  }
  document.getElementById('btn-start').disabled = state.players.size === 0;
}

function updateAnswerCounter() {
  const answered = [...state.players.values()].filter(p => p.answered).length;
  document.getElementById('answer-counter').textContent = `${answered} / ${state.players.size} answered`;
}

// ── Timer UI ──────────────────────────────────────────────────────────────────
function updateTimerUI(timeLeft, totalTime) {
  const pct = (timeLeft / totalTime) * 100;
  const bar = document.getElementById('timer-bar');
  bar.style.width = pct + '%';
  bar.classList.toggle('urgent', timeLeft <= 5);
  document.getElementById('timer-display').textContent = timeLeft + 's';
}

// ── Network ───────────────────────────────────────────────────────────────────
function broadcast(data) {
  state.players.forEach(p => { try { p.conn.send(data); } catch (e) {} });
}

function handlePlayerMsg(conn, data) {
  if (data.type === 'join' || data.type === 'rejoin') {
    const saved = state.savedScores.get(data.name);
    state.players.set(conn.peer, {
      conn, name: data.name,
      score:    saved ? saved.score   : 0,
      correct:  saved ? saved.correct : 0,
      answered: false, lastAnswer: -1, lastTimeLeft: 0, lastDelta: 0, lastEstimate: null,
    });
    updatePlayerList();
  }
  if (data.type === 'answer') {
    const p = state.players.get(conn.peer);
    if (!p || p.answered || state.revealed) return;
    p.answered     = true;
    p.lastTimeLeft = data.timeRemaining;
    if (data.estimate !== undefined) {
      p.lastEstimate = data.estimate;
      p.lastAnswer   = -1;
    } else {
      p.lastAnswer   = data.answerIndex;
      p.lastEstimate = null;
    }
    updateAnswerCounter();
    const answered = [...state.players.values()].filter(x => x.answered).length;
    if (answered >= state.players.size) revealAnswer();
  }
}

function initPeer() {
  const pin = localStorage.getItem('quiz-host-pin');
  state.peer = new window.Peer(pin, PEER_OPTIONS);

  state.peer.on('open', () => console.log('Host bereit, PIN:', pin));

  state.peer.on('connection', conn => {
    conn.on('open', () => {
      conn.on('data',  data => handlePlayerMsg(conn, data));
      conn.on('close', () => { state.players.delete(conn.peer); updatePlayerList(); });
    });
  });

  state.peer.on('error', err => {
    console.error(err);
    if (err.type === 'unavailable-id') setTimeout(initPeer, 4000);
  });
}

// ── Game state persistence ────────────────────────────────────────────────────
function saveGameState() {
  localStorage.setItem('quiz-game-state', JSON.stringify({
    ts: Date.now(),
    questions: state.questions,
    nextQIndex: state.qIndex + 1,
    playerScores: [...state.players.values()].map(p => ({ name: p.name, score: p.score, correct: p.correct })),
  }));
}

function clearGameState() {
  localStorage.removeItem('quiz-game-state');
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function showCurrentQuestion() {
  state.revealed = false;
  const q     = state.questions[state.qIndex];
  const qtype = q.type || 'multiple';
  state.players.forEach(p => { p.answered = false; p.lastAnswer = -1; p.lastDelta = 0; p.lastEstimate = null; });

  showScreen('screen-question');
  document.getElementById('q-counter').textContent      = `Question ${state.qIndex + 1} / ${state.questions.length}`;
  document.getElementById('question-text').textContent  = q.question;
  document.getElementById('answer-counter').textContent = `0 / ${state.players.size} answered`;

  const imgEl = document.getElementById('question-image');
  if (qtype === 'image' && q.image) { imgEl.src = q.image; imgEl.style.display = 'block'; }
  else { imgEl.style.display = 'none'; imgEl.src = ''; }

  const grid = document.getElementById('answer-grid');
  grid.innerHTML = '';
  if (qtype === 'estimate') {
    const info = document.createElement('div');
    info.style.cssText = 'grid-column:1/-1;background:rgba(255,255,255,.15);border-radius:12px;padding:28px;text-align:center;font-size:1.3rem;font-weight:700';
    info.textContent = '🔢 Players are typing their estimates…';
    grid.appendChild(info);
  } else {
    (q.options || []).forEach((opt, i) => {
      const btn = document.createElement('div');
      btn.className = 'answer-btn';
      btn.innerHTML = `<span class="shape">${SHAPES[i]}</span>${opt}`;
      grid.appendChild(btn);
    });
  }

  broadcast({ type: 'question', index: state.qIndex, total: state.questions.length,
               question: q.question, options: q.options || [], timeLimit: q.timeLimit,
               qtype, image: q.image || null });

  if (state.timer) state.timer.stop();
  state.timer = startTimer(q.timeLimit, {
    onTick: (left, total) => updateTimerUI(left, total),
    onEnd:  () => revealAnswer(),
  });
}

function revealAnswer() {
  if (state.revealed) return;
  state.revealed = true;
  if (state.timer) state.timer.stop();

  const q     = state.questions[state.qIndex];
  const qtype = q.type || 'multiple';
  state.players.forEach(p => {
    if (!p.answered) { p.lastDelta = 0; return; }
    if (qtype === 'estimate') {
      if (p.lastEstimate === null || p.lastEstimate === undefined) {
        p.lastDelta = 0;
      } else {
        const diff = Math.abs(p.lastEstimate - q.correctAnswer);
        const [b0, b1, b2] = q.brackets || [0, 0, 0];
        let mult = 0;
        if      (diff <= b0) mult = 1.00;
        else if (diff <= b1) mult = 0.50;
        else if (diff <= b2) mult = 0.25;
        if (mult > 0) {
          const timePts = Math.max(MIN_PTS, Math.round(MAX_PTS * (p.lastTimeLeft / q.timeLimit)));
          const pts     = Math.round(timePts * mult);
          p.score  += pts;
          p.correct++;
          p.lastDelta = pts;
        } else {
          p.lastDelta = 0;
        }
      }
    } else {
      if (p.lastAnswer === q.correctIndex) {
        const pts = Math.max(MIN_PTS, Math.round(MAX_PTS * (p.lastTimeLeft / q.timeLimit)));
        p.score  += pts;
        p.correct++;
        p.lastDelta = pts;
      } else {
        p.lastDelta = 0;
      }
    }
  });

  const lb = getLeaderboard();
  broadcast({ type: 'reveal', correctIndex: q.correctIndex, correctAnswer: q.correctAnswer,
               unit: q.unit || '', qtype, explanation: q.explanation, leaderboard: lb });

  showScreen('screen-result');
  const resultImgEl = document.getElementById('result-image');
  if (qtype === 'image' && q.image) { resultImgEl.src = q.image; resultImgEl.style.display = 'block'; }
  else { resultImgEl.style.display = 'none'; resultImgEl.src = ''; }

  const resultGrid = document.getElementById('result-grid');
  resultGrid.innerHTML = '';
  if (qtype === 'estimate') {
    const correctDiv = document.createElement('div');
    correctDiv.style.cssText = 'grid-column:1/-1;background:rgba(38,137,12,.4);border-radius:12px;padding:20px;text-align:center;font-size:1.8rem;font-weight:900';
    correctDiv.textContent = `✅ ${q.correctAnswer.toLocaleString()}${q.unit ? ' ' + q.unit : ''}`;
    resultGrid.appendChild(correctDiv);
    const guesses = [...state.players.values()]
      .filter(p => p.lastEstimate !== null && p.lastEstimate !== undefined)
      .sort((a, b) => b.lastDelta - a.lastDelta || Math.abs(a.lastEstimate - q.correctAnswer) - Math.abs(b.lastEstimate - q.correctAnswer));
    if (guesses.length > 0) {
      const guessWrap = document.createElement('div');
      guessWrap.style.cssText = 'grid-column:1/-1;display:flex;flex-direction:column;gap:6px;max-height:200px;overflow-y:auto';
      guesses.forEach(g => {
        const diff = Math.abs(g.lastEstimate - q.correctAnswer);
        const icon = g.lastDelta > 0 ? '🎯' : '❌';
        const row  = document.createElement('div');
        row.style.cssText = 'display:flex;justify-content:space-between;background:rgba(255,255,255,.1);border-radius:8px;padding:8px 14px;font-size:.95rem';
        row.innerHTML = `<span>${g.name}</span><span>${g.lastEstimate.toLocaleString()} <span style="opacity:.6;font-size:.85em">(${diff > 0 ? '+/−' + diff.toLocaleString() : 'exact'})</span> ${icon}</span>`;
        guessWrap.appendChild(row);
      });
      resultGrid.appendChild(guessWrap);
    }
  } else {
    (q.options || []).forEach((opt, i) => {
      const div = document.createElement('div');
      div.className = `answer-btn ${i === q.correctIndex ? 'correct' : 'wrong'}`;
      div.innerHTML = `<span class="shape">${SHAPES[i]}</span>${opt}`;
      resultGrid.appendChild(div);
    });
  }

  const isLast       = state.qIndex >= state.questions.length - 1;
  const isTop5Moment = !isLast && (state.qIndex + 1) % 5 === 0;
  if (isLast) { clearGameState(); } else { saveGameState(); }

  document.getElementById('result-title').textContent = isLast ? 'Last Question – Final Standings' : 'Standings';
  buildLeaderboard('leaderboard', lb, 8, { showDelta: true });

  const nextBtn = document.getElementById('btn-next');
  nextBtn.textContent = isLast ? 'Show final standings' : (isTop5Moment ? '🏅 Show Top 5' : 'Next question');
  nextBtn.onclick     = isLast ? showFinalResults : (isTop5Moment ? showTop5 : () => { state.qIndex++; showCurrentQuestion(); });
}

function showTop5() {
  const lb = getLeaderboard();
  broadcast({ type: 'top5', leaderboard: lb });
  showScreen('screen-top5');
  buildLeaderboard('top5-leaderboard', lb, 5);
  document.getElementById('btn-top5-next').onclick = () => { state.qIndex++; showCurrentQuestion(); };
}

function showFinalResults() {
  const lb = getLeaderboard();
  broadcast({ type: 'gameover', leaderboard: lb });
  showScreen('screen-gameover');
  buildLeaderboard('final-leaderboard', lb);
}

// ── DOM wiring & init ─────────────────────────────────────────────────────────
document.getElementById('btn-start').addEventListener('click', () => {
  clearGameState();
  state.savedScores = new Map();
  const multipleQs  = shuffle(ALL_QUESTIONS).slice(0, 10);
  const yesnoQs     = shuffle(YES_NO_QUESTIONS).slice(0, 5);
  const imageQs     = shuffle(IMAGE_QUESTIONS).slice(0, 5);
  const estimQs     = shuffle(ESTIMATION_QUESTIONS).slice(0, 5);
  state.questions   = [...multipleQs, ...yesnoQs, ...imageQs, ...estimQs];
  state.qIndex      = 0;
  state.players.forEach(p => { p.score = 0; p.correct = 0; p.lastDelta = 0; });
  showCurrentQuestion();
});

document.getElementById('btn-restart').addEventListener('click', () => {
  localStorage.removeItem('quiz-host-pin');
  localStorage.removeItem('quiz-game-state');
  location.reload();
});

const _savedRaw = localStorage.getItem('quiz-game-state');
if (_savedRaw) {
  try {
    const _saved    = JSON.parse(_savedRaw);
    const AGE_LIMIT = 6 * 60 * 60 * 1000;
    if (!_saved.ts || Date.now() - _saved.ts > AGE_LIMIT) {
      clearGameState();
    } else {
      state.savedScores = new Map(_saved.playerScores.map(p => [p.name, p]));
      const btnResume   = document.getElementById('btn-resume');
      btnResume.style.display = '';
      btnResume.addEventListener('click', () => {
        state.questions = _saved.questions;
        state.qIndex    = _saved.nextQIndex;
        state.players.forEach(p => {
          const s = state.savedScores.get(p.name);
          if (s) { p.score = s.score; p.correct = s.correct; }
        });
        showCurrentQuestion();
      });
    }
  } catch (e) { clearGameState(); }
}

initPeer();
