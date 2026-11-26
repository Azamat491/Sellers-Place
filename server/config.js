import 'node:process';

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  host: process.env.HOST || '0.0.0.0',
  // Публичный HTTPS-адрес, на котором открыт мини-апп (нужен для кнопки в боте)
  webAppUrl: process.env.WEBAPP_URL || '',
  botToken: process.env.BOT_TOKEN || '',
  // @username канала или числовой id (-100...). Бот должен быть админом канала.
  channelId: process.env.CHANNEL_ID || '@sellersplace2',
  channelUsername: process.env.CHANNEL_USERNAME || 'sellersplace2',
  // Telegram user id администраторов (модерация), через запятую
  adminIds: list(process.env.ADMIN_IDS).map(Number),
  // Или проще — @username администраторов через запятую. Админ должен один раз нажать /start в боте,
  // после этого бот запоминает его и присылает объявления на модерацию.
  adminUsernames: list(process.env.ADMIN_USERNAMES).map((u) => u.replace(/^@/, '').toLowerCase()),
  adsContact: process.env.ADS_CONTACT || 'ranjiroakim',
  garantContact: process.env.GARANT_CONTACT || 'ranjiroakim',
  // Если true — объявления публикуются без модерации
  autoPublish: process.env.AUTO_PUBLISH === 'true',
  // Локальная разработка без Telegram: подставляется тестовый пользователь
  devMode: process.env.DEV_MODE === 'true',
  dataDir: process.env.DATA_DIR || './data',
  maxPhotos: 10,
  // Стоимость размещения (0 — бесплатно). Оплату принимает администратор в личных сообщениях.
  postPrice: Number(process.env.POST_PRICE ?? 150),
  // @username администратора, которому клиент пишет для оплаты
  paymentContact: (process.env.PAYMENT_CONTACT || process.env.ADS_CONTACT || 'ranjiroakim').replace(/^@/, ''),
};
