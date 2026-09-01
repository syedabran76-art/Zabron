/**
 * Zabron — Onboarding & mention-response regression tests.
 *
 * Covers:
 *   - SUPPORT_SERVER_URL configuration (env var, fallback, validation)
 *   - welcomeEmbed / mentionHelpEmbed / supportButtonRow builders
 *   - GuildCreate channel selection:
 *       - prefers system channel when usable
 *       - falls back to first usable text channel
 *       - returns null when nothing is usable
 *   - Idempotency: re-sending welcome is a no-op
 *   - sendGuildWelcomeMessage: full happy path + permission failure
 *   - buildMentionReplyPayload: shows ACTUAL guild prefix
 *   - Default prefix is used when no custom prefix is configured
 *   - Missing SUPPORT_SERVER_URL does NOT render a Support button
 *   - Missing/unusable channels do NOT crash the caller
 *
 * The tests use a real on-disk SQLite database via the production
 * initDatabase() so the prefix-repository round-trips are realistic.
 * They do NOT spin up a real Discord client — they exercise the pure
 * logic and use lightweight stubs for the Guild/Channel objects.
 */

import { test, before, beforeEach, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';

import {
  ChannelType,
  Collection,
  Guild,
  GuildChannel,
  PermissionFlagsBits,
  PermissionsBitField,
  ActionRowBuilder,
} from 'discord.js';

import { initDatabase } from '../src/db/database.js';
import {
  getGuildSettings,
  updateGuildSettings,
} from '../src/db/repositories.js';

// IMPORTANT: import AFTER initDatabase() is invoked in before().
// Some modules read process.env at import-time.

// ---------- Test DB setup ----------

const TEST_DB_DIR = join(process.cwd(), '.test-build');
const TEST_DB_PATH = join(TEST_DB_DIR, 'onboarding-test.sqlite');
const ORIGINAL_SUPPORT_URL = process.env.SUPPORT_SERVER_URL;

before(() => {
  if (!existsSync(TEST_DB_DIR)) mkdirSync(TEST_DB_DIR, { recursive: true });
  // Reset DB to a known empty file for this suite, including WAL/SHM
  // sidecar files from previous runs.
  cleanTestDb();
  // Always reset support URL before each test.
  delete process.env.SUPPORT_SERVER_URL;
  initDatabase(TEST_DB_PATH);
});

// Restore the original env after the suite.
after(() => {
  if (ORIGINAL_SUPPORT_URL === undefined) {
    delete process.env.SUPPORT_SERVER_URL;
  } else {
    process.env.SUPPORT_SERVER_URL = ORIGINAL_SUPPORT_URL;
  }
  cleanTestDb();
});

// Reset DB state between tests so prefix changes don't leak.
// We also remove the WAL/SHM sidecar files so successive test runs
// start from a clean slate.
function cleanTestDb(): void {
  for (const suffix of ['', '-shm', '-wal']) {
    const p = TEST_DB_PATH + suffix;
    if (existsSync(p)) {
      try { rmSync(p); } catch { /* ignore */ }
    }
  }
}
afterEach(() => {
  cleanTestDb();
  initDatabase(TEST_DB_PATH);
  // Reset module-level welcome state.
  try {
    resetWelcomeStateForTests();
  } catch {}
});

// ---------------------------------------------------------------------------
// Imports of the modules under test (AFTER initDatabase so the repo is bound).
// ---------------------------------------------------------------------------

import {
  getSupportServerUrl,
  getSupportServerConfig,
  isValidSupportUrl,
} from '../src/config/support.js';

import {
  welcomeEmbed,
  mentionHelpEmbed,
  supportButtonRow,
  BRAND_NAME,
  BOT_TAGLINE,
  WELCOME_COLOR,
  INFO_COLOR,
} from '../src/embeds/builders.js';

import {
  sendGuildWelcomeMessage,
  buildWelcomePayload,
  buildMentionReplyPayload,
  pickWelcomeChannel,
  isSendableTextChannel,
  hasAlreadyWelcomed,
  __resetWelcomeStateForTests as resetWelcomeStateForTests,
} from '../src/services/onboarding.js';

// (No DEFAULT_PREFIX constant exported from repositories — we verify
// the fallback behaviour via getGuildSettings() returning '.' when no
// custom prefix is set.)

// ===========================================================================
// HELPERS — lightweight Discord.js stubs
// ===========================================================================

interface StubChannelOpts {
  id: string;
  name?: string;
  type: ChannelType;
  position?: number;
  /** When true the bot has all the required permissions. */
  botHasPerms?: boolean;
}

interface StubGuildOpts {
  id: string;
  name: string;
  systemChannelId?: string | null;
  /** Pre-built channels to include. Allows spy channels. */
  channels?: Array<{ channel: GuildChannel; opts: StubChannelOpts }>;
  /**
   * Channel definitions to build with the default stub helper.
   * Ignored if `channels` is provided.
   */
  channelSpecs?: StubChannelOpts[];
}

function stubPerms(hasAll: boolean): PermissionsBitField {
  const flags = hasAll
    ? PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.SendMessages |
      PermissionFlagsBits.EmbedLinks
    : 0n;
  return new PermissionsBitField(flags);
}

function stubChannelFromOpts(opts: StubChannelOpts): GuildChannel {
  const ch: any = {
    id: opts.id,
    name: opts.name ?? opts.id,
    type: opts.type,
    position: opts.position ?? 0,
    rawPosition: opts.position ?? 0,
    parentId: null,
    guild: undefined,
    permissionsFor: () => stubPerms(opts.botHasPerms !== false),
    permissionOverwrites: { edit: () => Promise.resolve() },
    send: (..._a: unknown[]) => Promise.resolve(undefined),
    delete: () => Promise.resolve(),
    toString: () => `<#${opts.id}>`,
  };
  return ch as GuildChannel;
}

/**
 * Spy-style sendable channel — records every `.send()` payload for inspection.
 */
function spyChannel(opts: StubChannelOpts & { record: { lastPayload?: any } }): GuildChannel {
  const base = stubChannelFromOpts(opts);
  (base as any).send = (payload: unknown) => {
    opts.record.lastPayload = payload;
    return Promise.resolve(undefined);
  };
  return base;
}

function stubGuild(opts: StubGuildOpts): Guild {
  // Build the channel list.
  const items: Array<{ channel: GuildChannel; opts: StubChannelOpts }> = [];
  if (opts.channels) {
    items.push(...opts.channels);
  }
  if (opts.channelSpecs) {
    for (const spec of opts.channelSpecs) {
      items.push({ channel: stubChannelFromOpts(spec), opts: spec });
    }
  }

  const channels = new Collection<string, GuildChannel>();
  let sysChan: GuildChannel | null = null;
  for (const { channel, opts: cOpts } of items) {
    channels.set(cOpts.id, channel);
    if (opts.systemChannelId && cOpts.id === opts.systemChannelId) {
      sysChan = channel;
    }
  }

  const me: any = {
    id: 'bot-id-1234',
    tag: 'Zabron#0001',
    bot: true,
  };

  const everyoneRole: any = {
    id: opts.id + '-everyone',
    name: '@everyone',
    permissions: new PermissionsBitField(PermissionFlagsBits.ViewChannel),
  };

  const guild: any = {
    id: opts.id,
    name: opts.name,
    systemChannel: sysChan,
    systemChannelId: opts.systemChannelId ?? null,
    channels: { cache: channels },
    members: { me },
    roles: { everyone: everyoneRole },
    ownerId: 'owner-id',
  };

  // Wire each channel back to the guild so permissionsFor resolves.
  for (const ch of channels.values()) {
    (ch as any).guild = guild;
  }

  return guild as Guild;
}

// ===========================================================================
// SUPPORT SERVER CONFIG
// ===========================================================================

test('support config: returns null when SUPPORT_SERVER_URL is unset', () => {
  delete process.env.SUPPORT_SERVER_URL;
  const cfg = getSupportServerConfig();
  assert.strictEqual(cfg.url, null);
  assert.strictEqual(cfg.isConfigured, false);
  assert.strictEqual(getSupportServerUrl(), null);
});

test('support config: returns null when SUPPORT_SERVER_URL is empty', () => {
  process.env.SUPPORT_SERVER_URL = '';
  assert.strictEqual(getSupportServerUrl(), null);
  process.env.SUPPORT_SERVER_URL = '   ';
  assert.strictEqual(getSupportServerUrl(), null);
});

test('support config: returns null when SUPPORT_SERVER_URL is invalid', () => {
  for (const bad of ['not-a-url', 'ftp://example.com', 'javascript:alert(1)', '   spaces   ']) {
    process.env.SUPPORT_SERVER_URL = bad;
    assert.strictEqual(isValidSupportUrl(bad), false, `should reject "${bad}"`);
    assert.strictEqual(getSupportServerUrl(), null, `should resolve null for "${bad}"`);
  }
});

test('support config: accepts http(s) URLs', () => {
  for (const good of [
    'https://discord.gg/abc',
    'http://example.com',
    'https://discord.com/invite/xyz',
  ]) {
    process.env.SUPPORT_SERVER_URL = good;
    assert.strictEqual(getSupportServerUrl(), good, `should accept "${good}"`);
  }
  delete process.env.SUPPORT_SERVER_URL;
});

// ===========================================================================
// EMBED BUILDERS
// ===========================================================================

test('welcomeEmbed: contains brand name and tagline', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/test';
  const embed = welcomeEmbed({
    guildName: 'My Test Guild',
    prefix: '!',
    supportUrl: getSupportServerUrl(),
  });
  const title = embed.data.title ?? '';
  const description = embed.data.description ?? '';
  const footer = embed.data.footer?.text ?? '';
  assert.ok(title.includes(BRAND_NAME), 'title should contain brand name');
  assert.ok(description.includes(BOT_TAGLINE), 'description should contain tagline');
  assert.ok(footer.includes(BRAND_NAME), 'footer should contain brand name');
  // Welcome tone color
  assert.strictEqual(embed.data.color, WELCOME_COLOR);
  delete process.env.SUPPORT_SERVER_URL;
});

