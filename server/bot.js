import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { formatPost, channelPostUrl, formatPrice } from './format.js';
import { db, getListing, setStatus, upsertUser } from './db.js';
import { isAdminUser } from './auth.js';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const photoInput = (p) => new InputFile(path.join(config.dataDir, 'uploads', path.basename(p)));

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const REJECT_REASONS = {
  nopay: 'Оплата не поступила',
  fake: 'Фейк вещь (п. 1)',
  ads: 'Реклама сторонних проектов (п. 5)',
  repeat: 'Эта вещь уже публиковалась менее 3 недель назад (п. 6)',
  photos: 'В посте должны быть только фото вещи (п. 7)',
  swear: 'Нецензурные высказывания (п. 9)',
  info: 'Не хватает информации (размер, состояние, цена)',
  segment: 'Вещь не подходит под сегмент люкс/премиум',
};

/** Отправить пост в канал. Возвращает id сообщений. */
export async function publishToChannel(listing) {
  if (!bot) {
    console.log('[dev] публикация в канал:\n' + formatPost(listing));
    return [];
  }
  const caption = formatPost(listing);
  const opts = { parse_mode: 'HTML' };
  const photos = listing.photos.slice(0, config.maxPhotos);
  if (photos.length === 0) {
    const m = await bot.api.sendMessage(config.channelId, caption, { ...opts, link_preview_options: { is_disabled: true } });
    return [m.message_id];
  }
  if (photos.length === 1) {
    const m = await bot.api.sendPhoto(config.channelId, photoInput(photos[0]), { caption, ...opts });
    return [m.message_id];
  }
  const media = photos.map((p, i) => ({
    type: 'photo',
    media: photoInput(p),
    ...(i === 0 ? { caption, parse_mode: 'HTML' } : {}),
  }));
  const msgs = await bot.api.sendMediaGroup(config.channelId, media);
  return msgs.map((m) => m.message_id);
}

/** Обновить подпись поста (например, пометка «ПРОДАНО») */
export async function refreshChannelPost(listing) {
  const [first] = listing.channel_message_ids;
  if (!bot || !first) return;
  const caption = formatPost(listing);
  try {
    if (listing.photos.length === 0) {
      await bot.api.editMessageText(config.channelId, first, caption, { parse_mode: 'HTML' });
    } else {
      await bot.api.editMessageCaption(config.channelId, first, { caption, parse_mode: 'HTML' });
    }
  } catch (e) {
    console.error('Не удалось обновить пост', listing.id, e.description || e.message);
  }
}

export async function deleteChannelPost(listing) {
  if (!bot || !listing.channel_message_ids.length) return;
  try {
    await bot.api.deleteMessages(config.channelId, listing.channel_message_ids);
  } catch (e) {
    console.error('Не удалось удалить пост', listing.id, e.description || e.message);
  }
}

export async function notifyUser(userId, text, extra = {}) {
  if (!bot) return console.log(`[dev] -> ${userId}: ${text}`);
  try {
    await bot.api.sendMessage(userId, text, { parse_mode: 'HTML', ...extra });
  } catch (e) {
    // Пользователь мог не запускать бота — это не ошибка для нас
    console.warn('notifyUser', userId, e.description || e.message);
  }
}

const MODERATABLE = ['pending', 'awaiting_payment'];
const STATUS_RU = {
  awaiting_payment: '💳 Ждёт оплаты', pending: '⏳ На модерации', published: '✅ Опубликовано',
  rejected: '❌ Отклонено', sold: 'Продано', archived: 'Снято',
};
const statusKb = (l) =>
  MODERATABLE.includes(l?.status) ? moderationKb(l) : new InlineKeyboard().text(STATUS_RU[l?.status] || 'Не найдено', 'noop');

/** Ссылка на ЛС администратора с готовым текстом сообщения об оплате */
export function paymentLink(l) {
  const what = l.kind === 'wtb' ? 'запроса «Ищу»' : 'объявления';
  const text = `Здравствуйте! Хочу оплатить размещение ${what} #${l.id} — ${l.brand} ${l.model} (${formatPrice(l.amount)})`;
  return `https://t.me/${config.paymentContact}?text=${encodeURIComponent(text)}`;
}

