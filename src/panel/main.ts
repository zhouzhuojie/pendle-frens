import { App } from './app';
import { qs } from './dom';

const app = new App(qs(document.body, '#app'));

qs(document.body, '#refresh').addEventListener('click', () => {
  void app.refresh(true);
});

// Keep the favorites tab honest if another surface mutates storage.
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes['pf.favorites.v1']) return;
  const next = changes['pf.favorites.v1'].newValue;
  if (Array.isArray(next)) {
    app.state.favorites = next;
    app.render();
  }
});

void app.boot();
