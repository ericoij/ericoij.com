const searchInput = document.querySelector('#wiki-search');
const filterButtons = Array.from(document.querySelectorAll('[data-filter]'));
const entries = Array.from(document.querySelectorAll('.entry'));
const resultCount = document.querySelector('#result-count');
const emptyState = document.querySelector('.empty-state');
let activeFilter = 'all';

const updateEntries = () => {
  const query = searchInput.value.trim().toLowerCase();
  let visibleCount = 0;

  entries.forEach((entry) => {
    const categories = entry.dataset.category.split(' ');
    const matchesFilter = activeFilter === 'all' || categories.includes(activeFilter);
    const matchesSearch = !query || entry.dataset.search.includes(query) || entry.textContent.toLowerCase().includes(query);
    const isVisible = matchesFilter && matchesSearch;
    entry.hidden = !isVisible;
    if (isVisible) visibleCount += 1;
  });

  resultCount.textContent = visibleCount;
  emptyState.hidden = visibleCount !== 0;
};

filterButtons.forEach((button) => {
  button.addEventListener('click', () => {
    activeFilter = button.dataset.filter;
    filterButtons.forEach((item) => item.classList.toggle('active', item === button));
    updateEntries();
  });
});

searchInput.addEventListener('input', updateEntries);
document.addEventListener('keydown', (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    searchInput.focus();
  }
});