test('welcomeEmbed: shows the ACTUAL configured prefix', () => {
  const embed = welcomeEmbed({
    guildName: 'G',
    prefix: '!!',
    supportUrl: null,
  });
  // The prefix appears in:
  //   - the "🔧 Prefix" field's value (e.g. `Your server prefix is `!!`...`)
  //   - the "🚀 Getting Started" field's value (`check `!!help` for...`)
  // It does NOT appear in the top-level description (which is generic).
  const prefixField = (embed.data.fields ?? []).find((f) => f.name.includes('Prefix'));
  assert.ok(prefixField, 'embed should have a Prefix field');
  assert.ok(prefixField!.value.includes('!!'), `Prefix field should contain the actual prefix. Got: ${prefixField!.value}`);

  const gettingStarted = (embed.data.fields ?? []).find((f) => f.name.includes('Getting Started'));
  assert.ok(gettingStarted, 'embed should have a Getting Started field');
  assert.ok(gettingStarted!.value.includes('!!'), 'Getting Started field should mention the actual prefix');
});

test('welcomeEmbed: defaults to "." when prefix is missing', () => {
  const embed = welcomeEmbed({
    guildName: 'G',
    prefix: '',
    supportUrl: null,
  });
  const fieldsText = (embed.data.fields ?? []).map((f) => `${f.name} ${f.value}`).join('\n');
  // We look for backtick-wrapped `.` rather than the raw `.` because
  // the surrounding text contains many periods.
  assert.ok(/`\.`/.test(fieldsText), `embed must fall back to default prefix \`.\`. Got:\n${fieldsText}`);
});

