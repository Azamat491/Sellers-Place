import express from 'express';
import multer from 'multer';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from './config.js';
import { db, getListing, hydrate, setStatus } from './db.js';
import { authMiddleware } from './auth.js';
import { CATEGORIES, CONDITIONS, DELIVERY, POPULAR_BRANDS } from './catalog.js';
import { channelPostUrl } from './format.js';
import {
  setupBot, sendToModeration, notifyPaymentInstructions, approveListing, rejectListing, refreshChannelPost, deleteChannelPost,
} from './bot.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const uploadsDir = path.join(config.dataDir, 'uploads');
const app = express();
app.use(express.json({ limit: '100kb' }));
app.use(express.static(path.join(root, 'public')));
app.use('/uploads', express.static(uploadsDir, { maxAge: '30d', immutable: true }));

const upload = multer({
  storage: multer.diskStorage({
    destination: uploadsDir,
    filename: (_req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype] || '.jpg';
      cb(null, crypto.randomBytes(12).toString('hex') + ext);
    },
  }),
  limits: { files: config.maxPhotos, fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)),
});

const api = express.Router();
api.use(authMiddleware);

const publicView = (l, userId) =>
  l && {
    ...l,
    channel_message_ids: undefined,
    post_url: channelPostUrl(l.channel_message_ids?.[0]),
    is_mine: l.user_id === userId,
    is_favorite: !!db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(userId, l.id),
  };

const LIST_SQL = `SELECT l.*, u.username, u.first_name FROM listings l JOIN users u ON u.id = l.user_id`;

api.get('/meta', (req, res) => {
  res.json({
    user: { id: req.user.id, username: req.user.username, first_name: req.user.first_name },
    isAdmin: req.isAdmin,
    categories: CATEGORIES,
    delivery: DELIVERY,
    conditions: CONDITIONS,
    brands: POPULAR_BRANDS,
    channel: config.channelUsername,
    adsContact: config.adsContact,
    garantContact: config.garantContact,
    maxPhotos: config.maxPhotos,
    autoPublish: config.autoPublish,
    payment: config.postPrice > 0
      ? { amount: config.postPrice, contact: config.paymentContact }
      : null,
  });
});

api.get('/listings', (req, res) => {
  const { kind = 'sell', q, category, size, city, min, max, sort = 'new' } = req.query;
  const where = [`l.status = 'published'`, 'l.kind = ?'];
  const vals = [kind === 'wtb' ? 'wtb' : 'sell'];
  if (q) {
    where.push(`(l.brand || ' ' || l.model || ' ' || l.description) LIKE ?`);
    vals.push(`%${String(q).slice(0, 80)}%`);
  }
  if (category) { where.push('l.category = ?'); vals.push(String(category)); }
  if (size) { where.push('l.size LIKE ?'); vals.push(`%${String(size).slice(0, 20)}%`); }
  if (city) { where.push('l.city LIKE ?'); vals.push(`%${String(city).slice(0, 40)}%`); }
  if (min) { where.push('l.price >= ?'); vals.push(Number(min)); }
  if (max) { where.push('l.price <= ?'); vals.push(Number(max)); }
  const order = { new: 'l.published_at DESC', cheap: 'l.price ASC', expensive: 'l.price DESC' }[sort] || 'l.published_at DESC';
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = db.prepare(`${LIST_SQL} WHERE ${where.join(' AND ')} ORDER BY ${order} LIMIT 30 OFFSET ?`).all(...vals, offset);
  res.json(rows.map((r) => publicView(hydrate(r), req.user.id)));
});

api.get('/listings/:id', (req, res) => {
  const l = getListing(Number(req.params.id));
  if (!l || (l.status !== 'published' && l.status !== 'sold' && l.user_id !== req.user.id && !req.isAdmin)) {
    return res.status(404).json({ error: 'Объявление не найдено' });
  }
  res.json(publicView(l, req.user.id));
});

