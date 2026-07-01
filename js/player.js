// Responsibility: player game flow — joining, answering, displaying feedback/results,
// peer networking with auto-reconnect, and DOM wiring.

import { PEER_OPTIONS }                         from './peer-config.js';
import { startTimer }                           from './timer.js';
import { SHAPES, showScreen, buildLeaderboard } from './ui.js';

const state = {
  myName:           '',
  myScore:          0,
  hasAnswered:      false,
  timer:            null,    // { stop }
  timeLeft:         0,
  hostConn:         null,
  peerInst:         null,
  connectedPin:     null,
  reconnectTimeout: null,
};

// ── UI helpers ────────────────────────────────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('error-msg');
  el.textContent = msg;
  el.classList.add('visible');
}

function showOverlay(show) {
  document.getElementById('overlay-disconnected').style.display = show ? 'flex' : 'none';
}

function updateTimerUI(timeLeft, totalTime) {
  const pct = (timeLeft / totalTime) * 100;
  const bar = document.getElementById('timer-bar');
  if (bar) {
    bar.style.width = pct + '%';
    bar.classList.toggle('urgent', timeLeft <= 5);
  }
}

// ── Network ───────────────────────────────────────────────────────────────────
function scheduleReconnect() {
  clearTimeout(state.reconnectTimeout);
  state.reconnectTimeout = setTimeout(tryReconnect, 3000);
}

function tryReconnect() {
  if (!state.connectedPin) return;
  if (state.peerInst) { try { state.peerInst.destroy(); } catch (e) {} }

  state.peerInst = new window.Peer(undefined, PEER_OPTIONS);

  state.peerInst.on('open', () => {
    state.hostConn = state.peerInst.connect(state.connectedPin);
    state.hostConn.on('open', () => {
      state.hostConn.send({ type: 'rejoin', name: state.myName });
      showOverlay(false);
    });
    state.hostConn.on('data',  data => handleHostMsg(data));
    state.hostConn.on('close', () => { if (state.timer) state.timer.stop(); showOverlay(true); scheduleReconnect(); });
    state.hostConn.on('error', ()   => scheduleReconnect());
  });

  state.peerInst.on('error', () => scheduleReconnect());
}

function doJoin() {
  const pin  = document.getElementById('input-pin').value.trim();
  const name = document.getElementById('input-name').value.trim();
  document.getElementById('error-msg').classList.remove('visible');

  if (!pin)  { showError('Please enter a PIN.');  return; }
  if (!name) { showError('Please enter a name.'); return; }

  state.myName = name;
  const btnJoin = document.getElementById('btn-join');
  btnJoin.disabled    = true;
  btnJoin.textContent = 'Connecting…';

  const joinTimeout = setTimeout(() => {
    btnJoin.disabled    = false;
    btnJoin.textContent = 'Join';
    showError('Timeout. Please try again.');
    if (state.peerInst) { try { state.peerInst.destroy(); } catch (e) {} }
  }, 10000);

  if (state.peerInst) { try { state.peerInst.destroy(); } catch (e) {} }

  state.peerInst = new window.Peer(undefined, PEER_OPTIONS);

  state.peerInst.on('open', () => {
    state.connectedPin = pin;
    state.hostConn     = state.peerInst.connect(pin);

    state.hostConn.on('open', () => {
      clearTimeout(joinTimeout);
      state.hostConn.send({ type: 'join', name: state.myName });
      document.getElementById('wait-name').textContent = state.myName;
      showScreen('screen-wait');
    });

    state.hostConn.on('data', data => handleHostMsg(data));

    state.hostConn.on('close', () => {
      if (state.timer) state.timer.stop();
      showOverlay(true);
      scheduleReconnect();
    });

    state.hostConn.on('error', e => {
      clearTimeout(joinTimeout);
      showError('Connection error: ' + e.message);
      btnJoin.disabled    = false;
      btnJoin.textContent = 'Join';
      showScreen('screen-join');
    });
  });

  state.peerInst.on('error', err => {
    clearTimeout(joinTimeout);
    btnJoin.disabled    = false;
    btnJoin.textContent = 'Join';
    showScreen('screen-join');
    if (err.type === 'peer-unavailable') {
      showError('PIN not found. Please check and try again.');
    } else {
      showError('Error: ' + err.message);
    }
  });
}

// ── Game flow ─────────────────────────────────────────────────────────────────
function handleHostMsg(data) {
  if (data.type === 'question') {
    state.hasAnswered = false;
    showQuestion(data);
  }
  if (data.type === 'reveal') {
    if (state.timer) state.timer.stop();
    showFeedback(data);
  }
  if (data.type === 'top5') {
    if (state.timer) state.timer.stop();
    showTop5(data);
  }
  if (data.type === 'gameover') {
    if (state.timer) state.timer.stop();
    showGameover(data);
  }
}