/** Продублировать инструкцию по оплате в бота — на случай, если клиент закрыл приложение */
export async function notifyPaymentInstructions(l) {
  await notifyUser(
    l.user_id,
    `📝 Объявление #${l.id} «${esc(l.brand)} ${esc(l.model)}» создано.\n\n` +
      `Стоимость размещения — <b>${formatPrice(l.amount)}</b>. Оплата принимается у администратора @${config.paymentContact} в личных сообщениях. ` +
      `Нажмите кнопку ниже — сообщение с номером объявления уже будет готово.\n\nПосле оплаты пост опубликуют в канале, мы пришлём ссылку.`,
    { reply_markup: new InlineKeyboard().url('💬 Написать администратору', paymentLink(l)) }
  );
}

export async function approveListing(id) {
  let l = getListing(id);
  if (!l || !MODERATABLE.includes(l.status)) return l;
  const ids = await publishToChannel(l);
  l = setStatus(id, 'published', { channel_message_ids: ids, ...(l.amount ? { paid_at: new Date().toISOString() } : {}) });
  const url = channelPostUrl(ids[0]);
  await notifyUser(l.user_id, `✅ Ваше объявление «${l.brand}» опубликовано${url ? `: ${url}` : ''}`);
  return l;
}

export async function rejectListing(id, reason, { backToPayment = false } = {}) {
  const l = getListing(id);
  if (!l || !MODERATABLE.includes(l.status)) return l;
  if (backToPayment) {
    // Оплата не поступила: объявление остаётся в статусе «Ждёт оплаты», клиенту — напоминание
    const out = setStatus(id, 'awaiting_payment', { reject_reason: reason || null });
    await notifyUser(l.user_id, `⚠️ Объявление #${l.id} «${esc(l.brand)}»: оплата пока не поступила.\nНапишите администратору @${config.paymentContact}.`, {
      reply_markup: new InlineKeyboard().url('💬 Написать администратору', paymentLink(l)),
    });
    return out;
  }
  const out = setStatus(id, 'rejected', { reject_reason: reason || null });
  await notifyUser(l.user_id, `❌ Объявление «${l.brand}» отклонено.${reason ? `\nПричина: ${reason}` : ''}\n\nИсправьте и отправьте заново в приложении.`);
  return out;
}

const moderationKb = (l) =>
  new InlineKeyboard()
    .text(l.amount ? '✅ Оплачено — опубликовать' : '✅ Опубликовать', `mod:ok:${l.id}`).row()
    .text('❌ Отклонить', `mod:no:${l.id}`);

/** Кому слать модерацию: ADMIN_IDS + пользователи из ADMIN_USERNAMES, которые уже запускали бота */
function adminRecipientIds() {
  const ids = new Set(config.adminIds);
  if (config.adminUsernames.length) {
    const marks = config.adminUsernames.map(() => '?').join(',');
    for (const r of db.prepare(`SELECT id FROM users WHERE lower(username) IN (${marks})`).all(...config.adminUsernames)) ids.add(r.id);
  }
  return [...ids];
}

/** Уведомить модераторов о новом объявлении */
export async function sendToModeration(listing) {
  if (!bot) return console.log(`[dev] на модерации #${listing.id}`);
  const kb = moderationKb(listing);
  const who = listing.username ? `@${esc(listing.username)}` : `<a href="tg://user?id=${listing.user_id}">${esc(listing.first_name || 'клиент')}</a>`;
  const payLine = listing.status === 'awaiting_payment'
    ? `💳 Ждёт оплаты ${formatPrice(listing.amount)}. ${who} напишет @${config.paymentContact} в ЛС с номером <b>#${listing.id}</b>.\nПосле оплаты нажмите «Оплачено».\n`
    : '';
  const caption = `🆕 Объявление <b>#${listing.id}</b>\n${payLine}\n${formatPost(listing)}`.slice(0, 1024);
  const recipients = adminRecipientIds();
  if (!recipients.length) console.warn('Нет админов для уведомлений: задайте ADMIN_USERNAMES и нажмите /start в боте с аккаунта админа');
  for (const adminId of recipients) {
    try {
      if (listing.photos.length > 1) {
        await bot.api.sendMediaGroup(adminId, listing.photos.map((p) => ({ type: 'photo', media: photoInput(p) })));
      }
      if (listing.photos.length === 1) {
        await bot.api.sendPhoto(adminId, photoInput(listing.photos[0]), { caption, parse_mode: 'HTML', reply_markup: kb });
      } else {
        await bot.api.sendMessage(adminId, caption, { parse_mode: 'HTML', reply_markup: kb });
      }
    } catch (e) {
      console.warn('moderation notify', adminId, e.description || e.message);
    }
  }
}

