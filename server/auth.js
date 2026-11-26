import crypto from 'node:crypto';
import { config } from './config.js';
import { upsertUser } from './db.js';

const MAX_AGE_SEC = 24 * 60 * 60;

/** Проверка подписи Telegram WebApp initData (https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app) */
export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;
  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');
  const dataCheckString = [...params.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join('\n');
  const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
  const calc = crypto.createHmac('sha256', secret).update(dataCheckString).digest('hex');
  const a = Buffer.from(calc, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SEC) return null;
  try {
    return JSON.parse(params.get('user') || 'null');
  } catch {
    return null;
  }
}

export function isAdminUser(u) {
  if (!u) return false;
  return config.adminIds.includes(u.id) || (!!u.username && config.adminUsernames.includes(u.username.toLowerCase()));
}

export function authMiddleware(req, res, next) {
  const initData = req.get('X-Telegram-Init-Data') || '';
  let tgUser = validateInitData(initData, config.botToken);
  if (!tgUser && config.devMode) {
    tgUser = { id: Number(req.get('X-Dev-User-Id') || 1), username: 'dev_seller', first_name: 'Dev' };
  }
  if (!tgUser) return res.status(401).json({ error: 'Откройте приложение через Telegram' });
  const user = upsertUser(tgUser);
  if (user.banned) return res.status(403).json({ error: 'Доступ ограничен администрацией' });
  req.user = user;
  const noAdmins = !config.adminIds.length && !config.adminUsernames.length;
  req.isAdmin = isAdminUser(user) || (config.devMode && noAdmins);
  next();
}
