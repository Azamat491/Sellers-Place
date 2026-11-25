import path from 'node:path';
import { Bot, InlineKeyboard, InputFile } from 'grammy';
import { config } from './config.js';
import { formatPost, channelPostUrl } from './format.js';
import { getListing, setStatus } from './db.js';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const photoInput = (p) => new InputFile(path.join(config.dataDir, 'uploads', path.basename(p)));

const REJECT_REASONS = {
  nopay: 'Оплата не найдена — проверьте перевод и прикрепите чек заново',
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

export async function approveListing(id) {
  let l = getListing(id);
  if (!l || l.status !== 'pending') return l;
  const ids = await publishToChannel(l);
  l = setStatus(id, 'published', { channel_message_ids: ids, ...(l.amount ? { paid_at: new Date().toISOString() } : {}) });
  const url = channelPostUrl(ids[0]);
  await notifyUser(l.user_id, `✅ Ваше объявление «${l.brand}» опубликовано${url ? `: ${url}` : ''}`);
  return l;
}

export async function rejectListing(id, reason, { backToPayment = false } = {}) {
  const l = getListing(id);
  if (!l || l.status !== 'pending') return l;
  if (backToPayment) {
    // Оплата не найдена: возвращаем объявление на шаг оплаты, чтобы автор приложил верный чек
    const out = setStatus(id, 'awaiting_payment', { reject_reason: reason || null, receipt: null });
    await notifyUser(l.user_id, `⚠️ Объявление «${l.brand}»: ${reason}\n\nОткройте приложение → Профиль → «Оплатить».`);
    return out;
  }
  const out = setStatus(id, 'rejected', { reject_reason: reason || null });
  await notifyUser(l.user_id, `❌ Объявление «${l.brand}» отклонено.${reason ? `\nПричина: ${reason}` : ''}\n\nИсправьте и отправьте заново в приложении.`);
  return out;
}

const moderationKb = (l) =>
  new InlineKeyboard()
    .text(l.amount ? '✅ Оплата есть — опубликовать' : '✅ Опубликовать', `mod:ok:${l.id}`).row()
    .text('❌ Отклонить', `mod:no:${l.id}`);

/** Уведомить модераторов о новом объявлении */
export async function sendToModeration(listing) {
  if (!bot) return console.log(`[dev] на модерации #${listing.id}`);
  const kb = moderationKb(listing);
  const paidLine = listing.amount ? `💳 Оплата ${listing.amount} ₽ — чек выше, сверьте поступление на карту\n` : '';
  const caption = `🆕 Объявление #${listing.id} на модерации\n${paidLine}\n${formatPost(listing)}`.slice(0, 1024);
  for (const adminId of config.adminIds) {
    try {
      if (listing.receipt) {
        const who = listing.username ? `@${listing.username}` : listing.first_name || listing.user_id;
        await bot.api.sendPhoto(adminId, new InputFile(path.join(config.dataDir, 'receipts', path.basename(listing.receipt))), {
          caption: `🧾 Чек #${listing.id} от ${who} на ${listing.amount} ₽`,
        });
      }
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

  bot.command('start', (ctx) =>
    ctx.reply(
      '<b>SELLERS PLACE 👁‍🗨</b>\nПлощадка для продажи брендовых вещей в сегменте люкс и премиум.\n\n' +
        '• Разместите вещь — пост появится в канале после модерации\n' +
        '• Ищете конкретную вещь — оставьте запрос «Ищу»\n' +
        '• Смотрите каталог с фильтрами по бренду, размеру и цене\n\n' +
        `Реклама и сотрудничество — @${config.adsContact}`,
      { parse_mode: 'HTML', reply_markup: openKb() }
    )
  );

  const isAdmin = (ctx) => config.adminIds.includes(ctx.from?.id);

  bot.callbackQuery(/^mod:ok:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Нет доступа');
    const l = await approveListing(Number(ctx.match[1]));
    await ctx.answerCallbackQuery(l?.status === 'published' ? 'Опубликовано' : `Статус: ${l?.status}`);
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`Статус: ${l?.status}`, 'noop') }).catch(() => {});
  });

  bot.callbackQuery(/^mod:no:(\d+)$/, async (ctx) => {
    if (!isAdmin(ctx)) return ctx.answerCallbackQuery('Нет доступа');
    const id = ctx.match[1];
    const kb = new InlineKeyboard();
    const l = getListing(Number(id));
    for (const [key, text] of Object.entries(REJECT_REASONS)) {
      if (key === 'nopay' && !l?.amount) continue;
      kb.text(key === 'nopay' ? 'Оплата не найдена' : text, `mod:rj:${id}:${key}`).row();
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
    await ctx.answerCallbackQuery('Отклонено');
    await ctx.editMessageReplyMarkup({ reply_markup: new InlineKeyboard().text(`Статус: ${l?.status}`, 'noop') }).catch(() => {});
  });

  bot.callbackQuery('noop', (ctx) => ctx.answerCallbackQuery());
  bot.catch((err) => console.error('bot error', err.error));

  if (config.webAppUrl) {
    bot.api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'Маркет', web_app: { url: config.webAppUrl } } }).catch(() => {});
  }
  bot.start({ onStart: (me) => console.log(`Бот @${me.username} запущен`) });
}
