const sourceEl = document.getElementById('source');
const modelEl = document.getElementById('model');
const statusMessage = document.getElementById('statusMessage');
const statusNumbers = document.getElementById('statusNumbers');
const statusError = document.getElementById('statusError');
const progressBar = document.getElementById('progressBar');
const scanButton = document.getElementById('scanButton');
const curateButton = document.getElementById('curateButton');
const scanLimit = document.getElementById('scanLimit');
const curateLimit = document.getElementById('curateLimit');
const searchInput = document.getElementById('searchInput');
const grid = document.getElementById('grid');
const emptyState = document.getElementById('emptyState');
const emptyTitle = document.getElementById('emptyTitle');
const emptyMessage = document.getElementById('emptyMessage');
const itemCount = document.getElementById('itemCount');
const template = document.getElementById('cardTemplate');
let activeFilter = 'all';
let items = [];

async function api(url, options) {
  const response = await fetch(url, options);
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `Request failed: ${response.status}`);
  return body;
}

function searchableText(item) {
  const analysis = item.analysis || {};
  let capturedYear = '';
  if (item.capturedAt) {
    const date = new Date(item.capturedAt);
    if (!Number.isNaN(date.valueOf())) capturedYear = String(date.getFullYear());
  }
  return [
    item.relativePath,
    item.type,
    item.capturedAt,
    capturedYear,
    item.decision,
    analysis.title,
    analysis.reason,
    analysis.category,
    analysis.privacy_risk,
    ...(analysis.tags || [])
  ].filter(Boolean).join(' ').toLowerCase();
}

function filterItems() {
  let result = items;
  if (activeFilter === 'recommended') result = result.filter((item) => item.analysis?.recommended);
  else if (['love', 'maybe', 'no', 'unreviewed'].includes(activeFilter)) result = result.filter((item) => item.decision === activeFilter);

  const terms = searchInput.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length) {
    result = result.filter((item) => {
      const haystack = searchableText(item);
      return terms.every((term) => haystack.includes(term));
    });
  }
  return result;
}

async function saveDecision(id, decision) {
  await api(`/api/items/${id}/decision`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ decision })
  });
  const item = items.find((candidate) => candidate.id === id);
  item.decision = decision;
  render();
}

function render() {
  const visible = filterItems();
  itemCount.textContent = `${visible.length} of ${items.length}`;
  grid.replaceChildren();

  if (items.length === 0) {
    emptyTitle.textContent = 'Your shortlist starts here.';
    emptyMessage.textContent = 'Scan the iPhone library to build your private searchable catalog.';
  } else if (visible.length === 0) {
    emptyTitle.textContent = 'No photos match.';
    emptyMessage.textContent = 'Try a filename, year, AI title, category, tag, or a broader search.';
  }
  emptyState.hidden = visible.length > 0;
  grid.hidden = visible.length === 0;

  for (const item of visible) {
    const card = template.content.cloneNode(true);
    const article = card.querySelector('.media-card');
    const image = card.querySelector('img');
    image.src = `/thumbs/${item.id}.jpg`;
    image.alt = item.analysis?.title || item.relativePath;
    card.querySelector('.score').textContent = item.analysis ? `${item.analysis.share_score} share` : `${item.technicalScore} tech`;
    card.querySelector('.media-type').textContent = item.type;
    card.querySelector('.category').textContent = item.analysis?.category || 'Awaiting AI';
    const risk = card.querySelector('.privacy-risk');
    risk.textContent = item.analysis ? `${item.analysis.privacy_risk} privacy risk` : '';
    card.querySelector('h2').textContent = item.analysis?.title || 'Not evaluated yet';
    card.querySelector('.reason').textContent = item.analysis?.reason || 'Technical scan complete. Run the local curator for a visual judgment.';
    card.querySelector('.filename').textContent = item.relativePath;
    for (const button of card.querySelectorAll('[data-decision]')) {
      button.classList.toggle('selected', button.dataset.decision === item.decision);
      button.addEventListener('click', () => saveDecision(item.id, button.dataset.decision));
    }
    article.dataset.id = item.id;
    grid.appendChild(card);
  }
}

async function refreshItems() {
  items = await api('/api/items');
  render();
}

async function refreshStatus() {
  try {
    const status = await api('/api/status');
    sourceEl.textContent = status.source;
    modelEl.textContent = `Vision model: ${status.model} · ${status.count} cached items`;
    statusMessage.textContent = status.message;
    statusNumbers.textContent = status.total ? `${status.completed} / ${status.total}` : '';
    statusError.textContent = status.error || '';
    progressBar.style.width = status.total ? `${Math.round(status.completed / status.total * 100)}%` : '0%';
    scanButton.disabled = Boolean(status.task);
    curateButton.disabled = Boolean(status.task) || status.count === 0;
    if (!status.task && Number(modelEl.dataset.lastCount || -1) !== status.count) {
      modelEl.dataset.lastCount = status.count;
      await refreshItems();
    }
  } catch (error) {
    statusError.textContent = error.message;
  }
}

scanButton.addEventListener('click', async () => {
  try {
    await api('/api/scan', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: scanLimit.value ? Number(scanLimit.value) : null })
    });
    await refreshStatus();
  } catch (error) { statusError.textContent = error.message; }
});

curateButton.addEventListener('click', async () => {
  try {
    await api('/api/curate', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ limit: Number(curateLimit.value) || 25 })
    });
    await refreshStatus();
  } catch (error) { statusError.textContent = error.message; }
});

searchInput.addEventListener('input', render);

for (const button of document.querySelectorAll('.filter')) {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    document.querySelector('.filter.active')?.classList.remove('active');
    button.classList.add('active');
    render();
  });
}

refreshStatus();
refreshItems();
setInterval(refreshStatus, 1000);
