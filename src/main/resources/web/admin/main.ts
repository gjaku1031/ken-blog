import './style.css';

const root = document.documentElement;
const theme = localStorage.getItem('ken-blog-theme');
if (theme === 'dark' || theme === 'light') root.dataset.theme = theme;

document.querySelector<HTMLButtonElement>('[data-theme-toggle]')?.addEventListener('click', () => {
  const next = root.dataset.theme === 'dark' ? 'light' : 'dark';
  root.dataset.theme = next;
  localStorage.setItem('ken-blog-theme', next);
});
