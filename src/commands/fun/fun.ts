/**
 * /8ball, /coinflip, /dice, /trivia, /friendship, /ship
 */

import { ChatInputCommandInteraction, Message, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond, replyError } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { resolveUser } from '../../utils/permissions.js';

const EIGHT_BALL_RESPONSES = [
  'It is certain.', 'It is decidedly so.', 'Without a doubt.', 'Yes, definitely.',
  'You may rely on it.', 'As I see it, yes.', 'Most likely.', 'Outlook good.',
  'Yes.', 'Signs point to yes.', 'Reply hazy, try again.', 'Ask again later.',
  'Better not tell you now.', 'Cannot predict now.', 'Concentrate and ask again.',
  'Don\'t count on it.', 'My reply is no.', 'My sources say no.', 'Outlook not so good.',
  'Very doubtful.',
];

const TRIVIA_QUESTIONS = [
  { q: 'What planet is known as the Red Planet?', a: 'Mars', options: ['Mars', 'Venus', 'Jupiter', 'Mercury'] },
  { q: 'Who painted the Mona Lisa?', a: 'Leonardo da Vinci', options: ['Picasso', 'Da Vinci', 'Van Gogh', 'Rembrandt'] },
  { q: 'What is the capital of Japan?', a: 'Tokyo', options: ['Seoul', 'Tokyo', 'Beijing', 'Bangkok'] },
  { q: 'Which element has the chemical symbol "O"?', a: 'Oxygen', options: ['Osmium', 'Oxygen', 'Oganesson', 'Opium'] },
  { q: 'How many continents are there on Earth?', a: '7', options: ['5', '6', '7', '8'] },
];

const eightBall: CommandDefinition = {
  name: '8ball',
  description: 'Ask the magic 8-ball a question.',
  category: 'fun',
  cooldownSeconds: 3,
  buildSlash() {
    return new SlashCommandBuilder().setName('8ball').setDescription('Ask the magic 8-ball.').addStringOption((o) => o.setName('question').setDescription('Your question').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { question: i.options.getString('question', true) }; },
  async parsePrefix(_m: Message, raw: string[]) { return { question: raw.join(' ') }; },
  async run(ctx: CommandContext) {
    const answer = EIGHT_BALL_RESPONSES[Math.floor(Math.random() * EIGHT_BALL_RESPONSES.length)];
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: '🎱 Magic 8-Ball', description: `Question: ${(ctx.args as any).question}\nAnswer: **${answer}**` })] });
  },
};

const coinflip: CommandDefinition = {
  name: 'coinflip',
  description: 'Flip a coin.',
  category: 'fun',
  cooldownSeconds: 2,
  buildSlash() { return new SlashCommandBuilder().setName('coinflip').setDescription('Flip a coin.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const result = Math.random() < 0.5 ? 'Heads' : 'Tails';
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: '🪙 Coin Flip', description: `Result: **${result}**` })] });
  },
};

const dice: CommandDefinition = {
  name: 'dice',
  description: 'Roll a dice.',
  category: 'fun',
  cooldownSeconds: 2,
  buildSlash() {
    return new SlashCommandBuilder().setName('dice').setDescription('Roll a dice.').addIntegerOption((o) => o.setName('sides').setDescription('Number of sides').setMinValue(2).setMaxValue(100).setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { sides: i.options.getInteger('sides') ?? 6 }; },
  async parsePrefix(_m: Message, raw: string[]) { return { sides: Number(raw[0]) || 6 }; },
  async run(ctx: CommandContext) {
    const sides = (ctx.args as any).sides || 6;
    const roll = Math.floor(Math.random() * sides) + 1;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: '🎲 Dice Roll', description: `Rolled a **${roll}** (1-${sides})` })] });
  },
};

const trivia: CommandDefinition = {
  name: 'trivia',
  description: 'Answer a random trivia question.',
  category: 'fun',
  cooldownSeconds: 10,
  buildSlash() { return new SlashCommandBuilder().setName('trivia').setDescription('Answer trivia.'); },
  parseSlash() { return {}; },
  parsePrefix() { return {}; },
  async run(ctx: CommandContext) {
    const q = TRIVIA_QUESTIONS[Math.floor(Math.random() * TRIVIA_QUESTIONS.length)];
    const shuffled = [...q.options].sort(() => Math.random() - 0.5);
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Trivia', description: q.q, fields: shuffled.map((opt, idx) => ({ name: `Option ${idx + 1}`, value: opt, inline: true })) })] });
  },
};

const friendship: CommandDefinition = {
  name: 'friendship',
  description: 'Rate your friendship with someone.',
  category: 'fun',
  buildSlash() {
    return new SlashCommandBuilder().setName('friendship').setDescription('Rate your friendship.').addUserOption((o) => o.setName('user').setDescription('Friend to rate with').setRequired(true));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user: i.options.getUser('user', true) }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user = await resolveUser(m.guild!, raw[0]);
    if (!user) throw new Error('User required');
    return { user };
  },
  async run(ctx: CommandContext) {
    const { user } = ctx.args as any;
    const score = Math.floor(Math.random() * 100) + 1;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: 'Friendship Meter', description: `${ctx.user.tag} ↔ ${user.tag}\n**${score}%**` })] });
  },
};

const ship: CommandDefinition = {
  name: 'ship',
  description: 'Ship two users.',
  category: 'fun',
  buildSlash() {
    return new SlashCommandBuilder().setName('ship').setDescription('Ship two users.').addUserOption((o) => o.setName('user1').setDescription('First user').setRequired(true)).addUserOption((o) => o.setName('user2').setDescription('Second user (defaults to you)').setRequired(false));
  },
  async parseSlash(i: ChatInputCommandInteraction) { return { user1: i.options.getUser('user1', true), user2: i.options.getUser('user2') }; },
  async parsePrefix(m: Message, raw: string[]) {
    const user1 = await resolveUser(m.guild!, raw[0]);
    const user2 = raw[1] ? await resolveUser(m.guild!, raw[1]) : null;
    if (!user1) throw new Error('Two users required');
    return { user1, user2: user2 ?? m.author };
  },
  async run(ctx: CommandContext) {
    const { user1, user2 } = ctx.args as any;
    const score = Math.floor(Math.random() * 100) + 1;
    await respond(ctx, { embeds: [buildEmbed({ tone: 'info', title: '💕 Ship Meter', description: `${user1.tag} ❤️ ${user2.tag}\n**${score}%**` })] });
  },
};

[eightBall, coinflip, dice, trivia, friendship, ship].forEach(registerCommand);
export default eightBall;