test('welcomeEmbed: Support field changes when supportUrl is missing', () => {
  const withUrl = welcomeEmbed({ guildName: 'G', prefix: '.', supportUrl: 'https://discord.gg/x' });
  const withoutUrl = welcomeEmbed({ guildName: 'G', prefix: '.', supportUrl: null });

  const findSupport = (e: any) => (e.data.fields ?? []).find((f: any) => f.name.includes('Support'))?.value ?? '';

  assert.notStrictEqual(findSupport(withUrl), findSupport(withoutUrl));
  assert.ok(findSupport(withoutUrl).toLowerCase().includes('not configured'));
});

test('supportButtonRow: returns null when no URL configured', () => {
  const row = supportButtonRow({ supportUrl: null });
  assert.strictEqual(row, null);
});

test('supportButtonRow: builds a Link button when URL is configured', () => {
  const row = supportButtonRow({ supportUrl: 'https://discord.gg/abc' });
  assert.ok(row, 'should produce a row');
  assert.ok(row instanceof ActionRowBuilder);
  const json = (row as any).toJSON();
  assert.ok(json.components?.length === 1);
  assert.strictEqual(json.components[0].style, 5 /* LINK */);
  assert.strictEqual(json.components[0].url, 'https://discord.gg/abc');
});

test('mentionHelpEmbed: shows the actual prefix', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/x';
  const embed = mentionHelpEmbed({ prefix: '?', supportUrl: getSupportServerUrl() });
  const description = embed.data.description ?? '';
  assert.ok(description.includes('?'), 'description should include the prefix');
  assert.strictEqual(embed.data.color, INFO_COLOR);
  delete process.env.SUPPORT_SERVER_URL;
});