function showQuestion(data) {
  showScreen('screen-answer');
  const qtype = data.qtype || 'multiple';
  const imgEl = document.getElementById('question-image');
  const screenEl = document.getElementById('screen-answer');
  if (qtype === 'image' && data.image) {
    imgEl.src = data.image;
    imgEl.style.display = 'block';
    screenEl.classList.add('has-image');
  } else {
    imgEl.style.display = 'none';
    imgEl.src = '';
    screenEl.classList.remove('has-image');
  }

  const grid = document.getElementById('answer-grid');
  grid.innerHTML = '';
  data.options.forEach((opt, i) => {
    const btn = document.createElement('button');
    btn.className = 'answer-btn';
    btn.innerHTML = `<span class="shape">${SHAPES[i]}</span><span>${opt}</span>`;
    btn.addEventListener('click', () => sendAnswer(i, btn));
    grid.appendChild(btn);
  });

  if (state.timer) state.timer.stop();
  const startFrom = (data.timeRemaining !== undefined && data.timeRemaining < data.timeLimit)
    ? data.timeRemaining
    : data.timeLimit;
  state.timer = startTimer(startFrom, {
    totalTime: data.timeLimit,
    onTick: (left, total) => { state.timeLeft = left; updateTimerUI(left, total); },
    onEnd:  () => {},
  });
}

function sendAnswer(index, clickedBtn) {
  if (state.hasAnswered) return;
  state.hasAnswered = true;
  if (state.timer) state.timer.stop();

  state.hostConn.send({ type: 'answer', answerIndex: index, timeRemaining: state.timeLeft });

  document.querySelectorAll('.answer-btn').forEach(b => {
    b.disabled = true;
    if (b === clickedBtn) b.classList.add('selected');
    else                  b.classList.add('dimmed');
  });

  document.getElementById('feedback-icon').textContent   = '⏳';
  document.getElementById('feedback-title').textContent  = 'Answer submitted!';
  document.getElementById('feedback-points').textContent = 'Waiting for reveal…';
  document.getElementById('feedback-total').textContent  = '';
  showScreen('screen-feedback');
}

function showFeedback(data) {
  if (!state.hasAnswered) {
    document.getElementById('feedback-icon').textContent   = '⏱️';
    document.getElementById('feedback-title').textContent  = "Time's up!";
    document.getElementById('feedback-points').textContent = '0 points';
    document.getElementById('feedback-total').textContent  = '';
    state.hasAnswered = true;
  } else {
    const me    = (data.leaderboard || []).find(p => p.name === state.myName);
    const delta = me ? me.delta : 0;
    state.myScore = me ? me.score : state.myScore;

    const isCorrect = delta > 0;
    document.getElementById('feedback-icon').textContent   = isCorrect ? '✅' : '❌';
    document.getElementById('feedback-title').textContent  = isCorrect ? 'Correct!' : 'Wrong!';
    document.getElementById('feedback-points').textContent = isCorrect ? `+${delta} points` : '0 points';
    document.getElementById('feedback-total').textContent  = `Total: ${state.myScore} points`;
  }
  showScreen('screen-feedback');
}

function showTop5(data) {
  const lb = data.leaderboard || [];
  buildLeaderboard('top5-leaderboard', lb, 5, { myName: state.myName });
  const me     = lb.find(p => p.name === state.myName);
  const rankEl = document.getElementById('top5-myrank');
  rankEl.textContent = me ? `You: Rank ${me.rank} · ${me.score} pts` : '';
  showScreen('screen-top5');
}

function showGameover(data) {
  const me = (data.leaderboard || []).find(p => p.name === state.myName);
  if (me) state.myScore = me.score;
  document.getElementById('gameover-name').textContent = state.myName;
  document.getElementById('final-score').textContent   = state.myScore + ' points';
  showScreen('screen-gameover');
}

// ── DOM wiring ────────────────────────────────────────────────────────────────
document.getElementById('btn-join').addEventListener('click', doJoin);
document.getElementById('input-pin').addEventListener('keydown',  e => e.key === 'Enter' && doJoin());
document.getElementById('input-name').addEventListener('keydown', e => e.key === 'Enter' && doJoin());

document.querySelector('#screen-gameover .btn').addEventListener('click', () => location.reload());
document.querySelector('#overlay-disconnected .btn').addEventListener('click', () => location.reload());