export function setupBot() {
  if (!bot) {
    console.log('BOT_TOKEN не задан — бот отключён (режим разработки)');
    return;
  }
  const openKb = () =>
    config.webAppUrl ? new InlineKeyboard().webApp('🛍 Открыть SELLERS PLACE', config.webAppUrl) : undefined;

  // Запоминаем каждого, кто пишет боту: так админы из ADMIN_USERNAMES получают уведомления без ручного ввода id
  bot.use(async (ctx, next) => {
    if (ctx.from && !ctx.from.is_bot) upsertUser(ctx.from);
    await next();
  });

  bot.command('id', (ctx) => ctx.reply(`Ваш Telegram id: <code>${ctx.from.id}</code>`, { parse_mode: 'HTML' }));

  bot.command('start', async (ctx) => {
    if (isAdminUser(ctx.from)) {
      await ctx.reply('🛠 Вы администратор SELLERS PLACE. Сюда будут приходить новые объявления с кнопками «Оплачено — опубликовать» и «Отклонить».');
    }
    return ctx.reply(
      '<b>SELLERS PLACE 👁‍🗨</b>\nПлощадка для продажи брендовых вещей в сегменте люкс и премиум.\n\n' +
        '• Разместите вещь — пост появится в канале после модерации\n' +
        '• Ищете конкретную вещь — оставьте запрос «Ищу»\n' +
        '• Смотрите каталог с фильтрами по бренду, размеру и цене\n\n' +
        `Реклама и сотрудничество — @${config.adsContact}`,
      { parse_mode: 'HTML', reply_markup: openKb() }
    );
  });

  const isAdmin = (ctx) => isAdminUser(ctx.from);

  bot.callbackQuery(/^mod:ok:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Нет доступа');
    const l = await approveListing(Number(ctx.match[1]));
    await ctx.answerCallbackQuery(STATUS_RU[l?.status] || 'Не найдено');
    await ctx.editMessageReplyMarkup({ reply_markup: statusKb(l) }).catch(() => {});
  });

  bot.callbackQuery(/^mod:no:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Нет доступа');
    const id = ctx.match[1];
    const kb = new InlineKeyboard();
    const l = getListing(Number(id));
    for (const [key, text] of Object.entries(REJECT_REASONS)) {
      if (key === 'nopay' && !l?.amount) continue;
      kb.text(text, `mod:rj:${id}:${key}`).row();
    }
    kb.text('← Назад', `mod:back:${id}`);
    await ctx.editMessageReplyMarkup({ reply_markup: kb });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^mod:back:(\d+)$/, async (ctx) => {
    const id = ctx.match[1];
    const l = getListing(Number(id));
    if (l) await ctx.editMessageReplyMarkup({ reply_markup: moderationKb(l) });
    await ctx.answerCallbackQuery();
  });

  bot.callbackQuery(/^mod:rj:(\d+):(\w+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Нет доступа');
    const l = await rejectListing(Number(ctx.match[1]), REJECT_REASONS[ctx.match[2]], { backToPayment: ctx.match[2] === 'nopay' });
    await ctx.answerCallbackQuery(l?.status === 'awaiting_payment' ? 'Клиенту отправлено напоминание об оплате' : 'Отклонено');
    await ctx.editMessageReplyMarkup({ reply_markup: statusKb(l) }).catch(() => {});
  });

  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());
  bot.catch((err) => console.error('bot error', err.error));

  if (config.webAppUrl) {
    bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Маркет', web_app: { url: config.webAppUrl } } }).catch(() => {});
  }
  bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен`) });
}