// ===========================================================================
// CHANNEL SELECTION
// ===========================================================================

test('isSendableTextChannel: recognises text-like types only', () => {
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildText }), true);
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildAnnouncement }), true);
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildVoice }), true);
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildStageVoice }), true);
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.PublicThread }), true);

  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildForum }), false);
  assert.strictEqual(isSendableTextChannel({ type: ChannelType.GuildCategory }), false);
  assert.strictEqual(isSendableTextChannel(null), false);
  assert.strictEqual(isSendableTextChannel(undefined), false);
});

test('pickWelcomeChannel: prefers system channel when usable', () => {
  const guild = stubGuild({
    id: 'g1',
    name: 'Test',
    systemChannelId: 'sys-1',
    channelSpecs: [
      { id: 'sys-1', name: 'system', type: ChannelType.GuildText, position: 0, botHasPerms: true },
      { id: 'general', name: 'general', type: ChannelType.GuildText, position: 1, botHasPerms: true },
    ],
  });
  const picked = pickWelcomeChannel(guild);
  assert.ok(picked);
  assert.strictEqual(picked!.channel.id, 'sys-1');
  assert.strictEqual(picked!.reason, 'system-channel');
});

test('pickWelcomeChannel: falls back to first usable text channel when system is missing', () => {
  // Sort order: lower position first. We pick "general" (position 1) by
  // giving the voice channel higher position so it's NOT the lowest.
  const guild = stubGuild({
    id: 'g2',
    name: 'Test',
    systemChannelId: null,
    channelSpecs: [
      { id: 'voice-1', type: ChannelType.GuildVoice, position: 2, botHasPerms: true },
      { id: 'general', name: 'general', type: ChannelType.GuildText, position: 1, botHasPerms: true },
      { id: 'news', type: ChannelType.GuildAnnouncement, position: 3, botHasPerms: true },
    ],
  });
  const picked = pickWelcomeChannel(guild);
  assert.ok(picked);
  assert.strictEqual(picked!.channel.id, 'general');
  assert.strictEqual(picked!.reason, 'fallback');
});

test('pickWelcomeChannel: falls back when system channel lacks permissions', () => {
  const guild = stubGuild({
    id: 'g3',
    name: 'Test',
    systemChannelId: 'sys-1',
    channelSpecs: [
      // System channel exists but the bot cannot send there.
      { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: false },
      { id: 'general', type: ChannelType.GuildText, position: 1, botHasPerms: true },
    ],
  });
  const picked = pickWelcomeChannel(guild);
  assert.ok(picked);
  assert.strictEqual(picked!.channel.id, 'general');
  assert.strictEqual(picked!.reason, 'fallback');
});

test('pickWelcomeChannel: returns null when no channel has permissions', () => {
  const guild = stubGuild({
    id: 'g4',
    name: 'Test',
    systemChannelId: 'sys-1',
    channelSpecs: [
      { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: false },
      { id: 'general', type: ChannelType.GuildText, position: 1, botHasPerms: false },
      { id: 'voice-1', type: ChannelType.GuildVoice, position: 2, botHasPerms: false },
    ],
  });
  const picked = pickWelcomeChannel(guild);
  assert.strictEqual(picked, null);
});

test('pickWelcomeChannel: returns null when there are no text-like channels at all', () => {
  const guild = stubGuild({
    id: 'g5',
    name: 'Test',
    systemChannelId: null,
    channelSpecs: [
      { id: 'cat', type: ChannelType.GuildCategory, position: 0 },
    ],
  });
  const picked = pickWelcomeChannel(guild);
  assert.strictEqual(picked, null);
});

// ===========================================================================
// FULL WELCOME FLOW
// ===========================================================================