const str = (v, max) => String(v ?? '').trim().slice(0, max);
const bool = (v) => v === true || v === 'true' || v === '1' || v === 'on';

api.post('/listings', upload.array('photos', config.maxPhotos), async (req, res) => {
  const cleanup = () => (req.files || []).forEach((f) => fs.rm(f.path, () => {}));
  const b = req.body;
  const kind = b.kind === 'wtb' ? 'wtb' : 'sell';
  const photos = (req.files || []).map((f) => f.filename);
  const price = b.price ? Math.round(Number(String(b.price).replace(/[^\d]/g, ''))) : null;
  const errors = [];
  if (!str(b.brand, 60)) errors.push('Укажите бренд');
  if (!str(b.model, 120)) errors.push('Укажите модель / название вещи');
  if (kind === 'sell') {
    if (!str(b.size, 40)) errors.push('Укажите размер');
    if (!str(b.condition, 40)) errors.push('Укажите состояние');
    if (!price || price < 100) errors.push('Укажите цену');
    if (photos.length < 2) errors.push('Добавьте минимум 2 фото');
  }
  const pendingToday = db
    .prepare(`SELECT COUNT(*) c FROM listings WHERE user_id = ? AND created_at > datetime('now','-1 day')`)
    .get(req.user.id).c;
  if (pendingToday >= 10 && !req.isAdmin) errors.push('Не больше 10 объявлений в сутки');
  // п. 5 правил: без рекламы сторонних проектов — ссылки и @упоминания в описании запрещены
  if (/(https?:\/\/|t\.me\/|www\.|@[a-z0-9_]{4,})/i.test(`${b.description || ''} ${b.model || ''}`)) {
    errors.push('Уберите ссылки и @упоминания из описания — реклама сторонних проектов запрещена (п. 5)');
  }
  // п. 6 правил: одну и ту же вещь — не чаще раза в 3 недели
  // Платные посты — исключение из п. 6
  if (kind === 'sell' && !req.isAdmin && !config.postPrice) {
    const dup = db.prepare(
      `SELECT 1 FROM listings WHERE user_id = ? AND kind = 'sell' AND lower(brand) = lower(?) AND lower(model) = lower(?)
         AND status IN ('pending','published','sold','archived') AND created_at > datetime('now','-21 days')`
    ).get(req.user.id, str(b.brand, 60), str(b.model, 120));
    if (dup) errors.push('Эту вещь можно предложить повторно не раньше, чем через 3 недели (п. 6)');
  }
  if (errors.length) { cleanup(); return res.status(400).json({ error: errors.join('\n') }); }

  let delivery = [];
  try { delivery = JSON.parse(b.delivery || '[]').filter((d) => DELIVERY.includes(d)); } catch {}

  const info = db.prepare(
    `INSERT INTO listings (user_id, kind, brand, model, category, size, condition, price, negotiable, exchange,
       city, meetup, delivery, garant, description, photos)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`
  ).run(
    req.user.id, kind, str(b.brand, 60), str(b.model, 120),
    CATEGORIES.some((c) => c.id === b.category) ? b.category : 'other',
    str(b.size, 40), str(b.condition, 40), price, bool(b.negotiable) ? 1 : 0, bool(b.exchange) ? 1 : 0,
    str(b.city, 60), bool(b.meetup) ? 1 : 0, JSON.stringify(delivery), bool(b.garant) ? 1 : 0,
    str(b.description, 700), JSON.stringify(photos)
  );
  const id = Number(info.lastInsertRowid);
  if (config.postPrice > 0 && !req.isAdmin) {
    // Оплата у администратора в ЛС: объявление сразу видно админам со статусом «Ждёт оплаты»
    const l = setStatus(id, 'awaiting_payment', { amount: config.postPrice });
    sendToModeration(l).catch((e) => console.error('moderation error', e));
    notifyPaymentInstructions(l).catch(() => {});
    return res.json(publicView(l, req.user.id));
  }
  try {
    if (config.autoPublish) await approveListing(id);
    else await sendToModeration(getListing(id));
  } catch (e) {
    console.error('publish/moderation error', e);
  }
  res.json(publicView(getListing(id), req.user.id));
});

