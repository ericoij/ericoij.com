const year = document.getElementById('year');
if (year) {
  year.textContent = new Date().getFullYear();
}

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const sections = document.querySelectorAll('.reveal');

if (reducedMotion || !('IntersectionObserver' in window)) {
  sections.forEach((section) => section.classList.add('visible'));
} else {
  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12 }
  );

  sections.forEach((section) => observer.observe(section));
}

const galleryItems = Array.from(
  document.querySelectorAll('.photo-tile, .painting-tile, .infographic-tile')
);

if (galleryItems.length) {
  const dialog = document.createElement('dialog');
  dialog.className = 'gallery-viewer';
  dialog.setAttribute('aria-label', 'Gallery image viewer');
  dialog.innerHTML = `
    <div class="gallery-viewer__frame">
      <button class="gallery-viewer__close" type="button" aria-label="Close image viewer">&times;</button>
      <button class="gallery-viewer__previous" type="button" aria-label="Previous image">&larr;</button>
      <figure class="gallery-viewer__figure">
        <img class="gallery-viewer__image" alt="" />
        <figcaption class="gallery-viewer__caption">
          <span class="gallery-viewer__title"></span>
          <span class="gallery-viewer__count"></span>
        </figcaption>
      </figure>
      <button class="gallery-viewer__next" type="button" aria-label="Next image">&rarr;</button>
    </div>
  `;
  document.body.append(dialog);

  const viewerImage = dialog.querySelector('.gallery-viewer__image');
  const viewerTitle = dialog.querySelector('.gallery-viewer__title');
  const viewerCount = dialog.querySelector('.gallery-viewer__count');
  const previousButton = dialog.querySelector('.gallery-viewer__previous');
  const nextButton = dialog.querySelector('.gallery-viewer__next');
  let activeIndex = 0;
  let touchStartX = null;

  const getTitle = (item) => {
    const caption = item.querySelector('figcaption');
    const strong = caption?.querySelector('strong');
    if (strong) return strong.textContent.trim();

    if (!caption) return '';
    const clone = caption.cloneNode(true);
    clone.querySelectorAll('span, small').forEach((element) => element.remove());
    return clone.textContent.trim();
  };

  const showItem = (index) => {
    activeIndex = (index + galleryItems.length) % galleryItems.length;
    const item = galleryItems[activeIndex];
    const image = item.querySelector('img');

    viewerImage.src = image.currentSrc || image.src;
    viewerImage.alt = image.alt;
    viewerTitle.textContent = getTitle(item);
    viewerCount.textContent = `${activeIndex + 1} / ${galleryItems.length}`;
    previousButton.hidden = galleryItems.length < 2;
    nextButton.hidden = galleryItems.length < 2;
  };

  const openItem = (index) => {
    showItem(index);
    dialog.showModal();
  };

  galleryItems.forEach((item, index) => {
    item.classList.add('gallery-item');

    if (item.tagName === 'A') {
      item.removeAttribute('target');
      item.setAttribute('aria-label', `Open ${getTitle(item)} in image viewer`);
      item.addEventListener('click', (event) => {
        event.preventDefault();
        openItem(index);
      });
    } else {
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-label', `Open ${getTitle(item)} in image viewer`);
      item.addEventListener('click', () => openItem(index));
      item.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          openItem(index);
        }
      });
    }
  });

  dialog.querySelector('.gallery-viewer__close').addEventListener('click', () => dialog.close());
  previousButton.addEventListener('click', () => showItem(activeIndex - 1));
  nextButton.addEventListener('click', () => showItem(activeIndex + 1));

  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });

  dialog.addEventListener('keydown', (event) => {
    if (event.key === 'ArrowLeft') showItem(activeIndex - 1);
    if (event.key === 'ArrowRight') showItem(activeIndex + 1);
  });

  dialog.addEventListener('touchstart', (event) => {
    touchStartX = event.changedTouches[0].clientX;
  }, { passive: true });

  dialog.addEventListener('touchend', (event) => {
    if (touchStartX === null) return;
    const distance = event.changedTouches[0].clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(distance) < 50) return;
    showItem(activeIndex + (distance < 0 ? 1 : -1));
  }, { passive: true });
}