test('sendGuildWelcomeMessage: sends to system channel and marks guild welcomed', async () => {
  const record: { lastPayload?: any } = {};
  const sysCh = spyChannel({
    id: 'sys-1',
    type: ChannelType.GuildText,
    position: 0,
    botHasPerms: true,
    record,
  });

  const guild = stubGuild({
    id: 'gw1',
    name: 'Welcome Test',
    systemChannelId: 'sys-1',
    channels: [{ channel: sysCh, opts: { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: true } }],
  });

  // Make sure the DB row exists.
  updateGuildSettings('gw1', { prefix: '.' });
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/test';

  const result = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(result.status, 'sent');
  assert.strictEqual(result.channelId, 'sys-1');
  assert.ok(record.lastPayload, 'send() must have been called');
  assert.ok(record.lastPayload.embeds?.length === 1, 'payload should include the embed');
  assert.strictEqual(hasAlreadyWelcomed('gw1'), true);

  delete process.env.SUPPORT_SERVER_URL;
});

test('sendGuildWelcomeMessage: idempotent — second call returns duplicate status', async () => {
  // Use a counter to assert that the channel's send() was called
  // exactly once, not "the payload is undefined" which would conflate
  // "not called" with "called once with the first payload".
  let sendCalls = 0;
  const sysCh: any = stubChannelFromOpts({
    id: 'sys-1',
    type: ChannelType.GuildText,
    position: 0,
    botHasPerms: true,
  });
  sysCh.send = () => { sendCalls += 1; return Promise.resolve(undefined); };

  const guild = stubGuild({
    id: 'gw2',
    name: 'Welcome Test',
    systemChannelId: 'sys-1',
    channels: [{ channel: sysCh, opts: { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: true } }],
  });
  updateGuildSettings('gw2', { prefix: '.' });

  const first = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(first.status, 'sent');
  assert.strictEqual(sendCalls, 1, 'first call must send exactly once');

  const second = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(second.status, 'duplicate');
  assert.strictEqual(sendCalls, 1, 'second call must NOT send again');
});

test('sendGuildWelcomeMessage: returns no-system-channel when no usable channel exists', async () => {
  const guild = stubGuild({
    id: 'gw3',
    name: 'No channels',
    systemChannelId: null,
    channelSpecs: [
      { id: 'broken', type: ChannelType.GuildText, position: 0, botHasPerms: false },
    ],
  });
  updateGuildSettings('gw3', { prefix: '.' });

  const result = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(result.status, 'no-system-channel');
  assert.strictEqual(result.reason, 'no-channel-with-perms');
  assert.strictEqual(hasAlreadyWelcomed('gw3'), false, 'should NOT mark a failed welcome');
});

test('sendGuildWelcomeMessage: never crashes when SUPPORT_SERVER_URL is missing', async () => {
  delete process.env.SUPPORT_SERVER_URL;

  const record: { lastPayload?: any } = {};
  const sysCh = spyChannel({
    id: 'sys-1',
    type: ChannelType.GuildText,
    position: 0,
    botHasPerms: true,
    record,
  });
  const guild = stubGuild({
    id: 'gw4',
    name: 'No Support URL',
    systemChannelId: 'sys-1',
    channels: [{ channel: sysCh, opts: { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: true } }],
  });
  updateGuildSettings('gw4', { prefix: '.' });

  const result = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(result.status, 'sent');
  // No support button row should be present.
  const components = record.lastPayload?.components ?? [];
  assert.strictEqual(components.length, 0, 'no button rows when SUPPORT_SERVER_URL is missing');
  // But the embed is still rendered.
  assert.ok(record.lastPayload?.embeds?.length === 1);
  // And the embed's Support field says "Not configured".
  const supportField = record.lastPayload.embeds[0].data.fields.find((f: any) => f.name.includes('Support'));
  assert.ok(supportField, 'Support field should still exist');
  assert.ok(/not configured/i.test(supportField.value));
});

