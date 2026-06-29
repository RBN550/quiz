// Responsibility: shared UI helpers used by both host and player.

export const SHAPES = ['▲', '◆', '●', '■'];

export function showScreen(id) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  document.getElementById(id).classList.add('active');
}

// Options:
//   myName    {string}  – highlights the row whose name matches (player view)
//   showDelta {boolean} – shows green +pts delta (host view)
export function buildLeaderboard(containerId, lb, limit = 8, { myName, showDelta } = {}) {
  const el = document.getElementById(containerId);
  if (!el) return;
  el.innerHTML = '';
  lb.slice(0, limit).forEach((entry, i) => {
    const row = document.createElement('div');
    row.className = 'lb-row' + (myName && entry.name === myName ? ' highlight' : '');
    row.style.animationDelay = `${i * 80}ms`;
    const medal = entry.rank === 1 ? '🥇' : entry.rank === 2 ? '🥈' : entry.rank === 3 ? '🥉' : entry.rank + '.';
    const deltaHtml = showDelta && entry.delta > 0
      ? ` <span style="color:#4ade80;font-size:.85em;margin-left:4px">+${entry.delta}</span>`
      : '';
    row.innerHTML = `<span class="rank">${medal}</span><span class="lb-name">${entry.name}</span>${deltaHtml}<span class="lb-score">${entry.score} pts</span>`;
    el.appendChild(row);
  });
}
