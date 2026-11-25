import 'node:process';

const list = (v) => (v || '').split(',').map((s) => s.trim()).filter(Boolean);

export const config = {
  port: Number(process.env.PORT || 3000),
  // Публичный HTTPS-адрес, на котором открыт мини-апп (нужен для кнопки в боте)
  webAppUrl: process.env.WEBAPP_URL || '',
  botToken: process.env.BOT_TOKEN || '',
  // @username канала или числовой id (-100...). Бот должен быть админом канала.
  channelId: process.env.CHANNEL_ID || '@sellersplace2',
  channelUsername: process.env.CHANNEL_USERNAME || 'sellersplace2',
  // Telegram user id администраторов (модерация), через запятую
  adminIds: list(process.env.ADMIN_IDS).map(Number),
  adsContact: process.env.ADS_CONTACT || 'ranjiroakim',
  garantContact: process.env.GARANT_CONTACT || 'ranjiroakim',
  // Если true — объявления публикуются без модерации
  autoPublish: process.env.AUTO_PUBLISH === 'true',
  // Локальная разработка без Telegram: подставляется тестовый пользователь
  devMode: process.env.DEV_MODE === 'true',
  dataDir: process.env.DATA_DIR || './data',
  maxPhotos: 10,
  // Оплата размещения переводом на карту администратора (0 — бесплатно)
  postPrice: Number(process.env.POST_PRICE ?? 150),
  paymentCard: process.env.PAYMENT_CARD || '',
  paymentBank: process.env.PAYMENT_BANK || '',
  paymentHolder: process.env.PAYMENT_HOLDER || '',
};