test('sendGuildWelcomeMessage: send failure does not throw and is reported', async () => {
  // Build a stub channel whose .send() rejects with a known error.
  const failingCh: any = stubChannelFromOpts({
    id: 'sys-1',
    type: ChannelType.GuildText,
    position: 0,
    botHasPerms: true,
  });
  failingCh.send = () => Promise.reject(new Error('Missing Permissions'));

  const guild = stubGuild({
    id: 'gw5',
    name: 'Fail Test',
    systemChannelId: 'sys-1',
    channels: [{ channel: failingCh, opts: { id: 'sys-1', type: ChannelType.GuildText, position: 0, botHasPerms: true } }],
  });
  updateGuildSettings('gw5', { prefix: '.' });

  const result = await sendGuildWelcomeMessage(guild);
  assert.strictEqual(result.status, 'send-failed');
  assert.ok(/Missing Permissions/.test(result.reason ?? ''), `reason should mention the error: ${result.reason}`);
  assert.strictEqual(hasAlreadyWelcomed('gw5'), false, 'failed welcome must NOT be marked');
});

// ===========================================================================
// PREFIX DISPLAY
// ===========================================================================

test('buildWelcomePayload: uses the ACTUAL guild prefix (custom prefix)', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/x';
  const guildId = 'prefix-1';
  updateGuildSettings(guildId, { prefix: '$$$' });
  const guild = stubGuild({
    id: guildId,
    name: 'Custom Prefix',
    systemChannelId: null,
    channels: [],
  });
  const { payload } = buildWelcomePayload(guild);
  const text = JSON.stringify(payload);
  assert.ok(text.includes('$$$'), 'embed must contain the configured custom prefix');
  delete process.env.SUPPORT_SERVER_URL;
});

test('buildWelcomePayload: falls back to default "." when no custom prefix', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/x';
  // Insert a row WITHOUT setting a custom prefix.
  const guildId = 'prefix-default';
  getGuildSettings(guildId); // seeds default '.'
  const guild = stubGuild({
    id: guildId,
    name: 'Default Prefix',
    systemChannelId: null,
    channels: [],
  });
  const { payload } = buildWelcomePayload(guild);
  const text = JSON.stringify(payload);
  // Default prefix must be shown.
  assert.ok(/`\.`/.test(text), 'embed must show the default prefix `.`');
  delete process.env.SUPPORT_SERVER_URL;
});

test('buildMentionReplyPayload: shows the actual guild prefix', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/x';
  const guildId = 'mention-1';
  updateGuildSettings(guildId, { prefix: '>>' });
  const { payload } = buildMentionReplyPayload(guildId);
  const text = JSON.stringify(payload);
  assert.ok(text.includes('>>'), 'reply must contain the configured prefix');
  delete process.env.SUPPORT_SERVER_URL;
});

test('buildMentionReplyPayload: no support button when SUPPORT_SERVER_URL is missing', () => {
  delete process.env.SUPPORT_SERVER_URL;
  const guildId = 'mention-2';
  updateGuildSettings(guildId, { prefix: '?' });
  const { payload, supportConfigured } = buildMentionReplyPayload(guildId);
  assert.strictEqual(supportConfigured, false);
  const components = payload.components ?? [];
  assert.strictEqual(components.length, 0);
});

test('buildMentionReplyPayload: support button is added when SUPPORT_SERVER_URL is set', () => {
  process.env.SUPPORT_SERVER_URL = 'https://discord.gg/hello';
  const guildId = 'mention-3';
  updateGuildSettings(guildId, { prefix: '!' });
  const { payload, supportConfigured } = buildMentionReplyPayload(guildId);
  assert.strictEqual(supportConfigured, true);
  const components = payload.components ?? [];
  assert.strictEqual(components.length, 1, 'one button row should be attached');
  delete process.env.SUPPORT_SERVER_URL;
});

// ===========================================================================
// SOURCE CHECKS — make sure we are NOT hardcoding the prefix anywhere
// ===========================================================================

test('source check: onboarding service does NOT hardcode the prefix', () => {
  // Read the source file and assert no literal hardcoded prefix appears.
  // The only legitimate place is the `|| '.'` fallback in
  // `buildWelcomePayload`. This is a guard against regressions where
  // someone copy-pastes a hardcoded prefix into the embed builder.
  const src = readFileSync(
    join(process.cwd(), 'src/services/onboarding.ts'),
    'utf8',
  );
  // We ban the bare assignment `prefix = '.'` (single-character literal).
  // The fallback in buildWelcomePayload uses `|| '.'` which is fine.
  const hardcodedAssignments = src.match(/prefix\s*=\s*['"`]\.['"`]/g) ?? [];
  assert.strictEqual(
    hardcodedAssignments.length,
    0,
    `onboarding.ts must never hardcode the prefix as a literal assignment (found ${hardcodedAssignments.length})`,
  );
});