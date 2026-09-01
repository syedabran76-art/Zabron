/**
 * /automation — Manage automation workflows.
 */

import { ChatInputCommandInteraction, Message, PermissionFlagsBits, SlashCommandBuilder } from 'discord.js';

import type { CommandContext, CommandDefinition } from '../../types/index.js';
import { registerCommand } from '../../handlers/registry.js';
import { respond } from '../../handlers/respond.js';
import { buildEmbed } from '../../embeds/builders.js';
import { randomToken } from '../../utils/ids.js';
import { listWorkflows, insertWorkflow, deleteWorkflow } from '../../db/repositories.js';
import { parseJSON } from '../../services/automation.js';

const def: CommandDefinition = {
  name: 'automation',
  description: 'Manage automation workflows.',
  category: 'automation',
  userPermissions: ['ManageGuild'],
  cooldownSeconds: 5,

  buildSlash() {
    return new SlashCommandBuilder()
      .setName('automation')
      .setDescription('Workflows.')
      .addSubcommand((s) => s.setName('list').setDescription('List workflows'))
      .addSubcommand((s) => s.setName('create').setDescription('Create a workflow').addStringOption((o) => o.setName('name').setDescription('Workflow name').setRequired(true)).addStringOption((o) => o.setName('trigger').setDescription('Event that fires the workflow').addChoices({ name: 'member_join', value: 'member_join' }, { name: 'member_leave', value: 'member_leave' }, { name: 'message_create', value: 'message_create' }, { name: 'warn_added', value: 'warn_added' }).setRequired(true)).addStringOption((o) => o.setName('actions').setDescription('JSON actions array').setRequired(true)).addStringOption((o) => o.setName('conditions').setDescription('JSON conditions array').setRequired(false)))
      .addSubcommand((s) => s.setName('delete').setDescription('Delete workflow').addStringOption((o) => o.setName('id').setDescription('Workflow ID to delete').setRequired(true)))
      .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild);
  },

  async parseSlash(i: ChatInputCommandInteraction) {
    return {
      sub: i.options.getSubcommand(),
      name: i.options.getString('name'),
      trigger: i.options.getString('trigger'),
      actions: i.options.getString('actions'),
      conditions: i.options.getString('conditions'),
      id: i.options.getString('id'),
    };
  },

  async parsePrefix(_m: Message, raw: string[]) { return { sub: raw[0] ?? 'list', name: raw[1], trigger: raw[2], actions: raw[3], conditions: raw[4], id: raw[1] }; },

  async run(ctx: CommandContext) {
    if (!ctx.guild) return;
    const args = ctx.args as any;
    if (args.sub === 'create') {
      if (!args.name || !args.trigger || !args.actions) { await respond(ctx, { embeds: [buildEmbed({ tone: 'warning', title: 'Name, trigger and actions are required.' })] }); return; }
      let parsedActions: unknown;
      try { parsedActions = JSON.parse(args.actions); } catch { await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Actions must be valid JSON.' })] }); return; }
      const parsedConditions = args.conditions ? parseJSON(args.conditions, []) : [];
      const id = `WF-${randomToken(5)}`;
      insertWorkflow({
        id,
        guildId: ctx.guild.id,
        name: args.name,
        enabled: true,
        trigger: args.trigger,
        conditions: JSON.stringify(parsedConditions),
        actions: JSON.stringify(parsedActions),
        createdAt: Date.now(),
      });
      await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Workflow created', description: `ID: ${id}` })] });
      return;
    }
    if (args.sub === 'delete') {
      const ok = deleteWorkflow(ctx.guild.id, args.id);
      if (ok) await respond(ctx, { embeds: [buildEmbed({ tone: 'success', title: 'Workflow deleted' })] });
      else await respond(ctx, { embeds: [buildEmbed({ tone: 'error', title: 'Not found.' })] });
      return;
    }
    const list = listWorkflows(ctx.guild.id);
    await respond(ctx, { embeds: [buildEmbed({ tone: 'configuration', title: 'Workflows', description: list.length ? list.map((w) => `\`${w.id}\` — **${w.name}** (${w.trigger})`).join('\n') : 'No workflows yet.' }) ] });
  },
};

registerCommand(def);
export default def;