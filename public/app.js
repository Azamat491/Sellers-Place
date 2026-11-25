const tg = window.Telegram?.WebApp;
tg?.ready();
tg?.expand();

const $ = (s, el = document) => el.querySelector(s);
const view = $('#view');
const esc = (s) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const price = (n) => (n == null ? '' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} ₽`);
const haptic = (t = 'light') => tg?.HapticFeedback?.impactOccurred(t);
const photoUrl = (p) => `/uploads/${encodeURIComponent(p)}`;

let META = null;
const state = { tab: 'feed', stack: [], filters: { q: '', category: '', size: '', city: '', min: '', max: '', sort: 'new' } };

// ---------- API ----------
async function api(path, opts = {}) {
  const headers = { 'X-Telegram-Init-Data': tg?.initData || '', ...(opts.headers || {}) };
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
  }
  const res = await fetch(`/api${path}`, { ...opts, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Ошибка ${res.status}`);
  return data;
}

function toast(msg, ms = 2600) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => (t.hidden = true), ms);
}

function openLink(url) {
  if (url.startsWith('https://t.me/') && tg?.openTelegramLink) tg.openTelegramLink(url);
  else if (tg?.openLink) tg.openLink(url);
  else window.open(url, '_blank');
}

function confirmDialog(text) {
  return new Promise((resolve) => (tg?.showConfirm ? tg.showConfirm(text, resolve) : resolve(window.confirm(text))));
}

// ---------- Навигация ----------
const TABS = { feed: renderFeed, wtb: renderWtb, create: renderCreate, favorites: renderFavorites, profile: renderProfile };

function go(tab) {
  state.tab = tab;
  state.stack = [];
  document.querySelectorAll('.tabbar button').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  updateBack();
  window.scrollTo(0, 0);
  TABS[tab]();
}

function push(render) {
  state.stack.push({ render, scroll: window.scrollY });
  updateBack();
  window.scrollTo(0, 0);
  render();
}

function back() {
  state.stack.pop();
  updateBack();
  const top = state.stack[state.stack.length - 1];
  if (top) top.render();
  else TABS[state.tab]();
}

function updateBack() {
  const has = state.stack.length > 0;
  $('#backBtn').hidden = !has || !!tg?.BackButton;
  if (tg?.BackButton) has ? tg.BackButton.show() : tg.BackButton.hide();
}

tg?.BackButton?.onClick(back);
$('#backBtn').onclick = back;
$('#rulesBtn').onclick = () => push(renderRules);
document.querySelectorAll('.tabbar button').forEach((b) => (b.onclick = () => (haptic(), go(b.dataset.tab))));

// ---------- Карточки ----------
const STATUS = {
  pending: ['На модерации', 'warn'],
  published: ['Опубликовано', 'ok'],
  rejected: ['Отклонено', 'bad'],
  sold: ['Продано', ''],
};

function cardHtml(l, withStatus = false) {
  const st = withStatus ? STATUS[l.status] : l.status === 'sold' ? STATUS.sold : null;
  const cover = l.photos[0] ? `style="background-image:url('${photoUrl(l.photos[0])}')"` : '';
  return `<button class="card" data-id="${l.id}">
    <div class="ph" ${cover}></div>
    ${st ? `<span class="badge ${st[1]}">${st[0]}</span>` : ''}
    <div class="body">
      <div class="brand">${esc(l.brand)}</div>
      <div class="model">${esc(l.model)}</div>
      <div class="price">${price(l.price)}</div>
      <div class="meta">${esc([l.size && `р. ${l.size}`, l.condition].filter(Boolean).join(' · '))}</div>
    </div>
  </button>`;
}

function bindCards(root = view) {
  root.querySelectorAll('[data-id]').forEach((el) => (el.onclick = () => push(() => renderDetail(Number(el.dataset.id)))));
}

const skeletons = (n = 6) => `<div class="grid">${'<div class="skeleton"></div>'.repeat(n)}</div>`;