api.get('/my', (req, res) => {
  const rows = db.prepare(`${LIST_SQL} WHERE l.user_id = ? AND l.status != 'archived' ORDER BY l.id DESC`).all(req.user.id);
  res.json(rows.map((r) => publicView(hydrate(r), req.user.id)));
});

function ownListing(req, res) {
  const l = getListing(Number(req.params.id));
  if (!l || (l.user_id !== req.user.id && !req.isAdmin)) {
    res.status(404).json({ error: 'Объявление не найдено' });
    return null;
  }
  return l;
}

api.post('/listings/:id/sold', async (req, res) => {
  const l = ownListing(req, res);
  if (!l) return;
  if (l.status !== 'published') return res.status(400).json({ error: 'Можно отметить только опубликованное' });
  const out = setStatus(l.id, 'sold');
  await refreshChannelPost(out);
  res.json(publicView(out, req.user.id));
});

api.post('/listings/:id/archive', async (req, res) => {
  const l = ownListing(req, res);
  if (!l) return;
  await deleteChannelPost(l);
  setStatus(l.id, 'archived');
  res.json({ ok: true });
});

api.post('/listings/:id/favorite', (req, res) => {
  const id = Number(req.params.id);
  const exists = db.prepare('SELECT 1 FROM favorites WHERE user_id = ? AND listing_id = ?').get(req.user.id, id);
  if (exists) db.prepare('DELETE FROM favorites WHERE user_id = ? AND listing_id = ?').run(req.user.id, id);
  else db.prepare('INSERT INTO favorites (user_id, listing_id) VALUES (?, ?)').run(req.user.id, id);
  res.json({ is_favorite: !exists });
});

api.get('/favorites', (req, res) => {
  const rows = db.prepare(
    `${LIST_SQL} JOIN favorites f ON f.listing_id = l.id AND f.user_id = ?
     WHERE l.status IN ('published','sold') ORDER BY f.created_at DESC`
  ).all(req.user.id);
  res.json(rows.map((r) => publicView(hydrate(r), req.user.id)));
});

// --- Модерация ---
const adminOnly = (req, res, next) => (req.isAdmin ? next() : res.status(403).json({ error: 'Нет доступа' }));

api.get('/admin/pending', adminOnly, (req, res) => {
  const rows = db.prepare(`${LIST_SQL} WHERE l.status IN ('pending','awaiting_payment') ORDER BY l.id ASC`).all();
  res.json(rows.map((r) => publicView(hydrate(r), req.user.id)));
});

api.post('/admin/:id/approve', adminOnly, async (req, res) => {
  try {
    res.json(publicView(await approveListing(Number(req.params.id)), req.user.id));
  } catch (e) {
    res.status(500).json({ error: 'Не удалось опубликовать: ' + (e.description || e.message) });
  }
});

api.post('/admin/:id/reject', adminOnly, async (req, res) => {
  const backToPayment = req.body?.nopay === true;
  res.json(publicView(await rejectListing(Number(req.params.id), str(req.body?.reason, 300), { backToPayment }), req.user.id));
});

app.use('/api', api);
app.use((err, _req, res, _next) => {
  console.error(err);
  const msg = err instanceof multer.MulterError ? `Ошибка загрузки фото: ${err.code === 'LIMIT_FILE_SIZE' ? 'файл больше 10 МБ' : err.message}` : 'Ошибка сервера';
  res.status(err instanceof multer.MulterError ? 400 : 500).json({ error: msg });
});

app.listen(config.port, () => console.log(`SELLERS PLACE mini app: http://localhost:${config.port}`));
setupBot();
