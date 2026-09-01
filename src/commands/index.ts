/**
 * Zabron — Command barrel.
 *
 * Importing this file (for its side effects) registers every command
 * with the shared registry. Both the bot entry point (src/index.ts)
 * and the standalone registration script (src/handlers/registerCommands.ts)
 * import from here so the registry is always populated identically,
 * regardless of which entry point runs.
 *
 * To add a new command: add a single import line below. Nothing else
 * needs to change in the runtime or the registration script.
 */

// Side-effect imports — each module self-registers with the registry.
import './moderation/ban.js';
import './moderation/unban.js';
import './moderation/kick.js';
import './moderation/timeout.js';
import './moderation/untimeout.js';
import './moderation/warn.js';
import './moderation/warnings.js';
import './moderation/purge.js';
import './moderation/softban.js';
import './moderation/lock.js';
import './moderation/slowmode.js';
import './moderation/nick.js';
import './moderation/role.js';
import './moderation/voicekick.js';
import './moderation/modlogs.js';
import './moderation/clear.js';

import './management/info.js';
import './management/roleManage.js';
import './management/channelManage.js';
import './management/invites.js';

import './configuration/prefix.js';
import './configuration/logging.js';
import './configuration/welcome.js';
import './configuration/setup.js';
import './configuration/settings.js';

import './security/security.js';
import './security/antinuke.js';
import './security/antiraid.js';
import './security/panic.js';
import './security/automod.js';

import './utility/util.js';
import './fun/fun.js';
import './community/community.js';
import './community/stats.js';
import './roles/rolePanel.js';
import './voice/tempvoice.js';
import './giveaways/giveaway.js';
import './leveling/leveling.js';
import './tickets/tickets.js';
import './automation/automation.js';