// ---------- Каталог ----------
async function renderFeed() {
  const f = state.filters;
  const activeFilters = ['size', 'city', 'min', 'max'].filter((k) => f[k]).length + (f.sort !== 'new' ? 1 : 0);
  view.innerHTML = `
    <div class="search">
      <input id="q" type="search" placeholder="Бренд, модель…" value="${esc(f.q)}" enterkeyhint="search" />
      <button class="btn secondary sm" id="filtersBtn">Фильтры${activeFilters ? ` · ${activeFilters}` : ''}</button>
    </div>
    <div class="chips" id="cats">
      <button class="chip ${f.category ? '' : 'on'}" data-cat="">Все</button>
      ${META.categories.map((c) => `<button class="chip ${f.category === c.id ? 'on' : ''}" data-cat="${c.id}">${esc(c.name)}</button>`).join('')}
    </div>
    <div id="list">${skeletons()}</div>`;

  let timer;
  $('#q').oninput = (e) => {
    clearTimeout(timer);
    timer = setTimeout(() => ((f.q = e.target.value.trim()), loadFeed()), 350);
  };
  $('#cats').querySelectorAll('.chip').forEach(
    (c) => (c.onclick = () => ((f.category = c.dataset.cat), haptic(), renderFeed()))
  );
  $('#filtersBtn').onclick = openFilters;
  loadFeed();
}

async function loadFeed() {
  const f = state.filters;
  const params = new URLSearchParams({ kind: 'sell', ...Object.fromEntries(Object.entries(f).filter(([, v]) => v)) });
  const list = $('#list');
  try {
    const items = await api(`/listings?${params}`);
    if (!list.isConnected) return;
    list.innerHTML = items.length
      ? `<div class="grid">${items.map((l) => cardHtml(l)).join('')}</div>`
      : `<div class="empty"><b>∅</b>Ничего не нашлось.<br/>Попробуйте изменить фильтры или <a href="#" id="toWtb">оставьте запрос «Ищу»</a></div>`;
    bindCards(list);
    const toWtb = $('#toWtb');
    if (toWtb) toWtb.onclick = (e) => (e.preventDefault(), go('create'), setTimeout(() => $('[data-kind="wtb"]')?.click()));
  } catch (e) {
    list.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function openFilters() {
  const f = state.filters;
  const sheet = $('#sheet');
  sheet.innerHTML = `<div>
    <h2>Фильтры</h2>
    <div class="two-col">
      <div class="field"><label>Размер</label><input id="fSize" placeholder="M, 42, 1…" value="${esc(f.size)}" /></div>
      <div class="field"><label>Город</label><input id="fCity" placeholder="Москва" value="${esc(f.city)}" /></div>
      <div class="field"><label>Цена от, ₽</label><input id="fMin" inputmode="numeric" value="${esc(f.min)}" /></div>
      <div class="field"><label>Цена до, ₽</label><input id="fMax" inputmode="numeric" value="${esc(f.max)}" /></div>
    </div>
    <div class="field"><label>Сортировка</label>
      <select id="fSort">
        <option value="new">Сначала новые</option>
        <option value="cheap">Сначала дешевле</option>
        <option value="expensive">Сначала дороже</option>
      </select>
    </div>
    <div class="btns two">
      <button class="btn secondary" id="fReset">Сбросить</button>
      <button class="btn" id="fApply">Показать</button>
    </div>
  </div>`;
  $('#fSort').value = f.sort;
  sheet.hidden = false;
  sheet.onclick = (e) => e.target === sheet && (sheet.hidden = true);
  $('#fReset').onclick = () => {
    Object.assign(f, { size: '', city: '', min: '', max: '', sort: 'new' });
    sheet.hidden = true;
    renderFeed();
  };
  $('#fApply').onclick = () => {
    Object.assign(f, {
      size: $('#fSize').value.trim(),
      city: $('#fCity').value.trim(),
      min: $('#fMin').value.replace(/\D/g, ''),
      max: $('#fMax').value.replace(/\D/g, ''),
      sort: $('#fSort').value,
    });
    sheet.hidden = true;
    renderFeed();
  };
}

// ---------- Ищут ----------
async function renderWtb() {
  view.innerHTML = `<h2>Ищут</h2>
    <p class="muted small">Запросы покупателей. Есть такая вещь — напишите покупателю напрямую.</p>
    <button class="btn secondary" id="newWtb" style="margin-bottom:14px">🔎 Оставить свой запрос</button>
    <div id="list">${skeletons(2)}</div>`;
  $('#newWtb').onclick = () => (go('create'), setTimeout(() => $('[data-kind="wtb"]')?.click()));
  try {
    const items = await api('/listings?kind=wtb');
    $('#list').innerHTML = items.length
      ? items.map(rowHtml).join('')
      : `<div class="empty"><b>🔎</b>Пока нет запросов</div>`;
    bindCards($('#list'));
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function rowHtml(l, actions = '') {
  const st = STATUS[l.status];
  const thumb = l.photos[0] ? `style="background-image:url('${photoUrl(l.photos[0])}')"` : '';
  return `<div class="row-card">
    <div class="thumb" data-id="${l.id}" ${thumb}>${l.photos[0] ? '' : l.kind === 'wtb' ? '🔎' : '👕'}</div>
    <div class="info" data-id="${l.id}">
      <div><b>${l.kind === 'wtb' ? 'ИЩУ: ' : ''}${esc(l.brand)}</b> <span class="muted">${esc(l.model)}</span></div>
      <div class="small muted">${esc([l.size && `Размер ${l.size}`, l.price && (l.kind === 'wtb' ? `до ${price(l.price)}` : price(l.price)), l.city].filter(Boolean).join(' · '))}</div>
      ${actions ? `<div class="small" style="margin-top:4px"><span class="badge ${st?.[1] || ''}" style="position:static">${st?.[0] || l.status}</span></div>` : ''}
      ${l.status === 'rejected' && l.reject_reason ? `<div class="small" style="color:var(--bad);margin-top:4px">${esc(l.reject_reason)}</div>` : ''}
    </div>
    ${actions}
  </div>`;
}

// ---------- Карточка товара ----------
async function renderDetail(id) {
  view.innerHTML = skeletons(1);
  let l;
  try {
    l = await api(`/listings/${id}`);
  } catch (e) {
    view.innerHTML = `<div class="empty">${esc(e.message)}</div>`;
    return;
  }
  const cat = META.categories.find((c) => c.id === l.category);
  const deal = [l.meetup && l.city && `Личная встреча: ${l.city}`, ...l.delivery].filter(Boolean);
  const contact = l.username ? `https://t.me/${l.username}` : null;
  view.innerHTML = `
    ${l.photos.length ? `<div class="gallery" id="gal">${l.photos.map((p) => `<img src="${photoUrl(p)}" loading="lazy" alt="" />`).join('')}</div>
      ${l.photos.length > 1 ? `<div class="dots" id="dots">1 / ${l.photos.length}</div>` : ''}` : ''}
    ${l.status === 'sold' ? `<div class="notice">Эта вещь уже продана</div>` : ''}
    <div class="muted small">${l.kind === 'wtb' ? 'ИЩУ' : esc(cat?.name || '')}</div>
    <h2 style="margin:2px 0">${esc(l.brand)}</h2>
    <div>${esc(l.model)}</div>
    <div class="price-big">${l.kind === 'wtb' ? (l.price ? `до ${price(l.price)}` : 'Бюджет не указан') : price(l.price)}</div>
    <dl class="specs">
      ${l.size ? `<dt>Размер</dt><dd>${esc(l.size)}</dd>` : ''}
      ${l.condition ? `<dt>Состояние</dt><dd>${esc(l.condition)}</dd>` : ''}
      ${l.kind === 'sell' ? `<dt>Торг</dt><dd>${l.negotiable ? 'Возможен' : 'Нет'}</dd><dt>Обмен</dt><dd>${l.exchange ? 'Да' : 'Нет'}</dd>` : ''}
      ${deal.length ? `<dt>Сделка</dt><dd>${esc(deal.join(' / '))}</dd>` : ''}
      ${l.garant ? `<dt>Гарант</dt><dd>Garant 3%</dd>` : ''}
    </dl>
    ${l.description ? `<div class="desc">${esc(l.description)}</div>` : ''}
    <div class="btns">
      ${!l.is_mine && contact ? `<button class="btn" id="write">Написать ${l.kind === 'wtb' ? 'покупателю' : 'продавцу'} @${esc(l.username)}</button>` : ''}
      ${!l.is_mine && !contact ? `<div class="notice">У автора нет @username — свяжитесь через пост в канале</div>` : ''}
      ${l.garant && !l.is_mine && l.kind === 'sell' ? `<button class="btn secondary" id="garant">🛡 Сделка через гаранта (3%)</button>` : ''}
      <div class="btns two" style="margin-top:0">
        <button class="btn secondary" id="fav">${l.is_favorite ? '♥ В избранном' : '♡ В избранное'}</button>
        <button class="btn secondary" id="share">↗ Поделиться</button>
      </div>
      ${l.post_url ? `<button class="btn secondary" id="post">Открыть пост в канале</button>` : ''}
    </div>`;

  const gal = $('#gal');
  if (gal && $('#dots')) gal.onscroll = () => ($('#dots').textContent = `${Math.round(gal.scrollLeft / gal.clientWidth) + 1} / ${l.photos.length}`);
  $('#write') && ($('#write').onclick = () => openLink(contact));
  $('#garant') && ($('#garant').onclick = () => openLink(`https://t.me/${META.garantContact}`));
  $('#post') && ($('#post').onclick = () => openLink(l.post_url));
  $('#fav').onclick = async () => {
    haptic();
    const r = await api(`/listings/${l.id}/favorite`, { method: 'POST' });
    $('#fav').textContent = r.is_favorite ? '♥ В избранном' : '♡ В избранное';
  };
  $('#share').onclick = () => {
    const url = l.post_url || `https://t.me/${META.channel}`;
    const text = `${l.brand} ${l.model} — ${price(l.price)}`;
    openLink(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(text)}`);
  };
}

// ---------- Создание объявления ----------
const draft = { kind: 'sell', photos: [] };

function renderCreate() {
  const k = draft.kind;
  const noUsername = !META.user.username;
  view.innerHTML = `
    <h2>${k === 'sell' ? 'Продать вещь' : 'Найти вещь'}</h2>
    <div class="seg">
      <button data-kind="sell" class="${k === 'sell' ? 'on' : ''}">Продаю</button>
      <button data-kind="wtb" class="${k === 'wtb' ? 'on' : ''}">Ищу</button>
    </div>
    ${noUsername ? `<div class="notice">У вас не указан @username в Telegram. Покупателям будет сложнее связаться — установите его в настройках Telegram.</div>` : ''}
    <form id="form" autocomplete="off">
      ${k === 'sell' ? `
      <div class="field"><label>Фото (от 2 до ${META.maxPhotos}, первое — обложка)</label>
        <p class="small muted" style="margin:0 0 8px">Только фото самой вещи. Допускаются фото с показа коллекции, на которых изображена ваша вещь (п. 7).</p>
        <div class="photos" id="photos"></div>
        <input type="file" id="file" accept="image/jpeg,image/png,image/webp" multiple hidden />
      </div>` : ''}
      <div class="field"><label>Бренд *</label>
        <input name="brand" list="brands" required maxlength="60" placeholder="Rick Owens" />
        <datalist id="brands">${META.brands.map((b) => `<option value="${esc(b)}">`).join('')}</datalist>
      </div>
      <div class="field"><label>Модель / название *</label><input name="model" required maxlength="120" placeholder="Bozo Tractor" /></div>
      <div class="field"><label>Категория</label>
        <select name="category">${META.categories.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
      </div>
      <div class="two-col">
        <div class="field"><label>Размер${k === 'sell' ? ' *' : ''}</label><input name="size" maxlength="40" placeholder="L / 43 / 2" /></div>
        <div class="field"><label>Состояние${k === 'sell' ? ' *' : ''}</label>
          <select name="condition"><option value="">—</option>${META.conditions.map((c) => `<option>${esc(c)}</option>`).join('')}</select>
        </div>
      </div>
      <div class="field"><label>${k === 'sell' ? 'Цена, ₽ *' : 'Бюджет до, ₽'}</label><input name="price" inputmode="numeric" placeholder="12 200" /></div>
      ${k === 'sell' ? `
        <label class="toggle">Торг возможен<input type="checkbox" name="negotiable" /></label>
        <label class="toggle">Рассматриваю обмен<input type="checkbox" name="exchange" /></label>` : ''}
      <h3>Сделка</h3>
      <label class="toggle">Личная встреча<input type="checkbox" name="meetup" checked /></label>
      <div class="field" style="margin-top:10px"><label>Город</label><input name="city" maxlength="60" placeholder="Москва" /></div>
      <div class="field"><label>Доставка</label>
        <div class="chips wrap" id="delivery">${META.delivery.map((d) => `<button type="button" class="chip" data-d="${esc(d)}">${esc(d)}</button>`).join('')}</div>
      </div>
      <label class="toggle"><span>Garant 3 процента<br/><span class="small muted">Безопасная сделка через гаранта площадки</span></span><input type="checkbox" name="garant" checked /></label>
      <div class="field" style="margin-top:12px"><label>Описание</label>
        <textarea name="description" maxlength="700" placeholder="${k === 'sell' ? 'Комплект, дефекты, замеры, история вещи…' : 'Какой сезон, цвет, детали…'} Без ссылок и рекламы."></textarea>
      </div>
      <h3>Так пост будет выглядеть в канале</h3>
      <div class="preview" id="preview"></div>
      <p class="small muted">${META.autoPublish ? 'Объявление будет опубликовано сразу.' : 'Перед публикацией объявление проверит модератор. Мы пришлём уведомление в бота.'}
        Публикуя, вы соглашаетесь с <a href="#" id="toRules">правилами площадки</a>.</p>
      <button class="btn" type="submit" id="submit">Отправить на публикацию</button>
    </form>`;

  view.querySelectorAll('[data-kind]').forEach(
    (b) => (b.onclick = () => ((draft.kind = b.dataset.kind), haptic(), renderCreate()))
  );
  $('#toRules').onclick = (e) => (e.preventDefault(), push(renderRules));
  const form = $('#form');
  const delivery = new Set();
  $('#delivery').querySelectorAll('.chip').forEach(
    (c) => (c.onclick = () => {
      delivery.has(c.dataset.d) ? delivery.delete(c.dataset.d) : delivery.add(c.dataset.d);
      c.classList.toggle('on');
      updatePreview();
    })
  );

  const values = () => {
    const fd = new FormData(form);
    return {
      kind: draft.kind,
      brand: fd.get('brand')?.trim() || '',
      model: fd.get('model')?.trim() || '',
      category: fd.get('category'),
      size: fd.get('size')?.trim() || '',
      condition: fd.get('condition') || '',
      price: (fd.get('price') || '').replace(/\D/g, ''),
      negotiable: !!fd.get('negotiable'),
      exchange: !!fd.get('exchange'),
      meetup: !!fd.get('meetup'),
      city: fd.get('city')?.trim() || '',
      delivery: [...delivery],
      garant: !!fd.get('garant'),
      description: fd.get('description')?.trim() || '',
    };
  };

  function updatePreview() {
    $('#preview').textContent = previewText(values());
  }
  form.oninput = updatePreview;
  updatePreview();

  if (k === 'sell') renderPhotos();

  form.onsubmit = async (e) => {
    e.preventDefault();
    const v = values();
    const btn = $('#submit');
    btn.disabled = true;
    btn.textContent = 'Отправляем…';
    try {
      const fd = new FormData();
      for (const [key, val] of Object.entries(v)) fd.append(key, key === 'delivery' ? JSON.stringify(val) : String(val));
      for (const p of draft.photos) fd.append('photos', p.blob, 'photo.jpg');
      const l = await api('/listings', { method: 'POST', body: fd });
      tg?.HapticFeedback?.notificationOccurred('success');
      draft.photos.forEach((p) => URL.revokeObjectURL(p.url));
      draft.photos = [];
      toast(l.status === 'published' ? 'Опубликовано в канале!' : 'Отправлено на модерацию. Мы сообщим о публикации в боте.');
      go('profile');
    } catch (err) {
      tg?.HapticFeedback?.notificationOccurred('error');
      toast(err.message, 4000);
      btn.disabled = false;
      btn.textContent = 'Отправить на публикацию';
    }
  };
}

function renderPhotos() {
  const box = $('#photos');
  if (!box) return;
  box.innerHTML =
    draft.photos.map((p, i) => `<div class="ph ${i === 0 ? 'first' : ''}" style="background-image:url('${p.url}')"><button type="button" data-rm="${i}">✕</button></div>`).join('') +
    (draft.photos.length < META.maxPhotos ? `<button type="button" class="add" id="addPhoto">＋</button>` : '');
  box.querySelectorAll('[data-rm]').forEach(
    (b) => (b.onclick = () => {
      const [p] = draft.photos.splice(Number(b.dataset.rm), 1);
      URL.revokeObjectURL(p.url);
      renderPhotos();
    })
  );
  const add = $('#addPhoto');
  if (add) add.onclick = () => $('#file').click();
  $('#file').onchange = async (e) => {
    const files = [...e.target.files].slice(0, META.maxPhotos - draft.photos.length);
    e.target.value = '';
    for (const f of files) {
      try {
        const blob = await compressImage(f);
        draft.photos.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        toast('Не удалось обработать фото');
      }
    }
    renderPhotos();
  };
}

/** Сжимаем фото на клиенте: длинная сторона ≤ 1600px, JPEG ~0.85 — быстрее загрузка, укладываемся в лимиты Telegram */
async function compressImage(file, max = 1600) {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * k);
  canvas.height = Math.round(bmp.height * k);
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
  return new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej()), 'image/jpeg', 0.85));
}

/** Повторяет формат поста канала (server/format.js) */
function previewText(v) {
  const title = [v.brand || 'Бренд', v.model || 'Модель'].join(' | ');
  const L = [];
  if (v.kind === 'wtb') {
    L.push(`🔎 ИЩУ: ${title}`, '');
    if (v.size) L.push(`Размер: ${v.size}`);
    if (v.condition) L.push(`Состояние: от ${v.condition}`);
    if (v.price) L.push(`Бюджет: до ${price(v.price)}`);
  } else {
    L.push(title, '', `Состояние: ${v.condition || '—'}`, '', `Размер: ${v.size || '—'}`, '');
    L.push(`Цена: ${v.price ? price(v.price) : '—'}${v.negotiable ? ', торг возможен' : ''}`, '', `Обмен: ${v.exchange ? 'Да' : 'Нет'}`);
  }
  if (v.description) L.push('', v.description);
  const deal = [v.meetup && v.city && `Личная встреча ${v.city}`, ...v.delivery, v.garant && 'Garant 3 процента'].filter(Boolean);
  if (deal.length) L.push('', deal.join(' / '));
  const who = META.user.username ? `@${META.user.username}` : META.user.first_name;
  L.push('', `${v.kind === 'wtb' ? 'Покупатель' : 'Продавец'} - ${who}`);
  const cat = META.categories.find((c) => c.id === v.category);
  const brandTag = v.brand.replace(/[^\p{L}\p{N}]+/gu, '');
  L.push('', [v.kind === 'wtb' ? '#поиск' : '#продажа', cat && `#${cat.tag}`, brandTag && `#${brandTag}`].filter(Boolean).join(' '));
  return L.join('\n');
}

// ---------- Избранное ----------
async function renderFavorites() {
  view.innerHTML = `<h2>Избранное</h2><div id="list">${skeletons(4)}</div>`;
  try {
    const items = await api('/favorites');
    $('#list').innerHTML = items.length
      ? `<div class="grid">${items.map((l) => cardHtml(l)).join('')}</div>`
      : `<div class="empty"><b>♡</b>Сохраняйте понравившиеся вещи, чтобы не потерять</div>`;
    bindCards($('#list'));
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- Профиль / Мои объявления ----------
async function renderProfile() {
  const u = META.user;
  view.innerHTML = `
    <h2>${esc(u.first_name || 'Профиль')}</h2>
    <div class="muted small" style="margin-top:-8px;margin-bottom:12px">${u.username ? '@' + esc(u.username) : 'без @username'}</div>
    ${META.isAdmin ? `<button class="btn secondary" id="admin" style="margin-bottom:12px">🛠 Модерация</button>` : ''}
    <h3>Мои объявления</h3>
    <div id="list">${skeletons(2)}</div>
    <h3>Площадка</h3>
    <div class="btns" style="margin-top:0">
      <button class="btn secondary" id="channel">Канал @${esc(META.channel)}</button>
      <button class="btn secondary" id="ads">Реклама и сотрудничество</button>
      <button class="btn secondary" id="rules">Правила площадки</button>
    </div>`;
  $('#admin') && ($('#admin').onclick = () => push(renderAdmin));
  $('#channel').onclick = () => openLink(`https://t.me/${META.channel}`);
  $('#ads').onclick = () => openLink(`https://t.me/${META.adsContact}`);
  $('#rules').onclick = () => push(renderRules);
  try {
    const items = await api('/my');
    const list = $('#list');
    list.innerHTML = items.length
      ? items.map((l) => rowHtml(l, myActions(l))).join('')
      : `<div class="empty"><b>👕</b>У вас пока нет объявлений<br/><br/><button class="btn sm" id="first">Разместить первую вещь</button></div>`;
    $('#first') && ($('#first').onclick = () => go('create'));
    bindCards(list);
    list.querySelectorAll('[data-act]').forEach((b) => (b.onclick = () => myAction(b.dataset.act, Number(b.dataset.lid))));
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

function myActions(l) {
  const acts = [];
  if (l.status === 'published' && l.kind === 'sell') acts.push(`<button class="btn sm secondary" data-act="sold" data-lid="${l.id}">Продано</button>`);
  if (l.status === 'published' && l.kind === 'wtb') acts.push(`<button class="btn sm secondary" data-act="sold" data-lid="${l.id}">Нашёл</button>`);
  acts.push(`<button class="btn sm danger" data-act="archive" data-lid="${l.id}">${l.status === 'published' ? 'Снять' : 'Удалить'}</button>`);
  return `<div class="actions" style="flex-direction:column">${acts.join('')}</div>`;
}

async function myAction(act, id) {
  try {
    if (act === 'sold') {
      if (!(await confirmDialog('Отметить как проданное? В посте канала появится пометка «ПРОДАНО».'))) return;
      await api(`/listings/${id}/sold`, { method: 'POST' });
      toast('Отмечено как продано');
    }
    if (act === 'archive') {
      if (!(await confirmDialog('Снять объявление? Пост будет удалён из канала.'))) return;
      await api(`/listings/${id}/archive`, { method: 'POST' });
      toast('Объявление снято');
    }
    renderProfile();
  } catch (e) {
    toast(e.message);
  }
}

// ---------- Модерация ----------
async function renderAdmin() {
  view.innerHTML = `<h2>Модерация</h2><div id="list">${skeletons(2)}</div>`;
  try {
    const items = await api('/admin/pending');
    const list = $('#list');
    list.innerHTML = items.length
      ? items
          .map((l) =>
            rowHtml(
              l,
              `<div class="actions" style="flex-direction:column">
                <button class="btn sm" data-ok="${l.id}">✓</button>
                <button class="btn sm danger" data-no="${l.id}">✕</button>
              </div>`
            )
          )
          .join('')
      : `<div class="empty"><b>✓</b>Очередь пуста</div>`;
    bindCards(list);
    list.querySelectorAll('[data-ok]').forEach(
      (b) => (b.onclick = async () => {
        b.disabled = true;
        try {
          await api(`/admin/${b.dataset.ok}/approve`, { method: 'POST' });
          toast('Опубликовано');
        } catch (e) {
          toast(e.message, 4000);
        }
        renderAdmin();
      })
    );
    list.querySelectorAll('[data-no]').forEach(
      (b) => (b.onclick = async () => {
        const reason = window.prompt('Причина отказа (увидит автор):', 'Вещь не подходит под сегмент люкс/премиум');
        if (reason === null) return;
        await api(`/admin/${b.dataset.no}/reject`, { method: 'POST', json: { reason } });
        toast('Отклонено');
        renderAdmin();
      })
    );
  } catch (e) {
    $('#list').innerHTML = `<div class="empty">${esc(e.message)}</div>`;
  }
}

// ---------- Правила ----------
const RULES = [
  ['Фейк вещь', 'бан'],
  ['Спам под постами', 'бан'],
  ['Спам в предложку', 'бан'],
  ['Мошенничество', 'бан'],
  ['Реклама сторонних проектов', 'бан'],
  ['Предлагать одни и те же вещи можно не чаще, чем раз в 3 недели', 'платные посты — исключение'],
  ['В оформленном посте не должно быть ничего, кроме фотографий вещи', 'кроме фото с показа коллекции, на которых изображена ваша вещь'],
  ['Администрация не несёт ответственности за товары, выкладываемые в группе', ''],
  ['Запрещены нецензурные высказывания в предложенных к публикации постах', ''],
  ['Запрещено общение и неадекватное общение в комментариях под постом', ''],
];

function renderRules() {
  view.innerHTML = `<div class="rules">
    <h2>Правила площадки</h2>
    <ol>${RULES.map(([r, note]) => `<li><b>${esc(r)}</b>${note ? `<br/><span class="muted small">${esc(note)}</span>` : ''}</li>`).join('')}</ol>
    <div class="notice">При нарушении правил пост не будет опубликован.<br/>При оплате поста вы соглашаетесь с правилами площадки.</div>
    <h3>Безопасная сделка</h3>
    <p>Для сделок на расстоянии используйте гаранта площадки — комиссия <b>3%</b>.</p>
    <div class="btns">
      <button class="btn secondary" id="g">Связаться с гарантом</button>
      <button class="btn secondary" id="a">Реклама и сотрудничество — @${esc(META.adsContact)}</button>
    </div>
  </div>`;
  $('#g').onclick = () => openLink(`https://t.me/${META.garantContact}`);
  $('#a').onclick = () => openLink(`https://t.me/${META.adsContact}`);
}

// ---------- Старт ----------
(async function init() {
  try {
    META = await api('/meta');
  } catch (e) {
    view.innerHTML = `<div class="empty"><b>👁‍🗨</b>${esc(e.message)}</div>`;
    $('#tabbar').hidden = true;
    return;
  }
  // Глубокая ссылка: t.me/<bot>/<app>?startapp=item_123
  const sp = tg?.initDataUnsafe?.start_param || new URLSearchParams(location.search).get('startapp') || '';
  go('feed');
  const m = sp.match(/^item_(\d+)$/);
  if (m) push(() => renderDetail(Number(m[1])));
  if (sp === 'sell') go('create');
})();
